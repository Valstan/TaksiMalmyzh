#!/usr/bin/env bash
# SessionStart hook (brain D-066 / pool #268): печатает состояние git и actionable-часть
# handoff при открытии сессии, чтобы агент стартовал в контексте без ритуала чтения.
# Только чтение, без сети: синхронизацию с origin делает /start шаг 1, хук её не подменяет.
# Вызов: bash .claude/scripts/session_start.sh  (из .claude/settings.json → hooks.SessionStart)
#
# Почему не `cat` целиком, как в образце Мозга: наш handoff — ~700 строк против 66 у него,
# и полный дамп съедал бы ~25k токенов на каждом startup И каждом resume. Печатаем шапку и
# два раздела, по которым принимают решения; остальное агент дочитывает сам по указателю.
cd "$(dirname "$0")/../.." || exit 0

HANDOFF="docs/SESSION_HANDOFF.md"

echo "=== TaksiMalmyzh · SessionStart · $(date +%F) ==="
git status -sb 2>/dev/null | head -5
git log --oneline -3 2>/dev/null

if [ ! -f "$HANDOFF" ]; then
  echo "(handoff не найден: $HANDOFF)"
  exit 0
fi

# Шапка: всё до первого раздела — Status, Updated, Branch, Стадия.
echo
echo "--- $HANDOFF, шапка (как лежит на диске, до pull) ---"
awk '/^## /{exit} {print}' "$HANDOFF"

# Разделы, по которым принимают решения. Печатаем от заголовка до следующего "## ".
for SECTION in "## Что ждёт владельца" "## Следующие шаги разработки"; do
  echo
  echo "--- $HANDOFF, раздел «${SECTION#\#\# }» ---"
  awk -v h="$SECTION" '
    index($0, h) == 1 { f = 1; print; next }
    f && /^## / { exit }
    f { print }
  ' "$HANDOFF"
done

echo
echo "--- Остальное в $HANDOFF (уроки, разборы сессий, устройство схемы) — читать по месту."
echo "--- Дальше: /start (полный проход, включая почту brain) или задача владельца."
echo "--- Канон правил: AGENTS.md. Восстановление после обрыва — из Git/PR, не по памяти."
exit 0
