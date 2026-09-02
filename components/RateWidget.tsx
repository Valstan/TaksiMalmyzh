"use client";

import { useState } from "react";
import { installId } from "@/lib/install-id";
import type { WorkerStats } from "@/lib/ratings";

// Звёзды на карточке (спринт 9): фирме или, если бизнес завёл работников, конкретному
// человеку. Только числа — текста нет по построению. Голос за день можно поменять.

export default function RateWidget({ entryId, workers }: { entryId: number; workers: WorkerStats[] }) {
  const [who, setWho] = useState(0);
  const [given, setGiven] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function send(stars: number) {
    setGiven(stars);
    try {
      const r = await fetch("/api/rate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, workerId: who, stars, installId: installId() }),
      });
      if (!r.ok) { const j = (await r.json()) as { error?: string }; setNote(j.error ?? "не принято"); setGiven(null); }
      else setNote(null);
    } catch { setNote("нет связи"); setGiven(null); }
  }

  return (
    <div className="rate">
      {workers.length > 0 && (
        <select className="rate-who" value={who} onChange={(e) => { setWho(Number(e.target.value)); setGiven(null); }}>
          <option value={0}>оценить фирму</option>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
      <span className="rate-stars" role="group" aria-label="Оценка от 1 до 5">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            className={`rate-star ${given !== null && s <= given ? "rate-on" : ""}`}
            aria-label={`${s} из 5`}
            onClick={() => void send(s)}
          >
            ★
          </button>
        ))}
      </span>
      {given !== null && <span className="share-meta">спасибо, {given} из 5</span>}
      {note && <span className="rec-error">{note}</span>}
    </div>
  );
}
