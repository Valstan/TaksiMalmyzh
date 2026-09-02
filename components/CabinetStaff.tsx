"use client";

import { useState } from "react";
import type { Claim } from "@/lib/market";

// Персоналу: заявки «это мой бизнес». Подтверждение — только после звонка по номеру из
// справочника: тот, кто отвечает по номеру, и есть бизнес. Кнопка так и подписана.

export default function CabinetStaff({ claims }: { claims: Claim[] }) {
  const [done, setDone] = useState<Record<number, "approved" | "rejected">>({});
  const [note, setNote] = useState<string | null>(null);

  async function act(id: number, action: "approve" | "reject") {
    const r = await fetch("/api/cabinet", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action, id }),
    });
    if (r.ok) setDone((d) => ({ ...d, [id]: action === "approve" ? "approved" : "rejected" }));
    else setNote("не получилось — обновите страницу");
  }

  return (
    <section className="cab">
      <h2>Заявки на владение</h2>
      {claims.length === 0 && <p className="page-sub">Заявок нет.</p>}
      <ul className="share-list">
        {claims.map((c) => (
          <li key={c.id} className="cab-claim">
            <div>
              <b>{c.entryName}</b> — {c.entryPhones.join(", ")}
              <br />
              <span className="share-meta">заявил: {c.userLabel} · {new Date(c.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
            </div>
            {done[c.id] ? (
              <span className="share-meta">{done[c.id] === "approved" ? "подтверждено" : "отклонено"}</span>
            ) : (
              <div className="rec-row">
                <button className="rec-btn" onClick={() => void act(c.id, "approve")}>Позвонил, подтверждаю</button>
                <button className="share-revoke" onClick={() => void act(c.id, "reject")}>отклонить</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="rec-error">{note}</p>}
    </section>
  );
}
