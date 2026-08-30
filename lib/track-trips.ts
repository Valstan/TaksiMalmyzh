import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { trackPool } from "./track-db.ts";
import { ensurePartitions } from "./track-maintenance.ts";
import {
  currentEpoch,
  installRef,
  newTripKey,
  sealPoint,
  unwrapTripKey,
  wrapTripKey,
  type TrackPoint,
} from "./track-crypto.ts";

// Операции над поездкой: старт, приём пачки точек, завершение.
//
// Живут отдельно от HTTP-обвязки, чтобы их можно было прогнать проверкой без поднятия
// сервера — schema и логика приёма проверяются в scripts/check-track.mjs.

/** Больше одной пачки за раз принимать незачем: клиент шлёт десятки точек, не тысячи. */
export const MAX_BATCH = 500;

export type TripHandle = {
  tripId: number;
  day: string;
  startedAt: string;
  writeToken: string;
};

const tokenHash = (t: string) => createHash("sha256").update(t, "utf8").digest();

/** Дата старта в UTC — она же `day` всех точек поездки (см. lib/track-ddl.ts). */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Начать поездку.
 *
 * Ключ поездки случайный и заворачивается мастер-ключом эпохи: при ротации мастера
 * достаточно перезавернуть строку поездки, не трогая ни одной строки точки.
 */
export async function startTrip(installId: string, now = new Date()): Promise<TripHandle> {
  const pool = trackPool();

  // Партиция на сегодня гарантируется ЗДЕСЬ, а не только регламентом.
  //
  // Обычно её создаёт регламент на 14 суток вперёд. Но если он однажды не отработал,
  // вставка точки падает жёстко («для строки не найдена секция») — и падает она посреди
  // поездки, у человека, который уже едет. Проверка это и поймала. Вызов идемпотентен
  // (CREATE TABLE IF NOT EXISTS) и стоит трёх запросов на поездку, которых в сутки единицы.
  //
  // Если партиции нет, честнее упасть на старте: человек ещё никуда не поехал.
  await ensurePartitions(pool, now, { log: false });

  const epoch = currentEpoch();
  const tripKey = newTripKey();
  const writeToken = randomBytes(32).toString("base64url");
  const day = utcDay(now);

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // trip_key_wrapped заворачивается по trip_id, а его до вставки нет — поэтому строка
    // создаётся, id получается из RETURNING, и ключ заворачивается вторым шагом в той же
    // транзакции. Пустой bytea промежуточным значением виден только внутри неё.
    const { rows: [row] } = await c.query<{ id: number }>(
      `INSERT INTO track.trip
         (install_ref, lookup_id, started_at, day, trip_key_wrapped, key_epoch, write_token_hash)
       VALUES ($1, $2, $3, $4, '\\x'::bytea, $5, $6)
       RETURNING id`,
      [installRef(installId), randomBytes(16), now, day, epoch, tokenHash(writeToken)],
    );
    await c.query(`UPDATE track.trip SET trip_key_wrapped = $2 WHERE id = $1`, [
      row.id,
      wrapTripKey(tripKey, row.id, epoch),
    ]);
    await c.query("COMMIT");
    return { tripId: row.id, day, startedAt: now.toISOString(), writeToken };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

type TripRow = {
  id: number;
  day: string;
  started_at: Date;
  state: number;
  trip_key_wrapped: Buffer;
  key_epoch: number;
  write_token_hash: Buffer | null;
};

async function authorize(tripId: number, writeToken: string): Promise<TripRow | null> {
  const { rows } = await trackPool().query<TripRow>(
    `SELECT id, day, started_at, state, trip_key_wrapped, key_epoch, write_token_hash
       FROM track.trip WHERE id = $1`,
    [tripId],
  );
  const t = rows[0];
  if (!t?.write_token_hash) return null;
  const presented = tokenHash(writeToken);
  // Длины равны по построению (оба SHA-256), но проверка дешевле, чем исключение.
  if (presented.length !== t.write_token_hash.length) return null;
  return timingSafeEqual(presented, t.write_token_hash) ? t : null;
}

export type IngestResult =
  | { ok: true; accepted: number; total: number }
  | { ok: false; reason: "not_found" | "closed" | "too_many" };

/**
 * Принять пачку точек. Идемпотентно: повтор той же пачки не создаёт дублей, досылка с
 * перекрытием вставляет только новое (`ON CONFLICT (day, trip_id, seq) DO NOTHING`).
 *
 * Точки шифруются здесь, в приложении: в СУБД летит только `bytea`. Это важно не из
 * педантизма — при включённом `log_min_duration_statement` bind-параметры пишутся в лог
 * сервера целиком, и лог стал бы теневой копией горячего слоя, не покрытой правилом
 * «только DROP партиции».
 */
export async function ingestPoints(
  tripId: number,
  writeToken: string,
  points: { seq: number; point: TrackPoint }[],
): Promise<IngestResult> {
  if (points.length === 0) return { ok: true, accepted: 0, total: 0 };
  if (points.length > MAX_BATCH) return { ok: false, reason: "too_many" };

  const t = await authorize(tripId, writeToken);
  if (!t) return { ok: false, reason: "not_found" };
  // В закрытую поездку не дописывают: окно досылки закрывается вместе со свёрткой, и
  // точка, приехавшая после неё, не попала бы в холодный слой и исчезла бы с партицией.
  if (t.state !== 0) return { ok: false, reason: "closed" };

  const key = unwrapTripKey(t.trip_key_wrapped, t.id, t.key_epoch);
  const startedMs = t.started_at.getTime();

  const values: string[] = [];
  const params: unknown[] = [];
  for (const { seq, point } of points) {
    params.push(t.day, t.id, seq, sealPoint(key, t.id, seq, startedMs, point));
    const n = params.length;
    values.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  const pool = trackPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ins = await c.query(
      `INSERT INTO track.point (day, trip_id, seq, pt) VALUES ${values.join(",")}
       ON CONFLICT (day, trip_id, seq) DO NOTHING`,
      params,
    );
    // Счётчики поездки: ни один из них не проиндексирован — иначе каждое обновление ломало
    // бы HOT-update и плодило мёртвые версии строки в таблице, которую нечем ужать.
    const maxSeq = Math.max(...points.map((p) => p.seq));
    const { rows: [tot] } = await c.query<{ n: string }>(
      `UPDATE track.trip
          SET last_point_at = now(),
              point_count = point_count + $2,
              seq_max = GREATEST(seq_max, $3)
        WHERE id = $1
      RETURNING point_count::text AS n`,
      [t.id, ins.rowCount ?? 0, maxSeq],
    );
    await c.query("COMMIT");
    return { ok: true, accepted: ins.rowCount ?? 0, total: Number(tot.n) };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function finishTrip(
  tripId: number,
  writeToken: string,
  now = new Date(),
): Promise<{ ok: boolean }> {
  const t = await authorize(tripId, writeToken);
  if (!t) return { ok: false };
  await trackPool().query(
    `UPDATE track.trip SET state = 1, ended_at = $2 WHERE id = $1 AND state = 0`,
    [t.id, now],
  );
  return { ok: true };
}
