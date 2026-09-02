"use client";

import { useState } from "react";
import type { Entry } from "@/payload-types";
import type { RequestRow } from "@/lib/market";

// Кабинет владельца: карточка (описание, часы, цены) и вызовы с адресом.
//
// Название, телефоны и категорию владелец не правит — это то, что персонал проверял
// звонком; их меняют через персонал. Всё остальное — его.

type PriceRow = { label: string; value: string };

function CardForm({ entry }: { entry: Entry }) {
  const [description, setDescription] = useState(entry.description ?? "");
  const [hours, setHours] = useState(entry.hours ?? "");
  const [prices, setPrices] = useState<PriceRow[]>(
    (entry.prices ?? []).map((p) => ({ label: p.label, value: p.value })),
  );
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");

  async function save() {
    setState("busy");
    const r = await fetch("/api/cabinet", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: "card", id: entry.id, description, hours, prices }),
    });
    setState(r.ok ? "saved" : "error");
  }

  return (
    <div className="cab-card">
      <h3>{entry.name}</h3>
      <p className="share-meta">{(entry.phones ?? []).map((p) => p.number).join(", ")} · название и телефоны меняет персонал</p>
      <div className="suggest-form">
        <label>
          Описание (что делаете, куда ездите)
          <textarea className="cab-textarea" maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Часы работы
          <input maxLength={120} placeholder="круглосуточно / 8:00–20:00" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <div>
          <span className="share-meta">Цены (справочные, не оферта)</span>
          {prices.map((p, i) => (
            <div key={i} className="rec-row cab-price">
              <input maxLength={80} placeholder="по городу" value={p.label}
                onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input maxLength={40} placeholder="от 100 ₽" value={p.value}
                onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button className="share-revoke" type="button" onClick={() => setPrices(prices.filter((_, j) => j !== i))}>убрать</button>
            </div>
          ))}
          {prices.length < 20 && (
            <button className="share-revoke" type="button" onClick={() => setPrices([...prices, { label: "", value: "" }])}>+ добавить цену</button>
          )}
        </div>
        <button type="button" disabled={state === "busy"} onClick={() => void save()}>
          {state === "busy" ? "Сохраняю…" : state === "saved" ? "Сохранено" : "Сохранить"}
        </button>
        {state === "error" && <p className="suggest-error">Не сохранилось — попробуйте ещё раз.</p>}
      </div>
    </div>
  );
}

export default function CabinetOwner({ entries, requests }: { entries: Entry[]; requests: RequestRow[] }) {
  const [rows, setRows] = useState(requests);
  const names = new Map(entries.map((e) => [e.id, e.name]));

  async function mark(id: number, what: "seen" | "done") {
    const r = await fetch("/api/cabinet", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: what, id }),
    });
    if (r.ok) {
      const now = new Date().toISOString();
      setRows(rows.map((x) => (x.id === id ? { ...x, seenAt: x.seenAt ?? now, doneAt: what === "done" ? now : x.doneAt } : x)));
    }
  }

  return (
    <>
      <section className="cab">
        <h2>Вызовы</h2>
        <p className="page-sub">
          Клиент нажал «Вызвать с адресом» — адрес уже подставлен, звоните ему. Вызовы хранятся
          30 дней.
        </p>
        {rows.length === 0 && <p className="page-sub">Вызовов пока нет.</p>}
        <ul className="share-list">
          {rows.map((r) => (
            <li key={r.id} className={`cab-req ${r.seenAt ? "" : "cab-new"} ${r.doneAt ? "cab-done" : ""}`}>
              <div>
                <b>{r.address}</b>
                {entries.length > 1 && <span className="share-meta"> · {names.get(r.entryId)}</span>}
                <br />
                <a className="dir-phone" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>
                {r.note && <span className="share-meta"> · {r.note}</span>}
                <br />
                <span className="share-meta">{new Date(r.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}{r.doneAt ? " · выполнен" : r.seenAt ? " · просмотрен" : " · новый"}</span>
              </div>
              {!r.doneAt && (
                <div className="rec-row">
                  {!r.seenAt && <button className="share-revoke" onClick={() => void mark(r.id, "seen")}>видел</button>}
                  <button className="rec-btn" onClick={() => void mark(r.id, "done")}>Выполнен</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="cab">
        <h2>{entries.length > 1 ? "Мои карточки" : "Моя карточка"}</h2>
        {entries.map((e) => <CardForm key={e.id} entry={e} />)}
      </section>
    </>
  );
}
