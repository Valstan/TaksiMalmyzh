# CLAUDE.md — entry point для AI-сессий «Такси» (TaksiMalmyzh)

Первый файл, который Claude читает в новой сессии проекта. Проект — часть экосистемы **brain_matrica**. **Полный концепт (источник правды по стратегии):** [`../brain_matrica/docs/plans/taxi-safety-app-concept.md`](../brain_matrica/docs/plans/taxi-safety-app-concept.md). Карточка реестра: [`../brain_matrica/projects/TaksiMalmyzh.md`](../brain_matrica/projects/TaksiMalmyzh.md).

## Быстрые факты

- **Что это:** мобильное приложение **безопасности поездок → маркетплейс такси** (г. Малмыж). Запускается не как агрегатор, а как клиентское приложение безопасности пассажира (трекинг маршрута как подстраховка «найти пропавшего»), затем bootstrap двустороннего маркетплейса. Домен-цель: **такси.вмалмыже.рф**.
- **Статус:** ⚠️ **концепт / старт разработки. Стек НЕ финализирован.** Репо-скелет; ключевые продуктовые и технические решения ещё впереди.
- **Прод:** пока нет.
- **Предложенный стек (🔶 не решён):** Payload+Next+PostgreSQL (бэкенд/админка) + React, обёрнутый Capacitor (клиент с фоновым GPS). Финал — после probe (см. `docs/PROJECT_STATE.md`).

## Как работать

- **Не начинай постройку без решений по §3–§5 `docs/PROJECT_STATE.md`:** платформа (Capacitor+APK vs App Store vs PWA-foreground), дизайн приватности геоданных (152-ФЗ), probe-before-build фоновой геолокации. Это продуктовые/юридические/бюджетные решения владельца.
- Стратегия/концепт/реестр — в brain_matrica (read-only чтение). Постройка/scaffold/деплой — здесь.
- PR-flow (ADR-0002): ветка → PR → squash-merge. **Прямых пушей в `main` нет.**

## 📬 Mailbox check — ДО любой другой работы (ADR-0001 v3)

| Направление | Кто пишет | Где |
|---|---|---|
| `brain → Такси` | brain | `../brain_matrica/mailboxes/TaksiMalmyzh/from-brain/*.md` (мы только **читаем** после `git pull --ff-only`) |
| `Такси → brain` | мы | **`mailbox/to-brain/*.md`** в этом репо (через PR) |

Сканить только корень `from-brain/`. Compliance: `mandate`→MUST, `recommend`→SHOULD, `suggest`→MAY. ❌ **Никогда не писать/коммитить в `../brain_matrica/`** (read-only).

Формат `mailbox/to-brain/YYYY-MM-DD-slug.md`:

```yaml
---
from: TaksiMalmyzh
to: brain
date: YYYY-MM-DD
topic: ...
kind: idea | question | feedback | report
compliance: suggest | recommend | mandate   # для kind=idea
urgency: low | normal | high
---
```

## Session-память и команды

- `docs/PROJECT_STATE.md` — видение/стек/риски/следующие шаги (рабочая выжимка концепта).
- `docs/SESSION_HANDOFF.md` — статус/нитка/следующий шаг (обновляет `/close_session`, читает `/start`).
- `/start` — синхра репо + mailbox-check от brain + чтение handoff.
- `/close_session` — сохранить состояние, всё на origin через PR (brain не трогать).
- `/obriv` — восстановление после обрыва связи (самопроверка целостности + продолжение).
