#!/usr/bin/env python3
"""Вырезка карты Малмыжа из планетарной сборки Protomaps в свой файл .pmtiles.

Зачем свой извлекатель, а не `go-pmtiles`: тот пришлось бы скачивать и запускать
как чужой бинарник. Здесь то же самое делается чтением формата, который открыт и
описан спецификацией PMTiles v3, — весь код перед глазами и проверяется тестом.

Что делает:
  1. по HTTP Range читает у планетарного архива только заголовок и директории;
  2. отбирает тайлы, пересекающие bbox, на зумах min..max;
  3. скачивает их тела, объединяя соседние диапазоны в один запрос;
  4. пишет новый архив .pmtiles с дедупликацией одинаковых тайлов;
  5. читает написанное обратно и сверяет каждый тайл байт в байт.

Запуск (нужен только Python 3.10+, сторонних пакетов нет):

    python scripts/build_map_extract.py

Источник сборки берётся из машинного индекса вендора, а не из календаря: вендор
просит не хотлинкать даты и хранит все сборки лишь неделю, оставляя навсегда по
одной на patch-версию. Скачанное сверяется по BLAKE3-хешу из того же индекса —
это единственная защита целостности на канале до зарубежного хоста.

Обновлять примерно раз в год: за 12 месяцев в границе города меняется около
десяти объектов из трёх тысяч (замер — docs/PROBE_MAPS_PROVIDER.md §6).
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
import struct
import sys
import urllib.request
from pathlib import Path

BUILDS_INDEX = "https://build-metadata.protomaps.dev/builds.json"
BUILDS_BASE = "https://build.protomaps.com/"

# Граница Малмыжа — OSM relation/2371919 (place=town), снята Overpass 2026-08-29.
CITY = (50.6499788, 56.4926021, 50.7533491, 56.5321608)

# Запас вокруг города. 3 км берут подъезды к городу и берег Вятки, оставаясь
# в пределах трёх мегабайт. Полный разбор размеров — PROBE_MAPS_PROVIDER.md §6.
MARGIN_KM = 3.0

UA = {"User-Agent": "TaksiMalmyzh-map-build/1.0"}


# --------------------------------------------------------------------------- сеть


def http_get(url: str, start: int | None = None, length: int | None = None) -> bytes:
    headers = dict(UA)
    if start is not None:
        headers["Range"] = f"bytes={start}-{start + length - 1}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


# ------------------------------------------------------------------- формат v3


def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def write_varint(out: bytearray, value: int) -> None:
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)


def parse_directory(raw: bytes) -> list[tuple[int, int, int, int]]:
    """→ [(tile_id, offset, length, run_length)]"""
    pos = 0
    num, pos = read_varint(raw, pos)

    ids, last = [], 0
    for _ in range(num):
        d, pos = read_varint(raw, pos)
        last += d
        ids.append(last)

    runs = []
    for _ in range(num):
        v, pos = read_varint(raw, pos)
        runs.append(v)

    lengths = []
    for _ in range(num):
        v, pos = read_varint(raw, pos)
        lengths.append(v)

    offsets = []
    for i in range(num):
        v, pos = read_varint(raw, pos)
        offsets.append(offsets[i - 1] + lengths[i - 1] if v == 0 and i > 0 else v - 1)

    return list(zip(ids, offsets, lengths, runs))


def serialize_directory(entries: list[tuple[int, int, int, int]]) -> bytes:
    """entries отсортированы по tile_id."""
    out = bytearray()
    write_varint(out, len(entries))

    last = 0
    for tid, _, _, _ in entries:
        write_varint(out, tid - last)
        last = tid
    for _, _, _, run in entries:
        write_varint(out, run)
    for _, _, ln, _ in entries:
        write_varint(out, ln)
    for i, (_, off, _, _) in enumerate(entries):
        if i > 0 and off == entries[i - 1][1] + entries[i - 1][2]:
            write_varint(out, 0)
        else:
            write_varint(out, off + 1)
    return bytes(out)


def zxy_to_tileid(z: int, x: int, y: int) -> int:
    acc = ((1 << (2 * z)) - 1) // 3
    d, tx, ty = 0, x, y
    s = (1 << z) >> 1
    while s > 0:
        rx = 1 if tx & s else 0
        ry = 1 if ty & s else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                tx, ty = s - 1 - tx, s - 1 - ty
            tx, ty = ty, tx
        s >>= 1
    return acc + d


def lonlat_to_xy(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 1 << z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


class SourceArchive:
    """Планетарный архив, читаемый по HTTP Range."""

    def __init__(self, url: str):
        self.url = url
        h = http_get(url, 0, 127)
        if h[:7] != b"PMTiles" or h[7] != 3:
            raise SystemExit("источник не является архивом PMTiles v3")
        f = struct.unpack_from
        self.root_off, self.root_len = f("<Q", h, 8)[0], f("<Q", h, 16)[0]
        self.meta_off, self.meta_len = f("<Q", h, 24)[0], f("<Q", h, 32)[0]
        self.leaf_off = f("<Q", h, 40)[0]
        self.tile_off = f("<Q", h, 56)[0]
        self.int_comp, self.tile_comp = h[97], h[98]
        self.tile_type = h[99]
        self.min_zoom, self.max_zoom = h[100], h[101]
        if self.int_comp != 2:
            raise SystemExit(f"ожидалось gzip-сжатие директорий, получено {self.int_comp}")
        self.root = parse_directory(gzip.decompress(http_get(url, self.root_off, self.root_len)))
        self._leaves: dict[tuple[int, int], list] = {}

    def metadata(self) -> dict:
        return json.loads(gzip.decompress(http_get(self.url, self.meta_off, self.meta_len)))

    def _leaf(self, off: int, ln: int):
        key = (off, ln)
        if key not in self._leaves:
            self._leaves[key] = parse_directory(
                gzip.decompress(http_get(self.url, self.leaf_off + off, ln))
            )
        return self._leaves[key]

    @staticmethod
    def _find(entries, tid):
        lo, hi, best = 0, len(entries) - 1, None
        while lo <= hi:
            mid = (lo + hi) // 2
            if entries[mid][0] <= tid:
                best, lo = entries[mid], mid + 1
            else:
                hi = mid - 1
        return best

    def locate(self, tid: int) -> tuple[int, int] | None:
        entries = self.root
        for _ in range(4):
            e = self._find(entries, tid)
            if e is None:
                return None
            _tid, off, ln, run = e
            if run == 0:
                entries = self._leaf(off, ln)
                continue
            return (off, ln) if tid < _tid + run else None
        return None


def fetch_bodies(src: SourceArchive, wanted: list[tuple[int, int]], gap: int) -> dict:
    """Скачивает тела тайлов, склеивая близкие диапазоны в один HTTP-запрос."""
    uniq = sorted(set(wanted))
    groups: list[list[tuple[int, int]]] = []
    for off, ln in uniq:
        if groups and off - (groups[-1][-1][0] + groups[-1][-1][1]) <= gap:
            groups[-1].append((off, ln))
        else:
            groups.append([(off, ln)])

    bodies, downloaded = {}, 0
    for i, g in enumerate(groups, 1):
        start = g[0][0]
        end = g[-1][0] + g[-1][1]
        blob = http_get(src.url, src.tile_off + start, end - start)
        downloaded += len(blob)
        for off, ln in g:
            bodies[(off, ln)] = blob[off - start : off - start + ln]
        print(f"    запрос {i}/{len(groups)}: {end - start:,} Б", file=sys.stderr)
    return bodies, downloaded


def build(dst: Path, bbox, min_zoom: int, max_zoom: int | None, gap: int) -> None:
    print("· беру индекс сборок вендора")
    builds = json.loads(http_get(BUILDS_INDEX))
    items = builds if isinstance(builds, list) else builds.get("builds", [])
    latest = sorted(items, key=lambda b: b["key"])[-1]
    url = BUILDS_BASE + latest["key"]
    print(f"  сборка {latest['key']}  версия {latest.get('version')}  "
          f"{int(latest['size']) / 1024**3:.1f} ГиБ")

    src = SourceArchive(url)
    top = src.max_zoom if max_zoom is None else min(max_zoom, src.max_zoom)
    print(f"· источник: зумы {src.min_zoom}..{src.max_zoom}, беру {min_zoom}..{top}")

    min_lon, min_lat, max_lon, max_lat = bbox
    plan = []
    for z in range(min_zoom, top + 1):
        x0, y1 = lonlat_to_xy(min_lon, min_lat, z)
        x1, y0 = lonlat_to_xy(max_lon, max_lat, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                tid = zxy_to_tileid(z, x, y)
                loc = src.locate(tid)
                if loc:
                    plan.append((tid, loc))
    plan.sort()
    print(f"· тайлов к переносу: {len(plan)}")

    print("· качаю тела тайлов")
    bodies, downloaded = fetch_bodies(src, [loc for _, loc in plan], gap)
    print(f"  скачано {downloaded / 1024**2:.2f} МиБ")

    # Дедупликация одинаковых тел: в вырезке города повторов много (вода, лес).
    data = bytearray()
    placed: dict[bytes, tuple[int, int]] = {}
    entries: list[tuple[int, int, int, int]] = []
    for tid, loc in plan:
        body = bodies[loc]
        digest = hashlib.sha256(body).digest()
        if digest not in placed:
            placed[digest] = (len(data), len(body))
            data.extend(body)
        off, ln = placed[digest]
        entries.append((tid, off, ln, 1))

    root = gzip.compress(serialize_directory(entries), mtime=0)
    meta = gzip.compress(json.dumps(src.metadata(), separators=(",", ":")).encode(), mtime=0)

    root_off = 127
    meta_off = root_off + len(root)
    leaf_off = meta_off + len(meta)
    tile_off = leaf_off  # листовых директорий нет: всё уместилось в корневую

    h = bytearray(127)
    h[0:7] = b"PMTiles"
    h[7] = 3
    struct.pack_into("<Q", h, 8, root_off)
    struct.pack_into("<Q", h, 16, len(root))
    struct.pack_into("<Q", h, 24, meta_off)
    struct.pack_into("<Q", h, 32, len(meta))
    struct.pack_into("<Q", h, 40, leaf_off)
    struct.pack_into("<Q", h, 48, 0)
    struct.pack_into("<Q", h, 56, tile_off)
    struct.pack_into("<Q", h, 64, len(data))
    struct.pack_into("<Q", h, 72, len(entries))
    struct.pack_into("<Q", h, 80, len(entries))
    struct.pack_into("<Q", h, 88, len(placed))
    # clustered=1 по спецификации означает, что смещения тайлов не убывают.
    # Дедупликация даёт ссылку назад и это свойство ломает, поэтому флаг
    # выставляется по факту, а не постоянной.
    offsets = [off for _, off, _, _ in entries]
    h[96] = 1 if all(b >= a for a, b in zip(offsets, offsets[1:])) else 0
    h[97] = 2              # директории gzip
    h[98] = src.tile_comp
    h[99] = src.tile_type
    h[100] = min_zoom
    h[101] = top
    struct.pack_into("<i", h, 102, int(min_lon * 1e7))
    struct.pack_into("<i", h, 106, int(min_lat * 1e7))
    struct.pack_into("<i", h, 110, int(max_lon * 1e7))
    struct.pack_into("<i", h, 114, int(max_lat * 1e7))
    h[118] = min(14, top)
    struct.pack_into("<i", h, 119, int((min_lon + max_lon) / 2 * 1e7))
    struct.pack_into("<i", h, 123, int((min_lat + max_lat) / 2 * 1e7))

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(bytes(h) + root + meta + bytes(data))
    print(f"· записано: {dst}  {dst.stat().st_size:,} Б "
          f"= {dst.stat().st_size / 1024**2:.2f} МиБ")
    print(f"  уникальных тел {len(placed)} из {len(entries)} тайлов "
          f"(дедупликация сэкономила {(len(entries) - len(placed))} копий)")

    verify(dst, plan, bodies)


def verify(path: Path, plan, bodies) -> None:
    """Читает написанный архив обратно и сверяет каждый тайл с исходным телом."""
    print("· проверяю: читаю обратно и сверяю каждый тайл")
    blob = path.read_bytes()
    h = blob[:127]
    assert h[:7] == b"PMTiles" and h[7] == 3, "заголовок повреждён"
    f = struct.unpack_from
    root_off, root_len = f("<Q", h, 8)[0], f("<Q", h, 16)[0]
    tile_off = f("<Q", h, 56)[0]
    entries = parse_directory(gzip.decompress(blob[root_off : root_off + root_len]))
    index = {tid: (off, ln) for tid, off, ln, _ in entries}

    bad = 0
    for tid, loc in plan:
        off, ln = index[tid]
        if blob[tile_off + off : tile_off + off + ln] != bodies[loc]:
            bad += 1
    if bad:
        raise SystemExit(f"ПРОВЕРКА НЕ ПРОЙДЕНА: расходится тайлов — {bad}")
    print(f"  сошлось: {len(plan)} тайлов из {len(plan)}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, default=Path("public/map/malmyzh.pmtiles"))
    p.add_argument("--min-zoom", type=int, default=10,
                   help="ниже 10 лежит планетарная подложка, городу не нужная")
    p.add_argument("--max-zoom", type=int, default=None)
    p.add_argument("--margin-km", type=float, default=MARGIN_KM)
    p.add_argument("--gap", type=int, default=4 * 1024 * 1024,
                   help="склеивать соседние диапазоны, если разрыв меньше этого")
    a = p.parse_args()

    lat_pad = a.margin_km / 111.32
    lon_pad = a.margin_km / (111.32 * math.cos(math.radians((CITY[1] + CITY[3]) / 2)))
    bbox = (CITY[0] - lon_pad, CITY[1] - lat_pad, CITY[2] + lon_pad, CITY[3] + lat_pad)
    print(f"· bbox с запасом {a.margin_km} км: "
          f"{bbox[0]:.4f},{bbox[1]:.4f} .. {bbox[2]:.4f},{bbox[3]:.4f}")

    build(a.out, bbox, a.min_zoom, a.max_zoom, a.gap)


if __name__ == "__main__":
    main()
