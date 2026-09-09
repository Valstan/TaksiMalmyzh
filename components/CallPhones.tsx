"use client";

import { useEffect, useRef, useState } from "react";
import KarmaVote from "@/components/KarmaVote";
import { installId } from "@/lib/install-id";
import { phoneKey } from "@/lib/phone-key";
import type { KarmaCount } from "@/lib/karma";

// Телефоны карточки с вопросом «дозвонились?» после звонка (спринт 5).
//
// Как ловится «вернулся после звонка»: нажатие на tel: уводит из браузера в звонилку, а
// возврат — событие visibilitychange → visible. На настольном браузере звонилки может не
// быть, тогда вопрос показывается по таймеру. Вопрос — не модалка и не обязателен: можно
// не отвечать, и ничего не сломается.
//
// Отметка одна на номер с устройства в сутки — это правило сервера (первичный ключ), а
// здесь просто не спрашиваем второй раз в той же сессии страницы.

type Phone = { id?: string | null; number: string };

function telHref(raw: string): string {
  return "tel:" + raw.replace(/[^\d+]/g, "");
}

type Stage = "idle" | "calling" | "ask" | "thanks";

export default function CallPhones({
  entryId,
  phones,
  karma,
}: {
  entryId: number;
  phones: Phone[];
  /**
   * Карма по номерам этой карточки, ключ — нормализованный номер (`lib/phone-key.ts`).
   * Обычный объект, а не Map: так проще и дешевле переехать через границу сервер→клиент.
   */
  karma?: Record<string, KarmaCount>;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [price, setPrice] = useState(false);
  const calledAt = useRef<number | null>(null);

  const post = (body: Record<string, unknown>) =>
    fetch("/api/signal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ ...body, entryId, installId: installId() }),
    }).catch(() => {});

  function onCall() {
    if (stage === "thanks") return; // уже отвечали в этой сессии — не переспрашиваем
    calledAt.current = Date.now();
    setStage("calling");
    void post({ action: "call" });
  }

  useEffect(() => {
    if (stage !== "calling") return;
    // Вернулись в приложение — спрашиваем. Или прошло 8 с без ухода (десктоп).
    const onVis = () => {
      if (document.visibilityState === "visible" && calledAt.current && Date.now() - calledAt.current > 1500) {
        setStage("ask");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setTimeout(() => setStage((s) => (s === "calling" ? "ask" : s)), 8000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(t); };
  }, [stage]);

  function answer(outcome: "answered" | "no_answer") {
    void post({ action: "answer", outcome, priceMismatch: price });
    setStage("thanks");
  }

  return (
    <>
      {/* Каждый номер — своя строка: телефон и его карма. Карма именно у номера, а не
          только у организации, — решение владельца: у одной службы бывает несколько
          номеров, и «этот не берут, а по этому отвечают» это разные факты. */}
      <div className="dir-phones">
        {phones.map((p) => {
          const key = phoneKey(p.number);
          return (
            <span key={p.id ?? p.number} className="dir-phone-row">
              <a className="dir-phone" href={telHref(p.number)} onClick={onCall}>
                {p.number}
              </a>
              {/* Поле без цифр («по договору») номером не является: голосовать не за что. */}
              {key !== "" && (
                <KarmaVote entryId={entryId} phone={p.number} count={karma?.[key]} />
              )}
            </span>
          );
        })}
      </div>

      {stage === "ask" && (
        <div className="ask">
          <p className="ask-q">Дозвонились?</p>
          <label className="ask-price">
            <input type="checkbox" checked={price} onChange={(e) => setPrice(e.target.checked)} />
            цена не совпала с указанной
          </label>
          <div className="rec-row">
            <button className="rec-btn" onClick={() => answer("answered")}>Да</button>
            <button className="rec-btn rec-stop" onClick={() => answer("no_answer")}>Не ответили</button>
            <button className="share-revoke" onClick={() => setStage("thanks")}>пропустить</button>
          </div>
        </div>
      )}

      {stage === "thanks" && <p className="ask-thanks">Спасибо — это поможет другим.</p>}
    </>
  );
}
