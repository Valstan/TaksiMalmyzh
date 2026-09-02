// Краудсигналы по номерам — спринт 5: «дозвонились?», «не ответил», «цена не та».
//
// Что это даёт справочнику: номер, по которому месяц никто не дозванивается, — мёртвый
// номер, и посетителю лучше знать это до звонка. Цена, с которой «не совпадает» несколько
// разных устройств, — повод персоналу перепроверить карточку.
//
// Что это НЕ даёт: рейтинга, отзывов, текста. Только счётчики, только о бизнесе.

import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { trackPool } from "./track-db.ts";

/** Окно агрегата — «за месяц» на карточке. */
export const WINDOW_DAYS = 30;
/** Срок жизни строки сигнала. */
export const RETENTION_DAYS = 90;

export type Outcome = "unknown" | "answered" | "no_answer";
const OUTCOME_CODE: Record<Outcome, number> = { unknown: 0, answered: 1, no_answer: 2 };

/**
 * Псевдоним устройства: HMAC от install_id с ключом приложения. Не сам install_id — он
 * не должен лежать в базе в открытом виде (M0.A §6.2.2), и не голый SHA-256 — тот
 * обратим перебором по утёкшему списку идентификаторов.
 */
export function deviceRef(installId: string): Buffer {
  const key = process.env.PAYLOAD_SECRET;
  if (!key) throw new Error("PAYLOAD_SECRET не задан — псевдоним устройства не построить");
  return createHmac("sha256", key).update(`crowd:${installId}`).digest();
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Звонок по номеру: строка на сегодня появляется (или остаётся) с outcome «неизвестно». */
export async function recordCall(entryId: number, installId: string, now = new Date()): Promise<void> {
  await trackPool().query(
    `INSERT INTO crowd.signal (entry_id, device_ref, day)
     VALUES ($1, $2, $3)
     ON CONFLICT (entry_id, device_ref, day) DO UPDATE SET updated_at = now()`,
    [entryId, deviceRef(installId), utcDay(now)],
  );
}

/**
 * Ответ на «дозвонились?». Перезаписывает СВОЮ строку за день: передумал — последнее слово
 * верное, а второй голос не появляется.
 */
export async function recordAnswer(
  entryId: number,
  installId: string,
  outcome: Outcome,
  priceMismatch: boolean,
  now = new Date(),
): Promise<void> {
  await trackPool().query(
    `INSERT INTO crowd.signal (entry_id, device_ref, day, outcome, price_mismatch)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entry_id, device_ref, day)
       DO UPDATE SET outcome = EXCLUDED.outcome, price_mismatch = EXCLUDED.price_mismatch,
                     updated_at = now()`,
    [entryId, deviceRef(installId), utcDay(now), OUTCOME_CODE[outcome], priceMismatch],
  );
}

export type EntryStats = {
  /** Звонков (строк) за окно — одно устройство в день считается один раз. */
  calls: number;
  /** Из них «не ответили». */
  noAnswer: number;
  /** Устройств, отметивших «цена не совпадает». */
  priceMismatch: number;
};

/** Агрегат за окно для набора записей. Ключ — entry_id. Отсутствие в карте = нулей. */
export async function entryStats(
  entryIds: number[],
  now = new Date(),
  pool: Pool = trackPool(),
): Promise<Map<number, EntryStats>> {
  const out = new Map<number, EntryStats>();
  if (entryIds.length === 0) return out;
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const { rows } = await pool.query<{ entry_id: number; calls: string; no_answer: string; price: string }>(
    `SELECT entry_id,
            count(*)::text AS calls,
            count(*) FILTER (WHERE outcome = 2)::text AS no_answer,
            count(*) FILTER (WHERE price_mismatch)::text AS price
       FROM crowd.signal
      WHERE entry_id = ANY($1) AND day >= $2
      GROUP BY entry_id`,
    [entryIds, utcDay(since)],
  );
  for (const r of rows) {
    out.set(r.entry_id, { calls: Number(r.calls), noAnswer: Number(r.no_answer), priceMismatch: Number(r.price) });
  }
  return out;
}

/** Регламент: строки старше срока удаляются. Возвращает число удалённых. */
export async function pruneCrowdSignals(pool: Pool, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const r = await pool.query(`DELETE FROM crowd.signal WHERE day < $1`, [utcDay(before)]);
  return r.rowCount ?? 0;
}

/** Есть ли схема (миграция могла ещё не примениться, страница не должна падать). */
export async function crowdReady(pool: Pool = trackPool()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ yes: boolean }>(`SELECT to_regclass('crowd.signal') IS NOT NULL AS yes`);
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}

/** Человеческая строка для карточки; null — показывать нечего. */
export function statsLine(s: EntryStats | undefined): string | null {
  if (!s || s.calls === 0) return null;
  const parts = [`${s.calls} ${plural(s.calls, "звонок", "звонка", "звонков")}`];
  if (s.noAnswer > 0) parts.push(`${s.noAnswer} без ответа`);
  if (s.priceMismatch > 0) parts.push(`цена не совпала у ${s.priceMismatch}`);
  return `за месяц: ${parts.join(", ")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
