import { NextResponse } from "next/server";
import { createClaim, marketReady } from "@/lib/market";

// «Это мой бизнес»: заявка от вошедшего посетителя на опубликованную запись.
// Подтверждает персонал звонком (см. lib/market-ddl.ts). Тело: { entryId }.

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

export async function POST(request: Request) {
  let body: { entryId?: unknown };
  try { body = (await request.json()) as { entryId?: unknown }; } catch { return bad("Неверный запрос."); }
  const entryId = typeof body.entryId === "number" && Number.isInteger(body.entryId) ? body.entryId : NaN;
  if (!Number.isInteger(entryId)) return bad("Нужен entryId.");
  if (!(await marketReady())) return bad("Кабинеты пока недоступны.", 503);

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: request.headers });
  if (!user) return bad("Нужно войти.", 401);

  const found = await payload.find({ collection: "entries", where: { id: { equals: entryId } }, limit: 1, depth: 0, overrideAccess: false });
  const entry = found.docs[0];
  if (!entry) return bad("Номер не найден.", 404);
  if (entry.owner) return bad("У этой карточки уже есть владелец.", 409);

  const r = await createClaim(entryId, Number(user.id));
  return NextResponse.json({ ok: true, state: r });
}
