"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import AddressSearch from "@/components/AddressSearch";
import type { Hit } from "@/components/MapView";

// MapLibre работает только в браузере: на сервере нет ни canvas, ни WebGL.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map-holder map-loading">Карта загружается…</div>,
});

/**
 * Карта и поиск адреса — единственная часть главной, которой нужен браузер.
 * Вынесена из страницы, чтобы сама страница осталась серверной: скоуп домена
 * читается из заголовка `Host`, а его на клиенте нет.
 */
export default function HomeMap() {
  const [target, setTarget] = useState<Hit | null>(null);

  return (
    <>
      <AddressSearch onPick={setTarget} />
      <MapView target={target} />
    </>
  );
}
