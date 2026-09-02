"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ShareView } from "@/lib/track-share";
import TripChat from "@/components/TripChat";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map-holder map-loading">Карта загружается…</div>,
});

// Просмотр поездки доверенным контактом.
//
// Главное правило экрана (M0.A §5.5): молчащая точка НИКОГДА не показывается как «где он
// сейчас». Возраст последней точки — крупно; состояние — словами; оборванная поездка не
// выглядит завершённой.

// 10 с: страница теперь ещё и чат, ответ пассажира должен приходить без «обновите».
const POLL_MS = 10_000;

function age(s: number | null): string {
  if (s === null) return "точек ещё нет";
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return `${Math.round(s / 360) / 10} ч назад`;
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export default function TripView({ lookup }: { lookup: string }) {
  const [view, setView] = useState<ShareView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Verifier живёт во фрагменте и уходит только телом POST — не в адресе (M0.A §6.3).
    const verifier = window.location.hash.replace(/^#/, "") || null;
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(lookup)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ verifier }),
      });
      if (res.status === 410) { setError("Доступ к этой поездке отозван."); return; }
      if (res.status === 429) { setError("Слишком много запросов — подождите минуту."); return; }
      if (!res.ok) {
        setError(verifier
          ? "Поездка не найдена. Проверьте, что ссылка скопирована целиком."
          : "В ссылке нет ключа доступа. Откройте её целиком, как получили.");
        return;
      }
      setView((await res.json()) as ShareView);
      setError(null);
    } catch {
      setError("Нет связи. Повторим через минуту.");
    }
  }, [lookup]);

  useEffect(() => {
    // Первый запрос — следующим тиком (setState в теле эффекта — каскадный рендер).
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), POLL_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  if (error) return <p className="rec-error">{error}</p>;
  if (!view) return <p className="page-sub">Загружается…</p>;

  const last = view.track.length ? view.track[view.track.length - 1] : null;
  const started = when(view.startedAt);

  const headline: Record<ShareView["status"], string> = {
    recording: "Поездка идёт",
    silent: "Тревога: данные не поступают",
    disclosed: "Маршрут раскрыт",
    finished: "Поездка завершена",
    abandoned: "Поездка оборвана",
  };

  return (
    <section className="rec">
      <p className={`rec-state ${view.status === "recording" ? "rec-live" : view.status === "finished" ? "" : "rec-broken"}`}>
        {headline[view.status]}
        {view.label && <> · {view.label}</>}
      </p>

      <p className="page-sub">
        Началась в {started}.{" "}
        {view.status === "finished" && <>Завершена в {when(view.endedAt)} — человек нажал «завершить» сам.</>}
        {view.status === "recording" && <>Последняя точка: <b>{age(view.lastPointAgeS)}</b>.</>}
        {view.status === "silent" && (
          <>
            Последняя точка: <b>{age(view.lastPointAgeS)}</b>. Тревога с {when(view.alarmAt)}. Если через
            несколько минут он не подтвердит, что всё в порядке, маршрут откроется здесь сам.
          </>
        )}
        {view.status === "disclosed" && (
          <>
            {view.finishReason === "idle"
              ? "Телефон долго не двигался, и на три напоминания никто не ответил."
              : view.finishReason === "abandoned"
                ? "Записи не было шесть часов, и поездка закрыта сервером."
                : "Данные перестали поступать, подтверждения не было."}{" "}
            Маршрут открыт с {when(view.disclosedAt)}. Последняя известная точка —{" "}
            <b>{age(view.lastPointAgeS)}</b>; это не «где он сейчас», а где телефон был в последний раз.
          </>
        )}
        {view.status === "abandoned" && <>Точек не было шесть часов; сервер закрыл запись.</>}
        {view.allOkAt && <> Он сообщил «всё в порядке» в {when(view.allOkAt)}.</>}
      </p>

      {view.trackVisible ? (
        view.trackExpired ? (
          <p className="rec-error">Подробный маршрут уже удалён по сроку хранения.</p>
        ) : (
          <>
            <MapView target={null} track={view.track} />
            <p className="page-sub">
              Точек: {view.track.length}. Красная метка — последняя известная точка
              {last && <> ({age(view.lastPointAgeS)})</>}.
            </p>
          </>
        )
      ) : (
        <p className="page-sub">
          Маршрут скрыт: поездка идёт штатно. Он откроется, если человек включит показ сам или
          перестанет отвечать. Точек записано: {view.pointCount}.
        </p>
      )}

      {view.boundToViewer && (
        <p className="page-sub">Эта поездка есть и в вашем списке «поездки знакомых».</p>
      )}

      <TripChat
        me="contact"
        messages={view.messages}
        disabled={view.chatClosed}
        phone={view.contactPhone}
        onSend={async (text) => {
          const verifier = window.location.hash.replace(/^#/, "") || null;
          const res = await fetch(`/api/t/${encodeURIComponent(lookup)}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ verifier, text }),
          });
          if (res.ok) void load();
          return res.ok;
        }}
      />
    </section>
  );
}
