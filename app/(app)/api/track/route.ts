import { NextResponse } from "next/server";
import { checkRecordingGate } from "@/lib/track-gate";
import { finishTrip, ingestPoints, MAX_BATCH, startTrip } from "@/lib/track-trips";
import type { TrackPoint } from "@/lib/track-crypto";

// Запись поездки — единственный эндпоинт с тремя действиями, а не три маршрута.
//
// ⚠️ ЗАКРЫТ ПО УМОЛЧАНИЮ. Стенд открыт наружу (решение владельца 2026-08-29), и открытый
// эндпоинт записи означал бы, что поездку может записать посторонний — то есть чужие
// персональные данные, то есть ЭТАП B, в который проект не входил (M0.A §8.0). Гейт в
// lib/track-gate.ts: нужны обе переменные, TRACK_RECORDING=on и TRACK_ETAP_A_TOKEN.
// Без них ответ 404 — «такого адреса нет», а не «закрыто».
//
// Тело: { action: "start" | "points" | "finish", ... }

export const dynamic = "force-dynamic";

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

function parsePoint(raw: unknown): TrackPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number): number | null => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return null;
    return v;
  };
  // Диапазоны — не украшение: значение вне их сломало бы упаковку в 19 байт молча,
  // а «молча» здесь означает нечитаемую точку через месяц.
  const tMs = int(p.tMs, 0, 2_147_483_647);
  const latE7 = int(p.latE7, -900_000_000, 900_000_000);
  const lngE7 = int(p.lngE7, -1_800_000_000, 1_800_000_000);
  const accDm = int(p.accDm, 0, 65_535);
  const spdCms = int(p.spdCms, 0, 65_535);
  const flags = int(p.flags, 0, 255);
  const stopS = int(p.stopS, 0, 65_535);
  if (tMs === null || latE7 === null || lngE7 === null || accDm === null
      || spdCms === null || flags === null || stopS === null) return null;
  return { tMs, latE7, lngE7, accDm, spdCms, flags, stopS };
}

export async function POST(request: Request) {
  const gate = checkRecordingGate(request);
  if (!gate.ok) {
    return gate.status === 404
      ? new NextResponse("Not Found", { status: 404 })
      : NextResponse.json({ error: "Нет доступа." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Неверный запрос.");
  }

  const action = body.action;

  if (action === "start") {
    // install_id порождается клиентом и живёт локально (M0.A §6.2.2). Сюда приезжает
    // только он сам, а в базу уходит его HMAC — дамп не отвечает «какое устройство».
    const installId = typeof body.installId === "string" ? body.installId.trim() : "";
    if (installId.length < 16 || installId.length > 128) return bad("Неверный installId.");
    const trip = await startTrip(installId);
    return NextResponse.json(trip);
  }

  const tripId = typeof body.tripId === "number" ? body.tripId : NaN;
  const writeToken = typeof body.writeToken === "string" ? body.writeToken : "";
  if (!Number.isInteger(tripId) || !writeToken) return bad("Нужны tripId и writeToken.");

  if (action === "points") {
    const raw = Array.isArray(body.points) ? body.points : null;
    if (!raw) return bad("Нужен массив points.");
    if (raw.length > MAX_BATCH) return bad(`Не больше ${MAX_BATCH} точек за раз.`, 413);

    const points: { seq: number; point: TrackPoint }[] = [];
    for (const item of raw) {
      const rec = item as Record<string, unknown>;
      const seq = typeof rec?.seq === "number" && Number.isInteger(rec.seq) && rec.seq >= 0
        ? rec.seq : null;
      const point = parsePoint(rec?.point);
      if (seq === null || !point) return bad("Неверная точка в пачке.");
      points.push({ seq, point });
    }

    const result = await ingestPoints(tripId, writeToken, points);
    if (!result.ok) {
      if (result.reason === "closed") return bad("Поездка уже закрыта.", 409);
      if (result.reason === "too_many") return bad(`Не больше ${MAX_BATCH} точек за раз.`, 413);
      return bad("Поездка не найдена.", 404);
    }
    return NextResponse.json({ ok: true, accepted: result.accepted, total: result.total });
  }

  if (action === "finish") {
    const done = await finishTrip(tripId, writeToken);
    return done.ok ? NextResponse.json({ ok: true }) : bad("Поездка не найдена.", 404);
  }

  return bad("Неизвестное действие.");
}
