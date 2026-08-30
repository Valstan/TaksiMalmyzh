import type { Pool, PoolClient } from "pg";
import {
  currentEpoch,
  openPoint,
  sealTripField,
  unwrapTripKey,
  type TrackPoint,
// Импорт относительный, а не через алиас `@/`: этот модуль запускается не только Next, но
// и обычным node из scripts/check-track.mjs, а тот про алиасы tsconfig ничего не знает.
} from "./track-crypto.ts";

// Регламент горячего и холодного слоёв: партиции вперёд, свёртка, автозакрытие, удаление
// по возрасту. Разбор решений — docs/TRIP_SCHEMA.md, требования — M0.A §3.
//
// Планировщик живёт в приложении, а не в pg_cron: наличие pg_cron на боевой конфигурации не
// проверено, а он требует правки конфигурации всего кластера, которым проект не
// распоряжается единолично. Все процедуры идемпотентны — планировщик взаимозаменяем.

/** Партиции недельные — решение владельца 2026-08-30 (M0.A §3.4). */
const PARTITION_DAYS = 7;
/** На сколько суток вперёд держим партиции. Больше двух периодов: см. TRIP_SCHEMA.md §3. */
const AHEAD_DAYS = 14;
/** Сырьё живёт 30 суток от записи (M0.A §3.1 слой 1). */
const RAW_RETENTION_DAYS = 30;
/** Свёрнутая трасса — 6 месяцев (решение владельца 2026-08-30, M0.A §8.3). */
const FOLDED_RETENTION_DAYS = 183;
/** Свёртка на T+48 ч после закрытия — окно досылки с телефона, который был офлайн. */
const FOLD_DELAY_HOURS = 48;
/** Поездка без точек и подтверждения дольше 6 часов — abandoned (M0.A §3.1). */
const ABANDON_HOURS = 6;
/** Douglas–Peucker, eps 15 м (M0.A §2.4). В E7 на широте Малмыжа ≈ 1,35e-4 градуса. */
const DP_EPS_E7 = 1350;

/** Один и тот же лок берут приём и свёртка: окно досылки закрывается ровно в момент свёртки. */
export const TRIP_LOCK_CLASS = 0x7a1c;

