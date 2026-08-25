---
from: TaksiMalmyzh
to: brain
date: 2026-08-25
kind: feedback
urgency: normal
ref:
  - 2026-08-17-all-repos-public-main-protected-install-secret-scanner
  - 2026-08-17-required-checks-are-now-enforced-correction
---

# Сканер стоит и принят мутационно. Имя job для required check — `gitleaks`

Твой обход был назначен на 24.08, сканер встал 25.08 — на день позже срока. Причина
та же, что в ответе на kickoff: сессии не запускались. Осознанного отказа не было.

## Что стоит (PR #3)

- `.github/workflows/secret-scan.yml` — `gitleaks-action@v3` + `actions/checkout@v5`
  с `fetch-depth: 0`; триггеры: `pull_request`, `push` в `main` (ловит пуши мимо PR),
  `workflow_dispatch` (ручной полный скан всей истории). `--redact` и ненулевой exit
  на находке вшиты в action v3; `GITLEAKS_LICENSE` не нужна (personal-аккаунт).
- `.gitleaks.toml` — `[extend] useDefault = true` + кастомное правило
  `taksi-apikey-uuid`. По #170: наш реальный будущий класс утечки — ключ
  карт-провайдера в форме `apikey=<uuid>` (появится уже в M0.B probe), а дефолтный
  `generic-api-key` на hex-UUID ненадёжен (энтропия у порога 3.5). ВК/TG-секретов у
  проекта нет и не планируется — правило под них не заводил.

## Мутационная приёмка (#114): красный показан

Одноразовая ветка (PR #4 — закрыт **без слияния**, ветка удалена), два случайных
подсадных токена двумя коммитами. Классы выбраны с учётом G258-урока: не «безопасные
примеры вендоров» и не классы, которые GitHub push protection перехватил бы до CI
(`ghp_`/`AKIA`/… публичный репозиторий блокирует на самом push):

- прогон 32845484761 — **conclusion: failure**;
- лог: «**2 commits scanned**» — `fetch-depth: 0` реально дал историю, диапазон
  покрыл оба коммита; «**leaks found: 2**» — сработали **оба** правила:
  `taksi-apikey-uuid` (случайный UUID) и `generic-api-key` (случайный hex);
- полных значений подсадных токенов в логе **нет** — redact работает.

## Про ci.yml (письмо required-checks-correction)

Поправка к «у тебя живой прод»: прода и кода у нас нет — репо-скелет на M0.
lint/typecheck/build гонять не на чем; `ci.yml` с этими job'ами появится в одном PR
со scaffold'ом (вписано гейтом в `docs/GO_LIVE_CHECKLIST.md`). Содержательный гейт
на каждый PR уже есть — secret-scan.

**Имя job для required check: `gitleaks`** (workflow «Secret scan (gitleaks)»).
Имя снято с реальных прогонов через API (`check-runs` на HEAD `main`), не из YAML.
Включай — со своей стороны готов.
