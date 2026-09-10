// Очередь предложенных правок к записям справочника (решение владельца 2026-09-10).
//
// Человек выбрал в форме уже существующую организацию и добавил ей номер. Номер не
// дописывается в карточку сразу: правило владельца 2026-08-29 — наружу уходит только
// проверенное, а дописать номер по анонимному запросу значит опубликовать непроверенный.
// Номер ложится сюда и ждёт персонал, который принимает его одной кнопкой в /kabinet.
//
// Разбор решений — docs/DIRECTORY_EDITS.md. DDL — lib/market-ddl.ts.

import type { Pool } from "pg";
import type { Payload } from "payload";
import { trackPool } from "./track-db.ts";
import { phoneKey } from "./phone-key.ts";

/** Сколько правка ждёт персонал, прежде чем погаснуть автоматом. */
export const EDIT_GRACE_DAYS = 60;
/** Сколько решённая правка хранится ради истории, прежде чем удалиться. */
export const EDIT_RETENTION_DAYS = 90;
/**
 * Потолок номеров у одной карточки при приёмке. Не ради базы — ради человека: карточка с
 * двадцатью номерами уже не справочник, а свалка, и такое место заслуживает взгляда
 * персонала в админке, а не ещё одной кнопки «добавить».
 */
export const MAX_PHONES_PER_ENTRY = 10;

export type EditStatus = 0 | 1 | 2 | 3;

export type EntryEdit = {
  id: number;
  entryId: number;
  entryName: string;
  /** Статус записи, к которой правка: персоналу важно видеть, что это черновик. */
  entryStatus: string | null;
  entryPhones: string[];
  raw: string;
  note: string | null;
  at: string;
};

/** Годится ли строка как номер для очереди: не пустой ключ и хотя бы пять цифр. */
export function acceptablePhone(raw: string): boolean {
  return phoneKey(raw) !== "" && raw.replace(/\D/g, "").length >= 5;
}

/**
 * Положить номер в очередь. Повтор того же номера к той же записи, пока правка ждёт, строки
 * не добавляет — это и есть антизаливка: десять человек, одна строка.
 */
export async function createEntryEdit(
  entryId: number,
  raw: string,
  note: string | null,
  pool: Pool = trackPool(),
): Promise<"created" | "exists" | "bad_phone"> {
  const clean = raw.trim().slice(0, 30);
  if (!acceptablePhone(clean)) return "bad_phone";
  const r = await pool.query(
    `INSERT INTO market.entry_edit (entry_id, kind, value, raw, note)
     VALUES ($1, 0, $2, $3, $4)
     ON CONFLICT (entry_id, kind, value) WHERE status = 0 DO NOTHING`,
    [entryId, phoneKey(clean), clean, note?.trim().slice(0, 300) || null],
  );
  return (r.rowCount ?? 0) > 0 ? "created" : "exists";
}

async function decide(id: number, status: EditStatus, pool: Pool): Promise<boolean> {
  const r = await pool.query(
    `UPDATE market.entry_edit SET status = $2, decided_at = now() WHERE id = $1 AND status = 0`,
    [id, status],
  );
  return (r.rowCount ?? 0) > 0;
}

export type ApproveResult = "added" | "already" | "gone" | "full" | "not_found";

/**
 * Персонал позвонил и принимает номер.
 *
 * ⚠️ Порядок шагов выстрадан заранее, а не на проде. Сначала читаем запись, и читаем
 * мягко (`.catch(() => null)`): внешнего ключа на entries нет намеренно, запись могли
 * удалить, пока правка ждала. Такая правка гаснет со статусом 3 — автомат, а не отказ
 * персонала. Помечать правку принятой ДО чтения было бы ошибкой: `findByID` бросает на
 * отсутствующей записи, персонал получил бы 500, а строка уже сгорела бы — номер не
 * добавлен никуда, и одна удалённая карточка навсегда съедала бы очередь.
 *
 * И запись карточки идёт ДО пометки: упала запись — правка осталась ждущей, её можно
 * принять ещё раз. Существующим номерам передаются их id, чтобы адаптер не перевыпускал
 * их без нужды.
 */