/** Понедельник недели, в которую попадает дата, в UTC. */
export function partitionStart(d: Date): Date {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const shift = (u.getUTCDay() + 6) % 7; // 0 = понедельник
  u.setUTCDate(u.getUTCDate() - shift);
  return u;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const partName = (from: Date) => `point_${iso(from).replace(/-/g, "")}`;

async function logRun(c: PoolClient, job: string, ok: boolean, detail: unknown) {
  await c.query(
    `INSERT INTO track.maintenance_run (job, ok, detail) VALUES ($1, $2, $3)`,
    [job, ok, JSON.stringify(detail)],
  );
}

/**
 * Создать партиции на AHEAD_DAYS вперёд. Идемпотентно.
 *
 * Отсутствие партиции — не мелочь: вставка в день без партиции падает жёстко («для строки не
 * найдена секция»), то есть приём точек встаёт у человека, который уже едет. DEFAULT-партиции
 * при этом нет намеренно — при ней PostgreSQL запрещает DETACH CONCURRENTLY, и каждый
 * ретеншн-прогон блокировал бы приём (проверено, TRIP_SCHEMA.md §3).
 */
export async function ensurePartitions(
  pool: Pool,
  now: Date,
  opts: { log?: boolean } = {},
): Promise<string[]> {
  const c = await pool.connect();
  const made: string[] = [];
  try {
    let from = partitionStart(now);
    const until = new Date(now.getTime() + AHEAD_DAYS * 86400000);
    while (from <= until) {
      const to = new Date(from.getTime() + PARTITION_DAYS * 86400000);
      const name = partName(from);
      await c.query(
        `CREATE TABLE IF NOT EXISTS track.${name}
         PARTITION OF track.point FOR VALUES FROM ($1) TO ($2)`.replace("$1", `'${iso(from)}'`).replace("$2", `'${iso(to)}'`),
      );
      made.push(name);
      from = to;
    }
    // Старт поездки вызывает эту же функцию, и писать строку журнала на каждую поездку
    // незачем: журнал прогонов нужен, чтобы видеть работу расписания, а не трафик.
    if (opts.log !== false) await logRun(c, "ensure_partitions", true, { made });
    return made;
  } finally {
    c.release();
  }
}

/**
 * Сколько суток осталось до того, как кончатся созданные партиции.
 * Меньше 3 — алерт: задача создания партиций отказала, и у приёма кончается взлётная полоса.
 */
export async function partitionRunwayDays(pool: Pool, now: Date): Promise<number> {
  const { rows } = await pool.query<{ upper: string | null }>(
    `SELECT max(
        (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\(''([0-9-]+)''\\)'))[1]
     ) AS upper
     FROM pg_class c
     JOIN pg_inherits i ON i.inhrelid = c.oid
     JOIN pg_class p ON p.oid = i.inhparent
     JOIN pg_namespace n ON n.oid = p.relnamespace
     WHERE n.nspname = 'track' AND p.relname = 'point'`,
  );
  if (!rows[0]?.upper) return 0;
  return Math.floor((new Date(rows[0].upper + "T00:00:00Z").getTime() - now.getTime()) / 86400000);
}

/**
 * Автозакрытие. Две ветки, а не одна: предикат `last_point_at < now() - 6h` при
 * `last_point_at IS NULL` ложен всегда, и поездка, не приславшая ни одной точки, осталась бы
 * открытой навсегда — то есть хранилищем без срока, что запрещено M0.A §3.6.
 */
export async function closeAbandoned(pool: Pool, now: Date): Promise<{ abandoned: number; voided: number }> {
  const c = await pool.connect();
  try {
    const cutoff = new Date(now.getTime() - ABANDON_HOURS * 3600000);
    const ab = await c.query(
      `UPDATE track.trip SET state = 2, ended_at = last_point_at, finish_reason = 'abandoned'
        WHERE state = 0 AND last_point_at IS NOT NULL AND last_point_at < $1
        RETURNING id`,
      [cutoff],
    );
    // Поездка, не приславшая НИ ОДНОЙ точки, не переводится в состояние, а УДАЛЯЕТСЯ.
    // Данных в ней нет, сворачивать нечего, гасить по сроку холодного слоя тоже нечего —
    // оставленная строка стала бы хранилищем без срока, а M0.A §3.6 требует срок для
    // каждого хранилища, которое документ создаёт. Проверка это и поймала.
    const vo = await c.query(
      `DELETE FROM track.trip
        WHERE state = 0 AND last_point_at IS NULL AND started_at < $1
        RETURNING id`,
      [cutoff],
    );
    for (const r of ab.rows) {
      await c.query(
        `INSERT INTO track.erasure_log (action, basis, target, detail)
         VALUES ('close_abandoned', 'retention_30d', $1, $2)`,
        [String(r.id), JSON.stringify({ hours: ABANDON_HOURS })],
      );
    }
    for (const r of vo.rows) {
      await c.query(
        `INSERT INTO track.erasure_log (action, basis, target, detail)
         VALUES ('delete_empty_trip', 'retention_30d', $1, $2)`,
        [String(r.id), JSON.stringify({ hours: ABANDON_HOURS, reason: "ни одной точки" })],
      );
    }
    await logRun(c, "close_abandoned", true, { abandoned: ab.rowCount, voided: vo.rowCount });
    return { abandoned: ab.rowCount ?? 0, voided: vo.rowCount ?? 0 };
  } finally {
    c.release();
  }
}

/** Douglas–Peucker по координатам в E7. Возвращает индексы оставленных вершин. */
export function douglasPeucker(pts: TrackPoint[], epsE7: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = pts[a].lngE7, ay = pts[a].latE7, bx = pts[b].lngE7, by = pts[b].latE7;
    const dx = bx - ax, dy = by - ay;
    const den = Math.hypot(dx, dy);
    let best = -1, bestD = -1;
    for (let i = a + 1; i < b; i++) {
      const d = den === 0
        ? Math.hypot(pts[i].lngE7 - ax, pts[i].latE7 - ay)
        : Math.abs(dy * (pts[i].lngE7 - ax) - dx * (pts[i].latE7 - ay)) / den;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD > epsE7) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  // Никогда не прореживаются (M0.A §2.4): границы сегментов и точки остановок.
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].flags & 0b0000_1110) keep[i] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(i);
  return out;
}

