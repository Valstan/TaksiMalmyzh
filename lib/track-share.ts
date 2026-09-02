// Ссылка доступа доверенному контакту и «мёртвая рука» — спринт 4 (M0.A §5, §6.3–6.4).
//
// Решения владельца 2026-09-02:
//  - §8.6: пороги подбираем сами; бюджета ложных тревог НЕТ — лучше лишняя тревога, чем
//    пропущенная («пастух и волк» наоборот: контакт, которого зря дёрнули, переживёт;
//    человек, которого не искали, — нет).
//  - §8.8: канал уведомления — ссылка в этом же приложении: знакомый открывает её и видит
//    трекер. Ни push, ни SMS. Вошедший в ПОЗВОНИ знакомый видит поездку и в списке
//    «поездки знакомых» без ссылки.
//  - §8.2: родитель видит поездку ребёнка — та же ссылка, сценарий разрешён и назван в
//    интерфейсе.
//
// Формат ссылки — `/t/<lookup>#<verifier>` (§6.3): lookup в пути, verifier во фрагменте.
// Фрагмент не уходит на сервер по протоколу — ни в логи, ни в Referer; страница-оболочка
// читает location.hash и шлёт verifier телом POST. В базе — SHA-256 verifier'а, не он сам.
// Токен не одноразовый: превью-бот мессенджера открыл бы ссылку первым и сжёг её.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { trackPool } from "./track-db.ts";
import { openPoint, unwrapTripKey, type TrackPoint } from "./track-crypto.ts";

// --- пороги «мёртвой руки» ---------------------------------------------------------
//
// Два состояния с разными порогами (M0.A §5.3): «поездка идёт, данных нет» и «поездка
// закончена, подтверждения нет». Клиентская лестница (TripRecorder) спрашивает человека
// через 10 мин неподвижности и трижды с шагом 5 мин, затем завершает поездку с причиной
// `idle` — то есть к 25–30-й минуте молчания сам клиент уже сказал «не отвечает».
// Серверная лестница ниже — страховка на случай, когда клиента уже нет (телефон разбит,
// разряжен, отобран): ей нечего спросить, она считает время.
export const ALARM = {
  /** Поездка идёт, точек нет столько минут → тревога (контакт видит «данные не поступают»). */
  silenceMin: 20,
  /** Окно отмены после тревоги: пассажир успевает нажать «всё в порядке». Затем раскрытие. */
  cancelWindowMin: 10,
} as const;

const b64 = (b: Buffer) => b.toString("base64url");
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Разбор lookup из пути: 16 байт base64url, иначе null. */
export function parseLookup(raw: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(raw)) return null;
  const b = Buffer.from(raw, "base64url");
  return b.length === 16 ? b : null;
}

async function authorizeWrite(tripId: number, writeToken: string): Promise<boolean> {
  const { rows } = await trackPool().query<{ h: Buffer | null }>(
    `SELECT write_token_hash AS h FROM track.trip WHERE id = $1`,
    [tripId],
  );
  const h = rows[0]?.h;
  if (!h) return false;
  const p = sha(writeToken);
  return p.length === h.length && timingSafeEqual(p, h);
}

export type ShareInfo = {
  id: number;
  label: string | null;
  path: string | null;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  /** Открывал ли ссылку вошедший в ПОЗВОНИ человек — тогда она есть и в его списке. */
  boundToViewer: boolean;
};

/**
 * Выдать ссылку. Подпись («маме», «Ивану») — слово пассажира для себя, чтобы различать
 * ссылки и отзывать нужную; о контакте мы ничего не храним (M0.A §7.5).
 */
export async function createShare(
  tripId: number,
  writeToken: string,
  label: string | null,
): Promise<{ ok: true; share: ShareInfo } | { ok: false }> {
  if (!(await authorizeWrite(tripId, writeToken))) return { ok: false };
  const lookup = randomBytes(16);
  const verifier = b64(randomBytes(32));
  const clean = label?.trim().slice(0, 40) || null;
  const { rows: [r] } = await trackPool().query<{ id: number; created_at: Date }>(
    `INSERT INTO track.share (trip_id, lookup_id, verifier_hash, label)
     VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [tripId, lookup, sha(verifier), clean],
  );
  return {
    ok: true,
    share: {
      id: r.id,
      label: clean,
      // Путь с фрагментом отдаётся ровно один раз — здесь. Дальше его знает только пассажир.
      path: `/t/${b64(lookup)}#${verifier}`,
      createdAt: r.created_at.toISOString(),
      revokedAt: null,
      viewCount: 0,
      lastViewedAt: null,
      boundToViewer: false,
    },
  };
}

