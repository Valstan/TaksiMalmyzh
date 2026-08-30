// DDL схемы поездок и точек — единственный экземпляр текста.
//
// Живёт здесь, а не внутри миграции, чтобы одно и то же можно было и влить миграцией, и
// поднять в одноразовой базе проверкой. Схема, которую нельзя прогнать до прода, проверяется
// только на проде — а это самая дорогая площадка из возможных.
//
// Решения, стоящие за каждой строкой, — docs/TRIP_SCHEMA.md. Требования — M0.A §2–§4, §6.2.1.
// Гейт первой миграции (M0.A §8.0) снят: риск этапа A принят владельцем письменно 2026-08-30.

export const TRACK_DDL_UP = `
CREATE SCHEMA IF NOT EXISTS track;

-- Поездка. Строк мало, поэтому здесь можно позволить себе читаемость,
-- а экономить в таблице точек.
CREATE TABLE track.trip (
  id               integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- Псевдоним установки (M0.A §6.2.2): HMAC от install_id, а не сам install_id. Дамп базы
  -- не отвечает «какое это устройство», но группировка поездок одной установки видна —
  -- она нужна для «моей истории» (§3.5), и эта цена названа в TRIP_SCHEMA.md §4.
  install_ref      bytea       NOT NULL,

  -- Непредсказуемый идентификатор для ссылки доступа (§6.4). Внутренний id — int4 ради
  -- размера индекса точек; 128 непредсказуемых бит живут здесь, один раз на поездку.
  lookup_id        bytea       NOT NULL UNIQUE,

  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,

  -- day поездки = дата её СТАРТА в UTC, и это же значение уходит в каждую точку.
  -- Не дата точки: иначе поездка через полночь размазывается по двум партициям, и ключ
  -- идемпотентности (day, trip_id, seq) перестаёт быть детерминированным для клиента,
  -- который досылает точку, не помня, к какой дате её отнёс сервер.
  day              date        NOT NULL,

  state            smallint    NOT NULL DEFAULT 0,   -- 0 open, 1 closed, 2 abandoned, 3 void
  last_point_at    timestamptz,
  point_count      integer     NOT NULL DEFAULT 0,
  seq_max          integer     NOT NULL DEFAULT -1,

  -- Конвертное шифрование: ключ поездки, завёрнутый мастер-ключом эпохи. Мастер живёт вне
  -- БД, в systemd-credential (решение владельца 2026-08-30).
  trip_key_wrapped bytea       NOT NULL,
  key_epoch        smallint    NOT NULL,

  -- Концы и назначение — координаты, значит шифруются (§6.2.1). dest_enc заводится, но НЕ
  -- пишется до решения владельца по §2.3. has_destination нужен спринту 4 и координатой
  -- не является.
  ends_enc         bytea,
  dest_enc         bytea,
  has_destination  boolean     NOT NULL DEFAULT false,

  -- Холодный слой: свёрнутая трасса одним блобом (§3.1 слой 2). Шифруется тем же ключом.
  -- rolled_at — отметка, что свёртка прошла; без неё DROP партиции сырья унёс бы поездку,
  -- которую никто не свернул.
  folded_track     bytea,
  folded_vertices  smallint,
  rolled_at        timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Приём обновляет last_point_at/point_count/seq_max десятки раз за поездку. Ни одна из этих
-- колонок не проиндексирована намеренно: индекс на них ломает HOT-update и плодит мёртвые
-- версии строки в таблице, которую нечем ужать.
ALTER TABLE track.trip SET (fillfactor = 80);

-- Открытых поездок единицы. state меняется один раз за поездку, поэтому HOT он не ломает.
CREATE INDEX trip_open_idx ON track.trip (id) WHERE state = 0;
CREATE INDEX trip_install_idx ON track.trip (install_ref, started_at DESC);
CREATE INDEX trip_unrolled_idx ON track.trip (ended_at) WHERE rolled_at IS NULL AND state IN (1, 2);

-- Точки. Партиционирование по НЕДЕЛЯМ (решение владельца 2026-08-30): фактический срок
-- жизни точки 30–37 суток, обещание пользователю — «около месяца».
--
-- Открытыми остаются ровно три колонки. Время точки уходит внутрь шифротекста: это стоит
-- ноль байт (MAXALIGN), а открытый ряд времён при событийной записи §2.1 сам по себе
-- кинематическая подпись маршрута.
CREATE TABLE track.point (
  day     date    NOT NULL,
  trip_id integer NOT NULL,
  seq     integer NOT NULL,
  -- nonce(12) ‖ ct(19) ‖ tag(16) = 47 Б. Раскладка открытого текста — lib/track-crypto.ts.
  pt      bytea   NOT NULL,
  PRIMARY KEY (day, trip_id, seq)
) PARTITION BY RANGE (day);

-- DEFAULT-партиции НЕТ и не будет: при живой DEFAULT-партиции PostgreSQL запрещает
-- DETACH ... CONCURRENTLY, а обычный DETACH берёт ACCESS EXCLUSIVE на родителе и
-- останавливает приём точек. Проверено. Взамен партиции создаются на 14 суток вперёд,
-- а их отсутствие — алерт.

-- Журнал уничтожения (§3.4, приказ РКН № 179). Переживает удаление самих данных.
CREATE TABLE track.erasure_log (
  id       bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  at       timestamptz NOT NULL DEFAULT now(),
  action   text        NOT NULL,
  basis    text        NOT NULL,
  target   text        NOT NULL,
  rows_est bigint,
  detail   jsonb
);
CREATE INDEX erasure_log_at_idx ON track.erasure_log (at DESC);

-- Журнал прогонов регламента: его отсутствие за 25 часов — алерт (§3.4).
CREATE TABLE track.maintenance_run (
  id         bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  job        text        NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ok         boolean,
  detail     jsonb
);
CREATE INDEX maintenance_run_job_idx ON track.maintenance_run (job, started_at DESC);
`;

export const TRACK_DDL_DOWN = `DROP SCHEMA IF EXISTS track CASCADE;`;

// Токен записи в поездку — добавлен отдельной миграцией 20260830_210000_write_token.
//
// Зачем отдельный токен, когда есть lookup_id: lookup_id отдаётся доверенному контакту по
// ссылке (§6.4), и если бы он же разрешал дописывать точки, контакт мог бы подделывать
// трассу. Право писать и право читать — разные права.
//
// Хранится ХЭШ, не сам токен (§6.4): утечка дампа не должна давать право дописывать в
// чужую поездку. Внутренний trip_id — маленькое целое и угадывается перебором, поэтому
// без токена приём был бы открыт любому, кто умеет считать.
export const TRACK_DDL_WRITE_TOKEN_UP = `
ALTER TABLE track.trip ADD COLUMN write_token_hash bytea;
`;

export const TRACK_DDL_WRITE_TOKEN_DOWN = `
ALTER TABLE track.trip DROP COLUMN IF EXISTS write_token_hash;
`;
