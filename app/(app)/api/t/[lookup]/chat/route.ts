import { NextResponse } from "next/server";
import { contactSend, MAX_TEXT } from "@/lib/track-chat";
import { parseLookup } from "@/lib/track-share";
import { limited } from "@/lib/rate-limit";

// Сообщение от контакта на странице поездки (спринт 6). Право — то же, что на просмотр:
// verifier телом или привязанная сессия. Ответ — сообщения не возвращает: страница и так
// опрашивает /api/t/<lookup> и увидит своё вместе с чужими.

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

export async function POST(request: Request, ctx: { params: Promise<{ lookup: string }> }) {
  const { lookup: raw } = await ctx.params;
  const lookup = parseLookup(raw);
  if (!lookup) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  // Отдельное окно от просмотра: 20 сообщений в минуту на ссылку — больше человек не пишет.
  if (limited(`chat:${raw}`, 20)) return NextResponse.json({ error: "too_many" }, { status: 429, headers });

  let verifier: string | null = null;
  let text = "";
  try {
    const body = (await request.json()) as { verifier?: unknown; text?: unknown };
    if (typeof body.verifier === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(body.verifier)) verifier = body.verifier;
    if (typeof body.text === "string") text = body.text;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers });
  }
  if (!text.trim() || text.length > MAX_TEXT) {
    return NextResponse.json({ error: "bad_text", max: MAX_TEXT }, { status: 400, headers });
  }

  let viewerUserId: number | null = null;
  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    if (user) viewerUserId = Number(user.id);
  } catch { /* гость */ }

  const r = await contactSend(lookup, verifier, viewerUserId, text);
  if (!r.ok) {
    const status = r.reason === "revoked" ? 410 : r.reason === "closed" ? 409 : r.reason === "too_many" ? 429 : r.reason === "too_long" ? 400 : 404;
    return NextResponse.json({ error: r.reason }, { status, headers });
  }
  return NextResponse.json({ ok: true, seq: r.seq }, { headers });
}
