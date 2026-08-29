#!/usr/bin/env python3
"""Адресный справочник Малмыжа из OpenStreetMap.

Заменяет внешний геокодер целиком: 103 улицы и около 2 100 адресованных объектов
умещаются в файл на полтораста килобайт, а поиск становится локальным. Обоснование —
docs/PROBE_MAPS_PROVIDER.md §6.

Два правила, которые пришлось вывести замером и которые здесь соблюдаются:

  · **Один запрос, а не серия.** Публичный Overpass отдаёт 429 уже на десятке
    запросов подряд, а второй публичный инстанс в день замера не отвечал вовсе.
  · **Сырой ответ сохраняется артефактом.** Он и есть наш запасной источник:
    второго зеркала у нас нет, а обновление нужно примерно раз в год — за
    12 месяцев в границе города меняется 9 объектов из 3 151.

Границей берётся сама OSM-граница города (relation/2371919), а не прямоугольник:
прямоугольник первой редакции M0.B срезал юг и восток города — четыре улицы
целиком — и захватывал улицы соседних деревень.

Запуск:  python scripts/build_address_index.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OVERPASS = "https://overpass-api.de/api/interpreter"
CITY_RELATION = 2371919

QUERY = f"""[out:json][timeout:240];
rel({CITY_RELATION});
map_to_area->.city;
(
  way["highway"]["name"](area.city);
  node["addr:housenumber"](area.city);
  way["addr:housenumber"](area.city);
  relation["addr:housenumber"](area.city);
);
out tags center;
"""


def fetch(attempts: int = 4) -> dict:
    delay = 8
    for i in range(1, attempts + 1):
        try:
            req = urllib.request.Request(
                OVERPASS,
                data=QUERY.encode("utf-8"),
                headers={"User-Agent": "TaksiMalmyzh-address-build/1.0"},
            )
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == attempts:
                raise
            print(f"  попытка {i}: 429, жду {delay} с", file=sys.stderr)
        except urllib.error.URLError as e:
            if i == attempts:
                raise
            print(f"  попытка {i}: {e.reason}, жду {delay} с", file=sys.stderr)
        time.sleep(delay)
        delay *= 2
    raise SystemExit("Overpass не ответил")


def normalize(s: str) -> str:
    """Ключ для поиска: регистр и ё не должны мешать найти улицу."""
    return s.lower().replace("ё", "е")


def build(raw: dict) -> dict:
    streets: dict[str, dict] = {}
    addresses: list[list] = []

    for el in raw["elements"]:
        t = el.get("tags") or {}
        name = t.get("name")
        if t.get("highway") and name:
            c = el.get("center") or {}
            s = streets.setdefault(name, {"name": name, "lat": None, "lon": None, "n": 0})
            if c.get("lat") is not None and s["lat"] is None:
                s["lat"], s["lon"] = round(c["lat"], 6), round(c["lon"], 6)

        house = t.get("addr:housenumber")
        if house:
            c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
            if c.get("lat") is None:
                continue
            street = t.get("addr:street") or ""
            addresses.append([street, house, round(c["lat"], 6), round(c["lon"], 6)])
            if street:
                s = streets.setdefault(
                    street, {"name": street, "lat": None, "lon": None, "n": 0}
                )
                s["n"] += 1
                if s["lat"] is None:
                    s["lat"], s["lon"] = round(c["lat"], 6), round(c["lon"], 6)

    addresses.sort(key=lambda a: (normalize(a[0]), len(a[1]), a[1]))
    ordered = sorted(streets.values(), key=lambda s: normalize(s["name"]))

    return {
        "source": "OpenStreetMap",
        "licence": "ODbL 1.0",
        "attribution": "© OpenStreetMap contributors",
        "boundary": f"relation/{CITY_RELATION}",
        "streets": ordered,
        "addresses": addresses,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--raw", type=Path, default=Path("data/osm/malmyzh-raw.json"),
                   help="куда положить сырой ответ Overpass — он же запасной источник")
    p.add_argument("--out", type=Path, default=Path("data/addresses.json"))
    p.add_argument("--offline", action="store_true",
                   help="не ходить в сеть, пересобрать из сохранённого сырого ответа")
    a = p.parse_args()

    if a.offline:
        print(f"· беру сохранённый ответ {a.raw}")
        raw = json.loads(a.raw.read_text(encoding="utf-8"))
    else:
        print("· один запрос к Overpass по границе города")
        raw = fetch()
        a.raw.parent.mkdir(parents=True, exist_ok=True)
        a.raw.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        print(f"  сырой ответ сохранён: {a.raw} ({a.raw.stat().st_size:,} Б)")

    index = build(raw)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    named = [s for s in index["streets"] if s["n"] > 0]
    print(f"· улиц всего {len(index['streets'])}, из них с адресами {len(named)}")
    print(f"· адресов {len(index['addresses'])}")
    print(f"· записано: {a.out} ({a.out.stat().st_size:,} Б "
          f"= {a.out.stat().st_size / 1024:.0f} КиБ)")

    # Контроль: четыре улицы, которые выпадали из прямоугольника первой редакции.
    # Если они снова пропали, значит граница взята неверно.
    control = ["Прибрежная улица", "Пристанская улица", "Флотская улица", "Тихий переулок"]
    have = {s["name"] for s in index["streets"]}
    missing = [c for c in control if c not in have]
    if missing:
        raise SystemExit(f"КОНТРОЛЬ НЕ ПРОЙДЕН: нет улиц {missing}")
    print(f"· контроль пройден: все четыре улицы приречной части на месте")


if __name__ == "__main__":
    main()
