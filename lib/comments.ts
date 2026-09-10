// Комментарии посетителей под номерами справочника — решение владельца 2026-09-10:
// «телефоны надо сделать с заметками, с комментами, чтобы люди могли под ними оставить
// комменты: что это неправильный номер, или трубку не берут, или они молодцы — классно
// катают, цены дешёвые, не опаздывают».
//
// ⚠️ ЭТО ОТМЕНЯЕТ ЧАСТЬ docs/RATINGS.md, и отмена осознанная. Там записано «текста нет —
// нечего модерировать, нечего цитировать в суде», и до сегодня это было правдой. Владелец
// решил (ответ на прямой вопрос 2026-09-10): комментарии публикуются СРАЗУ, с жалобой и
// скрытием. Риск клеветы и 152-ФЗ по людям, упомянутым в тексте, принят им явно — до
// правового контура спринта 7. Что его удерживает: страница /pravila, жалоба с устройства,
// автоскрытие при трёх жалобах, очередь персонала, требование удаления у владельца
// карточки, запрет телефонов и ссылок в тексте, сроки хранения. Разбор — docs/COMMENTS.md.
//
// Автора нет по построению: ни аккаунта, ни IP, ни имени. Только device_ref — HMAC от
// локального install_id, тот же псевдоним, что у краудсигналов и кармы. Дамп базы не
// отвечает «кто написал», но отвечает «то же ли это устройство» — ровно столько, сколько
// нужно правилам «не больше N в сутки» и «одна жалоба с устройства».
//
// Адресат — пара (entry_id, phone_key). `phone_key = ''` — про организацию целиком, иначе
// ключ номера из lib/phone-key.ts, единственного нормализатора в продукте (им же пользуется
// карма). Лента и счётчик показывают только комментарии к номерам, которые у карточки есть
// СЕЙЧАС: персонал исправил неверный номер — комментарий «неправильный номер» относился к
// старой строке и с карточки уходит сам. Это не побочный эффект на словах: фильтр стоит и в
// `listComments`, и в `commentCounts`, и проверяется в scripts/check-track.mjs.

import type { Pool } from "pg";
import type { Payload } from "payload";
import { trackPool } from "./track-db.ts";
import { deviceRef } from "./crowd-signals.ts";
import { ORG_KEY, phoneKey } from "./phone-key.ts";

export const MIN_LEN = 10;
export const MAX_LEN = 400;
/** Три жалобы с разных устройств — комментарий скрывается до проверки. */
export const REPORTS_TO_HIDE = 3;
export const PER_DEVICE_PER_ENTRY_DAY = 3;
export const PER_DEVICE_DAY = 10;
/** Видимый комментарий живёт год — как окно рейтингов и кармы. */
export const COMMENT_RETENTION_DAYS = 365;
/** Скрытый — месяц, включая нерассмотренный: скрытое навсегда было бы тихим удалением. */
export const HIDDEN_RETENTION_DAYS = 30;
export const PAGE_FIRST = 3;
export const PAGE_MORE = 10;

/** 0 виден, 1 скрыт до проверки, 2 скрыт персоналом, 3 возвращён персоналом. */
export type CommentState = 0 | 1 | 2 | 3;
export type BadText = "short" | "long" | "link" | "phone";

/**
 * Текст до проверки: NFKC (полноширинные цифры становятся обычными — иначе фильтр телефонов
 * обходился бы ими), без символов нулевой ширины (иначе ими разрезали бы номер), пробелы
 * схлопнуты.
 */
