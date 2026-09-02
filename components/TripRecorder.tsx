"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ShareTripPanel from "@/components/ShareTripPanel";
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
const LS_SESSION = "taksi.trip.session";
const LS_QUEUE = "taksi.trip.queue";

/** Отправляем накопленное не чаще этого — пачками, а не по точке. */
const FLUSH_MS = 15_000;
/** ...и не реже, чем накопится столько точек. */
const FLUSH_POINTS = 25;

// Лестница «человек забыл выключить запись».
//
// Мировая практика трекеров (Strava, Runkeeper, Garmin, водительские приложения) сводится к
// трём шагам: автопауза на околонулевой скорости через минуты, напоминание через десяток
// минут, автозавершение через полчаса-час. Числа ниже в этом коридоре и намеренно ближе к
// его нижней границе: у нас продукт безопасности, и висящая «активная поездка», про которую
// все забыли, обесценивает саму идею — доверенный контакт видит запись там, где давно ничего
// не происходит.
//
// ⚠️ Тот же механизм — половина «мёртвой руки» (M0.A §5.3). Неподвижность и молчание
// означают ЛИБО «забыл выключить», ЛИБО «что-то случилось», и различить их нельзя ничем,
// кроме вопроса самому человеку. Поэтому напоминания — это не удобство, а дискриминатор:
// ответил — забыл; не ответил трижды — повод для тревоги, и завершение помечается `idle`.
//
// ⚠️ Числа подлежат настройке на реальных поездках: M0.A §5.3 прямо называет порог
// «норма или тревога» центральной нерешённой задачей, а §8.6 оставляет бюджет ложных
// срабатываний за владельцем. Здесь они собраны в одном месте, чтобы правка была правкой
// числа, а не поиском по коду.
const IDLE = {
  /** Ниже этой скорости считаем, что стоим (та же величина, что в политике выборки). */
  speedMs: 1,
  /** Сколько стоять до первого напоминания. */
  firstMs: 10 * 60_000,
  /** Пауза между напоминаниями. */
  repeatMs: 5 * 60_000,
  /** Сколько напоминаний до автозавершения. */
  count: 3,
} as const;

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
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [recorded, setRecorded] = useState(0);
  const [queued, setQueued] = useState(() => readLS<Queued[]>(LS_QUEUE)?.length ?? 0);
  /** Сколько напоминаний «вы ещё пишете?» уже показано без ответа. */
  const [nagCount, setNagCount] = useState(0);
  /** Поездку закрыл таймер, а не человек — это надо сказать прямо, а не молча закрыть. */
  const [autoFinished, setAutoFinished] = useState(false);
  const [lastFixAgoS, setLastFixAgoS] = useState<number | null>(null);
  const [stillMin, setStillMin] = useState(0);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  /**
   * Зеркало `session` для рендера: панель «поделиться» — часть разметки, а читать ref во
   * время рендера нельзя. Меняется вместе с session в start/finish.
   */
  const [activeTrip, setActiveTrip] = useState<Session | null>(() => readLS<Session>(LS_SESSION));
  /** Последняя завершённая поездка — ссылки на неё работают и после конца (M0.A §6.4). */
  const [lastTrip, setLastTrip] = useState<Session | null>(null);

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
  /**
   * Когда в последний раз наблюдалось движение — от него отсчитывается неподвижность.
   * `null` до старта поездки: `Date.now()` в теле рендера — нечистый вызов, и лестница
   * напоминаний всё равно начинает считать только с момента старта.
   */
  const movingSince = useRef<number | null>(null);
  /** Когда показано последнее напоминание; null — лестница не начата. */
  const nagAt = useRef<number | null>(null);
  /** Счётчик напоминаний в ссылке: состояние нужно только для показа, решение — по нему. */
  const nagCountRef = useRef(0);

  // Возраст последнего фикса — то самое «явное состояние записи» (M0.A §2.1): человек
  // должен видеть, что запись идёт, а не догадываться.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setLastFixAgoS(lastFixAt.current === null ? null : Math.round((now - lastFixAt.current) / 1000));
      // Считается здесь, а не в рендере: и `Date.now()`, и чтение ссылки во время рендера —
      // нечистые операции, и правило линтера про это право по существу.
      setStillMin(movingSince.current === null ? 0 : Math.floor((now - movingSince.current) / 60_000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Вводить нечего: право записи даёт обычная сессия приложения (cookie), та же, что и в
  // админке. Секрета, который надо где-то прочитать и куда-то ввести, больше нет — а
  // значит, нечему и утекать.
  const api = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }, []);

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

    // Движение сбрасывает лестницу напоминаний: человек явно едет, спрашивать не о чем.
    const speed = typeof pos.coords.speed === "number" && !Number.isNaN(pos.coords.speed)
      ? pos.coords.speed : null;
    if (speed !== null && speed >= IDLE.speedMs) {
      movingSince.current = Date.now();
      if (nagAt.current !== null) { nagAt.current = null; setNagCount(0); }
    }

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
    setNeedLogin(false);
    try {
      const r = await api({ action: "start", installId: installId() });
      session.current = {
        tripId: Number(r.tripId),
        writeToken: String(r.writeToken),
        startedAtMs: Date.now(),
        nextSeq: 0,
      };
      writeLS(LS_SESSION, session.current);
      setActiveTrip(session.current);
      sampler.current = newSamplerState();
      queue.current = [];
      writeLS(LS_QUEUE, []);
      setRecorded(0);
      setQueued(0);
      setNagCount(0);
      nagCountRef.current = 0;
      nagAt.current = null;
      movingSince.current = Date.now();
      setPhase("recording");
      await acquireWakeLock();
      startWatch();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "401") {
        // Не ошибка, а состояние: человек просто не вошёл. Показываем ссылку на вход,
        // а не пугающее «нет доступа».
        setNeedLogin(true);
      } else {
        setError(
          code === "404"
            ? "запись выключена на сервере (этап A)"
            : "не удалось начать поездку",
        );
      }
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

  const finish = useCallback(async (reason: "user" | "idle" = "user") => {
    stopWatch();
    closeSegment(sampler.current);
    await flush();
    const s = session.current;
    if (s) {
      try {
        await api({ action: "finish", tripId: s.tripId, writeToken: s.writeToken, reason });
      } catch { /* не дошло — закроет серверное автозакрытие через 6 ч */ }
    }
    try { await wakeLock.current?.release(); } catch { /* уже отпущен */ }
    wakeLock.current = null;
    localStorage.removeItem(LS_SESSION);
    setLastTrip(s);
    setActiveTrip(null);
    session.current = null;
    nagAt.current = null;
    setNagCount(0);
    setPhase("finished");
    setAutoFinished(reason === "idle");
  }, [api, flush, stopWatch]);

  /** Напоминание должно быть заметно с закрытыми глазами: вибрация плюс короткий сигнал. */
  const nudge = useCallback(() => {
    try { navigator.vibrate?.([300, 150, 300]); } catch { /* нет вибромотора */ }
    try {
      // Звук через WebAudio, а не <audio src>: файла нет, а внешних запросов у нас
      // не бывает по правилу проекта. Разрешение на звук уже есть — человек нажимал «начать».
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      setTimeout(() => void ctx.close(), 700);
    } catch { /* звук не обязателен */ }
  }, []);

  // Лестница «вы ещё пишете?» — она же половина «мёртвой руки» (M0.A §5.3).
  //
  // Неподвижность и молчание означают ЛИБО «забыл выключить», ЛИБО «что-то случилось».
  // Различить это можно только вопросом самому человеку: ответил — забыл, не ответил
  // трижды — повод для тревоги. Поэтому завершение помечается `idle`, а не `user`.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      if (movingSince.current === null || Date.now() - movingSince.current < IDLE.firstMs) return;

      const since = nagAt.current;
      if (since === null) {
        nagAt.current = Date.now();
        nagCountRef.current = 1;
        setNagCount(1);
        nudge();
        return;
      }
      if (Date.now() - since < IDLE.repeatMs) return;

      nagAt.current = Date.now();
      nagCountRef.current += 1;
      setNagCount(nagCountRef.current);
      if (nagCountRef.current > IDLE.count) void finish("idle");
      else nudge();
    }, 10_000);
    return () => clearInterval(t);
  }, [phase, nudge, finish]);

  /**
   * Человек ответил «я здесь» — лестница сбрасывается, поездка продолжается. Серверу тоже
   * говорим «всё в порядке»: его лестница считает молчание независимо и могла уже поднять
   * тревогу контактам (M0.A §5.3, окно отмены).
   */
  const stillHere = useCallback(() => {
    movingSince.current = Date.now();
    nagAt.current = null;
    nagCountRef.current = 0;
    setNagCount(0);
    const s = session.current;
    if (s) void api({ action: "ok", tripId: s.tripId, writeToken: s.writeToken }).catch(() => {});
  }, [api]);

  const stale = lastFixAgoS !== null && lastFixAgoS > 30;

  return (
    <section className="rec">
      {phase === "idle" && (
        <>
          <button className="rec-btn" onClick={() => void start()}>Начать поездку</button>
          {needLogin && (
            <p className="rec-error">
              Нужно войти в приложение — <Link href="/admin">открыть вход</Link>. Вводить ничего
              больше не потребуется: право записи даёт сам вход.
            </p>
          )}
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

          {/* Напоминание — не всплывашка: диалог браузера блокирует поток и не виден, если
              человек смотрит в другую сторону. Крупный блок с одной кнопкой заметен и не
              требует прицеливаться. */}
          {nagCount > 0 && phase === "recording" && (
            <div className="rec-nag">
              <p className="rec-nag-title">
                {nagCount >= IDLE.count ? "Последнее напоминание" : "Вы ещё записываете?"}
              </p>
              <p className="page-sub">
                Ничего не движется уже {stillMin} мин. Если поездка кончилась — завершите её.
                {nagCount >= IDLE.count && " Через пять минут запись завершится сама."}
              </p>
              <div className="rec-row">
                <button className="rec-btn" onClick={stillHere}>Я здесь, продолжаем</button>
                <button className="rec-btn rec-stop" onClick={() => void finish("user")}>
                  Завершить
                </button>
              </div>
            </div>
          )}

          <p className="page-sub">
            Точек записано: <b>{recorded}</b>
            {queued > 0 && <> · ждут отправки: <b>{queued}</b></>}
            {accuracyM !== null && <> · точность ≈ {accuracyM} м</>}
          </p>
          <div className="rec-row">
            {phase === "paused" && <button className="rec-btn" onClick={() => void resume()}>Продолжить</button>}
            <button className="rec-btn rec-stop" onClick={() => void finish("user")}>Завершить поездку</button>
          </div>

          {activeTrip && (
            <ShareTripPanel
              api={api}
              tripId={activeTrip.tripId}
              writeToken={activeTrip.writeToken}
              finished={false}
            />
          )}
        </>
      )}

      {phase === "finished" && (
        <>
          <p className="rec-state">
            {autoFinished
              ? "Запись завершена сама: ничего не двигалось и на напоминания никто не ответил."
              : "Поездка завершена."} Точек: <b>{recorded}</b>.
          </p>
          <button className="rec-btn" onClick={() => { setAutoFinished(false); setPhase("idle"); }}>
            Ещё одна
          </button>
          {lastTrip && (
            <ShareTripPanel api={api} tripId={lastTrip.tripId} writeToken={lastTrip.writeToken} finished />
          )}
        </>
      )}

      {error && <p className="rec-error">{error}</p>}
    </section>
  );
}
