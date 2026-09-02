"use client";

import { useState } from "react";
import type { WorkerStats } from "@/lib/ratings";

// Работники в кабинете (спринт 9): заводит и убирает сам бизнес. Имя — его слово и его
// ответственность; посетители работников не создают. Убрать — не удалить: голоса остаются
// в общем рейтинге, имя со страницы уходит.

export default function CabinetWorkers({ entryId, workers, avg, count }: {
  entryId: number; workers: WorkerStats[]; avg: number; count: number;
}) {
  const [list, setList] = useState(workers);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    const r = await fetch("/api/cabinet", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ ...body, id: entryId }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string; worker?: WorkerStats };
    if (!r.ok) { setNote(j.error ?? "не получилось"); return null; }
    setNote(null);
    return j;
  }

  async function add() {
    const j = await act({ action: "worker_add", name });
    if (j?.worker) { setList([...list, { ...j.worker, avg: 0, count: 0 }]); setName(""); }
  }

  async function remove(workerId: number) {
    const j = await act({ action: "worker_remove", workerId });
    if (j) setList(list.filter((w) => w.id !== workerId));
  }

  return (
    <div className="cab-workers">
      <p className="share-meta">
        Рейтинг: {count > 0 ? `★ ${avg.toFixed(1).replace(".", ",")} из 5 по ${count} оценкам за год` : "оценок пока нет"}.
        Звёзды работникам входят в общий рейтинг.
      </p>
      {list.length > 0 && (
        <ul className="share-list">
          {list.map((w) => (
            <li key={w.id}>
              <span>{w.name}</span>
              <span className="share-meta">{w.count > 0 ? `★ ${w.avg.toFixed(1).replace(".", ",")} (${w.count})` : "оценок нет"}</span>
              <button className="share-revoke" type="button" onClick={() => void remove(w.id)}>убрать</button>
            </li>
          ))}
        </ul>
      )}
      <div className="rec-row">
        <input className="share-input" maxLength={60} placeholder="водитель Василий" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="rec-btn" type="button" disabled={name.trim().length < 2} onClick={() => void add()}>Добавить работника</button>
      </div>
      <p className="share-meta">Имя работника вы вписываете сами и отвечаете за него; посетители смогут ставить ему звёзды.</p>
      {note && <p className="rec-error">{note}</p>}
    </div>
  );
}
