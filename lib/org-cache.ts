// Корпус организаций для подсказок — ТОЛЬКО анонимная проекция.
//
// ⚠️ Кэш вынесен в отдельный модуль не для порядка. В нём лежит список, который увидит
// любой посторонний, и единственное, что гарантирует, что туда не попадёт черновик, — то,
// что у этого модуля нет доступа к пользователю вообще: `payload.find` здесь зовётся без
// `req`, значит access-правило коллекции идёт по анонимной ветке и отдаёт только
// опубликованное. Держи кэш рядом с кодом, у которого сессия есть, — и однажды туда
// положат не ту проекцию; граница модуля делает эту ошибку невозможной, а не маловероятной.
//
// По той же причине подсказки ВСЕГДА анонимны, даже для вошедшего персонала: персоналу
// справочник показывает админка, а форма предложения — посетительская.
//
// Свежесть — TTL 30 секунд, без хуков в коллекции: персонал опубликовал карточку — через
// полминуты её подскажут. Для справочника маленького города этого достаточно, а хук в
// `collections/Entries.ts` связал бы конфиг Payload с кэшем подсказок ради тридцати секунд.

import type { OrgRow } from "./org-search.ts";

const TTL_MS = 30_000;
let cache: { at: number; rows: OrgRow[] } | null = null;

export async function publishedOrgs(now: number = Date.now()): Promise<OrgRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const { docs } = await payload.find({
    collection: "entries",
    overrideAccess: false, // без req — анонимная ветка access-правила: только опубликованное
    depth: 0,
    limit: 1000,
    pagination: false,
    sort: "name",
  });

  const rows: OrgRow[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    phones: (d.phones ?? []).map((p) => p.number),
  }));
  cache = { at: now, rows };
  return rows;
}
