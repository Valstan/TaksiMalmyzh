"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/track-chat";

// Переписка на странице поездки — общий вид для пассажира и контакта (спринт 6).
//
// Не мессенджер: без истории между поездками, без вложений, без «прочитано». Список
// приходит снаружи (страница и так опрашивает сервер), здесь — только отправка и вид.

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export default function TripChat({
  me,
  messages,
  onSend,
  disabled,
  phone,
}: {
  me: "passenger" | "contact";
  messages: ChatMessage[];
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  /** Номер для связи, если пассажир его оставил (виден только контакту). */
  phone?: string | null;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setNote(null);
    const ok = await onSend(t);
    if (ok) setText(""); else setNote("не отправилось — попробуйте ещё раз");
    setBusy(false);
  }

  return (
    <div className="chat">
      <p className="share-title">
        {me === "contact" ? "Написать ему" : "Сообщения от тех, у кого есть ссылка"}
      </p>

      {phone && me === "contact" && (
        <div className="rec-row chat-phone">
          <a className="rec-btn" href={`tel:${phone}`}>Позвонить</a>
          <a className="rec-btn" href={`sms:${phone}`}>SMS</a>
        </div>
      )}

      <div className="chat-list">
        {messages.length === 0 && <p className="page-sub">Пока пусто.</p>}
        {messages.map((m) => (
          <div key={m.seq} className={`chat-msg ${m.author === me ? "chat-mine" : ""}`}>
            <span className="chat-meta">
              {m.author === me ? "вы" : m.author === "passenger" ? "пассажир" : m.via ?? "контакт"} · {when(m.at)}
            </span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {!disabled ? (
        <div className="rec-row">
          <input
            className="share-input"
            placeholder={me === "contact" ? "где ты? / выезжаю за тобой" : "уже подъезжаю"}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          />
          <button className="rec-btn" disabled={busy || !text.trim()} onClick={() => void send()}>Отправить</button>
        </div>
      ) : (
        <p className="page-sub">Переписка закрыта: поездка свёрнута по сроку хранения.</p>
      )}
      {note && <p className="rec-error">{note}</p>}
    </div>
  );
}
