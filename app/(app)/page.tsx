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

export default function Home() {
  const [target, setTarget] = useState<Hit | null>(null);

  return (
    <main className="page">
      <header className="page-header">
        <h1>ПОЗВОНИ</h1>
        <p className="page-sub">
          Карта Малмыжа, поиск адреса и справочник номеров. Персональные данные не
          собираются.
        </p>
        <nav className="top-nav">
          <a href="/nomera">Справочник номеров</a>
        </nav>
      </header>

      <AddressSearch onPick={setTarget} />
      <MapView target={target} />

      <footer className="page-footer">
        <p>
          Картографические данные —{" "}
          <a href="https://openstreetmap.org/copyright" rel="noreferrer">
            © OpenStreetMap contributors
          </a>
          , лицензия{" "}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noreferrer">
            ODbL 1.0
          </a>
          . Поиск адреса работает по данным OpenStreetMap.
        </p>
      </footer>
    </main>
  );
}
