import { NextResponse } from "next/server";
import { approveClaim, markRequest, marketReady, rejectClaim, updateOwnCard, type CardPatch } from "@/lib/market";

// Действия кабинета. Владелец: card (правка своей карточки), seen/done (вызов).
// Персонал: approve/reject (заявка на владение — после звонка по номеру).
// Право — сессия; чья именно — проверяется в lib/market.ts по owner_id, не здесь.

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return bad("Неверный запрос."); }
  if (!(await marketReady())) return bad("Кабинеты пока недоступны.", 503);

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: request.headers });
  if (!user) return bad("Нужно войти.", 401);
  const userId = Number(user.id);
  const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : NaN;

  switch (body.action) {
    case "card": {
      if (!Number.isInteger(id)) return bad("Нужен id карточки.");
      const patch: CardPatch = {
        description: typeof body.description === "string" ? body.description : undefined,
        hours: typeof body.hours === "string" ? body.hours : undefined,
        prices: Array.isArray(body.prices)
          ? (body.prices as { label?: unknown; value?: unknown }[]).map((p) => ({
              label: typeof p?.label === "string" ? p.label : "",
              value: typeof p?.value === "string" ? p.value : "",
            }))
          : undefined,
      };
      const ok = await updateOwnCard(payload, userId, id, patch);
      return ok ? NextResponse.json({ ok: true }) : bad("Это не ваша карточка.", 403);
    }
    case "seen":
    case "done": {
      if (!Number.isInteger(id)) return bad("Нужен id вызова.");
      const ok = await markRequest(payload, userId, id, body.action);
      return ok ? NextResponse.json({ ok: true }) : bad("Вызов не найден.", 404);
    }
    case "approve":
    case "reject": {
      if (user.role !== "superadmin") return bad("Только персонал.", 403);
      if (!Number.isInteger(id)) return bad("Нужен id заявки.");
      const ok = body.action === "approve" ? await approveClaim(payload, id) : await rejectClaim(id);
      return ok ? NextResponse.json({ ok: true }) : bad("Заявка не найдена.", 404);
    }
    default:
      return bad("Неизвестное действие.");
  }
}
