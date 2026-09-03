// Кабинеты бизнесов — спринт 8: заявка на владение, карточка, вызовы с адресом.
//
// Право на карточку живёт в одном месте — entries.owner_id — и ставится только персоналом
// после подтверждения звонком. Всё, что делает владелец (правка карточки, вызовы), сверяет
// owner_id с его сессией здесь, а не в правах коллекции: коллекция для посетителей закрыта
// на запись целиком.

import type { Pool } from "pg";
import type { Payload } from "payload";
import { trackPool } from "./track-db.ts";
import type { Entry } from "../payload-types.ts";

export const REQUEST_RETENTION_DAYS = 30;

/**
 * Срок жизни нерассмотренной заявки «это мой бизнес» — решение владельца 2026-09-03.
 *
 * До него у заявки срока не было вовсе, и это протекало в ретеншн аккаунтов: заявитель
 * исключён из удаления, пока заявка ждёт, — значит нерассмотренная заявка держала бы чужие
 * персональные данные дольше обещанных 12 месяцев (`lib/account-retention.ts`).
 * Исключение из срока не может само быть бессрочным.
 */
export const CLAIM_GRACE_DAYS = 30;

// --- заявки ------------------------------------------------------------------------
//
// Статусы: 0 — ждёт звонка персонала, 1 — подтверждена, 2 — отклонена персоналом,
// 3 — истекла без ответа.
//
// Тройка заведена отдельной, а не сведена к двойке намеренно: «отклонена» означает решение
// человека, и автомат, ставящий её по таймеру, задним числом припишет персоналу отказ,
// которого тот не выносил. Разница видна и заявителю: отклонённую заявку повторять
// бессмысленно, истёкшую — можно и нужно.

export type Claim = {
  id: number;
  entryId: number;
  entryName: string;
  entryPhones: string[];
  userId: number;
  userLabel: string;
  at: string;
};

export async function createClaim(entryId: number, userId: number): Promise<"created" | "exists"> {
  // Истёкшую заявку тот же человек может подать заново: `UNIQUE (entry_id, user_id)` иначе
  // запер бы его навсегда из-за того, что персонал однажды не дошёл до звонка. Отклонённую
  // (status = 2) не переоткрываем — это решение человека, и обходить его кнопкой нельзя.
  const r = await trackPool().query(
    `INSERT INTO market.claim (entry_id, user_id) VALUES ($1, $2)
     ON CONFLICT (entry_id, user_id) DO UPDATE
        SET status = 0, at = now()
      WHERE market.claim.status = 3`,
    [entryId, userId],
  );
  return (r.rowCount ?? 0) > 0 ? "created" : "exists";
}

/**
 * Погасить заявки, до которых персонал не дошёл за срок. Идемпотентно.
 *
 * Заявка не удаляется, а помечается истёкшей: заявитель должен увидеть, что произошло, и
 * иметь возможность подать её снова, а персонал — что до неё не дошли руки.
 */
export async function expireStaleClaims(
  pool = trackPool(),
  days: number = CLAIM_GRACE_DAYS,
): Promise<number> {
  const r = await pool.query(
    `UPDATE market.claim SET status = 3
      WHERE status = 0 AND at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return r.rowCount ?? 0;
}

export async function myClaims(userId: number): Promise<Map<number, number>> {
  const { rows } = await trackPool().query<{ entry_id: number; status: number }>(
    `SELECT entry_id, status FROM market.claim WHERE user_id = $1`, [userId],
  );
  return new Map(rows.map((r) => [r.entry_id, r.status]));
}

/** Персоналу: заявки, ждущие звонка. Имена и телефоны — из Payload, чтобы не дублировать. */
export async function pendingClaims(payload: Payload): Promise<Claim[]> {
  const { rows } = await trackPool().query<{ id: number; entry_id: number; user_id: number; at: Date }>(
    `SELECT id, entry_id, user_id, at FROM market.claim WHERE status = 0 ORDER BY at`,
  );
  if (rows.length === 0) return [];
  const entries = await payload.find({
    collection: "entries",
    where: { id: { in: rows.map((r) => r.entry_id) } },
    limit: 200, depth: 0, overrideAccess: true,
  });
  const users = await payload.find({
    collection: "users",
    where: { id: { in: rows.map((r) => r.user_id) } },
    limit: 200, depth: 0, overrideAccess: true,
  });
  const e = new Map(entries.docs.map((d) => [d.id, d]));
  const u = new Map(users.docs.map((d) => [d.id, d]));
  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    entryName: e.get(r.entry_id)?.name ?? `#${r.entry_id}`,
    entryPhones: (e.get(r.entry_id)?.phones ?? []).map((p) => p.number),
    userId: r.user_id,
    userLabel: u.get(r.user_id)?.name?.trim() || u.get(r.user_id)?.username || `#${r.user_id}`,
    at: r.at.toISOString(),
  }));
}

/** Персонал подтвердил звонком: владелец записывается в карточку, остальные заявки на неё гаснут. */
export async function approveClaim(payload: Payload, claimId: number): Promise<boolean> {
  const pool = trackPool();
  const { rows } = await pool.query<{ entry_id: number; user_id: number }>(
    `UPDATE market.claim SET status = 1 WHERE id = $1 AND status = 0 RETURNING entry_id, user_id`, [claimId],
  );
  const c = rows[0];
  if (!c) return false;
  await payload.update({ collection: "entries", id: c.entry_id, data: { owner: c.user_id }, overrideAccess: true });
  await pool.query(`UPDATE market.claim SET status = 2 WHERE entry_id = $1 AND status = 0`, [c.entry_id]);
  return true;
}

