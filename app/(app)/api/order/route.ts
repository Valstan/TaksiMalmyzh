import { NextResponse } from "next/server";
import { createRequest, marketReady } from "@/lib/market";
import { limited } from "@/lib/rate-limit";

// Вызов из приложения с адресом (спринт 8, п.3): «звонит и сразу свой адрес вводил».
// Тело: { entryId, address, lat?, lng?, phone, note? }. Входа не требует — клиент бизнеса
// не обязан иметь аккаунт; если вошёл, вызов привязывается к нему.
//
// Телефон и адрес клиента — персональные данные, которые он сам отдаёт бизнесу, чтобы тот
// перезвонил. Живут 30 суток (регламент). Тексты согласия — спринт 7.

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const clamp = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && v >= min && v <= max ? v : null);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return bad("Неверный запрос."); }
  if (clamp(body.website, 10)) return NextResponse.json({ ok: true }); // honeypot

  const entryId = typeof body.entryId === "number" && Number.isInteger(body.entryId) ? body.entryId : NaN;
  const address = clamp(body.address, 200);
  const phone = clamp(body.phone, 30);
  const note = clamp(body.note, 300);
  const lat = num(body.lat, 56.4, 56.6);
  const lng = num(body.lng, 50.5, 50.9);
  if (!Number.isInteger(entryId)) return bad("Нужен entryId.");
  if (address.length < 3) return bad("Нужен адрес.");
  if (!/\d{6,}/.test(phone.replace(/\D/g, ""))) return bad("Нужен телефон для обратного звонка.");
  if (limited(`order:${entryId}`, 20)) return bad("Слишком много вызовов подряд — позвоните по номеру.", 429);
  if (!(await marketReady())) return bad("Вызовы пока недоступны.", 503);

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const found = await payload.find({ collection: "entries", where: { id: { equals: entryId } }, limit: 1, depth: 0, overrideAccess: false });
  const entry = found.docs[0];
  if (!entry) return bad("Номер не найден.", 404);
  // Вызов имеет смысл только туда, где его увидят: у карточки должен быть владелец.
  if (!entry.owner) return bad("Этот бизнес пока не принимает вызовы из приложения — позвоните.", 409);

  let customerUserId: number | null = null;
  try {
    const { user } = await payload.auth({ headers: request.headers });
    if (user) customerUserId = Number(user.id);
  } catch { /* гость */ }

  const id = await createRequest({ entryId, customerUserId, address, lat, lng, phone, note });
  return NextResponse.json({ ok: true, id });
}
