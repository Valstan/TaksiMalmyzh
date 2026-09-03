"use client";

import { useState } from "react";
import AddressSearch from "@/components/AddressSearch";
import type { Hit } from "@/components/MapView";

// Действия на карточке справочника (спринт 8): «Вызвать с адресом» (если у карточки есть
// владелец, который вызов увидит) и «Это мой бизнес» (вошедшему, пока владельца нет).

export default function EntryActions({
  entryId,
  hasOwner,
  viewer,
  claimed,
}: {
  entryId: number;
  hasOwner: boolean;
  viewer: { id: number; role: string } | null;
  /** Заявка этого посетителя уже есть (0 ждёт / 1 подтверждена / 2 отклонена). */
  claimed: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [hit, setHit] = useState<Hit | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [claim, setClaim] = useState<number | null>(claimed);

  async function order(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setState("busy");
    try {
      const r = await fetch("/api/order", {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          entryId,
          address: hit?.label ?? data.address,
          lat: hit?.lat ?? null,
          lng: hit?.lon ?? null,
          phone: data.phone,
          note: data.note,
          website: data.website,
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) { setMessage(j.error ?? "Не получилось."); setState("error"); return; }
      setState("done");
    } catch { setMessage("Нет связи."); setState("error"); }
  }

  async function claimIt() {
    const r = await fetch("/api/claim", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ entryId }),
    });
    if (r.ok) setClaim(0);
  }

  return (
    <div className="entry-actions">
      {hasOwner && state !== "done" && !open && (
        <button className="rec-btn" type="button" onClick={() => setOpen(true)}>Вызвать с адресом</button>
      )}
      {hasOwner && open && state !== "done" && (
        <form className="suggest-form" onSubmit={order}>
          <label>
            Откуда забрать
            <AddressSearch onPick={setHit} />
            <input name="address" maxLength={200} placeholder="или впишите адрес" defaultValue={hit?.label ?? ""} />
          </label>
          <label>
            Ваш телефон — чтобы перезвонили
            <input name="phone" required maxLength={30} inputMode="tel" placeholder="+7 912 000-00-00" />
          </label>
          <label>
            Примечание (не обязательно)
            <input name="note" maxLength={300} placeholder="подъезд 2, к 18:00" />
          </label>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
          <p className="share-meta">Адрес и телефон увидит только этот бизнес; через 30 дней вызов удалится.</p>
          <div className="rec-row">
            <button type="submit" disabled={state === "busy"}>{state === "busy" ? "Отправляю…" : "Вызвать"}</button>
            <button type="button" className="share-revoke" onClick={() => setOpen(false)}>отмена</button>
          </div>
          {state === "error" && <p className="suggest-error">{message}</p>}
        </form>
      )}
      {state === "done" && <p className="suggest-done">Вызов отправлен — вам перезвонят.</p>}

      {/* Истёкшая заявка (3) снова показывает кнопку: до неё не дошли руки персонала, и
          запирать человека навсегда из-за этого нельзя. Отклонённая (2) — решение
          человека, её кнопкой не обходят. */}
      {!hasOwner && viewer && viewer.role !== "superadmin" && (
        claim === null || claim === 3
          ? (
            <>
              <button className="share-revoke" type="button" onClick={() => void claimIt()}>Это мой бизнес</button>
              {claim === 3 && <span className="share-meta">прошлая заявка истекла без ответа</span>}
            </>
          )
          : <span className="share-meta">{claim === 0 ? "заявка отправлена — мы позвоним подтвердить" : claim === 1 ? "ваша карточка" : "заявка отклонена"}</span>
      )}
    </div>
  );
}
