#!/usr/bin/env bash
# Проверка гео-блока — пункт 0 спринта 1 и последний открытый пункт M0.B.
#
# ЗАЧЕМ. Все пробы агента шли не из России: в M0.B (2026-08-25) точка выхода оказалась
# немецкой, 2026-08-29 — австралийской, и туннель снимается только владельцем.
#
# Половина вопроса уже закрыта без этого скрипта (M0.B §4.1): замер с трёх российских узлов
# показал, что зарубежные хосты российским адресам не отказывают и DNS не подменён. Осталась
# вторая половина — ДОМАШНИЙ канал в Малмыже, которого сторонний измеритель не видит: его узлы
# датацентровые. Скрипт отвечает ровно на это и больше ни на что.
#
# КАК ЗАПУСКАТЬ. Из Git Bash, **с выключенным VPN/прокси**, из Малмыжа или любой точки РФ:
#
#     bash scripts/probe-geoblock.sh
#
# Отчёт печатается на экран и дублируется в geoblock-report.txt рядом. Файл в репозиторий
# не коммитим — он попадает под .gitignore; результат переносится в PROBE_MAPS_PROVIDER.md
# словами.
#
# Скрипт ничего не устанавливает, никуда не логинится и не передаёт наружу ничего,
# кроме самих HTTP-запросов к перечисленным ниже публичным адресам.

set -u

REPORT="${1:-geoblock-report.txt}"
: > "$REPORT"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }

FAIL_BLOCKING=0
FAIL_BUILD=0

# --- 1. Точка выхода: без неё весь остальной вывод бессмыслен ----------------------------

say "=============================================================="
say " Проверка гео-блока — TaksiMalmyzh, M0.B пункт 4"
say " Дата: $(date '+%Y-%m-%d %H:%M %Z')"
say "=============================================================="
say ""

EGRESS_JSON=$(curl -sS --max-time 25 https://ifconfig.co/json 2>/dev/null)
COUNTRY=$(printf '%s' "$EGRESS_JSON" | grep -o '"country_iso"[^,]*' | cut -d'"' -f4)
EGRESS_IP=$(printf '%s' "$EGRESS_JSON" | grep -o '"ip"[^,]*' | head -1 | cut -d'"' -f4)
ASN=$(printf '%s' "$EGRESS_JSON" | grep -o '"asn_org"[^,]*' | cut -d'"' -f4)

if [ -z "$COUNTRY" ]; then
  say "!! Не удалось определить точку выхода — нет ответа от ifconfig.co."
  say "   Проверь связь и запусти снова. Без этого шага результат интерпретировать нельзя."
  exit 2
fi

say "Точка выхода: $EGRESS_IP  страна=$COUNTRY  сеть=$ASN"
if [ -n "${HTTP_PROXY:-}${HTTPS_PROXY:-}${http_proxy:-}${https_proxy:-}" ]; then
  say "!! В окружении заданы proxy-переменные — трафик может идти не туда, куда кажется."
fi

if [ "$COUNTRY" != "RU" ]; then
  say ""
  say "!! ОСТАНОВКА: точка выхода не российская ($COUNTRY)."
  say "   Именно этим дефектом обесценены пробы M0.B и сессии 2026-08-29."
  say "   Выключи VPN/прокси и запусти снова, иначе результат не отвечает на заданный вопрос."
  say ""
  say "   Дальше проверки всё равно выполнятся — но их вывод НЕ является ответом на пункт 0."
  say ""
fi

# --- 2. Проверки, сгруппированные по тому, что ломается при отказе ------------------------

probe() {
  tier="$1"; key="$2"; url="$3"; expect="$4"; shift 4
  out=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null \
        -w '%{http_code} %{time_total} %{ssl_verify_result}' "$@" "$url" 2>/dev/null)
  rc=$?
  code=$(printf '%s' "$out" | cut -d' ' -f1)
  secs=$(printf '%s' "$out" | cut -d' ' -f2)
  tls=$(printf '%s' "$out" | cut -d' ' -f3)

  if [ $rc -ne 0 ]; then
    verdict="СБОЙ(curl $rc)"
  elif printf '%s' "$expect" | tr ',' '\n' | grep -qx "$code"; then
    verdict="ok"
  else
    verdict="НЕ ОЖИДАЛОСЬ ($code)"
  fi

  if [ "$verdict" != "ok" ]; then
    case "$tier" in
      RUNTIME) FAIL_BLOCKING=$((FAIL_BLOCKING + 1)) ;;
      BUILD)   FAIL_BUILD=$((FAIL_BUILD + 1)) ;;
    esac
  fi

  printf '  %-9s %-22s %-14s %6ss  tls=%s\n' "[$tier]" "$key" "$verdict" "$secs" "$tls" | tee -a "$REPORT"
}

