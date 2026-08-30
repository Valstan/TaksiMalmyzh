"use client";

import dynamic from "next/dynamic";

// Клиентская обёртка над записью поездки.
//
// Нужна ровно затем, чтобы `ssr: false` было объявлено в клиентском компоненте: в Next 16
// серверный компонент так делать не может. Тот же приём, что у карты (components/HomeMap.tsx).
//
// А `ssr: false` нужен потому, что запись читает своё состояние из localStorage прямо в
// инициализаторах: на сервере его нет, и без этого флага первый серверный рендер разошёлся
// бы с клиентским — то есть страница мигала бы «поездки нет» поверх прерванной поездки.
const TripRecorder = dynamic(() => import("@/components/TripRecorder"), {
  ssr: false,
  loading: () => <p className="page-sub">Загружается…</p>,
});

export default function TripRecorderMount() {
  return <TripRecorder />;
}
