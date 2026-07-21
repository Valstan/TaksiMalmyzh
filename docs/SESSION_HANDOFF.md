# Такси (TaksiMalmyzh) — Session Handoff

> Sticky-note для непрерывности сессий. Перезаписывается `/close_session`. История — `git log -- docs/SESSION_HANDOFF.md`.

**Status:** ACTIVE
**Updated:** 2026-07-21 (bootstrap: репо создан, подключён к Мозгу, засеян концепт)
**Branch:** main

## Текущая нитка

Проект на стадии **концепт / старт**. Постройка ещё не начата — сперва решения по платформе, приватности и probe (см. `docs/PROJECT_STATE.md` §3–§5).

## Что сделано (bootstrap 2026-07-21)

- Репо создан, подключён к экосистеме brain_matrica (`CLAUDE.md`, `/start`+`/close_session`, `mailbox/`, handoff). Brain-сторона: `../brain_matrica/mailboxes/TaksiMalmyzh/from-brain/`.
- Засеян `README.md` + `docs/PROJECT_STATE.md` из концепта Мозга.

## Следующий шаг

По `docs/PROJECT_STATE.md` §5: (1) probe-before-build фоновой геолокации на реальных Android/iOS; (2) решить платформу (Capacitor+APK / App Store / PWA-foreground); (3) дизайн приватности геоданных (152-ФЗ). Всё — решения владельца при go.

## Открытые вопросы для владельца

- Платформенный путь (фоновый GPS + «без стора» + iPhone) — центральное решение.
- Дизайн приватности: как трасса переживает потерю телефона, оставаясь анонимной.
- Go/no-go на старт активной разработки (сейчас концепт был BACKLOG).
