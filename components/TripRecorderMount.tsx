"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";

// Клиентская обёртка над записью поездки.
//
// Нужна ровно затем, чтобы `ssr: false` было объявлено в клиентском компоненте: в Next 16
// серверный компонент так делать не может. Тот же приём, что у карты (components/HomeMap.tsx).
//
// А `ssr: false` нужен потому, что запись читает своё состояние из localStorage прямо в
// инициализаторах: на сервере его нет, и без этого флага первый серверный рендер разошёлся
// бы с клиентским — то есть страница мигала бы «поездки нет» поверх прерванной поездки.
//
// ⚠️ Граница ошибки здесь не украшение. При `ssr: false` кнопки «Начать поездку» нет в
// HTML вообще — она появляется только после того, как браузер догрузит чанк. Не догрузил
// (вкладка открыта до выкатки и просит исчезнувший `buildId`, моргнул мобильный интернет) —
// и без этой границы человек до конца времён смотрит на «Загружается…», неотличимое от
// «кнопки просто нет». Именно этот симптом описал владелец. Теперь тупик виден и назван,
// и из него есть выход — перезагрузка страницы.
const TripRecorder = dynamic(() => import("@/components/TripRecorder"), {
  ssr: false,
  loading: () => <p className="page-sub">Загружается…</p>,
});

class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="rec-error">
        Запись не загрузилась — скорее всего, страница открыта давно, а на сервере с тех пор
        была выкатка. Обновите страницу (Ctrl+F5): начатая поездка не потеряется, она лежит
        в этом браузере.
      </p>
    );
  }
}

export default function TripRecorderMount({ loginHref }: { loginHref: string }) {
  return (
    <ChunkBoundary>
      <TripRecorder loginHref={loginHref} />
    </ChunkBoundary>
  );
}
