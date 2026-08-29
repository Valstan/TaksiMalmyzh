# Лицензии данных и ассетов карты

Этот каталог содержит чужие данные и файлы, перенесённые к нам сознательно: браузер
пассажира не должен ходить на зарубежные хосты (разбор — [`docs/PROBE_MAPS_PROVIDER.md`](../../docs/PROBE_MAPS_PROVIDER.md) §6).
Перенос к себе — это распространение, поэтому лицензии едут вместе с файлами.

## `malmyzh.pmtiles` — карта

Вырезка из ежедневной сборки Protomaps по границе Малмыжа, собирается
`scripts/build_map_extract.py`.

- Исходные данные: **OpenStreetMap**, лицензия **ODbL 1.0**.
- Сама сборка распространяется вендором как **Produced Work** по ODbL: share-alike на
  неё не распространяется (ODbL §4.5 b), требуется атрибуция OpenStreetMap.
- Обязательная подпись: «© OpenStreetMap contributors», где слово OpenStreetMap —
  ссылка на `https://openstreetmap.org/copyright`.

## `fonts/` — глифы подписей

Noto Sans, взяты из репозитория `protomaps/basemaps-assets`.

- Лицензия: **SIL Open Font License 1.1**, полный текст — [`fonts/OFL.txt`](fonts/OFL.txt).
- Файлы не изменялись; отобраны только диапазоны, которые встречаются в подписях
  нашей вырезки (`scripts/fetch_map_assets.py`).

## `sprites/` — значки

Из того же репозитория; производные от **MIT**-лицензированных `tangrams/icons`.

## `maplibre/` — воркер MapLibre GL JS

Копия из `node_modules`, создаётся при сборке и в Git не хранится.
Лицензия **BSD-3-Clause** — в самом пакете `maplibre-gl`.

## Адресный справочник

Лежит не здесь, а в `data/addresses.json`. Это **производная база** по ODbL §4.4 b,
и у неё есть отдельная обязанность §4.6: когда поиском начнут пользоваться
посторонние (этап B), надо предложить им копию базы или файл изменений. Разбор —
[`docs/PROBE_MAPS_PROVIDER.md`](../../docs/PROBE_MAPS_PROVIDER.md) §9.3.