export async function rejectClaim(claimId: number): Promise<boolean> {
  const r = await trackPool().query(`UPDATE market.claim SET status = 2 WHERE id = $1 AND status = 0`, [claimId]);
  return (r.rowCount ?? 0) > 0;
}

// --- карточка владельца ---------------------------------------------------------------

export async function ownedEntries(payload: Payload, userId: number): Promise<Entry[]> {
  const r = await payload.find({
    collection: "entries",
    where: { owner: { equals: userId } },
    limit: 50, depth: 0, sort: "name", overrideAccess: true,
  });
  return r.docs;
}

export type CardPatch = {
  description?: string;
  hours?: string;
  prices?: { label: string; value: string }[];
};

/** Правка карточки владельцем: только эти поля, только своя запись. Статус не трогается. */
export async function updateOwnCard(payload: Payload, userId: number, entryId: number, patch: CardPatch): Promise<boolean> {
  const cur = await payload.findByID({ collection: "entries", id: entryId, depth: 0, overrideAccess: true }).catch(() => null);
  if (!cur || Number(cur.owner) !== userId) return false;
  const clean = (s: string | undefined, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : undefined);
  const prices = patch.prices
    ?.map((p) => ({ label: clean(p.label, 80) ?? "", value: clean(p.value, 40) ?? "" }))
    .filter((p) => p.label && p.value)
    .slice(0, 20);
  await payload.update({
    collection: "entries",
    id: entryId,
    data: {
      ...(patch.description !== undefined ? { description: clean(patch.description, 600) } : {}),
      ...(patch.hours !== undefined ? { hours: clean(patch.hours, 120) } : {}),
      ...(prices ? { prices } : {}),
    },
    overrideAccess: true,
  });
  return true;
}

// --- вызовы -------------------------------------------------------------------------

export type OrderInput = {
  entryId: number;
  customerUserId: number | null;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  note: string;
};

export async function createRequest(o: OrderInput): Promise<number> {
  const { rows: [r] } = await trackPool().query<{ id: number }>(
    `INSERT INTO market.request (entry_id, customer_user_id, address, lat, lng, phone, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [o.entryId, o.customerUserId, o.address, o.lat, o.lng, o.phone, o.note || null],
  );
  return r.id;
}

export type RequestRow = {
  id: number;
  entryId: number;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  note: string | null;
  at: string;
  seenAt: string | null;
  doneAt: string | null;
};

export async function requestsForOwner(payload: Payload, userId: number, limit = 100): Promise<RequestRow[]> {
  const mine = await ownedEntries(payload, userId);
  if (mine.length === 0) return [];
  const { rows } = await trackPool().query<{
    id: number; entry_id: number; address: string; lat: number | null; lng: number | null; phone: string;
    note: string | null; at: Date; seen_at: Date | null; done_at: Date | null;
  }>(
    `SELECT id, entry_id, address, lat, lng, phone, note, at, seen_at, done_at
       FROM market.request WHERE entry_id = ANY($1) ORDER BY at DESC LIMIT $2`,
    [mine.map((e) => e.id), limit],
  );
  return rows.map((r) => ({
    id: r.id, entryId: r.entry_id, address: r.address, lat: r.lat, lng: r.lng, phone: r.phone, note: r.note,
    at: r.at.toISOString(), seenAt: r.seen_at?.toISOString() ?? null, doneAt: r.done_at?.toISOString() ?? null,
  }));
}

/** Сколько непросмотренных вызовов у владельца — для шапки («кабинет (3)»). */
export async function unseenRequests(payload: Payload, userId: number): Promise<number> {
  const mine = await ownedEntries(payload, userId);
  if (mine.length === 0) return 0;
  const { rows: [r] } = await trackPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM market.request WHERE entry_id = ANY($1) AND seen_at IS NULL`,
    [mine.map((e) => e.id)],
  );
  return r.n;
}

export async function markRequest(payload: Payload, userId: number, requestId: number, what: "seen" | "done"): Promise<boolean> {
  const mine = await ownedEntries(payload, userId);
  if (mine.length === 0) return false;
  const col = what === "seen" ? "seen_at" : "done_at";
  const r = await trackPool().query(
    `UPDATE market.request SET ${col} = COALESCE(${col}, now()), seen_at = COALESCE(seen_at, now())
      WHERE id = $1 AND entry_id = ANY($2)`,
    [requestId, mine.map((e) => e.id)],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Регламент: вызовы старше срока удаляются — телефон клиента не должен лежать вечно. */
export async function pruneRequests(pool: Pool, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - REQUEST_RETENTION_DAYS * 86_400_000);
  const r = await pool.query(`DELETE FROM market.request WHERE at < $1`, [before]);
  return r.rowCount ?? 0;
}

export async function marketReady(pool: Pool = trackPool()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ yes: boolean }>(`SELECT to_regclass('market.request') IS NOT NULL AS yes`);
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}
