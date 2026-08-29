#!/usr/bin/env python3
"""Перенос шрифтов и спрайтов карты на свою статику.

Зачем. Дефолтный стиль @protomaps/basemaps жёстко указывает `glyphs` и `sprite`
на protomaps.github.io — то есть браузер пассажира ходил бы на зарубежный хост при
каждом рендере карты. Разбор — docs/PROBE_MAPS_PROVIDER.md §6.

Что делает:
  1. читает нашу вырезку .pmtiles и собирает кодовые точки всех подписей в ней;
  2. по ним вычисляет, какие диапазоны глифов нужны на самом деле, — вместо того
     чтобы тянуть все 256 диапазонов на каждый шрифт;
  3. скачивает эти диапазоны для трёх наборов, которые использует стиль,
     и файлы спрайта;
  4. печатает итоговый размер.

Лицензии переносимого (их место — в NOTICE рядом с файлами):
  шрифты  — SIL Open Font License;
  спрайты — производные от MIT-лицензированных tangrams/icons.

Запуск:  python scripts/fetch_map_assets.py
"""

from __future__ import annotations

import argparse
import gzip
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ASSETS = "https://protomaps.github.io/basemaps-assets"
FONTSTACKS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]
SPRITE_FLAVOR = "light"
UA = {"User-Agent": "TaksiMalmyzh-map-build/1.0"}

# Диапазоны, нужные всегда: базовая латиница с пунктуацией — в неё попадают
# цифры домов и служебные символы, даже если в подписях один кириллический текст.
ALWAYS = {0}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def read_varint(buf: bytes, pos: int):
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def parse_directory(raw: bytes):
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


def pb_fields(buf: bytes):
    """Минимальный разбор protobuf: отдаёт (номер поля, wire type, значение).

    Скан тайла регулярным выражением сюда не годится: он принимает куски
    бинарной геометрии за текст и добавляет сотни несуществующих кодовых точек.
    Нужны ровно строковые значения атрибутов, а они лежат в известных полях.
    """
    pos, n = 0, len(buf)
    while pos < n:
        key, pos = read_varint(buf, pos)
        field, wire = key >> 3, key & 7
        if wire == 0:
            val, pos = read_varint(buf, pos)
            yield field, wire, val
        elif wire == 1:
            yield field, wire, buf[pos : pos + 8]
            pos += 8
        elif wire == 2:
            ln, pos = read_varint(buf, pos)
            yield field, wire, buf[pos : pos + ln]
            pos += ln
        elif wire == 5:
            yield field, wire, buf[pos : pos + 4]
            pos += 4
        else:
            raise ValueError(f"неизвестный wire type {wire}")


def mvt_strings(tile: bytes):
    """Строковые значения атрибутов тайла (vector_tile.proto).

    Tile.layers = 3 → Layer.values = 4 → Value.string_value = 1.
    Дополнительно Layer.keys = 3 — имена атрибутов; в подписи они не попадают,
    но и вреда от них нет, а пропуск диапазона стоил бы квадратиков вместо букв.
    """
    for f, w, layer in pb_fields(tile):
        if f != 3 or w != 2:
            continue
        for lf, lw, v in pb_fields(layer):
            if lw != 2:
                continue
            if lf == 3:
                yield v.decode("utf-8", errors="replace")
            elif lf == 4:
                for vf, vw, sv in pb_fields(v):
                    if vf == 1 and vw == 2:
                        yield sv.decode("utf-8", errors="replace")


def codepoints_of_extract(path: Path) -> set[int]:
    blob = path.read_bytes()
    h = blob[:127]
    if h[:7] != b"PMTiles" or h[7] != 3:
        raise SystemExit(f"{path} — не архив PMTiles v3")
    f = struct.unpack_from
    root_off, root_len = f("<Q", h, 8)[0], f("<Q", h, 16)[0]
    tile_off = f("<Q", h, 56)[0]
    tile_comp = h[98]
    entries = parse_directory(gzip.decompress(blob[root_off : root_off + root_len]))

    seen: set[int] = set()
    for _tid, off, ln, _run in entries:
        body = blob[tile_off + off : tile_off + off + ln]
        if tile_comp == 2:
            body = gzip.decompress(body)
        for s in mvt_strings(body):
            seen.update(ord(c) for c in s)
    return seen


def ranges_for(codepoints: set[int]) -> list[int]:
    buckets = {cp // 256 for cp in codepoints if cp < 65536} | ALWAYS
    return sorted(buckets)


def fetch_glyphs(out: Path, stacks: list[str], buckets: list[int]) -> int:
    total = 0
    for stack in stacks:
        d = out / "fonts" / stack
        d.mkdir(parents=True, exist_ok=True)
        got = 0
        for b in buckets:
            name = f"{b * 256}-{b * 256 + 255}.pbf"
            url = f"{ASSETS}/fonts/{urllib.parse.quote(stack)}/{name}"
            try:
                data = get(url)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    continue  # диапазон в этом шрифте не покрыт — это нормально
                raise
            (d / name).write_bytes(data)
            total += len(data)
            got += 1
        print(f"  {stack:<20} диапазонов {got}/{len(buckets)}")
    return total


def fetch_sprites(out: Path, flavor: str) -> int:
    d = out / "sprites"
    d.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in (f"{flavor}.json", f"{flavor}.png", f"{flavor}@2x.json", f"{flavor}@2x.png"):
        try:
            data = get(f"{ASSETS}/sprites/v4/{name}")
        except urllib.error.HTTPError as e:
            print(f"  {name}: HTTP {e.code} — пропущен")
            continue
        (d / name).write_bytes(data)
        total += len(data)
        print(f"  {name:<18} {len(data):>8,} Б")
    return total


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--extract", type=Path, default=Path("public/map/malmyzh.pmtiles"))
    p.add_argument("--out", type=Path, default=Path("public/map"))
    a = p.parse_args()

    print("· считаю кодовые точки подписей в вырезке")
    cps = codepoints_of_extract(a.extract)
    buckets = ranges_for(cps)
    print(f"  различных символов {len(cps)}, диапазонов нужно {len(buckets)}: "
          + ", ".join(f"{b * 256}-{b * 256 + 255}" for b in buckets))

    print("· качаю глифы")
    g = fetch_glyphs(a.out, FONTSTACKS, buckets)
    print("· качаю спрайты")
    s = fetch_sprites(a.out, SPRITE_FLAVOR)

    print(f"· итого перенесено: глифы {g / 1024:.0f} КиБ, спрайты {s / 1024:.0f} КиБ, "
          f"вместе {(g + s) / 1024:.0f} КиБ")


if __name__ == "__main__":
    main()