/** Упаковка свёрнутой трассы: старт абсолютом, дальше зигзаг-варинт по дельтам. */
export function packTrack(pts: TrackPoint[]): Buffer {
  const out: number[] = [];
  const head = Buffer.alloc(12);
  head.writeInt32LE(pts[0].latE7, 0);
  head.writeInt32LE(pts[0].lngE7, 4);
  head.writeInt32LE(pts[0].tMs, 8);
  out.push(...head);
  const put = (n: number) => {
    let v = ((n << 1) ^ (n >> 31)) >>> 0;
    while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
  };
  for (let i = 1; i < pts.length; i++) {
    put(pts[i].latE7 - pts[i - 1].latE7);
    put(pts[i].lngE7 - pts[i - 1].lngE7);
    put(pts[i].tMs - pts[i - 1].tMs);
    put(pts[i].accDm - pts[i - 1].accDm);
    put(pts[i].stopS - pts[i - 1].stopS);
    out.push(pts[i].flags);
  }
  return Buffer.from(out);
}

/**
 * Свёртка на T+48 ч: расшифровать сырьё, прорядить, упаковать, зашифровать обратно.
 * Сырьё при этом НЕ удаляется — оно уходит вместе с партицией по возрасту (M0.A §3.1).
 *
 * Читает точки с явным `day` из строки поездки: в PostgreSQL 17 нет index skip scan, и
 * запрос без `day` дал бы Seq Scan по каждой партиции.
 */
export async function foldDueTrips(pool: Pool, now: Date, limit = 50): Promise<number> {
  const c = await pool.connect();
  let folded = 0;
  try {
    const due = await c.query(
      `SELECT id, day, started_at, trip_key_wrapped, key_epoch
         FROM track.trip
        WHERE rolled_at IS NULL AND state IN (1, 2) AND ended_at < $1
        ORDER BY ended_at LIMIT $2`,
      [new Date(now.getTime() - FOLD_DELAY_HOURS * 3600000), limit],
    );

    for (const t of due.rows) {
      await c.query("SELECT pg_advisory_lock($1, $2)", [TRIP_LOCK_CLASS, t.id]);
      try {
        const raw = await c.query<{ seq: number; pt: Buffer }>(
          `SELECT seq, pt FROM track.point WHERE day = $1 AND trip_id = $2 ORDER BY seq`,
          [t.day, t.id],
        );
        const key = unwrapTripKey(t.trip_key_wrapped, t.id, t.key_epoch);
        const startedMs = new Date(t.started_at).getTime();
        const pts = raw.rows.map((r) => openPoint(key, t.id, r.seq, startedMs, r.pt));

        if (pts.length === 0) {
          // Свернуть нечего, но и висеть вечно нельзя: помечаем свёрнутой пустой.
          await c.query(`UPDATE track.trip SET rolled_at = now(), folded_vertices = 0 WHERE id = $1`, [t.id]);
        } else {
          const keepIdx = douglasPeucker(pts, DP_EPS_E7);
          const kept = keepIdx.map((i) => pts[i]);
          const blob = sealTripField(key, "folded", t.id, startedMs, packTrack(kept));
          await c.query(
            `UPDATE track.trip SET folded_track = $2, folded_vertices = $3, rolled_at = now() WHERE id = $1`,
            [t.id, blob, kept.length],
          );
        }
        await c.query(
          `INSERT INTO track.erasure_log (action, basis, target, rows_est, detail)
           VALUES ('fold', 'retention_30d', $1, $2, $3)`,
          [String(t.id), pts.length, JSON.stringify({ vertices: pts.length ? douglasPeucker(pts, DP_EPS_E7).length : 0 })],
        );
        folded++;
      } finally {
        await c.query("SELECT pg_advisory_unlock($1, $2)", [TRIP_LOCK_CLASS, t.id]);
      }
    }
    await logRun(c, "fold", true, { folded, due: due.rowCount });
    return folded;
  } finally {
    c.release();
  }
}