export function cleanText(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Ссылки — вместе с кириллическими доменами: здесь рекламируются именно ими
// («такси-малмыж.рф»). Граница после зоны — просмотром вперёд, а не `\b`: `\b` в JS знает
// только латиницу и после «рф» не сработал бы никогда.
const LINK =
  /(?:https?:\/\/|www\.|t\.me\/|@[\p{L}\p{N}_]{3,}|[\p{L}\p{N}-]+\.(?:ru|su|com|net|org|info|pro|site|online|shop|me|xyz|top|рф|рус)(?![\p{L}\p{N}]))/iu;

// Кандидат в номер — цифры, между которыми не больше двух разделителей. Считаются ЦИФРЫ, а
// не длина совпадения: иначе «цена 150 - 200 рублей» (одна цифра и пять пробелов-дефисов)
// считалась бы телефоном. Точка разделителем не считается — это даты «10.09.2026».
const DIGIT_RUN = /\d(?:[\s()-]{0,2}\d)+/g;
const PHONE_DIGITS = 6;

/**
 * Годится ли текст. Телефоны запрещены прямо: чужой номер в комментарии — обход проверки
 * супер-админом (правило владельца 2026-08-29: наружу уходит только проверенный номер), а
 * «звоните лучше на 8-912-…» публикует непроверенный номер под проверенным. Ссылки — потому
 * что проверить их мы не можем вовсе.
 *
 * Честная цена: местный пятизначный номер («2-11-11») проходит — порог шесть цифр оставляет
 * живыми цены с разделителем тысяч («12 000»). И номер словами («восемь девять один два»)
 * не ловится вообще. Это держится правилами на /pravila и кнопкой «пожаловаться».
 */
export function checkText(text: string): BadText | null {
  if (text.length < MIN_LEN) return "short";
  if (text.length > MAX_LEN) return "long";
  if (LINK.test(text)) return "link";
  for (const run of text.match(DIGIT_RUN) ?? []) {
    if (run.replace(/\D/g, "").length >= PHONE_DIGITS) return "phone";
  }
  return null;
}

/** Ключи номеров карточки, у которых он настоящий: «по договору» — не номер. */
export function phoneKeysOf(phones: { number: string }[] | null | undefined): string[] {
  return [...new Set((phones ?? []).map((p) => phoneKey(p.number)).filter((k) => k !== ORG_KEY))];
}

export type AddResult =
  | { ok: true; id: number }
  | { ok: false; reason: BadText | "too_many" };

/**
 * Опубликовать. Сразу — решение владельца. Лимит по устройству считается в базе: это
 * единственный барьер без IP. Сброс localStorage его обнуляет, и это принято тем же доводом,
 * что у краудсигналов: цена ошибки — мусор в ленте, а не утечка.
 */
export async function addComment(
  entryId: number,
  key: string,
  text: string,
  installId: string,
  pool: Pool = trackPool(),
  now: Date = new Date(),
): Promise<AddResult> {
  const body = cleanText(text);
  const bad = checkText(body);
  if (bad) return { ok: false, reason: bad };

  const ref = deviceRef(installId);
  const since = new Date(now.getTime() - 86_400_000);
  const { rows: [c] } = await pool.query<{ n_all: number; n_here: number }>(
    `SELECT count(*)::int AS n_all, count(*) FILTER (WHERE entry_id = $2)::int AS n_here
       FROM market.comment WHERE device_ref = $1 AND at > $3`,
    [ref, entryId, since],
  );
  if (c.n_here >= PER_DEVICE_PER_ENTRY_DAY || c.n_all >= PER_DEVICE_DAY) {
    return { ok: false, reason: "too_many" };
  }

  const { rows: [r] } = await pool.query<{ id: number }>(
    `INSERT INTO market.comment (entry_id, phone_key, body, device_ref, at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [entryId, key, body, ref, now],
  );
  return { ok: true, id: r.id };
}

export type CommentItem = { id: number; phoneKey: string; text: string | null; at: string };

/**
 * Лента карточки: свежие сверху, курсор по id. Показываются видимые (0, 3) и скрытые до
 * проверки (1) — заглушкой без текста. Исчезновение без следа сделало бы механизм жалоб
 * невидимым: трое сговорившихся стирали бы неудобное молча. Скрытое персоналом (2) не
 * показывается вовсе — решение уже принято, «до проверки» было бы неправдой.
 */
export async function listComments(
  entryId: number,
  currentKeys: string[],
  before: number | null,
  limit: number,
  pool: Pool = trackPool(),
): Promise<CommentItem[]> {
  const { rows } = await pool.query<{
    id: number; phone_key: string; body: string; at: Date; state: number;
  }>(
    `SELECT id, phone_key, body, at, state FROM market.comment
      WHERE entry_id = $1 AND state IN (0, 1, 3)
        AND (phone_key = '' OR phone_key = ANY($2::text[]))
        AND ($3::int IS NULL OR id < $3)
      ORDER BY id DESC LIMIT $4`,
    [entryId, currentKeys, before, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    phoneKey: r.phone_key,
    // Текст скрытого не отдаётся никому, включая автора: лента грузится без installId.
    text: r.state === 1 ? null : r.body,
    at: r.at.toISOString(),
  }));
}

/**
 * Сколько строк увидит человек, развернув ленту, — по тем же правилам, что `listComments`:
 * число на кнопке обязано совпасть с числом строк за ней.
 */
export async function commentCounts(
  entries: { id: number; phones?: { number: string }[] | null }[],
  pool: Pool = trackPool(),
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (entries.length === 0) return out;
  const keys = new Map(entries.map((e) => [e.id, phoneKeysOf(e.phones)]));
  const { rows } = await pool.query<{ entry_id: number; phone_key: string; n: number }>(
    `SELECT entry_id, phone_key, count(*)::int AS n FROM market.comment
      WHERE entry_id = ANY($1) AND state IN (0, 1, 3) GROUP BY entry_id, phone_key`,
    [[...keys.keys()]],
  );
  for (const r of rows) {
    if (r.phone_key !== ORG_KEY && !(keys.get(r.entry_id) ?? []).includes(r.phone_key)) continue;
    out.set(r.entry_id, (out.get(r.entry_id) ?? 0) + r.n);
  }
  return out;
}

/**
 * Жалоба. Анти-накрутка — первичный ключ (комментарий, устройство), как у краудсигналов:
 * повтор с того же устройства не создаёт строку и не двигает счётчик.
 *
 * Возвращённый персоналом (3) жалобами больше не скрывается: иначе трое настойчивых гасили
 * бы его по кругу после каждого решения. Жалобы при этом считаются дальше.
 */
export async function reportComment(
  id: number,
  installId: string,
  pool: Pool = trackPool(),
): Promise<"hidden" | "counted" | "not_found"> {
  const { rows: [c] } = await pool.query<{ state: number }>(
    `SELECT state FROM market.comment WHERE id = $1`,
    [id],
  );
  // Скрытый персоналом не показывается — жаловаться не на что.
  if (!c || c.state === 2) return "not_found";

  await pool.query(
    `INSERT INTO market.comment_report (comment_id, device_ref) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [id, deviceRef(installId)],
  );
  const { rows: [u] } = await pool.query<{ state: number }>(
    `UPDATE market.comment c
        SET reports = r.n,
            state = CASE WHEN c.state = 0 AND r.n >= $2 THEN 1 ELSE c.state END,
            hidden_at = CASE WHEN c.state = 0 AND r.n >= $2
                             THEN COALESCE(c.hidden_at, now()) ELSE c.hidden_at END
       FROM (SELECT count(*)::int AS n FROM market.comment_report WHERE comment_id = $1) r
      WHERE c.id = $1
  RETURNING c.state`,
    [id, REPORTS_TO_HIDE],
  );
  return u?.state === 1 ? "hidden" : "counted";
}

/**
 * Автор удаляет своё — самый дешёвый ответ на «уберите мой текст», без аккаунта и переписки.
 * Право — совпадение псевдонима устройства; список «моих» в браузере только подсказывает
 * интерфейсу, где рисовать кнопку, и прав не даёт.
 */
export async function removeOwnComment(
  id: number,
  installId: string,
  pool: Pool = trackPool(),
): Promise<"removed" | "not_yours" | "not_found"> {
  const r = await pool.query(
    `DELETE FROM market.comment WHERE id = $1 AND device_ref = $2`,
    [id, deviceRef(installId)],
  );
  if ((r.rowCount ?? 0) > 0) return "removed";
  const { rows } = await pool.query(`SELECT 1 FROM market.comment WHERE id = $1`, [id]);
  return rows.length > 0 ? "not_yours" : "not_found";
}

// --- модерация -----------------------------------------------------------------------

export type ModerationRow = {
  id: number;
  entryId: number;
  entryName: string;
  phoneKey: string;
  text: string;
  at: string;
  state: CommentState;
  reports: number;
  /** Владелец карточки потребовал удалить. */
  ownerDemand: boolean;
};

type RawRow = {
  id: number; entry_id: number; phone_key: string; body: string; at: Date;
  state: CommentState; reports: number; demanded: boolean;
};

const toRow = (r: RawRow, names: Map<number, string>): ModerationRow => ({
  id: r.id,
  entryId: r.entry_id,
  entryName: names.get(r.entry_id) ?? `#${r.entry_id} (запись удалена)`,
  phoneKey: r.phone_key,
  text: r.body,
  at: r.at.toISOString(),
  state: r.state,
  reports: r.reports,
  ownerDemand: r.demanded,
});

/**
 * Очередь персонала: скрытое до проверки и то, чего потребовал удалить владелец, — пока
 * персонал не вынес решения. Требование владельца идёт первым.
 */
export async function reviewQueue(pool: Pool = trackPool()): Promise<ModerationRow[]> {
  const { rows } = await pool.query<RawRow>(
    `SELECT id, entry_id, phone_key, body, at, state, reports,
            owner_demand_at IS NOT NULL AS demanded
       FROM market.comment
      WHERE decided_at IS NULL AND (state = 1 OR owner_demand_at IS NOT NULL)
      ORDER BY (owner_demand_at IS NULL), COALESCE(owner_demand_at, hidden_at, at)
      LIMIT 200`,
  );
  return rows.map((r) => toRow(r, new Map()));
}

async function namesOf(payload: Payload, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const { docs } = await payload.find({
    collection: "entries",
    where: { id: { in: [...new Set(ids)] } },
    limit: 300,
    depth: 0,
    overrideAccess: true,
  });
  return new Map(docs.map((d) => [d.id, d.name]));
}

/** Очередь персонала с названиями карточек — для /kabinet. */
export async function pendingComments(
  payload: Payload,
  pool: Pool = trackPool(),
): Promise<ModerationRow[]> {
  const rows = await reviewQueue(pool);
  const names = await namesOf(payload, rows.map((r) => r.entryId));
  return rows.map((r) => ({ ...r, entryName: names.get(r.entryId) ?? r.entryName }));
}

/**
 * Владелец карточки видит ВСЕ комментарии о ней, включая скрытые, и исход своего требования.
 * Это ответ на вопрос правового контура «что видит тот, о ком пишут».
 */
export async function commentsForOwner(
  payload: Payload,
  entryIds: number[],
  pool: Pool = trackPool(),
): Promise<ModerationRow[]> {
  if (entryIds.length === 0) return [];
  const { rows } = await pool.query<RawRow>(
    `SELECT id, entry_id, phone_key, body, at, state, reports,
            owner_demand_at IS NOT NULL AS demanded
       FROM market.comment WHERE entry_id = ANY($1) ORDER BY id DESC LIMIT 300`,
    [entryIds],
  );
  const names = await namesOf(payload, entryIds);
  return rows.map((r) => toRow(r, names));
}

/** Персонал согласился с жалобой. `hidden_at` ставится при ЛЮБОМ переходе в скрытое. */
export async function hideByStaff(id: number, pool: Pool = trackPool()): Promise<boolean> {
  const r = await pool.query(
    `UPDATE market.comment
        SET state = 2, hidden_at = COALESCE(hidden_at, now()), decided_at = now()
      WHERE id = $1`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Персонал вернул. Решение персонала всегда последнее. */
export async function restoreByStaff(id: number, pool: Pool = trackPool()): Promise<boolean> {
  const r = await pool.query(
    `UPDATE market.comment SET state = 3, decided_at = now() WHERE id = $1`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}

export type DemandResult =
  /** был виден — скрыт до проверки и поставлен в очередь */
  | "hidden"
  /** персонал его уже возвращал — требование снова в очереди, до решения он виден */
  | "requeued"
  /** требование уже подано и ждёт решения */
  | "already_pending"
  /** персонал рассмотрел требование и оставил комментарий */
  | "kept"
  /** комментарий уже скрыт персоналом */
  | "removed"
  | "not_found";

/**
 * Требование владельца карточки удалить комментарий.
 *
 * ⚠️ Отдельно от жалоб, и это выстрадано заранее. В первом проекте требование было жалобой с
 * псевдонимом «owner:<id>» — и ломалось дважды: посетитель, приславший такой installId,
 * занимал слот владельца навсегда; а после того как персонал однажды вернул комментарий,
 * кнопка владельца превращалась в молчаливый `ok` без действия. Здесь требование — своя
 * отметка времени, оно ставит комментарий в очередь персонала из ЛЮБОГО видимого состояния,
 * а владелец всегда получает честный исход вместо `ok`.
 *
 * Сам владелец удалить чужой комментарий не может: справочник, где бизнес стирает критику
 * одним нажатием, врёт посетителю.
 */
export async function demandByOwner(
  ownedEntryIds: number[],
  id: number,
  pool: Pool = trackPool(),
): Promise<DemandResult> {
  const { rows: [c] } = await pool.query<{
    state: number; owner_demand_at: Date | null; decided_at: Date | null;
  }>(
    `SELECT state, owner_demand_at, decided_at FROM market.comment
      WHERE id = $1 AND entry_id = ANY($2)`,
    [id, ownedEntryIds],
  );
  if (!c) return "not_found";
  if (c.state === 2) return "removed";
  if (c.owner_demand_at) {
    return c.decided_at && c.decided_at > c.owner_demand_at ? "kept" : "already_pending";
  }
  await pool.query(
    `UPDATE market.comment
        SET owner_demand_at = now(),
            state = CASE WHEN state = 0 THEN 1 ELSE state END,
            hidden_at = CASE WHEN state = 0 THEN COALESCE(hidden_at, now()) ELSE hidden_at END,
            decided_at = NULL
      WHERE id = $1`,
    [id],
  );
  return c.state === 3 ? "requeued" : "hidden";
}

// --- сроки ----------------------------------------------------------------------------

/**
 * Уборка по срокам. Возраст скрытого считается от `hidden_at`, а если его нет — от даты
 * создания: строка без конца жизни в этом проекте не допускается.
 */
export async function pruneComments(
  pool: Pool = trackPool(),
  now: Date = new Date(),
): Promise<{ visible: number; hidden: number; orphans: number }> {
  const visibleBefore = new Date(now.getTime() - COMMENT_RETENTION_DAYS * 86_400_000);
  const hiddenBefore = new Date(now.getTime() - HIDDEN_RETENTION_DAYS * 86_400_000);
  const a = await pool.query(
    `DELETE FROM market.comment WHERE state IN (0, 3) AND at < $1`,
    [visibleBefore],
  );
  const b = await pool.query(
    `DELETE FROM market.comment WHERE state IN (1, 2) AND COALESCE(hidden_at, at) < $1`,
    [hiddenBefore],
  );
  return { visible: a.rowCount ?? 0, hidden: b.rowCount ?? 0, orphans: await pruneOrphanComments(pool) };
}

/**
 * Комментарии к удалённым записям. Внешнего ключа на public.entries нет намеренно — сырые
 * схемы не завязываются на таблицы Payload, как и у market.claim.
 *
 * ⚠️ Гейт на существование таблицы не для красоты: в базе проверки схемы (CI) таблиц Payload
 * нет вовсе, и запрос без гейта уронил бы и проверку, и часовой тик регламента.
 */
export async function pruneOrphanComments(pool: Pool = trackPool()): Promise<number> {
  const { rows: [t] } = await pool.query<{ yes: boolean }>(
    `SELECT to_regclass('public.entries') IS NOT NULL AS yes`,
  );
  if (!t?.yes) return 0;
  const r = await pool.query(
    `DELETE FROM market.comment c
      WHERE NOT EXISTS (SELECT 1 FROM public.entries e WHERE e.id = c.entry_id)`,
  );
  return r.rowCount ?? 0;
}

export async function commentsReady(pool: Pool = trackPool()): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ yes: boolean }>(
      `SELECT to_regclass('market.comment') IS NOT NULL AS yes`,
    );
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}
