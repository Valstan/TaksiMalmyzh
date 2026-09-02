import { NextResponse } from "next/server";
import { parseLookup, resolveShare } from "@/lib/track-share";

// Данные поездки для страницы просмотра по ссылке. POST, не GET: verifier приходит телом,
// а не в адресе — адрес попадает в логи, тело нет (M0.A §6.3).
//
// Ответ — no-store: у контакта в кэше не должно оставаться координат после закрытия
// вкладки. Ошибки одинаково скупые: «нет такой поездки» и «неверный ключ» неразличимы
// снаружи, чтобы lookup нельзя было проверять перебором.

export const dynamic = "force-dynamic";

// Рейт-лимит по lookup: превью-боты и перебор verifier'а. Адреса посетителей у приложения
// нет намеренно (nginx их не передаёт), поэтому окно — на ссылку, не на клиента.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { at: number; n: number }>();

function limited(key: string, now: number): boolean {
  const h = hits.get(key);
  if (!h || now - h.at > WINDOW_MS) {
    hits.set(key, { at: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > MAX_PER_WINDOW;
}

const headers = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

export async function POST(request: Request, ctx: { params: Promise<{ lookup: string }> }) {
  const { lookup: raw } = await ctx.params;
  const lookup = parseLookup(raw);
  if (!lookup) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  if (limited(raw, Date.now())) {
    return NextResponse.json({ error: "too_many" }, { status: 429, headers });
  }

  let verifier: string | null = null;
  try {
    const body = (await request.json()) as { verifier?: unknown };
    if (typeof body.verifier === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(body.verifier)) {
      verifier = body.verifier;
    }
  } catch {
    /* тела нет — возможно, вошедший знакомый без ключа */
  }

  let viewerUserId: number | null = null;
  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    if (user) viewerUserId = Number(user.id);
  } catch {
    /* гость */
  }

  const r = await resolveShare(lookup, verifier, viewerUserId);
  if (!r.ok) {
    const status = r.reason === "revoked" ? 410 : 404;
    return NextResponse.json({ error: r.reason === "revoked" ? "revoked" : "not_found" }, { status, headers });
  }
  return NextResponse.json(r.view, { headers });
}