/**
 * Удаление сырья: DROP партиции по возрасту.
 *
 * Инвариант, без которого ретеншн уносит именно то, ради чего продукт существует: партиция
 * не удаляется, пока в ней есть точки поездки с `rolled_at IS NULL`. Оборванная поездка
 * пропавшего человека закрывается автозакрытием и сворачивается на общих основаниях
 * (M0.A §3.1) — но если свёртка почему-то не прошла, сырьё обязано дождаться её, а не
 * исчезнуть по расписанию.
 *
 * Три шага, а не один: `DETACH ... CONCURRENTLY` нельзя выполнять внутри транзакционного
 * блока (проверено), поэтому журнал пишется отдельно, затем отцепление, затем DROP.
 */
export async function dropAgedPartitions(pool: Pool, now: Date): Promise<string[]> {
  const cutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 86400000);
  const dropped: string[] = [];
  const c = await pool.connect();
  try {
    const parts = await c.query<{ name: string; upper: string }>(
      `SELECT c.relname AS name,
              (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\(''([0-9-]+)''\\)'))[1] AS upper
         FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
         JOIN pg_class p ON p.oid = i.inhparent
         JOIN pg_namespace n ON n.oid = p.relnamespace
        WHERE n.nspname = 'track' AND p.relname = 'point'`,
    );

    for (const p of parts.rows) {
      // Партиция удаляется, когда САМАЯ НОВАЯ строка в ней старше срока — то есть когда
      // верхняя граница диапазона уже за горизонтом. Иначе удалили бы точки, которым ещё
      // нет месяца (M0.A §3.4).
      if (new Date(p.upper + "T00:00:00Z") > cutoff) continue;

      const guard = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM track.${p.name} pt
           JOIN track.trip t ON t.id = pt.trip_id
          WHERE t.rolled_at IS NULL`,
      );
      if (Number(guard.rows[0].n) > 0) {
        await logRun(c, "drop_partition", false, {
          skipped: p.name,
          reason: "есть точки несвёрнутых поездок",
          rows: Number(guard.rows[0].n),
        });
        continue;
      }

      const est = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM track.${p.name}`);
      await c.query(
        `INSERT INTO track.erasure_log (action, basis, target, rows_est, detail)
         VALUES ('drop_partition', 'retention_30d', $1, $2, $3)`,
        [p.name, Number(est.rows[0].n), JSON.stringify({ upper: p.upper, cutoff: iso(cutoff) })],
      );
      await c.query(`ALTER TABLE track.point DETACH PARTITION track.${p.name} CONCURRENTLY`);
      await c.query(`DROP TABLE track.${p.name}`);
      dropped.push(p.name);
    }
    await logRun(c, "drop_partition", true, { dropped });
    return dropped;
  } finally {
    c.release();
  }
}

/** Холодный слой: 6 месяцев от конца поездки (решение владельца, M0.A §8.3). */
export async function pruneFolded(pool: Pool, now: Date): Promise<number> {
  const c = await pool.connect();
  try {
    const cutoff = new Date(now.getTime() - FOLDED_RETENTION_DAYS * 86400000);
    const r = await c.query(
      `UPDATE track.trip SET folded_track = NULL, ends_enc = NULL, dest_enc = NULL,
                             trip_key_wrapped = '\\x'::bytea
        WHERE ended_at < $1 AND folded_track IS NOT NULL
        RETURNING id`,
      [cutoff],
    );
    for (const row of r.rows) {
      await c.query(
        `INSERT INTO track.erasure_log (action, basis, target, detail)
         VALUES ('prune_folded', 'retention_6m', $1, $2)`,
        [String(row.id), JSON.stringify({ cutoff: iso(cutoff) })],
      );
    }
    await logRun(c, "prune_folded", true, { pruned: r.rowCount });
    return r.rowCount ?? 0;
  } finally {
    c.release();
  }
}

/** Полный прогон регламента. Порядок значим: свёртка до удаления сырья. */
export async function runMaintenance(pool: Pool, now = new Date()) {
  const partitions = await ensurePartitions(pool, now);
  const closed = await closeAbandoned(pool, now);
  const folded = await foldDueTrips(pool, now);
  const dropped = await dropAgedPartitions(pool, now);
  const pruned = await pruneFolded(pool, now);
  const runway = await partitionRunwayDays(pool, now);
  return { partitions: partitions.length, ...closed, folded, dropped, pruned, runway, epoch: currentEpoch() };
}
