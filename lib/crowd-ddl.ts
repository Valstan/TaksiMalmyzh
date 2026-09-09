// DDL краудсигналов по номерам справочника — спринт 5. Единственный экземпляр текста:
// миграция и проверка схемы поднимают ровно его.
//
// Первый пользовательский ввод в продукте — но о БИЗНЕСАХ, не о людях. Персональных данных
// здесь нет по построению: строка не содержит ни номера телефона звонившего, ни его
// адреса, ни аккаунта. Устройство представлено псевдонимом device_ref — HMAC от локального
// install_id (тот же приём, что install_ref в схеме track, M0.A §6.2.2): дамп базы не
// отвечает «какое это устройство», но повтор с того же устройства в тот же день виден —
// ровно то, что нужно правилу «не чаще одной отметки на номер с устройства в сутки».
//
// Первичный ключ (entry_id, device_ref, day) — это и есть анти-накрутка: вторая отметка
// того же устройства по тому же номеру в тот же день не создаёт строку, а перезаписывает
// свою. Сотня отметок с одного телефона за день весит одну.
//
// Срок жизни строки — 90 суток (pruneCrowdSignals): агрегат считается за 30, запас нужен,
// чтобы «за месяц» на границе месяца не проваливался в ноль.

export const CROWD_DDL_UP = `
CREATE SCHEMA IF NOT EXISTS crowd;

CREATE TABLE crowd.signal (
  entry_id       integer NOT NULL,
  device_ref     bytea   NOT NULL,
  day            date    NOT NULL,
  -- 0 неизвестно (ещё не ответил на вопрос), 1 дозвонился, 2 не ответили
  outcome        smallint NOT NULL DEFAULT 0,
  price_mismatch boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, device_ref, day)
);
CREATE INDEX signal_entry_day_idx ON crowd.signal (entry_id, day DESC);
`;

export const CROWD_DDL_DOWN = `DROP SCHEMA IF EXISTS crowd CASCADE;`;

// Карма справочника — решение владельца 2026-09-10. Плюс-минус у организации и у каждого
// её номера, голосуют без авторизации.
//
// Отдельным экспортом, не внутрь CROWD_DDL_UP: тот текст уже применён миграцией
// 20260903_120000 и меняться не имеет права. Тот же приём, что RATINGS_DDL_UP рядом с
// MARKET_DDL_UP в lib/market-ddl.ts.
//
// Почему в схеме `crowd`, а не `market`: карма положена ЛЮБОЙ опубликованной карточке, в
// том числе без кабинета, и адресует бизнес, а не человека, — это семья crowd.signal
// (анонимно, псевдоним устройства, анти-накрутка первичным ключом). market.rating живёт по
// другому правилу: только карточкам с владельцем, потому что звёзды получает тот, кому
// есть чем ответить.
//
// Цель голоса — пара (entry_id, phone_key). phone_key = '' — организация целиком (часовой
// по образцу worker_id = 0 у рейтингов). Иначе — нормализованный номер, lib/phone-key.ts;
// там же разобрано, почему не id строки массива телефонов.
//
// ⚠️ ДНЯ В КЛЮЧЕ НЕТ — в отличие от crowd.signal и market.rating, и это не забывчивость.
// Карма СУММИРУЕТСЯ, а звёзды усредняются: день в ключе дал бы одному устройству +1 каждые
// сутки, то есть +30 с одного телефона за месяц. Голос живёт, пока его не поменяли
// (UPDATE) или не отозвали (DELETE), и весит ровно единицу.
//
// Отдельного индекса по (entry_id, phone_key) нет намеренно: это префикс первичного ключа,
// и агрегат обслуживается им же. У crowd.signal собственный индекс нужен — там
// (entry_id, day) префиксом ключа не является.

export const KARMA_DDL_UP = `
CREATE TABLE crowd.karma (
  entry_id   integer     NOT NULL,
  -- '' — организация целиком; иначе нормализованный номер (lib/phone-key.ts)
  phone_key  text        NOT NULL CHECK (length(phone_key) <= 32),
  device_ref bytea       NOT NULL,
  vote       smallint    NOT NULL CHECK (vote IN (-1, 1)),
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, phone_key, device_ref)
);
-- Для уборки по сроку: часовой тик удаляет голоса старше года от последнего изменения.
CREATE INDEX karma_at_idx ON crowd.karma (at);
`;

export const KARMA_DDL_DOWN = `DROP TABLE IF EXISTS crowd.karma;`;
