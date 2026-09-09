"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { installId } from "@/lib/install-id";
import { ORG_KEY, phoneKey } from "@/lib/phone-key";
import type { KarmaCount } from "@/lib/karma";

// Плюс-минус у организации и у каждого номера (решение владельца 2026-09-10). Без входа:
// «пока чтобы плюсовали и минусовали без авторизации, чтобы начать жизнь сайта хотя бы».
//
// Своё нажатие показывается сразу, не дожидаясь сервера: голос — жест, а жест без отклика
// человек повторяет. Сервер отвечает итоговым состоянием, и если он не согласен, состояние
// откатывается к его слову: число на карточке общее, и врать в пользу оптимизма нельзя.
//
// Повторное нажатие той же кнопки ОТЗЫВАЕТ голос. Без отзыва человек, ткнувший минус
// случайно, ничего исправить не может, и единственный доступный ему ход — уйти.

/**
 * Где помнится СВОЙ голос.
 *
 * Сервер знает его по псевдониму устройства, но спрашивать «а как я голосовал» на каждую
 * карточку списка — лишний запрос на каждую карточку. Между тем «то же устройство» и «тот
 * же localStorage» — одно и то же: `install_id`, которым голос подписан, лежит ровно там
 * же. Поэтому своё состояние помнит браузер, а сервер остаётся единственным источником
 * правды о СУММЕ. Почистили хранилище — подсветка потеряется, голос на сервере останется,
 * и следующее нажатие его отзовёт. Редко и не страшно.
 *
 * Читается через `useSyncExternalStore`, а не эффектом: у хука есть отдельный снимок для
 * сервера, где localStorage нет, — то есть расхождения разметки не возникает по построению,
 * и `setState` внутри эффекта не нужен.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const mineKey = (entryId: number, phone?: string) =>
  `taksi.karma.${entryId}.${phone ? phoneKey(phone) : ORG_KEY}`;

function readMine(key: string): -1 | 0 | 1 {
  try {
    const v = Number(localStorage.getItem(key));
    return v === 1 || v === -1 ? v : 0;
  } catch {
    return 0; // хранилище закрыто — просто не подсветим
  }
}

function writeMine(key: string, v: -1 | 0 | 1) {
  try {
    if (v === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {
    /* не запомнили — не беда */
  }
  for (const l of listeners) l();
}

export default function KarmaVote({
  entryId,
  phone,
  count,
  label,
}: {
  entryId: number;
  /** Пусто — голос за организацию целиком; иначе номер как он записан в карточке. */
  phone?: string;
  count?: KarmaCount;
  /** Подпись перед кнопками: нужна там, где рядом звёзды, чтобы не путать две шкалы. */
  label?: string;
}) {
  const key = mineKey(entryId, phone);
  const state = useSyncExternalStore(
    subscribe,
    useCallback(() => readMine(key), [key]),
    () => 0 as const,
  );

  const [up, setUp] = useState(count?.up ?? 0);
  const [down, setDown] = useState(count?.down ?? 0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shift = (from: -1 | 0 | 1, to: -1 | 0 | 1, u: number, d: number) => {
    setUp(u + (to === 1 ? 1 : 0) - (from === 1 ? 1 : 0));
    setDown(d + (to === -1 ? 1 : 0) - (from === -1 ? 1 : 0));
  };

  async function send(value: -1 | 1) {
    if (busy) return;
    setBusy(true);
    setNote(null);

    const was = state;
    const wasUp = up;
    const wasDown = down;
    const next: -1 | 0 | 1 = was === value ? 0 : value;

    shift(was, next, up, down);
    writeMine(key, next);

    try {
      const r = await fetch("/api/karma", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, phone, value, installId: installId() }),
      });
      const j = (await r.json()) as { error?: string; state?: -1 | 0 | 1 };
      if (!r.ok) {
        setUp(wasUp);
        setDown(wasDown);
        writeMine(key, was);
        setNote(j.error ?? "не принято");
      } else if (j.state !== undefined && j.state !== next) {
        // Сервер знает лучше: у него общий счёт, у нас догадка.
        shift(next, j.state, wasUp, wasDown);
        writeMine(key, j.state);
      }
    } catch {
      setUp(wasUp);
      setDown(wasDown);
      writeMine(key, was);
      setNote("нет связи");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="karma">
      {label && <span className="karma-label">{label}</span>}
      <button
        type="button"
        className={state === 1 ? "karma-btn karma-on" : "karma-btn"}
        aria-pressed={state === 1}
        aria-label={phone ? `Хвалю номер ${phone}` : "Хвалю"}
        onClick={() => void send(1)}
      >
        +{up > 0 && <span className="karma-n">{up}</span>}
      </button>
      <button
        type="button"
        className={state === -1 ? "karma-btn karma-off karma-on" : "karma-btn karma-off"}
        aria-pressed={state === -1}
        aria-label={phone ? `Жалуюсь на номер ${phone}` : "Жалуюсь"}
        onClick={() => void send(-1)}
      >
        −{down > 0 && <span className="karma-n">{down}</span>}
      </button>
      {note && <span className="rec-error">{note}</span>}
    </span>
  );
}