export async function approveEntryEdit(
  payload: Payload,
  id: number,
  pool: Pool = trackPool(),
): Promise<ApproveResult> {
  const { rows } = await pool.query<{ entry_id: number; value: string; raw: string }>(
    `SELECT entry_id, value, raw FROM market.entry_edit WHERE id = $1 AND status = 0`,
    [id],
  );
  const edit = rows[0];
  if (!edit) return "not_found";

  const entry = await payload
    .findByID({ collection: "entries", id: edit.entry_id, depth: 0, overrideAccess: true })
    .catch(() => null);
  if (!entry) {
    await decide(id, 3, pool);
    return "gone";
  }

  const phones = entry.phones ?? [];
  if (phones.some((p) => phoneKey(p.number) === edit.value)) {
    await decide(id, 1, pool);
    return "already";
  }
  if (phones.length >= MAX_PHONES_PER_ENTRY) return "full";

  await payload.update({
    collection: "entries",
    id: entry.id,
    data: { phones: [...phones.map((p) => ({ id: p.id, number: p.number })), { number: edit.raw }] },
    overrideAccess: true,
  });
  await decide(id, 1, pool);
  return "added";
}

export async function rejectEntryEdit(id: number, pool: Pool = trackPool()): Promise<boolean> {
  return decide(id, 2, pool);
}

/** Персоналу: ждущие правки. Имена и номера записей — из Payload, чтобы не дублировать. */
export async function pendingEntryEdits(
  payload: Payload,
  pool: Pool = trackPool(),
): Promise<EntryEdit[]> {
  const { rows } = await pool.query<{
    id: number; entry_id: number; raw: string; note: string | null; at: Date;
  }>(
    `SELECT id, entry_id, raw, note, at FROM market.entry_edit WHERE status = 0 ORDER BY at LIMIT 200`,
  );
  if (rows.length === 0) return [];
  const { docs } = await payload.find({
    collection: "entries",
    where: { id: { in: [...new Set(rows.map((r) => r.entry_id))] } },
    limit: 200,
    depth: 0,
    overrideAccess: true,
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  return rows.map((r) => {
    const e = byId.get(r.entry_id);
    return {
      id: r.id,
      entryId: r.entry_id,
      entryName: e?.name ?? `#${r.entry_id} (запись удалена)`,
      entryStatus: e?.status ?? null,
      entryPhones: (e?.phones ?? []).map((p) => p.number),
      raw: r.raw,
      note: r.note,
      at: r.at.toISOString(),
    };
  });
}

/** Погасить правки, до которых персонал не дошёл за срок. Идемпотентно. */
export async function expireStaleEntryEdits(
  pool: Pool = trackPool(),
  now: Date = new Date(),
  days: number = EDIT_GRACE_DAYS,
): Promise<number> {
  const before = new Date(now.getTime() - days * 86_400_000);
  const r = await pool.query(
    `UPDATE market.entry_edit SET status = 3, decided_at = $2 WHERE status = 0 AND at < $1`,
    [before, now],
  );
  return r.rowCount ?? 0;
}

/**
 * Решённые правки старше срока — вон. Номер бизнеса персональными данными не является, но
 * примечание — свободный текст, и человек мог написать туда что угодно, включая свой
 * телефон. Бессрочно такое не лежит.
 */
export async function pruneEntryEdits(
  pool: Pool = trackPool(),
  now: Date = new Date(),
  days: number = EDIT_RETENTION_DAYS,
): Promise<number> {
  const before = new Date(now.getTime() - days * 86_400_000);
  const r = await pool.query(
    `DELETE FROM market.entry_edit WHERE status <> 0 AND decided_at < $1`,
    [before],
  );
  return r.rowCount ?? 0;
}

export async function entryEditsReady(pool: Pool = trackPool()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ yes: boolean }>(
      `SELECT to_regclass('market.entry_edit') IS NOT NULL AS yes`,
    );
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}
