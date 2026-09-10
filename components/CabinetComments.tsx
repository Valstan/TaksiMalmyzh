"use client";

import { useState } from "react";
// Только тип: сам модуль тянет pg и node:crypto, клиентскому бандлу он недоступен.
import type { ModerationRow } from "@/lib/comments";

// Комментарии в кабинете (решение владельца 2026-09-10). Два лица:
//  - персонал: очередь — скрытое тремя жалобами и то, чего потребовал удалить владелец
//    карточки; две кнопки, решение персонала последнее;
//  - владелец карточки: ВСЕ комментарии о ней, включая скрытые, и кнопка «Требую удалить».
//    Удалить сам он не может — справочник, где бизнес стирает критику, врёт посетителю.

const STATE_SAID = ["виден", "скрыт до проверки", "скрыт персоналом", "возвращён персоналом"];

const DEMAND_SAID: Record<string, string> = {
  hidden: "скрыт до проверки — персонал решит",
  requeued: "персонал его уже возвращал; требование передано на повторное рассмотрение",
  already_pending: "ваше требование уже ждёт решения персонала",
  kept: "персонал рассмотрел требование и оставил комментарий — дальше см. страницу правил",
  removed: "комментарий уже скрыт персоналом",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default function CabinetComments({
  mode,
  rows,
  hiddenDays,
}: {
  mode: "staff" | "owner";
  rows: ModerationRow[];
  /** Срок жизни скрытого — из констант сервера, чтобы текст не разошёлся с кодом. */
  hiddenDays: number;
}) {
  const [said, setSaid] = useState<Record<number, string>>({});

  async function act(id: number, action: "comment_hide" | "comment_restore" | "comment_demand") {
    try {
      const r = await fetch("/api/cabinet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, id }),
      });
      const j = (await r.json().catch(() => ({}))) as { result?: string; error?: string };
      const text = !r.ok
        ? (j.error ?? "не получилось — обновите страницу")
        : action === "comment_hide"
          ? "скрыт насовсем"
          : action === "comment_restore"
            ? "возвращён"
            : (DEMAND_SAID[j.result ?? ""] ?? "принято");
      setSaid((d) => ({ ...d, [id]: text }));
    } catch {
      setSaid((d) => ({ ...d, [id]: "нет связи" }));
    }
  }

  return (
    <section className="cab">
      <h2>{mode === "staff" ? "Комментарии на проверке" : "Комментарии о ваших карточках"}</h2>
      <p className="page-sub">
        {mode === "staff"
          ? `Сюда попадает скрытое тремя жалобами и то, чего потребовал удалить владелец карточки. Нерассмотренное скрытое удаляется само через ${hiddenDays} суток — решайте раньше, иначе автоскрытие станет тихой цензурой.`
          : "Удалить чужой комментарий вы не можете, но можете потребовать: комментарий скроется до решения персонала, а исход вы увидите здесь."}
      </p>
      {rows.length === 0 && (
        <p className="page-sub">{mode === "staff" ? "Очередь пуста." : "Комментариев пока нет."}</p>
      )}
      <ul className="share-list">
        {rows.map((c) => (
          <li key={c.id} className="cab-claim">
            <div>
              <b>{c.entryName}</b>
              {c.phoneKey && <span className="share-meta"> · о номере {c.phoneKey}</span>}
              <p className="cmt-text">{c.text}</p>
              <span className="share-meta">
                {when(c.at)} · {STATE_SAID[c.state]} · жалоб: {c.reports}
                {c.ownerDemand && " · требование владельца карточки"}
              </span>
            </div>
            {said[c.id] ? (
              <span className="share-meta">{said[c.id]}</span>
            ) : mode === "staff" ? (
              <div className="rec-row">
                <button className="rec-btn rec-stop" onClick={() => void act(c.id, "comment_hide")}>
                  Скрыть насовсем
                </button>
                <button className="share-revoke" onClick={() => void act(c.id, "comment_restore")}>
                  вернуть
                </button>
              </div>
            ) : c.state !== 2 ? (
              <button className="share-revoke" onClick={() => void act(c.id, "comment_demand")}>
                Требую удалить
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
