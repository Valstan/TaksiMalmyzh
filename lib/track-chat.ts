// Чат на странице поездки — спринт 6 (решение владельца 2026-08-29: строить, ОРИ-риск
// принят явно, M0.A §7.6/§9.3).
//
// Зачем: контакт, открывший ссылку, пишет уехавшему «где ты? / выезжаю / уже подъезжаю»,
// не зная его номера, а пассажир отвечает с экрана записи. Переписка — часть поездки:
// шифруется её ключом (тот же конвертный контур, что и точки), живёт до свёртки
// поездки и удаляется вместе с сырьём (M0.A §3–4). Это не мессенджер: истории между
// поездками нет, аккаунтов нет, вложений нет.
//
// Кнопки «позвонить» / «SMS» — деградация, работающая и без чата: пассажир МОЖЕТ (не
// обязан) оставить номер для связи на эту поездку; он шифруется тем же ключом и умирает
// со свёрткой. Контакт, который и так знает номер, его не увидит дважды — увидит кнопку.

import type { Pool } from "pg";
import { trackPool } from "./track-db.ts";
import { openMessage, openTripField, sealMessage, sealTripField, unwrapTripKey } from "./track-crypto.ts";
import { authorizeWrite, checkShareAccess } from "./track-share.ts";

export const MAX_TEXT = 500;
export const MAX_PER_TRIP = 300;

export type Author = "passenger" | "contact";
const AUTHOR_CODE: Record<Author, number> = { passenger: 1, contact: 2 };

export type ChatMessage = {
  seq: number;
  at: string;
  author: Author;
  /** Подпись ссылки, через которую написал контакт («маме»); у пассажира — null. */
  via: string | null;
  text: string;
};

type TripKeyRow = { id: number; started_at: Date; trip_key_wrapped: Buffer; key_epoch: number; rolled_at: Date | null };

async function tripKey(c: { query: Pool["query"] }, tripId: number) {
  const { rows } = await c.query<TripKeyRow>(
    `SELECT id, started_at, trip_key_wrapped, key_epoch, rolled_at FROM track.trip WHERE id = $1`,
    [tripId],
  );
  const t = rows[0];
  if (!t) return null;
  return { t, key: unwrapTripKey(t.trip_key_wrapped, t.id, t.key_epoch), startedMs: t.started_at.getTime() };
}

