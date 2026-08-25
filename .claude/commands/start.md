---
description: Старт сессии «Такси» — синхра только своего репо (#032) + двухканальный mailbox-check от brain + чтение SESSION_HANDOFF
---

Выполни старт сессии «Такси» (TaksiMalmyzh) строго по шагам. Порядок жёсткий: **сначала синхронизация своего репо (шаг 1), потом чтение session-памяти (шаг 4)** — pool #032. Чужие репозитории, включая `../brain_matrica`, **не синхронизировать вообще**: никаких `fetch`/`pull`/`checkout` — только чтение (мандат владельца 2026-08-04).

1. **Sync СВОЙ репо — единственная синхронизация:** `git fetch`; если working tree чист и есть отставание — `git checkout main && git pull --ff-only`. Незакоммиченное / не-ff — сообщи, не форсируй.
2. **Входящие от brain — два канала, без синхронизации чужого репо:**
   - **Локально:** прочитай файлы в корне `../brain_matrica/mailboxes/TaksiMalmyzh/from-brain/*.md` (НЕ `DRAFTS/`, НЕ `ARCHIVE/`); read-only, не pull'ить.
   - **GitHub `main`:** список писем того же пути без clone/fetch/pull:
     `gh api "repos/Valstan/brain_matrica/contents/mailboxes/TaksiMalmyzh/from-brain?ref=main" --jq '.[] | select(.type=="file") | .name'`.
   - **Набор писем = объединение** каналов. Письмо есть только на GitHub → читай его содержимое:
     `gh api "repos/Valstan/brain_matrica/contents/mailboxes/TaksiMalmyzh/from-brain/<файл>?ref=main" -H "Accept: application/vnd.github.raw"`.
   - **Одноимённое письмо различается** → свежесть по истории именно этого пути: незакоммиченная локальная правка (`git -C ../brain_matrica status --porcelain -- <путь>`) — свежее; иначе сравни последний локальный коммит файла (`git -C ../brain_matrica log -1 --format=%cI -- <путь>`) с последним коммитом пути на GitHub (`gh api "repos/Valstan/brain_matrica/commits?path=<путь>&per_page=1" --jq '.[0].commit.committer.date'`). Порядок не определяется → прочитай обе версии, явно отметь конфликт, ничего не перезаписывай.
   - Свежесть одного репозитория/письма **не переносится** на другие проекты и письма.
3. **Доложи** сводку писем ДО чтения handoff:
   ```
   📬 N писем от brain_matrica:
   - [urgency COMPLIANCE] YYYY-MM-DD-slug — тема
   ```
4. **Прочитай** `docs/SESSION_HANDOFF.md`. Если `Updated:` старше 14 дней — пометь «может быть неактуально».
5. **Сводка main:** `git log --oneline -5` и `git status`.
6. Кратко предложи следующий шаг из handoff.

Не начинай правки до завершения шагов 1–4.
