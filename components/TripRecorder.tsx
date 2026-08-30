"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeSegment,
  decide,
  newSamplerState,
  toApiPoint,
  type Fix,
  type SamplerState,
} from "@/lib/track-sampling";

// Клиент записи поездки — M0.A §2.1 (политика записи) и §2.5 (батарея).
//
// Запись только на переднем плане: это решение владельца 2026-07-23, и оно не «ограничение
// браузера», а свойство продукта. Скрытой слежки не бывает по построению.
//
// Само решение «писать эту точку или нет» живёт в lib/track-sampling.ts и проверяется
// детерминированными сценариями (npm run check:sampling). Здесь — только браузерная обвязка:
// разрешения, Wake Lock, очередь досылки и честное состояние на экране.

type Phase = "idle" | "recording" | "paused" | "finished";

type Queued = { seq: number; point: ReturnType<typeof toApiPoint> };

type Session = {
  tripId: number;
  writeToken: string;
  startedAtMs: number;
  nextSeq: number;
};

const LS_INSTALL = "taksi.installId";
const LS_TOKEN = "taksi.etapAToken";
const LS_SESSION = "taksi.trip.session";
const LS_QUEUE = "taksi.trip.queue";

/** Отправляем накопленное не чаще этого — пачками, а не по точке. */
const FLUSH_MS = 15_000;
/** ...и не реже, чем накопится столько точек. */
const FLUSH_POINTS = 25;

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим или переполнение — запись продолжится, досылка потеряется */
  }
}

/** install_id: 128 случайных бит, порождается клиентом и живёт локально (M0.A §6.2.2). */
function installId(): string {
  let id = localStorage.getItem(LS_INSTALL);
  if (!id) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(LS_INSTALL, id);
  }
  return id;
}

