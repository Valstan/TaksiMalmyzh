#!/usr/bin/env bash
# Активация релиза на прод-боксе. Выполняется НА СЕРВЕРЕ: workflow отдаёт этот файл
# по ssh на stdin, а не сочиняет команды внутри себя.
#
# Так сделано по мандату D-046: текст, написанный внутри команды, проходит до четырёх
# парсеров — кавычки шага, локальный shell, ssh, удалённый shell, — и ломается на любом
# из них, а выглядит это как ошибка в коде. Файл проходит ноль.
#
# Аргументы: <каталог приложения> <имя релиза> <имя службы>

set -euo pipefail

APP_DIR="${1:?не задан каталог приложения}"
RELEASE="${2:?не задано имя релиза}"
SERVICE="${3:?не задано имя службы}"

INCOMING="$APP_DIR/incoming.tar.gz"
TARGET="$APP_DIR/releases/$RELEASE"

test -f "$INCOMING" || { echo "нет пакета $INCOMING" >&2; exit 1; }

mkdir -p "$TARGET"
tar -xzf "$INCOMING" -C "$TARGET"
rm -f "$INCOMING"

# Пакет считается годным, только если в нём есть всё, без чего приложение
# поднимется, но окажется сломанным у пользователя.
for required in "server.js" ".next/static" "public/map/malmyzh.pmtiles" "data/addresses.json"; do
  test -e "$TARGET/$required" || { echo "в пакете нет $required" >&2; rm -rf "$TARGET"; exit 1; }
done

# Переключение симлинка атомарно: mv -T заменяет его одним шагом, без промежутка,
# когда current не существует.
ln -sfn "$TARGET" "$APP_DIR/current.new"
mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"

sudo systemctl restart "$SERVICE"

# Оставляем пять последних релизов: откат — это переключение симлинка назад,
# и откатываться должно быть куда.
ls -1dt "$APP_DIR/releases"/* | tail -n +6 | xargs -r rm -rf

echo "релиз $RELEASE активирован"