say ""
say "--- RUNTIME: к этим хостам ходит браузер пассажира. Отказ ломает продукт у людей."
say "    (в целевой архитектуре их быть не должно: шрифты и спрайты кладём к себе —"
say "     проверяем именно потому, что дефолтный стиль Protomaps ходит сюда сам)"
probe RUNTIME protomaps-fonts   'https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/0-255.pbf' 200
probe RUNTIME protomaps-sprites 'https://protomaps.github.io/basemaps-assets/sprites/v4/light.json' 200

say ""
say "--- BUILD: нужны разработчику и серверу для обновления карты. Отказ ломает сборку."
probe BUILD protomaps-daily   'https://build.protomaps.com/20260828.pmtiles' 206 -r 0-16
probe BUILD geofabrik-index   'https://download.geofabrik.de/russia.html' 200
probe BUILD geofabrik-pbf     'https://download.geofabrik.de/russia/volga-fed-district-latest.osm.pbf' 200,302 -I
probe BUILD overpass-de       'https://overpass-api.de/api/status' 200
probe BUILD overpass-kumi     'https://overpass.kumi.systems/api/status' 200
probe BUILD npm-registry      'https://registry.npmjs.org/maplibre-gl' 200
probe BUILD github-api        'https://api.github.com/repos/protomaps/go-pmtiles/releases/latest' 200
probe BUILD github-raw        'https://raw.githubusercontent.com/protomaps/go-pmtiles/main/README.md' 200 -I
probe BUILD nodejs-dist       'https://nodejs.org/dist/index.json' 200
probe BUILD dockerhub-auth    'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull' 200

say ""
say "--- INFO: не нужны выбранному пути, меряются для планов Б."
probe INFO osm-tile-malmyzh 'https://tile.openstreetmap.org/13/5249/2530.png' 200
probe INFO nominatim        'https://nominatim.openstreetmap.org/status' 200
probe INFO yandex-geocoder  'https://geocode-maps.yandex.ru/1.x/?geocode=Malmyzh&format=json' 400
probe INFO 2gis-geocode     'https://catalog.api.2gis.com/3.0/items/geocode?q=Malmyzh' 200
probe INFO dadata           'https://dadata.ru/api/geocode/' 200
probe INFO maptiler         'https://api.maptiler.com/maps/streets-v2/style.json?key=probe' 403

# --- 3. Ещё одна форма блокировки: DNS отвечает, но не тем ---------------------------------

say ""
say "--- Подмена DNS/TLS: ошибка сертификата (tls != 0) означает перехват, а не отсутствие связи."

# --- 4. Итог -------------------------------------------------------------------------------

say ""
say "=============================================================="
if [ "$COUNTRY" != "RU" ]; then
  say " ИТОГ: пункт 0 НЕ ЗАКРЫТ — проба шла не из России ($COUNTRY)."
elif [ "$FAIL_BLOCKING" -eq 0 ] && [ "$FAIL_BUILD" -eq 0 ]; then
  say " ИТОГ: гео-блока нет. Пункт 0 закрыт, рекомендованный путь OSM подтверждён."
elif [ "$FAIL_BLOCKING" -eq 0 ]; then
  say " ИТОГ: рантайм чист, но сборка задета ($FAIL_BUILD шт.)."
  say "       Продукт живёт, но обновление карты требует зеркала или сборки в CI."
else
  say " ИТОГ: задет РАНТАЙМ ($FAIL_BLOCKING шт.) и сборка ($FAIL_BUILD шт.)."
  say "       Шрифты и спрайты обязаны лежать на своей статике — иначе карта будет"
  say "       без подписей у части пользователей."
fi
say " Отчёт сохранён: $REPORT"
say "=============================================================="