export default function TripRecorder() {
  // Компонент грузится только в браузере (ssr: false на странице), поэтому localStorage
  // читается при инициализации состояния, а не эффектом: эффект дал бы лишний рендер и
  // мигание пустого поля, а правило react-hooks/set-state-in-effect право по существу.
  const [phase, setPhase] = useState<Phase>(() => (readLS<Session>(LS_SESSION) ? "paused" : "idle"));
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(LS_TOKEN) ?? ""; } catch { return ""; }
  });
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(0);
  const [queued, setQueued] = useState(() => readLS<Queued[]>(LS_QUEUE)?.length ?? 0);
  const [lastFixAgoS, setLastFixAgoS] = useState<number | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);

  // Восстановление из хранилища читается ровно один раз ленивым инициализатором состояния,
  // а ссылки заводятся уже этим значением. Так нет ни setState в эффекте, ни правки ref
  // во время рендера — оба правила линтера правы по существу.
  const [restored] = useState(() => ({
    session: readLS<Session>(LS_SESSION),
    queue: readLS<Queued[]>(LS_QUEUE) ?? [],
  }));

  const sampler = useRef<SamplerState>(newSamplerState());
  // Незавершённая сессия после перезагрузки не возобновляет запись молча — но и не
  // теряется: точки в очереди досылаются, а поездка помечена прерванной, и следующий фикс
  // станет началом нового сегмента.
  const session = useRef<Session | null>(restored.session);
  const queue = useRef<Queued[]>(restored.queue);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const lastFixAt = useRef<number | null>(null);
  const flushing = useRef(false);

  // Возраст последнего фикса — то самое «явное состояние записи» (M0.A §2.1): человек
  // должен видеть, что запись идёт, а не догадываться.
  useEffect(() => {
    const t = setInterval(() => {
      setLastFixAgoS(lastFixAt.current === null ? null : Math.round((Date.now() - lastFixAt.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const api = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    },
    [token],
  );

  const flush = useCallback(async () => {
    const s = session.current;
    if (!s || flushing.current || queue.current.length === 0) return;
    flushing.current = true;
    const batch = queue.current.slice(0, 500);
    try {
      await api({ action: "points", tripId: s.tripId, writeToken: s.writeToken, points: batch });
      // Снимаем с очереди только то, что подтвердил сервер. Приём идемпотентен, поэтому
      // повтор безопасен — а вот потерять точки при обрыве нельзя.
      queue.current = queue.current.slice(batch.length);
      writeLS(LS_QUEUE, queue.current);
      setQueued(queue.current.length);
      setError(null);
    } catch {
      // Молча оставляем в очереди: связь пропала — это штатное состояние (M0.A §2.1),
      // а не ошибка, которую надо показывать тревожно.
      setError("нет связи — точки копятся и уйдут сами");
    } finally {
      flushing.current = false;
    }
  }, [api]);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(flush, FLUSH_MS);
    return () => clearInterval(t);
  }, [phase, flush]);

  const onFix = useCallback((pos: GeolocationPosition) => {
    const s = session.current;
    if (!s) return;
    lastFixAt.current = Date.now();
    setAccuracyM(Math.round(pos.coords.accuracy));

    const fix: Fix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: pos.coords.accuracy,
      speedMs: typeof pos.coords.speed === "number" && !Number.isNaN(pos.coords.speed)
        ? pos.coords.speed : null,
      tMs: Date.now() - s.startedAtMs,
    };

    const d = decide(sampler.current, fix);
    if (!d.record) return;

    queue.current.push({ seq: s.nextSeq, point: toApiPoint(fix, d) });
    s.nextSeq += 1;
    writeLS(LS_SESSION, s);
    writeLS(LS_QUEUE, queue.current);
    setQueued(queue.current.length);
    setRecorded((n) => n + 1);
    if (queue.current.length >= FLUSH_POINTS) void flush();
  }, [flush]);

  const startWatch = useCallback(() => {
    if (watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      onFix,
      (e) => setError(`геолокация: ${e.message}`),
      // enableHighAccuracy — единственный режим, в котором трасса вообще имеет смысл;
      // он же самый расходный по батарее, и это признано в M0.A §2.5.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
  }, [onFix]);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      // Без Wake Lock экран гаснет, страница уходит в фон и запись прерывается — это
      // главная хрупкость foreground-записи (M0.A §2.5).
      wakeLock.current = await navigator.wakeLock?.request("screen") ?? null;
    } catch {
      setError("экран может погаснуть — запись прервётся");
    }
  }, []);

  // Уход в фон рвёт запись by-design. Граница сегмента ценнее прочих точек, поэтому
  // сегмент закрывается явно, а не «само получится».
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        closeSegment(sampler.current);
        setPhase((p) => (p === "recording" ? "paused" : p));
        stopWatch();
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [flush, stopWatch]);

  async function start() {
    setError(null);
    try {
      localStorage.setItem(LS_TOKEN, token);
      const r = await api({ action: "start", installId: installId() });
      session.current = {
        tripId: Number(r.tripId),
        writeToken: String(r.writeToken),
        startedAtMs: Date.now(),
        nextSeq: 0,
      };
      writeLS(LS_SESSION, session.current);
      sampler.current = newSamplerState();
      queue.current = [];
      writeLS(LS_QUEUE, []);
      setRecorded(0);
      setQueued(0);
      setPhase("recording");
      await acquireWakeLock();
      startWatch();
    } catch (e) {
      setError(
        e instanceof Error && e.message === "404"
          ? "запись выключена на сервере (этап A)"
          : e instanceof Error && e.message === "401"
            ? "неверный ключ записи"
            : "не удалось начать поездку",
      );
    }
  }

  async function resume() {
    setError(null);
    closeSegment(sampler.current);
    setPhase("recording");
    await acquireWakeLock();
    startWatch();
    void flush();
  }

  async function finish() {
    stopWatch();
    closeSegment(sampler.current);
    await flush();
    const s = session.current;
    if (s) {
      try { await api({ action: "finish", tripId: s.tripId, writeToken: s.writeToken }); } catch { /* закроет автозакрытие */ }
    }
    try { await wakeLock.current?.release(); } catch { /* уже отпущен */ }
    wakeLock.current = null;
    localStorage.removeItem(LS_SESSION);
    session.current = null;
    setPhase("finished");
  }

  const stale = lastFixAgoS !== null && lastFixAgoS > 30;

  return (
    <section className="rec">
      {phase === "idle" && (
        <>
          <label className="search-label" htmlFor="rec-token">Ключ записи (этап A)</label>
          <input
            id="rec-token"
            className="search-input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="выдаётся владельцем"
          />
          <button className="rec-btn" onClick={start} disabled={!token}>Начать поездку</button>
          <p className="page-sub">
            Запись идёт только пока экран включён и эта страница открыта. Это свойство
            продукта, а не ограничение: скрытой слежки здесь не бывает.
          </p>
        </>
      )}

      {(phase === "recording" || phase === "paused") && (
        <>
          <p className={`rec-state ${phase === "recording" && !stale ? "rec-live" : "rec-broken"}`}>
            {phase === "paused"
              ? "запись прервана"
              : stale
                ? `нет фиксов ${lastFixAgoS} с`
                : "идёт запись"}
          </p>
          <p className="page-sub">
            Точек записано: <b>{recorded}</b>
            {queued > 0 && <> · ждут отправки: <b>{queued}</b></>}
            {accuracyM !== null && <> · точность ≈ {accuracyM} м</>}
          </p>
          <div className="rec-row">
            {phase === "paused" && <button className="rec-btn" onClick={resume}>Продолжить</button>}
            <button className="rec-btn rec-stop" onClick={finish}>Завершить поездку</button>
          </div>
        </>
      )}

      {phase === "finished" && (
        <>
          <p className="rec-state">Поездка завершена. Точек: <b>{recorded}</b>.</p>
          <button className="rec-btn" onClick={() => setPhase("idle")}>Ещё одна</button>
        </>
      )}

      {error && <p className="rec-error">{error}</p>}
    </section>
  );
}
