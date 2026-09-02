"use client";

import dynamic from "next/dynamic";

// Клиентская обёртка: `ssr: false` объявляется в клиентском компоненте (Next 16), а сам
// просмотр читает location.hash — на сервере его нет.
const TripView = dynamic(() => import("@/components/TripView"), {
  ssr: false,
  loading: () => <p className="page-sub">Загружается…</p>,
});

export default function TripViewMount({ lookup }: { lookup: string }) {
  return <TripView lookup={lookup} />;
}