/** Записать сообщение. seq берётся под блокировкой строки поездки — без гонок. */
async function insertMessage(
  tripId: number,
  author: Author,
  shareId: number | null,
  text: string,
  now = new Date(),
): Promise<{ ok: true; seq: number } | { ok: false; reason: "not_found" | "closed" | "too_long" | "too_many" }> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, reason: "too_long" };
  if (clean.length > MAX_TEXT) return { ok: false, reason: "too_long" };

  const pool = trackPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT id FROM track.trip WHERE id = $1 FOR UPDATE`, [tripId]);
    const k = await tripKey(c, tripId);
    if (!k) { await c.query("ROLLBACK"); return { ok: false, reason: "not_found" }; }
    // Свёрнутая поездка — переписка уже удалена, писать некуда.
    if (k.t.rolled_at) { await c.query("ROLLBACK"); return { ok: false, reason: "closed" }; }
    const { rows: [m] } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM track.message WHERE trip_id = $1`, [tripId],
    );
    if (m.n >= MAX_PER_TRIP) { await c.query("ROLLBACK"); return { ok: false, reason: "too_many" }; }
    const { rows: [s] } = await c.query<{ seq: number }>(
      `SELECT COALESCE(max(seq), -1) + 1 AS seq FROM track.message WHERE trip_id = $1`, [tripId],
    );
    await c.query(
      `INSERT INTO track.message (trip_id, seq, share_id, author, at, body) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tripId, s.seq, shareId, AUTHOR_CODE[author], now, sealMessage(k.key, tripId, s.seq, k.startedMs, clean)],
    );
    await c.query("COMMIT");
    return { ok: true, seq: s.seq };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Пассажир пишет с экрана записи — право даёт writeToken поездки. */
export async function passengerSend(tripId: number, writeToken: string, text: string) {
  if (!(await authorizeWrite(tripId, writeToken))) return { ok: false as const, reason: "not_found" as const };
  return insertMessage(tripId, "passenger", null, text);
}

/** Контакт пишет со страницы ссылки — право даёт verifier или привязанная сессия. */
export async function contactSend(lookup: Buffer, verifier: string | null, viewerUserId: number | null, text: string) {
  const a = await checkShareAccess(lookup, verifier, viewerUserId);
  if (!a.ok) return { ok: false as const, reason: a.reason };
  return insertMessage(a.tripId, "contact", a.shareId, text);
}

/** Переписка поездки, расшифрованная в памяти; после свёртки — пусто. */
export async function listMessages(tripId: number, limit = 200): Promise<ChatMessage[]> {
  const pool = trackPool();
  const k = await tripKey(pool, tripId);
  if (!k || k.t.rolled_at) return [];
  const { rows } = await pool.query<{ seq: number; at: Date; author: number; body: Buffer; label: string | null }>(
    `SELECT m.seq, m.at, m.author, m.body, s.label
       FROM track.message m LEFT JOIN track.share s ON s.id = m.share_id
      WHERE m.trip_id = $1 ORDER BY m.seq DESC LIMIT $2`,
    [tripId, limit],
  );
  const out: ChatMessage[] = [];
  for (const r of rows.reverse()) {
    try {
      out.push({
        seq: r.seq,
        at: r.at.toISOString(),
        author: r.author === 1 ? "passenger" : "contact",
        via: r.author === 2 ? r.label : null,
        text: openMessage(k.key, tripId, r.seq, k.startedMs, r.body),
      });
    } catch {
      /* повреждённое сообщение — пропускаем, не роняем страницу */
    }
  }
  return out;
}

export async function passengerMessages(tripId: number, writeToken: string): Promise<ChatMessage[] | null> {
  if (!(await authorizeWrite(tripId, writeToken))) return null;
  return listMessages(tripId);
}

// --- номер для связи (деградация чата) ---------------------------------------------

/** Пассажир оставляет номер на эту поездку; пустая строка — убрать. Шифруется ключом поездки. */
export async function setContactPhone(tripId: number, writeToken: string, phone: string): Promise<boolean> {
  if (!(await authorizeWrite(tripId, writeToken))) return false;
  const digits = phone.replace(/[^\d+]/g, "").slice(0, 20);
  const pool = trackPool();
  const k = await tripKey(pool, tripId);
  if (!k) return false;
  await pool.query(`UPDATE track.trip SET contact_phone_enc = $2 WHERE id = $1`, [
    tripId,
    digits ? sealTripField(k.key, "phone", tripId, k.startedMs, Buffer.from(digits, "utf8")) : null,
  ]);
  return true;
}

export async function readContactPhone(tripId: number): Promise<string | null> {
  const pool = trackPool();
  const { rows } = await pool.query<TripKeyRow & { contact_phone_enc: Buffer | null }>(
    `SELECT id, started_at, trip_key_wrapped, key_epoch, rolled_at, contact_phone_enc FROM track.trip WHERE id = $1`,
    [tripId],
  );
  const t = rows[0];
  if (!t?.contact_phone_enc) return null;
  try {
    const key = unwrapTripKey(t.trip_key_wrapped, t.id, t.key_epoch);
    return openTripField(key, "phone", t.id, t.started_at.getTime(), t.contact_phone_enc).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Регламент: переписка и номер умирают вместе с сырьём — при свёртке поездки. Вызывается
 * из часового тика; идемпотентно. Пишет в журнал уничтожения, как и всё остальное.
 */
export async function pruneChat(pool: Pool): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const del = await c.query(
      `DELETE FROM track.message m USING track.trip t WHERE t.id = m.trip_id AND t.rolled_at IS NOT NULL`,
    );
    const ph = await c.query(
      `UPDATE track.trip SET contact_phone_enc = NULL WHERE rolled_at IS NOT NULL AND contact_phone_enc IS NOT NULL`,
    );
    const n = (del.rowCount ?? 0) + (ph.rowCount ?? 0);
    if (n > 0) {
      await c.query(
        `INSERT INTO track.erasure_log (action, basis, target, rows_est, detail)
         VALUES ('prune_chat', 'retention_30d', 'track.message', $1, $2)`,
        [del.rowCount ?? 0, JSON.stringify({ phones: ph.rowCount ?? 0 })],
      );
    }
    await c.query("COMMIT");
    return n;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