export async function listShares(tripId: number, writeToken: string): Promise<ShareInfo[] | null> {
  if (!(await authorizeWrite(tripId, writeToken))) return null;
  const { rows } = await trackPool().query<{
    id: number; label: string | null; created_at: Date; revoked_at: Date | null;
    view_count: number; last_viewed_at: Date | null; viewer_user_id: number | null;
  }>(
    `SELECT id, label, created_at, revoked_at, view_count, last_viewed_at, viewer_user_id
       FROM track.share WHERE trip_id = $1 ORDER BY id`,
    [tripId],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    path: null,
    createdAt: r.created_at.toISOString(),
    revokedAt: r.revoked_at?.toISOString() ?? null,
    viewCount: r.view_count,
    lastViewedAt: r.last_viewed_at?.toISOString() ?? null,
    boundToViewer: r.viewer_user_id !== null,
  }));
}

export async function revokeShare(tripId: number, writeToken: string, shareId: number): Promise<boolean> {
  if (!(await authorizeWrite(tripId, writeToken))) return false;
  const r = await trackPool().query(
    `UPDATE track.share SET revoked_at = now() WHERE id = $1 AND trip_id = $2 AND revoked_at IS NULL`,
    [shareId, tripId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Живой трек — явное, разовое, per-trip включение самим пассажиром (M0.A §5.2). */
export async function setLive(tripId: number, writeToken: string, live: boolean): Promise<boolean> {
  if (!(await authorizeWrite(tripId, writeToken))) return false;
  await trackPool().query(`UPDATE track.trip SET live_share = $2 WHERE id = $1`, [tripId, live]);
  return true;
}

/** «Всё в порядке» от пассажира: гасит тревогу, если раскрытия ещё не было. */
export async function allOk(tripId: number, writeToken: string, now = new Date()): Promise<boolean> {
  if (!(await authorizeWrite(tripId, writeToken))) return false;
  await trackPool().query(
    `UPDATE track.trip
        SET all_ok_at = $2,
            alarm_at = CASE WHEN disclosed_at IS NULL THEN NULL ELSE alarm_at END
      WHERE id = $1`,
    [tripId, now],
  );
  return true;
}

// --- серверная лестница -------------------------------------------------------------

/**
 * Один шаг лестницы для всех открытых поездок. Идемпотентен, вызывается раз в минуту.
 *
 * 1. Поездка идёт, последняя точка (или старт) старше `silenceMin` → `alarm_at`.
 * 2. Точки снова пошли после тревоги и раскрытия ещё не было → тревога снимается.
 * 3. Тревога старше `cancelWindowMin`, «всё в порядке» после неё не было → раскрытие.
 * 4. Поездка закрыта клиентом как `idle` или сервером как `abandoned` → раскрытие сразу:
 *    человека уже спрашивали трижды, либо его нет шесть часов.
 * Раскрытие необратимо (§5.3): `disclosed_at` никогда не снимается.
 */
export async function escalateTrips(pool: Pool, now = new Date()): Promise<{
  alarmed: number; calmed: number; disclosed: number;
}> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const alarmed = await c.query(
      `UPDATE track.trip SET alarm_at = $1
        WHERE state = 0 AND alarm_at IS NULL AND disclosed_at IS NULL
          AND COALESCE(last_point_at, started_at) < $1::timestamptz - make_interval(mins => $2)
          AND (all_ok_at IS NULL OR all_ok_at < $1::timestamptz - make_interval(mins => $2))`,
      [now, ALARM.silenceMin],
    );
    const calmed = await c.query(
      `UPDATE track.trip SET alarm_at = NULL
        WHERE state = 0 AND alarm_at IS NOT NULL AND disclosed_at IS NULL
          AND last_point_at > alarm_at`,
      [],
    );
    const disclosed = await c.query(
      `UPDATE track.trip SET disclosed_at = $1
        WHERE disclosed_at IS NULL AND (
          (alarm_at IS NOT NULL AND alarm_at < $1::timestamptz - make_interval(mins => $2)
             AND (all_ok_at IS NULL OR all_ok_at < alarm_at))
          OR finish_reason IN ('idle', 'abandoned')
        )`,
      [now, ALARM.cancelWindowMin],
    );
    await c.query("COMMIT");
    return {
      alarmed: alarmed.rowCount ?? 0,
      calmed: calmed.rowCount ?? 0,
      disclosed: disclosed.rowCount ?? 0,
    };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// --- просмотр по ссылке --------------------------------------------------------------

export type TripStatus =
  | "recording"   // идёт, данные поступают
  | "silent"      // идёт, данных нет дольше порога (тревога)
  | "disclosed"   // трек раскрыт «мёртвой рукой»
  | "finished"    // завершена человеком
  | "abandoned";  // закрыта сервером после 6 ч молчания

export type ViewPoint = { lat: number; lng: number; tMs: number; flags: number };

export type ShareView = {
  label: string | null;
  status: TripStatus;
  startedAt: string;
  endedAt: string | null;
  finishReason: string | null;
  lastPointAt: string | null;
  lastPointAgeS: number | null;
  pointCount: number;
  alarmAt: string | null;
  disclosedAt: string | null;
  allOkAt: string | null;
  /** Трек показан: либо раскрыт, либо пассажир включил живой показ. */
  trackVisible: boolean;
  live: boolean;
  /** Точки — только если trackVisible; иначе пусто. */
  track: ViewPoint[];
  /** Сырьё удалено по сроку, трасса недоступна (§3.1). */
  trackExpired: boolean;
  /** Ссылка привязана к вошедшему знакомому — есть в его списке. */
  boundToViewer: boolean;
};

export type ResolveResult =
  | { ok: true; view: ShareView }
  | { ok: false; reason: "not_found" | "revoked" | "forbidden" };

type ShareRow = {
  share_id: number; label: string | null; verifier_hash: Buffer; revoked_at: Date | null;
  viewer_user_id: number | null;
  trip_id: number; day: string; started_at: Date; ended_at: Date | null; state: number;
  finish_reason: string | null; last_point_at: Date | null; point_count: number;
  trip_key_wrapped: Buffer; key_epoch: number; alarm_at: Date | null; disclosed_at: Date | null;
  all_ok_at: Date | null; live_share: boolean; rolled_at: Date | null;
};

/**
 * Открыть поездку по ссылке. Доступ даёт verifier из фрагмента ЛИБО сессия знакомого,
 * который уже открывал эту ссылку с verifier'ом (тогда она «его», §8.8: трекер в
 * приложении). Каждое открытие считается — журнал просмотров показывается пассажиру
 * постфактум, push в момент просмотра не шлётся (§5.5).
 */
export async function resolveShare(
  lookup: Buffer,
  verifier: string | null,
  viewerUserId: number | null,
  now = new Date(),
): Promise<ResolveResult> {
  const pool = trackPool();
  const { rows } = await pool.query<ShareRow>(
    `SELECT s.id AS share_id, s.label, s.verifier_hash, s.revoked_at, s.viewer_user_id,
            t.id AS trip_id, t.day::text AS day, t.started_at, t.ended_at, t.state,
            t.finish_reason, t.last_point_at, t.point_count, t.trip_key_wrapped, t.key_epoch,
            t.alarm_at, t.disclosed_at, t.all_ok_at, t.live_share, t.rolled_at
       FROM track.share s JOIN track.trip t ON t.id = s.trip_id
      WHERE s.lookup_id = $1`,
    [lookup],
  );
  const r = rows[0];
  if (!r) return { ok: false, reason: "not_found" };

  let byVerifier = false;
  if (verifier) {
    const p = sha(verifier);
    byVerifier = p.length === r.verifier_hash.length && timingSafeEqual(p, r.verifier_hash);
  }
  const bySession = viewerUserId !== null && r.viewer_user_id === viewerUserId;
  if (!byVerifier && !bySession) return { ok: false, reason: "forbidden" };
  if (r.revoked_at) return { ok: false, reason: "revoked" };

  // Привязка к вошедшему знакомому — один раз, по первому открытию с verifier'ом.
  const bind = byVerifier && viewerUserId !== null && r.viewer_user_id === null;
  await pool.query(
    `UPDATE track.share
        SET view_count = view_count + 1,
            first_viewed_at = COALESCE(first_viewed_at, $2),
            last_viewed_at = $2,
            viewer_user_id = COALESCE(viewer_user_id, $3)
      WHERE id = $1`,
    [r.share_id, now, bind ? viewerUserId : null],
  );

  const status: TripStatus =
    r.disclosed_at ? "disclosed"
    : r.state === 0 ? (r.alarm_at ? "silent" : "recording")
    : r.finish_reason === "abandoned" ? "abandoned"
    : "finished";

  const trackVisible = r.disclosed_at !== null || r.live_share;
  let track: ViewPoint[] = [];
  let trackExpired = false;
  if (trackVisible) {
    if (r.rolled_at) {
      trackExpired = true;
    } else {
      track = await loadTrack(pool, r);
    }
  }

  return {
    ok: true,
    view: {
      label: r.label,
      status,
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at?.toISOString() ?? null,
      finishReason: r.finish_reason,
      lastPointAt: r.last_point_at?.toISOString() ?? null,
      lastPointAgeS: r.last_point_at ? Math.round((now.getTime() - r.last_point_at.getTime()) / 1000) : null,
      pointCount: r.point_count,
      alarmAt: r.alarm_at?.toISOString() ?? null,
      disclosedAt: r.disclosed_at?.toISOString() ?? null,
      allOkAt: r.all_ok_at?.toISOString() ?? null,
      trackVisible,
      live: r.live_share,
      track,
      trackExpired,
      boundToViewer: r.viewer_user_id !== null || bind,
    },
  };
}

/** Расшифровать точки поездки в памяти; координаты наружу — только по этому пути. */
async function loadTrack(pool: Pool, t: ShareRow): Promise<ViewPoint[]> {
  const key = unwrapTripKey(t.trip_key_wrapped, t.trip_id, t.key_epoch);
  const startedMs = t.started_at.getTime();
  const { rows } = await pool.query<{ seq: number; pt: Buffer }>(
    `SELECT seq, pt FROM track.point WHERE day = $1 AND trip_id = $2 ORDER BY seq`,
    [t.day, t.trip_id],
  );
  const out: ViewPoint[] = [];
  for (const row of rows) {
    let p: TrackPoint;
    try {
      p = openPoint(key, t.trip_id, row.seq, startedMs, row.pt);
    } catch {
      continue; // повреждённая точка — пропускаем, не роняем страницу
    }
    out.push({ lat: p.latE7 / 1e7, lng: p.lngE7 / 1e7, tMs: p.tMs, flags: p.flags });
  }
  return out;
}

// --- «поездки знакомых» для вошедшего -------------------------------------------------

export type SharedTripSummary = {
  lookup: string;
  label: string | null;
  status: TripStatus;
  startedAt: string;
  lastViewedAt: string | null;
};

export async function sharedWithUser(userId: number): Promise<SharedTripSummary[]> {
  const { rows } = await trackPool().query<{
    lookup_id: Buffer; label: string | null; started_at: Date; last_viewed_at: Date | null;
    state: number; finish_reason: string | null; alarm_at: Date | null; disclosed_at: Date | null;
  }>(
    `SELECT s.lookup_id, s.label, s.last_viewed_at, t.started_at, t.state, t.finish_reason,
            t.alarm_at, t.disclosed_at
       FROM track.share s JOIN track.trip t ON t.id = s.trip_id
      WHERE s.viewer_user_id = $1 AND s.revoked_at IS NULL
      ORDER BY t.started_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    lookup: b64(r.lookup_id),
    label: r.label,
    status: r.disclosed_at ? "disclosed"
      : r.state === 0 ? (r.alarm_at ? "silent" : "recording")
      : r.finish_reason === "abandoned" ? "abandoned" : "finished",
    startedAt: r.started_at.toISOString(),
    lastViewedAt: r.last_viewed_at?.toISOString() ?? null,
  }));
}
