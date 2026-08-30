"use client";

import { useEffect, useRef, useState } from "react";
// MapLibre 6 отдаёт только именованные экспорты — общего default-объекта больше нет.
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
// Версия берётся из самого пакета, а не пишется руками: путь к воркеру обязан
// меняться вместе с MapLibre (см. scripts/copy-map-worker.mjs), а константа,
// которую надо не забыть поднять, однажды не поднимается.
import { version as maplibreVersion } from "maplibre-gl/package.json";
import { layers, namedFlavor } from "@protomaps/basemaps";
import "maplibre-gl/dist/maplibre-gl.css";

export type Hit = {
  kind: "street" | "address";
  label: string;
  lat: number;
  lon: number;
};

// Границы вырезки: за ними тайлов нет, и карта не должна уезжать в пустоту.
// Значения совпадают с bbox из scripts/build_map_extract.py.
const BOUNDS: [number, number, number, number] = [50.6011, 56.4657, 50.8022, 56.5591];
const MIN_ZOOM = 10;
const MAX_ZOOM = 17; // источник даёт z15, выше MapLibre растягивает векторы сам

export default function MapView({ target }: { target: Hit | null }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!holder.current || map.current) return;

    // Адрес воркера задаётся явно. Сам MapLibre выводит его из `import.meta.url`,
    // подставляя соседний файл; под сборщиком это путь чанка, соседа нет, и карта
    // остаётся серой. Файлы кладёт scripts/copy-map-worker.mjs — на нашу статику,
    // чтобы и здесь наружу не уходило ни одного запроса.
    //
    // Версия в пути обязательна: /map/ отдаётся с `immutable` на год, и адрес —
    // единственный способ сообщить браузеру, что файл другой. Разбор — в шапке
    // scripts/copy-map-worker.mjs.
    setWorkerUrl(`/map/maplibre/${maplibreVersion}/maplibre-gl-worker.mjs`);

    // MapLibre не умеет читать .pmtiles сам — протокол добавляется пакетом pmtiles.
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);

    try {
      const instance = new MapLibreMap({
        container: holder.current,
        // Ни glyphs, ни sprite не указывают наружу: оба переопределены на нашу
        // статику. Дефолт @protomaps/basemaps ведёт на protomaps.github.io, и без
        // этой замены браузер ходил бы за границу при каждом рендере карты
        // (docs/PROBE_MAPS_PROVIDER.md §6).
        style: {
          version: 8,
          glyphs: "/map/fonts/{fontstack}/{range}.pbf",
          sprite: `${window.location.origin}/map/sprites/light`,
          sources: {
            protomaps: {
              type: "vector",
              url: "pmtiles:///map/malmyzh.pmtiles",
              attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
            },
          },
          layers: layers("protomaps", namedFlavor("light"), { lang: "ru" }),
        },
        bounds: BOUNDS,
        maxBounds: BOUNDS,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        attributionControl: { compact: false },
      });

      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
      instance.on("error", (e) => setError(e.error?.message ?? "ошибка карты"));
      map.current = instance;
    } catch (e) {
      // Конструктор падает синхронно, когда в браузере нет WebGL. Сообщение
      // ставится следующим тиком: обновлять состояние прямо в теле эффекта —
      // каскадный рендер, и правило react-hooks/set-state-in-effect право.
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      map.current?.remove();
      map.current = null;
      removeProtocol("pmtiles");
    };
  }, []);

  useEffect(() => {
    if (!map.current || !target) return;
    marker.current?.remove();
    marker.current = new Marker({ color: "#b3261e" })
      .setLngLat([target.lon, target.lat])
      .addTo(map.current);
    map.current.flyTo({
      center: [target.lon, target.lat],
      zoom: target.kind === "address" ? 17 : 15,
      duration: 900,
    });
  }, [target]);

  return (
    <div className="map-holder">
      <div ref={holder} className="map" />
      {error && <p className="map-error">Карта не загрузилась: {error}</p>}
    </div>
  );
}
