"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShareInfo } from "@/lib/track-share";
import type { ChatMessage } from "@/lib/track-chat";
import TripChat from "@/components/TripChat";

// Панель «поделиться поездкой» внутри записи (M0.A §5.2, §8.7: сильный дефолт, но не гейт).
//
// Ссылка с verifier'ом показывается один раз, при создании: дальше её знает только тот,
// кому её отправили. Список ниже — подпись, число просмотров, «отозвать»; самих ссылок в
// нём нет (M0.A §5.5: журнал просмотров постфактум, без данных о получателе).

type Api = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export default function ShareTripPanel({
  api, tripId, writeToken, finished,
}: { api: Api; tripId: number; writeToken: string; finished: boolean }) {
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ path: string; label: string | null } | null>(null);
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phone, setPhone] = useState("");
  const [phoneSaved, setPhoneSaved] = useState(false);

  // Переписка (спринт 6): опрос раз в 10 с, пока панель на экране.
  const loadMessages = useCallback(async () => {
    try {
      const r = await api({ action: "messages", tripId, writeToken });
      setMessages((r.messages as ChatMessage[]) ?? []);
    } catch { /* нет связи — покажем, что есть */ }
  }, [api, tripId, writeToken]);

  useEffect(() => {
    const first = setTimeout(() => void loadMessages(), 0);
    const t = setInterval(() => void loadMessages(), 10_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadMessages]);

  async function savePhone() {
    try {
      await api({ action: "phone", tripId, writeToken, phone });
      setPhoneSaved(true);
    } catch { setNote("не удалось сохранить номер"); }
  }

  const refresh = useCallback(async () => {
    try {
      const r = await api({ action: "shares", tripId, writeToken });
      setShares((r.shares as ShareInfo[]) ?? []);
      setLive(Boolean(r.live));
    } catch { /* список не обязателен */ }
  }, [api, tripId, writeToken]);

  // Первый запрос — следующим тиком: setState прямо в теле эффекта даёт каскадный рендер,
  // и правило линтера тут право по существу.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  async function create() {
    setBusy(true); setNote(null);
    try {
      const r = await api({ action: "share", tripId, writeToken, label });
      const s = r.share as ShareInfo;
      setFresh({ path: s.path ?? "", label: s.label });
      setLabel("");
      await refresh();
    } catch { setNote("не удалось создать ссылку"); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!fresh) return;
    const url = `${window.location.origin}${fresh.path}`;
    const text = "Я еду. По этой ссылке видно, как идёт поездка; если я перестану отвечать — откроется маршрут.";
    try {
      if (navigator.share) { await navigator.share({ title: "Моя поездка", text, url }); return; }
    } catch { /* отменил — попробуем скопировать */ }
    try { await navigator.clipboard.writeText(url); setNote("ссылка скопирована"); }
    catch { setNote("скопируйте ссылку вручную"); }
  }

  async function revoke(id: number) {
    try { await api({ action: "revoke", tripId, writeToken, shareId: id }); await refresh(); }
    catch { setNote("не удалось отозвать"); }
  }

  async function toggleLive() {
    try { await api({ action: "live", tripId, writeToken, live: !live }); setLive(!live); }
    catch { setNote("не удалось переключить"); }
  }

  return (
    <div className="share">
      <p className="share-title">Кому показать поездку</p>
      <p className="page-sub">
        Родителю, супругу, другу. Он увидит, что поездка идёт, а маршрут — только если вы
        включите показ или перестанете отвечать на напоминания. Ссылка работает и после
        поездки: пропажу замечают позже, чем она случается.
      </p>

      {!finished && (
        <div className="rec-row">
          <input
            className="share-input"
            placeholder="кому: маме, Ивану…"
            maxLength={40}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="rec-btn" disabled={busy} onClick={() => void create()}>Сделать ссылку</button>
        </div>
      )}

      {fresh && (
        <div className="share-fresh">
          <p className="page-sub">
            Ссылка{fresh.label && <> для «{fresh.label}»</>} готова. Отправьте её сейчас — потом
            она здесь не покажется.
          </p>
          <code className="share-url">{typeof window !== "undefined" ? window.location.origin : ""}{fresh.path}</code>
          <div className="rec-row">
            <button className="rec-btn" onClick={() => void send()}>Отправить</button>
            <button className="rec-btn rec-stop" onClick={() => setFresh(null)}>Скрыть</button>
          </div>
        </div>
      )}

      {!finished && (
        <label className="share-live">
          <input type="checkbox" checked={live} onChange={() => void toggleLive()} />
          Показывать маршрут живьём всем, у кого есть ссылка — только на эту поездку
        </label>
      )}

      {shares.length > 0 && (
        <ul className="share-list">
          {shares.map((s) => (
            <li key={s.id}>
              <span>{s.label ?? "без подписи"}</span>
              <span className="share-meta">
                {s.revokedAt ? "отозвана" : s.viewCount === 0 ? "не открывали" : `открывали ${s.viewCount} раз`}
                {s.boundToViewer && !s.revokedAt && " · у знакомого в приложении"}
              </span>
              {!s.revokedAt && (
                <button className="share-revoke" onClick={() => void revoke(s.id)}>отозвать</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {shares.length > 0 && (
        <>
          <div className="share-phone">
            <p className="page-sub">
              Номер для связи на эту поездку — не обязательно. Увидят только те, у кого есть
              ссылка; исчезнет вместе с поездкой.
            </p>
            <div className="rec-row">
              <input
                className="share-input"
                inputMode="tel"
                placeholder="+7 912 000-00-00"
                maxLength={20}
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneSaved(false); }}
              />
              <button className="rec-btn" onClick={() => void savePhone()}>
                {phoneSaved ? "Сохранено" : "Сохранить"}
              </button>
            </div>
          </div>

          <TripChat
            me="passenger"
            messages={messages}
            onSend={async (text) => {
              try {
                await api({ action: "chat", tripId, writeToken, text });
                await loadMessages();
                return true;
              } catch { return false; }
            }}
          />
        </>
      )}

      {note && <p className="page-sub">{note}</p>}
    </div>
  );
}
