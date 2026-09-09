// Карма справочника — решение владельца 2026-09-10: «у каждой организации и у каждого
// номера сделать плюс-минус, пока чтобы плюсовали и минусовали без авторизации, чтобы
// начать жизнь сайта хотя бы».
//
// Чем карма отличается от двух соседних механизмов, которые уже есть:
//  • crowd.signal («дозвонились?») — факт о попытке звонка, живёт 90 суток, отвечает на
//    вопрос «номер вообще живой?»;
//  • market.rating (звёзды 1–5) — оценка качества, только карточкам с кабинетом, потому
//    что звёзды получает тот, кому есть чем ответить;
//  • karma (±) — мнение, у ЛЮБОЙ опубликованной карточки и у каждого её номера. Это то,
//    что можно поставить, ничего не покупая и никуда не входя.
//
// Что удерживает от накрутки без авторизации: первичный ключ (запись, номер, устройство).
// Сколько ни жми — строка одна. Повтор тем же знаком отзывает голос, противоположным —
// меняет; в обоих случаях сумма двигается на единицу, а не растёт.
//
// Персональных данных здесь нет по построению: ни номера голосующего, ни его адреса, ни
// аккаунта. Устройство представлено псевдонимом device_ref — тем же HMAC, что у
// краудсигналов: дамп базы не отвечает «какое это устройство», но повтор с того же
// устройства виден, и этого достаточно правилу «один голос».

import type { Pool } from "pg";
import { trackPool } from "./track-db.ts";
import { deviceRef } from "./crowd-signals.ts";
import { ORG_KEY, phoneKey } from "./phone-key.ts";

/** Голос живёт год от последнего изменения — как и звёзды. */
export const KARMA_RETENTION_DAYS = 365;

export type Vote = -1 | 1;

export type KarmaCount = { up: number; down: number };
/** Карма карточки: организация целиком плюс по номерам, ключ — `phoneKey`. */
export type EntryKarma = { org: KarmaCount; phones: Map<string, KarmaCount> };

export type VoteResult = "set" | "cleared" | "bad_target";

/**
 * Поставить, поменять или отозвать голос.
 *
 * Повторное нажатие ТОЙ ЖЕ кнопки — отзыв (`cleared`), а не второй голос. Это не
 * украшение: без отзыва человек, ткнувший минус случайно, не может ничего исправить, и
 * единственный доступный ему ход — уйти. Возвращаемое значение говорит клиенту, что
 * именно случилось, чтобы он не гадал по своему локальному состоянию.
 */
export async function vote(
  entryId: number,
  rawPhone: string,
  installId: string,
  value: Vote,
  pool: Pool = trackPool(),
): Promise<VoteResult> {
  const key = rawPhone ? phoneKey(rawPhone) : ORG_KEY;
  // Номер, из которого нормализация ничего не извлекла («по договору»), не должен
  // молча слиться с часовым организации и утащить её карму.
  if (rawPhone && key === ORG_KEY) return "bad_target";

  const ref = deviceRef(installId);
  const { rows } = await pool.query<{ vote: number }>(
    `SELECT vote FROM crowd.karma WHERE entry_id = $1 AND phone_key = $2 AND device_ref = $3`,
    [entryId, key, ref],
  );

  if (rows[0]?.vote === value) {
    await pool.query(
      `DELETE FROM crowd.karma WHERE entry_id = $1 AND phone_key = $2 AND device_ref = $3`,
      [entryId, key, ref],
    );
    return "cleared";
  }

  await pool.query(
    `INSERT INTO crowd.karma (entry_id, phone_key, device_ref, vote)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (entry_id, phone_key, device_ref)
       DO UPDATE SET vote = EXCLUDED.vote, at = now()`,
    [entryId, key, ref, value],
  );
  return "set";
}

/** Карма набора карточек. Ключ — entry_id; карточки без единого голоса ключа не получают. */
export async function karmaStats(
  entryIds: number[],
  pool: Pool = trackPool(),
): Promise<Map<number, EntryKarma>> {
  const out = new Map<number, EntryKarma>();
  if (entryIds.length === 0) return out;

  const { rows } = await pool.query<{
    entry_id: number;
    phone_key: string;
    up: string;
    down: string;
  }>(
    `SELECT entry_id, phone_key,
            count(*) FILTER (WHERE vote = 1)::text  AS up,
            count(*) FILTER (WHERE vote = -1)::text AS down
       FROM crowd.karma
      WHERE entry_id = ANY($1)
      GROUP BY entry_id, phone_key`,
    [entryIds],
  );

  for (const r of rows) {
    const slot = out.get(r.entry_id) ?? { org: { up: 0, down: 0 }, phones: new Map() };
    const count = { up: Number(r.up), down: Number(r.down) };
    if (r.phone_key === ORG_KEY) slot.org = count;
    else slot.phones.set(r.phone_key, count);
    out.set(r.entry_id, slot);
  }
  return out;
}

/** Голоса этого устройства по набору карточек: чтобы кнопка сразу была нажатой. */
export async function myVotes(
  entryIds: number[],
  installId: string,
  pool: Pool = trackPool(),
): Promise<Map<string, Vote>> {
  const out = new Map<string, Vote>();
  if (entryIds.length === 0) return out;
  const { rows } = await pool.query<{ entry_id: number; phone_key: string; vote: number }>(
    `SELECT entry_id, phone_key, vote FROM crowd.karma
      WHERE entry_id = ANY($1) AND device_ref = $2`,
    [entryIds, deviceRef(installId)],
  );
  for (const r of rows) out.set(`${r.entry_id}:${r.phone_key}`, r.vote as Vote);
  return out;
}

export async function pruneKarma(pool: Pool, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - KARMA_RETENTION_DAYS * 86_400_000);
  const r = await pool.query(`DELETE FROM crowd.karma WHERE at < $1`, [before]);
  return r.rowCount ?? 0;
}

export async function karmaReady(pool: Pool = trackPool()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ yes: boolean }>(
      `SELECT to_regclass('crowd.karma') IS NOT NULL AS yes`,
    );
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}

/** «+4 −1» или null, если не голосовал никто. */
export function karmaLine(c: KarmaCount | undefined): string | null {
  if (!c || (c.up === 0 && c.down === 0)) return null;
  return `+${c.up} −${c.down}`;
}
