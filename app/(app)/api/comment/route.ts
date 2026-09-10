import { NextResponse } from "next/server";
import {
  PAGE_FIRST,
  PAGE_MORE,
  addComment,
  commentsReady,
  listComments,
  phoneKeysOf,
  removeOwnComment,
  reportComment,
  type BadText,
} from "@/lib/comments";
import { ORG_KEY, phoneKey } from "@/lib/phone-key";
import { limited } from "@/lib/rate-limit";

// Комментарии под номерами справочника (решение владельца 2026-09-10). Логика —
// lib/comments.ts, правила для людей — /pravila, разбор — docs/COMMENTS.md.
//
// GET  ?entryId=…&before=…                       — лента карточки (курсор по id)
// POST { entryId, phone?, text, installId, website? } — опубликовать
// POST { action: "report", commentId, installId }    — пожаловаться
// POST { action: "remove", commentId, installId }    — удалить свой
//
// Без сессии — как карма: «пока без авторизации, чтобы начать жизнь сайта».
//
// ⚠️ Неиндексируемость текста третьих лиц держится ДВУМЯ слоями, и оба надо сохранять:
// лента не попадает в серверный HTML (грузится этим роутом), а `/api/` закрыт в
// app/robots.ts. Поисковые роботы исполняют JS, поэтому первый слой без второго не держит.

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const bad = (error: string, status = 400) => json({ error }, status);

const SAID: Record<BadText | "too_many", string> = {
  short: "Слишком коротко — нужно от 10 знаков.",
  long: "Слишком длинно — не больше 400 знаков.",
  link: "Ссылки в комментариях не публикуем: проверить их мы не можем.",
  phone:
    "Телефоны в комментариях не публикуем: номер попадает в справочник только после " +
    "проверки. Предложите его формой «Предложить номер».",
  too_many: "С одного устройства — не больше 3 комментариев к карточке и 10 всего за сутки.",
};

/** Запись — только опубликованная, по тем же правилам, что и для всего мира. */
async function publishedEntry(entryId: number) {
  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const found = await payload.find({
    collection: "entries",
    where: { id: { equals: entryId } },
    limit: 1,
    depth: 0,
    overrideAccess: false,
  });
  return found.docs[0] ?? null;
}

const intOf = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) ? v : NaN;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entryId = Number(url.searchParams.get("entryId"));
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw ? Number(beforeRaw) : null;
  if (!Number.isInteger(entryId) || (before !== null && !Number.isInteger(before))) {
    return bad("Нужен entryId.");
  }
  if (!(await commentsReady())) return bad("Комментарии пока недоступны.", 503);

  const entry = await publishedEntry(entryId);
  if (!entry) return bad("Карточка не найдена.", 404);

  const limit = before === null ? PAGE_FIRST : PAGE_MORE;
  const rows = await listComments(entryId, phoneKeysOf(entry.phones), before, limit + 1);
  return json({ items: rows.slice(0, limit), more: rows.length > limit });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Неверный запрос.");
  }

  // Та же проверка, что у краудсигналов и кармы: псевдоним устройства — не любая строка.
  const installId = typeof body.installId === "string" ? body.installId.trim() : "";
  if (installId.length < 16 || installId.length > 128) return bad("Нужен installId.");
  if (!(await commentsReady())) return bad("Комментарии пока недоступны.", 503);

  const action = body.action ?? "add";

  if (action === "report" || action === "remove") {
    const commentId = intOf(body.commentId);
    if (!Number.isInteger(commentId)) return bad("Нужен commentId.");
    if (limited(`cmt-act:${commentId}`, 30)) return bad("Слишком часто — попробуйте позже.", 429);
    if (action === "report") {
      const r = await reportComment(commentId, installId);
      return r === "not_found"
        ? bad("Комментарий не найден.", 404)
        : json({ ok: true, hidden: r === "hidden" });
    }
    const r = await removeOwnComment(commentId, installId);
    if (r === "not_found") return bad("Комментарий не найден.", 404);
    if (r === "not_yours") {
      return bad("Удалить можно только свой комментарий — с того же устройства, где писали.", 403);
    }
    return json({ ok: true });
  }

  if (action !== "add") return bad("Неизвестное действие.");

  // Honeypot: бот не узнаёт, что его поймали.
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });

  const entryId = intOf(body.entryId);
  if (!Number.isInteger(entryId)) return bad("Нужен entryId.");
  // Ключ — ресурс, не клиент: адресов посетителей у приложения нет. Пять в минуту на
  // карточку и шестьдесят в час на весь сайт — своё число, а не списанное с /api/suggest:
  // комментариев к одной карточке законно больше, чем предложений на весь справочник.
  if (limited(`cmt:${entryId}`, 5) || limited("cmt:all", 60, 60 * 60_000)) {
    return bad("Слишком много комментариев подряд — попробуйте позже.", 429);
  }

  const entry = await publishedEntry(entryId);
  if (!entry) return bad("Карточка не найдена.", 404);

  let key = ORG_KEY;
  const phoneRaw = typeof body.phone === "string" ? body.phone : "";
  if (phoneRaw.trim()) {
    key = phoneKey(phoneRaw);
    if (key === ORG_KEY || !phoneKeysOf(entry.phones).includes(key)) {
      return bad("У этой карточки нет такого номера.", 409);
    }
  }

  const text = typeof body.text === "string" ? body.text.slice(0, 2000) : "";
  const r = await addComment(entryId, key, text, installId);
  if (!r.ok) return bad(SAID[r.reason], r.reason === "too_many" ? 429 : 400);
  return json({ ok: true, id: r.id });
}
