// DDL кабинетов бизнесов — спринт 8 (Фаза 2). Единственный экземпляр текста.
//
// Две сущности, обе сырым SQL в схеме `market` (как track и crowd): персоналу они видны
// на странице кабинета, а не в админке Payload, — зато миграция остаётся ручной и
// предсказуемой, без гонки с автогенерацией снимков схемы.
//
// claim — заявка «это мой бизнес» от вошедшего посетителя на опубликованную запись.
// Подтверждает персонал ЗВОНКОМ по номеру из справочника (бизнес подтверждает свой
// номер), после чего у записи появляется владелец (entries.owner_id). Самоподтверждения
// нет намеренно: SMS-шлюза нет, а карточка с чужим «владельцем» — прямой вред.
//
// request — вызов из приложения с автоадресом. Содержит телефон и адрес клиента — это
// персональные данные, которые клиент сам передаёт бизнесу, чтобы тот перезвонил. Срок
// жизни 30 суток (pruneRequests), дальше строка удаляется; правовые тексты — спринт 7.

export const MARKET_DDL_UP = `
CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE market.claim (
  id        integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entry_id  integer     NOT NULL,
  user_id   integer     NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  status    smallint    NOT NULL DEFAULT 0,   -- 0 ждёт, 1 подтверждена, 2 отклонена, 3 истекла
  UNIQUE (entry_id, user_id)
);
CREATE INDEX claim_pending_idx ON market.claim (at) WHERE status = 0;

CREATE TABLE market.request (
  id               integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entry_id         integer     NOT NULL,
  customer_user_id integer,
  address          text        NOT NULL,
  lat              double precision,
  lng              double precision,
  phone            text        NOT NULL,
  note             text,
  at               timestamptz NOT NULL DEFAULT now(),
  seen_at          timestamptz,
  done_at          timestamptz
);
CREATE INDEX request_entry_idx ON market.request (entry_id, at DESC);
`;

export const MARKET_DDL_DOWN = `DROP SCHEMA IF EXISTS market CASCADE;`;

// Рейтинги — миграция 20260903_180000_ratings (спринт 9). Обоснование ограничений —
// docs/RATINGS.md. worker_id = 0 — голос фирме; иначе — работнику (заведён бизнесом).
export const RATINGS_DDL_UP = `
CREATE TABLE market.worker (
  id         integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entry_id   integer     NOT NULL,
  name       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_entry_idx ON market.worker (entry_id) WHERE active;

CREATE TABLE market.rating (
  entry_id   integer  NOT NULL,
  worker_id  integer  NOT NULL DEFAULT 0,
  device_ref bytea    NOT NULL,
  day        date     NOT NULL,
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, worker_id, device_ref, day)
);
CREATE INDEX rating_entry_day_idx ON market.rating (entry_id, day DESC);
`;

export const RATINGS_DDL_DOWN = `
DROP TABLE IF EXISTS market.rating;
DROP TABLE IF EXISTS market.worker;
`;

// Поля карточки бизнеса на записи справочника (коллекция Payload `entries`): описание,
// часы работы, владелец. Имена колонок и индексов — те, что построил бы Payload.
export const ENTRIES_BUSINESS_UP = `
ALTER TABLE "entries" ADD COLUMN "description" varchar;
ALTER TABLE "entries" ADD COLUMN "hours" varchar;
ALTER TABLE "entries" ADD COLUMN "owner_id" integer;
ALTER TABLE "entries" ADD CONSTRAINT "entries_owner_id_users_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "entries_owner_idx" ON "entries" USING btree ("owner_id");
`;

export const ENTRIES_BUSINESS_DOWN = `
ALTER TABLE "entries" DROP COLUMN IF EXISTS "owner_id";
ALTER TABLE "entries" DROP COLUMN IF EXISTS "hours";
ALTER TABLE "entries" DROP COLUMN IF EXISTS "description";
`;

// Предложенные правки к записям справочника — решение владельца 2026-09-10: «при
// предложении нового номера чтобы была возможность выбрать организацию уже существующую».
// Миграция 20260910_140000_entry_edits. Разбор — docs/DIRECTORY_EDITS.md.
//
// Зачем отдельная таблица, а не правка карточки сразу. Правило владельца 2026-08-29:
// наружу уходит ТОЛЬКО проверенное. Дописать номер в опубликованную карточку по анонимному
// запросу значит опубликовать непроверенный номер. Правка лежит здесь, невидимая
// посетителю, пока персонал не примет её одной кнопкой в /kabinet. И это касается не только
// опубликованных карточек: черновики тоже меняются только через эту очередь — ни одна
// запись справочника не мутирует от анонимного запроса.
//
// Ни user_id, ни device_ref: у предложений в справочник автор не записывается (так было и
// у /api/suggest). Защита от заливки — рейт-лимит, honeypot и уникальный индекс ниже.
//
// value — ключ номера из lib/phone-key.ts, единственного нормализатора в продукте: по нему
// сверяются и дубли в очереди, и «этот номер у карточки уже есть» при приёмке. raw — как
// номер написал человек: он и попадёт в карточку, если персонал примет правку.
//
// Внешнего ключа на public.entries нет — как у market.claim и market.rating. Осиротевшая
// строка возможна намеренно, и приёмка обязана её пережить: запись удалили — правка
// гаснет со статусом 3, а не роняет очередь (lib/entry-edits.ts, approveEntryEdit).

export const ENTRY_EDIT_DDL_UP = `
CREATE TABLE market.entry_edit (
  id         integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entry_id   integer     NOT NULL,
  kind       smallint    NOT NULL DEFAULT 0,   -- 0 добавить телефон; задел под часы и цены
  value      text        NOT NULL CHECK (length(value) BETWEEN 1 AND 32),
  raw        text        NOT NULL CHECK (length(raw) <= 30),
  note       text        CHECK (length(note) <= 300),
  at         timestamptz NOT NULL DEFAULT now(),
  -- 0 ждёт, 1 принята, 2 отклонена персоналом, 3 погашена автоматом (истекла или запись
  -- удалена). Тройка отдельна от двойки по той же причине, что у market.claim: автомат не
  -- должен задним числом приписывать персоналу отказ, которого тот не выносил.
  status     smallint    NOT NULL DEFAULT 0,
  decided_at timestamptz
);
CREATE INDEX entry_edit_pending_idx ON market.entry_edit (at) WHERE status = 0;
-- Антизаливка: десять человек предложат один и тот же номер — в очереди одна строка.
-- Индекс частичный: после решения тот же номер можно предложить снова, потому что номер
-- мог измениться, и запирать это навсегда неправильно.
CREATE UNIQUE INDEX entry_edit_dedup_idx
  ON market.entry_edit (entry_id, kind, value) WHERE status = 0;
`;

export const ENTRY_EDIT_DDL_DOWN = `DROP TABLE IF EXISTS market.entry_edit;`;
