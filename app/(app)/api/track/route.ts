import { NextResponse } from "next/server";
import { checkRecordingGate } from "@/lib/track-gate";
import { finishTrip, ingestPoints, MAX_BATCH, startTrip } from "@/lib/track-trips";
import { allOk, createShare, listShares, revokeShare, setLive } from "@/lib/track-share";
import { passengerMessages, passengerSend, setContactPhone, MAX_TEXT } from "@/lib/track-chat";
import type { TrackPoint } from "@/lib/track-crypto";

// Запись поездки — один эндпоинт на все действия, а не маршрут на каждое.
//
// ⚠️ ЗАКРЫТ ПО УМОЛЧАНИЮ. Стенд открыт наружу (решение владельца 2026-08-29), и открытый
// эндпоинт записи означал бы, что поездку может записать посторонний — то есть чужие
// персональные данные, то есть ЭТАП B, в который проект не входил (M0.A §8.0). Гейт в
// lib/track-gate.ts держится на двух вещах, и токена среди них нет: мастер-выключатель
// TRACK_RECORDING=on и роль superadmin у вошедшего. Выключенная запись отвечает 404 —
// «такого адреса нет» не сообщает постороннему, что здесь что-то есть; а вошедший без
// роли (посетитель завёл себе аккаунт через единый вход) получает 401, тот же, что гость.
//
// Тело: { action: "start" | "points" | "finish" | "share" | "shares" | "revoke" | "live"
//                | "ok" | "chat" | "messages" | "phone", ... }
//
// Действия спринтов 4 и 6 (share/shares/revoke/live/ok, chat/messages/phone) авторизуются
// тем же writeToken поездки: делиться поездкой, гасить тревогу и писать в чат может только
// тот, кто её пишет.

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
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Неверный запрос.");
  }

  const action = body.action;

  // Сессия требуется только на СТАРТЕ поездки. Дальше поездка живёт своим токеном записи,
  // и это не небрежность, а требование сценария: поездка длится часами, сессия может
  // истечь по дороге, и тогда точки уже начатой поездки некуда было бы девать.
  if (action === "start") {
    const gate = await checkRecordingGate(request);
    if (!gate.ok) {
      return gate.status === 404
        ? new NextResponse("Not Found", { status: 404 })
        : NextResponse.json({ error: "Нужно войти в приложение." }, { status: 401 });
    }
  } else if (process.env.TRACK_RECORDING !== "on") {
    // Выключенная запись невидима целиком, а не только для старта.
    return new NextResponse("Not Found", { status: 404 });
  }

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
    // «idle» присылает клиент, когда завершил поездку сам — после неподвижности и трёх
    // неотвеченных напоминаний. Это не то же самое, что нажатая человеком кнопка.
    const reason = body.reason === "idle" ? "idle" : "user";
    const done = await finishTrip(tripId, writeToken, reason);
    return done.ok ? NextResponse.json({ ok: true }) : bad("Поездка не найдена.", 404);
  }

  if (action === "share") {
    const label = typeof body.label === "string" ? body.label : null;
    const r = await createShare(tripId, writeToken, label);
    return r.ok ? NextResponse.json({ ok: true, share: r.share }) : bad("Поездка не найдена.", 404);
  }

  if (action === "shares") {
    const shares = await listShares(tripId, writeToken);
    if (!shares) return bad("Поездка не найдена.", 404);
    const { rows } = await (await import("@/lib/track-db")).trackPool().query<{ live_share: boolean }>(
      `SELECT live_share FROM track.trip WHERE id = $1`, [tripId],
    );
    return NextResponse.json({ ok: true, shares, live: rows[0]?.live_share ?? false });
  }

  if (action === "revoke") {
    const shareId = typeof body.shareId === "number" ? body.shareId : NaN;
    if (!Number.isInteger(shareId)) return bad("Нужен shareId.");
    const done = await revokeShare(tripId, writeToken, shareId);
    return done ? NextResponse.json({ ok: true }) : bad("Ссылка не найдена.", 404);
  }

  if (action === "live") {
    const done = await setLive(tripId, writeToken, body.live === true);
    return done ? NextResponse.json({ ok: true }) : bad("Поездка не найдена.", 404);
  }

  if (action === "ok") {
    const done = await allOk(tripId, writeToken);
    return done ? NextResponse.json({ ok: true }) : bad("Поездка не найдена.", 404);
  }

  // Чат (спринт 6): пассажир пишет и читает с экрана записи.
  if (action === "chat") {
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim() || text.length > MAX_TEXT) return bad(`Текст от 1 до ${MAX_TEXT} символов.`);
    const r = await passengerSend(tripId, writeToken, text);
    if (!r.ok) {
      return r.reason === "closed" ? bad("Переписка закрыта.", 409)
        : r.reason === "too_many" ? bad("Слишком много сообщений.", 429)
        : bad("Поездка не найдена.", 404);
    }
    return NextResponse.json({ ok: true, seq: r.seq });
  }

  if (action === "messages") {
    const messages = await passengerMessages(tripId, writeToken);
    return messages ? NextResponse.json({ ok: true, messages }) : bad("Поездка не найдена.", 404);
  }

  if (action === "phone") {
    const phone = typeof body.phone === "string" ? body.phone : "";
    const done = await setContactPhone(tripId, writeToken, phone);
    return done ? NextResponse.json({ ok: true }) : bad("Поездка не найдена.", 404);
  }

  return bad("Неизвестное действие.");
}
