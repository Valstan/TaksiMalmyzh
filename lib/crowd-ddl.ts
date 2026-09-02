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
