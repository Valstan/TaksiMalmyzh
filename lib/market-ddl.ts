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
  status    smallint    NOT NULL DEFAULT 0,   -- 0 ждёт, 1 подтверждена, 2 отклонена
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
