"use client";

import { useState } from "react";
import type { Claim } from "@/lib/market";
import type { EntryEdit } from "@/lib/entry-edits";

// Персоналу: заявки «это мой бизнес». Подтверждение — только после звонка по номеру из
// справочника: тот, кто отвечает по номеру, и есть бизнес. Кнопка так и подписана.
//
// С 2026-09-10 здесь же очередь новых номеров к организациям, которые уже есть в
// справочнике (lib/entry-edits.ts). Правило то же: номер попадает в карточку только после
// звонка по нему — ответили от этой организации, значит номер её.

const EDIT_SAID: Record<string, string> = {
  added: "добавлено в карточку",
  already: "номер уже был в карточке",
  gone: "запись удалена — правка погашена",
  rejected: "отклонено",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

const tel = (raw: string) => "tel:" + raw.replace(/[^\d+]/g, "");

export default function CabinetStaff({ claims, edits }: { claims: Claim[]; edits: EntryEdit[] }) {
  const [done, setDone] = useState<Record<number, "approved" | "rejected">>({});
  const [editDone, setEditDone] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);

  async function act(id: number, action: "approve" | "reject") {
    const r = await fetch("/api/cabinet", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action, id }),
    });
    if (r.ok) setDone((d) => ({ ...d, [id]: action === "approve" ? "approved" : "rejected" }));
    else setNote("не получилось — обновите страницу");
  }

  async function actEdit(id: number, action: "edit_approve" | "edit_reject") {
    const r = await fetch("/api/cabinet", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action, id }),
    });
    const j = (await r.json().catch(() => ({}))) as { result?: string; error?: string };
    if (r.ok) {
      const key = action === "edit_reject" ? "rejected" : (j.result ?? "added");
      setEditDone((d) => ({ ...d, [id]: EDIT_SAID[key] ?? EDIT_SAID.added }));
    } else {
      setNote(j.error ?? "не получилось — обновите страницу");
    }
  }

  return (
    <>
      <section className="cab">
        <h2>Новые номера к организациям</h2>
        <p className="page-sub">
          Посетители предложили номер к карточке, которая уже есть. Позвоните по новому номеру:
          ответили от этой организации — добавляйте.
        </p>
        {edits.length === 0 && <p className="page-sub">Предложений нет.</p>}
        <ul className="share-list">
          {edits.map((e) => (
            <li key={e.id} className="cab-claim">
              <div>
                <b>{e.entryName}</b>
                {e.entryStatus === "draft" && (
                  <span className="share-meta"> · карточка ещё черновик</span>
                )}
                <br />
                новый номер: <a href={tel(e.raw)}>{e.raw}</a>
                {e.entryPhones.length > 0 && (
                  <>
                    <br />
                    <span className="share-meta">уже в карточке: {e.entryPhones.join(", ")}</span>
                  </>
                )}
                {e.note && (
                  <>
                    <br />
                    <span className="share-meta">примечание: {e.note}</span>
                  </>
                )}
                <br />
                <span className="share-meta">{when(e.at)}</span>
              </div>
              {editDone[e.id] ? (
                <span className="share-meta">{editDone[e.id]}</span>
              ) : (
                <div className="rec-row">
                  <button className="rec-btn" onClick={() => void actEdit(e.id, "edit_approve")}>
                    Позвонил, добавляю
                  </button>
                  <button className="share-revoke" onClick={() => void actEdit(e.id, "edit_reject")}>
                    отклонить
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="cab">
        <h2>Заявки на владение</h2>
        {claims.length === 0 && <p className="page-sub">Заявок нет.</p>}
        <ul className="share-list">
          {claims.map((c) => (
            <li key={c.id} className="cab-claim">
              <div>
                <b>{c.entryName}</b> — {c.entryPhones.join(", ")}
                <br />
                <span className="share-meta">заявил: {c.userLabel} · {when(c.at)}</span>
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
    </>
  );
}
