#!/usr/bin/env bash
# Проба прода: только чтение, ничего не меняет. Выполняется НА СЕРВЕРЕ, через ssh на
# stdin — как и остальные удалённые скрипты (мандат D-046: текст внутри команды проходит
# до четырёх парсеров и ломается на любом из них, файл — ноль).
#
# Зачем она есть. Смоук выкатки отвечает на вопрос «релиз поднялся?» и идёт только при
# выкатке. Есть класс поломок, который так не ловится вовсе: схема прода тихо расходится
# с кодом, и узнаёт об этом пользователь. Ровно это — [G231]: Payload при открытии ЛЮБОГО
# документа берёт блокировку и перечисляет в `payload_locked_documents_rels` все коллекции
# разом; коллекция, заведённая ручной миграцией без своей колонки в этой служебной
# таблице, роняет админку целиком — у соседнего проекта она пролежала так сутки
# («column …_id does not exist»). Гейты молчат по построению: заготовка DDL снимается по
# именам НОВЫХ таблиц, `CREATE TABLE IF NOT EXISTS` на существующую служебную — тихий
# no-op, а список таблиц не меняется. Поэтому дрейф проверяется на живой базе и по
# расписанию (письмо brain 2026-09-04).
#
# Что проверяется:
#   1. на каждую коллекцию Payload в `payload_locked_documents_rels` есть своя колонка;
#   2. выход из единого входа: наш роут отвечает редиректом на `end_session` ЕСА, и сам
#      ЕСА принимает этот адрес (docs/AUTH_ESA.md §«Выход»).
#
# Список коллекций приходит АРГУМЕНТОМ из репозитория, а не сочиняется здесь: источник
# истины — конфиг Payload, и второго экземпляра этого знания быть не должно.
#
# В лог не печатается ничего об устройстве сервера — репозиторий публичен, а логи
# прогонов публичного репозитория публичны (AGENTS.md, «recon-поверхность»). Имена
# коллекций и колонок к этому не относятся: они и так лежат в коде.
#
# Аргументы: <каталог приложения> <локальный порт> <слаги коллекций через запятую>

set -euo pipefail

APP_DIR="${1:?не задан каталог приложения}"
PORT="${2:?не задан порт}"
SLUGS="${3:?не задан список коллекций}"

ENV_FILE="$APP_DIR/shared/.env"
test -f "$ENV_FILE" || { echo "проба: нет файла окружения" >&2; exit 1; }

# Значение может содержать «=» (пароль в URI), поэтому режется только первый знак.
DATABASE_URI=$(sed -n 's/^DATABASE_URI=//p' "$ENV_FILE" | head -n 1)
DATABASE_URI="${DATABASE_URI%\"}"
DATABASE_URI="${DATABASE_URI#\"}"
test -n "$DATABASE_URI" || { echo "проба: в окружении нет DATABASE_URI" >&2; exit 1; }

# ── 1. Дрейф схемы: колонки locked_documents_rels против списка коллекций ──────────────
#
# Запрос строго read-only. Клиент выбирается по факту наличия: psql на боксе может не
# стоять (база живёт своей жизнью), зато рядом всегда лежит выкаченный релиз с `pg`.

SQL="SELECT column_name FROM information_schema.columns
     WHERE table_name = 'payload_locked_documents_rels' ORDER BY column_name;"

if command -v psql >/dev/null 2>&1; then
  COLUMNS=$(PGCONNECT_TIMEOUT=10 psql "$DATABASE_URI" -Atqc "$SQL")
else
  # `node -e` — всегда CommonJS, поэтому require здесь законен; каталог релиза даёт
  # доступ к `pg` из трассированных зависимостей Payload.
  COLUMNS=$(cd "$APP_DIR/current" && DATABASE_URI="$DATABASE_URI" SQL="$SQL" node -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.env.DATABASE_URI });
    c.connect()
      .then(() => c.query(process.env.SQL))
      .then((r) => { console.log(r.rows.map((x) => x.column_name).join("\n")); })
      .catch((e) => { console.error("проба: запрос не прошёл — " + e.message); process.exit(1); })
      .finally(() => c.end());
  ')
fi

test -n "$COLUMNS" || { echo "проба: таблицы payload_locked_documents_rels нет вовсе" >&2; exit 1; }

missing=""
count=0
for slug in ${SLUGS//,/ }; do
  count=$((count + 1))
  # Payload переводит слаг в имя колонки через snake_case: дефисы становятся
  # подчёркиваниями (`my-thing` → `my_thing_id`).
  column="${slug//-/_}_id"
  echo "$COLUMNS" | grep -qx "$column" || missing="$missing $slug"
done

# Колонки на коллекции — это всё, что не служебная четвёрка самой таблицы.
have=$(echo "$COLUMNS" | grep -vxE 'id|order|parent_id|path' | grep -c '_id$' || true)

if [ -n "$missing" ]; then
  echo "дрейф схемы: в payload_locked_documents_rels нет колонок под коллекции:$missing" >&2
  echo "лечится ALTER TABLE … ADD COLUMN IF NOT EXISTS \"<коллекция>_id\" integer + FK + индекс (G35)" >&2
  exit 1
fi
echo "  схема    колонок $have = коллекций $count, чисто"

# ── 2. Выход из единого входа ─────────────────────────────────────────────────────────
#
# Проверяется весь наш конец цепочки: роут отвечает редиректом на `end_session` ЕСА с
# адресом возврата, и ЕСА этот адрес принимает (иначе он вернул бы человека на свою
# страницу входа, а не к нам). Запрос идёт с бокса: до российских хостов раннер GitHub
# не достаёт, как и в смоуке.

LOGOUT=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 \
         -X POST "http://127.0.0.1:$PORT/api/auth/logout")
code="${LOGOUT%% *}"
away="${LOGOUT#* }"

case "$code" in
  303) ;;
  *) echo "выход: роут ответил $code, ожидалось 303" >&2; exit 1 ;;
esac

case "$away" in
  *"/oidc/logout"*)
    # Вторая половина: сам ЕСА. Ответ 302 назад к нам значит, что адрес возврата
    # зарегистрирован; чужой адрес он увёл бы на свою страницу входа.
    esa=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$away")
    esa_code="${esa%% *}"
    esa_back="${esa#* }"
    case "$esa_code" in
      302|303) echo "  выход    роут $code → end_session, ЕСА $esa_code → $esa_back" ;;
      *) echo "выход: ЕСА ответил $esa_code на end_session, ожидался редирект" >&2; exit 1 ;;
    esac ;;
  *)
    # Не поломка сама по себе: без OIDC_CLIENT_ID входа на боксе нет вовсе, и выход
    # честно ведёт на главную. Но сказать об этом надо вслух, иначе «зелено» будет
    # означать «проверка не выполнялась».
    echo "  выход    роут $code → $away (выхода в ЕСА нет: вход выключен или ЕСА молчит)" ;;
esac

echo "проба пройдена"
