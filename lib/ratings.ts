// Рейтинги — спринт 9 (Фаза 2). Только числа, только бизнесам с кабинетом.
//
// Что удерживает риск, названный планом («оценки поимённых людей = персональные данные
// физлиц плюс клевета и войны конкурентов»), пока правовой контур (спринт 7) не построен:
//  1. Текста нет. Только звёзды 1–5: нечего модерировать, нечего опровергать, нечего
//     цитировать в суде.
//  2. Оценивать можно только карточку с владельцем: у кого нет кабинета, у того нет и
//     рейтинга — и некому «ответить», значит, нечего и получать.
//  3. Работников заводит сам бизнес в кабинете (имя — его слово и его ответственность);
//     посетители не создают «народное досье». Бизнес же может убрать работника — оценки
//     остаются в его общем рейтинге, но имя со страницы исчезает.
//  4. Один голос на устройство в день на бизнес (и отдельно на работника): первичный ключ,
//     как у краудсигналов, — повтор перезаписывает свой голос, а не добавляет второй.
//  5. Формула владельца: звёзды работников суммируются в рейтинг бизнеса — среднее по ВСЕМ
//     голосам (фирме и работникам) за год.

import type { Pool } from "pg";
import { trackPool } from "./track-db.ts";
import { deviceRef } from "./crowd-signals.ts";

export const RATING_WINDOW_DAYS = 365;
export const MAX_WORKERS = 30;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export type Worker = { id: number; name: string; active: boolean };

export async function addWorker(entryId: number, name: string): Promise<Worker | null> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (clean.length < 2) return null;
  const pool = trackPool();
  const { rows: [c] } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM market.worker WHERE entry_id = $1 AND active`, [entryId],
  );
  if (c.n >= MAX_WORKERS) return null;
  const { rows: [w] } = await pool.query<{ id: number }>(
    `INSERT INTO market.worker (entry_id, name) VALUES ($1, $2) RETURNING id`, [entryId, clean],
  );
  return { id: w.id, name: clean, active: true };
}

/** Убрать — не удалить: голоса за него остаются в общем рейтинге, имя со страницы уходит. */
export async function removeWorker(entryId: number, workerId: number): Promise<boolean> {
  const r = await trackPool().query(
    `UPDATE market.worker SET active = false WHERE id = $1 AND entry_id = $2 AND active`, [workerId, entryId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function workersOf(entryId: number): Promise<Worker[]> {
  const { rows } = await trackPool().query<Worker>(
    `SELECT id, name, active FROM market.worker WHERE entry_id = $1 AND active ORDER BY id`, [entryId],
  );
  return rows;
}

export type RateResult = "ok" | "bad_stars" | "no_worker";

/** Голос: за фирму (workerId 0) или за работника. Перезаписывает свой голос за день. */
export async function rate(
  entryId: number, workerId: number, installId: string, stars: number, now = new Date(),
): Promise<RateResult> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return "bad_stars";
  const pool = trackPool();
  if (workerId !== 0) {
    const { rows } = await pool.query(`SELECT 1 FROM market.worker WHERE id = $1 AND entry_id = $2 AND active`, [workerId, entryId]);
    if (rows.length === 0) return "no_worker";
  }
  await pool.query(
    `INSERT INTO market.rating (entry_id, worker_id, device_ref, day, stars)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entry_id, worker_id, device_ref, day) DO UPDATE SET stars = EXCLUDED.stars, at = now()`,
    [entryId, workerId, deviceRef(installId), utcDay(now), stars],
  );
  return "ok";
}

export type WorkerStats = { id: number; name: string; avg: number; count: number };
export type RatingStats = {
  /** Среднее по всем голосам (фирма + работники), формула владельца. */
  avg: number;
  count: number;
  workers: WorkerStats[];
};

/** Агрегат за окно для набора записей; ключ — entry_id. Нет голосов — нет ключа. */
export async function ratingStats(
  entryIds: number[], now = new Date(), pool: Pool = trackPool(),
): Promise<Map<number, RatingStats>> {
  const out = new Map<number, RatingStats>();
  if (entryIds.length === 0) return out;
  const since = utcDay(new Date(now.getTime() - RATING_WINDOW_DAYS * 86_400_000));
  const { rows } = await pool.query<{ entry_id: number; avg: string; n: string }>(
    `SELECT entry_id, avg(stars)::text AS avg, count(*)::text AS n
       FROM market.rating WHERE entry_id = ANY($1) AND day >= $2 GROUP BY entry_id`,
    [entryIds, since],
  );
  for (const r of rows) out.set(r.entry_id, { avg: Number(r.avg), count: Number(r.n), workers: [] });
  const w = await pool.query<{ entry_id: number; id: number; name: string; avg: string | null; n: string }>(
    `SELECT w.entry_id, w.id, w.name, avg(r.stars)::text AS avg, count(r.stars)::text AS n
       FROM market.worker w
       LEFT JOIN market.rating r ON r.worker_id = w.id AND r.day >= $2
      WHERE w.entry_id = ANY($1) AND w.active
      GROUP BY w.entry_id, w.id, w.name ORDER BY w.id`,
    [entryIds, since],
  );
  for (const r of w.rows) {
    const s = out.get(r.entry_id) ?? { avg: 0, count: 0, workers: [] };
    s.workers.push({ id: r.id, name: r.name, avg: r.avg ? Number(r.avg) : 0, count: Number(r.n) });
    out.set(r.entry_id, s);
  }
  return out;
}

export async function pruneRatings(pool: Pool, now = new Date()): Promise<number> {
  const before = utcDay(new Date(now.getTime() - RATING_WINDOW_DAYS * 86_400_000));
  const r = await pool.query(`DELETE FROM market.rating WHERE day < $1`, [before]);
  return r.rowCount ?? 0;
}

export async function ratingsReady(pool: Pool = trackPool()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ yes: boolean }>(`SELECT to_regclass('market.rating') IS NOT NULL AS yes`);
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}

/** «★ 4,6 (12)» или null, если голосов нет. */
export function ratingLine(s: RatingStats | undefined): string | null {
  if (!s || s.count === 0) return null;
  return `★ ${s.avg.toFixed(1).replace(".", ",")} (${s.count})`;
}
