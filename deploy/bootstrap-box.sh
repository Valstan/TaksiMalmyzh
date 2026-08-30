#!/usr/bin/env bash
# Разовая подготовка бокса к выкатке. Запускается ОДИН раз, на сервере, под sudo.
#
# Что делает:
#   1. заводит каталог приложения и место под релизы;
#   2. кладёт публичный деплой-ключ в authorized_keys — им ходит GitHub Actions;
#   3. ставит systemd-юнит и включает службу;
#   4. ставит секцию nginx и перечитывает конфиг.
#
# Чего НЕ делает: не заводит базу данных (спринту 1 она не нужна), не выпускает
# сертификат (он ставится через панель хостера, а не certbot — G150) и не открывает
# сайт наружу, если выбран закрытый режим.
#
# Все значения приходят аргументами: в этом файле нет ни адреса, ни порта, ни путей —
# репозиторий публичный (AGENTS.md, «Публичный репозиторий — recon-поверхность»).
#
# Запуск:
#   sudo bash deploy/bootstrap-box.sh \
#        --user <системный пользователь> \
#        --dir <каталог приложения> \
#        --port <локальный порт> \
#        --service <имя службы> \
#        --domain "<домен> [<домен> ...]" \
#        --key "<строка публичного ключа>" \
#        [--closed <файл паролей basic-auth>]
#
# --domain принимает НЕСКОЛЬКО доменов через пробел: у «ПОЗВОНИ» матрёшка доменов
# (lib/sites.ts), и все они обслуживаются одной секцией nginx и одним приложением.
# Добавить домен позже = запустить этот скрипт ещё раз с ПОЛНЫМ списком: секция
# перезаписывается целиком, ключ и юнит переживают повтор.

set -euo pipefail

APP_USER=""; APP_DIR=""; APP_PORT=""; SERVICE=""; DOMAIN=""; PUBKEY=""; CLOSED=""

while [ $# -gt 0 ]; do
  case "$1" in
    --user)    APP_USER="$2"; shift 2 ;;
    --dir)     APP_DIR="$2"; shift 2 ;;
    --port)    APP_PORT="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --domain)  DOMAIN="$2"; shift 2 ;;
    --key)     PUBKEY="$2"; shift 2 ;;
    --closed)  CLOSED="$2"; shift 2 ;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done

for v in APP_USER APP_DIR APP_PORT SERVICE DOMAIN PUBKEY; do
  [ -n "${!v}" ] || { echo "не задан --${v,,}" >&2; exit 2; }
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "· каталоги"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_DIR" "$APP_DIR/releases" "$APP_DIR/shared"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$APP_DIR/shared"

echo "· деплой-ключ"
HOME_DIR="$(getent passwd "$APP_USER" | cut -d: -f6)"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$HOME_DIR/.ssh"
touch "$HOME_DIR/.ssh/authorized_keys"
chown "$APP_USER:$APP_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"
if grep -qF "$PUBKEY" "$HOME_DIR/.ssh/authorized_keys"; then
  echo "  ключ уже есть"
else
  printf '%s\n' "$PUBKEY" >> "$HOME_DIR/.ssh/authorized_keys"
  echo "  ключ добавлен"
fi

echo "· systemd"
sed -e "s|<пользователь приложения>|$APP_USER|g" \
    -e "s|<каталог приложения>|$APP_DIR|g" \
    -e "s|<локальный порт>|$APP_PORT|g" \
    "$HERE/taksi.service.example" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
echo "  юнит $SERVICE поставлен и включён (запустится после первой выкатки)"

echo "· nginx"
# На этом боксе nginx собирает конфиги из conf.d, схемы sites-available нет.
NGINX_CONF="/etc/nginx/conf.d/$SERVICE.conf"
sed -e "s|<домен>|$DOMAIN|g" \
    -e "s|<каталог приложения>|$APP_DIR|g" \
    -e "s|<локальный порт>|$APP_PORT|g" \
    "$HERE/nginx.conf.example" > "$NGINX_CONF"

if [ -n "$CLOSED" ]; then
  # Закрытый режим: пока приложение не готово к этапу B, посторонних пускать не надо —
  # их IP в логах это уже чужие персональные данные (docs/GO_LIVE_CHECKLIST.md).
  sed -i -e "s|# auth_basic \"closed\";|auth_basic \"closed\";|" \
         -e "s|# auth_basic_user_file <путь к файлу паролей>;|auth_basic_user_file $CLOSED;|" \
         "$NGINX_CONF"
  echo "  стенд закрыт basic-auth"
fi

nginx -t
systemctl reload nginx
echo "  секция nginx поставлена: $NGINX_CONF"

echo
echo "Готово. Дальше:"
echo "  1. в панели хостера выпустить сертификат КАЖДОМУ домену (certbot здесь не работает):"
for d in $DOMAIN; do echo "       $d"; done
echo "  2. запустить workflow deploy в GitHub Actions."
