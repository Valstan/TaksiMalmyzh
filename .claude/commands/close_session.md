---
description: Закрыть сессию «Такси» — сохранить состояние в SESSION_HANDOFF и запушить всё через PR-flow
---

# /close_session — финализация сессии «Такси» (TaksiMalmyzh)

Цель: оставить pointer «куда шли» в `docs/SESSION_HANDOFF.md` и убедиться, что **всё на `origin`**, brain не тронут.

## Когда вызывать / НЕ вызывать

- ✅ В конце сессии; перед пересадкой на другую машину; после значимого куска.
- ❌ После короткой консультации без правок — просто скажи, что состояние чистое.

## Шаг 1. Контекст

```bash
git branch --show-current; git status --short; git log --oneline -10; gh pr list --state open
```

## Шаг 2. Незакоммиченная работа → через PR-flow (НЕ в `main` напрямую)

Ветка `feat/ fix/ chore/ docs/` → гейты (`AGENTS.md` §«Гейты и выкатка») → коммит → `git push -u origin <ветка>` → `gh pr create` → CI зелёный → `gh pr merge --squash --delete-branch`.

⚠️ Выкатка на прод — отдельный ручной workflow `deploy`, мерж её не запускает. Если в сессии мержился код — реши, запускать ли выкатку сейчас, и запиши в handoff, выкачен прод или отстаёт от `main`.

## Шаг 3. Шеринг находки в brain (условный, pool #009)

Переносимый инсайт? → `mailbox/to-brain/YYYY-MM-DD-slug.md` (`kind`, `compliance`, `urgency`) **в этом репо**. ❌ Никогда не писать в `../brain_matrica/`. Тишина = норма.

## Шаг 4. Записать `docs/SESSION_HANDOFF.md`

Абсолютные даты: **Статус**, **Сделано**, **Следующий шаг**, **Открытые вопросы владельцу**.

## Шаг 5. Закоммитить handoff через docs-PR

```bash
git checkout -b docs/handoff-<slug>
git add docs/SESSION_HANDOFF.md
git commit -F <файл-с-сообщением>   # текст сообщения — файлом, не в -m (D-046)
git push -u origin docs/handoff-<slug>
gh pr create ... ; gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

## Шаг 6. Sync-гейт

```bash
git status --short                  # пусто
git rev-parse HEAD @{u}             # совпадают
cd ../brain_matrica && git status --short && cd -   # чисто
```

## Что НЕ делать

- ❌ `git push origin main` напрямую; `--force` / `reset --hard` по `main`.
- ❌ Писать/коммитить в `../brain_matrica/`.
- ❌ Оставлять незапушенные ветки/коммиты или висящий `git stash`.
