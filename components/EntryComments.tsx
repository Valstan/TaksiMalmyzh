"use client";

import { useState } from "react";
import Link from "next/link";
import { installId } from "@/lib/install-id";
import { phoneKey } from "@/lib/phone-key";

// Комментарии под номерами карточки — решение владельца 2026-09-10: «чтобы люди могли под
// ними оставить комменты: неправильный номер, трубку не берут, или молодцы — классно катают».
//
// Лента грузится КЛИЕНТОМ, по нажатию, а не рисуется сервером. Две причины: текст третьих
// лиц не должен попадать в серверный HTML (второй слой неиндексируемости — `/api/` закрыт в
// app/robots.ts), и список из сотен карточек не должен тащить за собой сотни лент.
//
// «Мои» комментарии браузер помнит у себя, чтобы показать «удалить мой» только на них. Это
// подсказка интерфейсу, а не право: сервер удаляет, только если совпал псевдоним устройства.

type Item = { id: number; phoneKey: string; text: string | null; at: string };

const LS_MINE = "taksi.myComments";
const MAX_MINE = 200;

function readMine(): number[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_MINE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

function writeMine(ids: number[]) {
  try {
    localStorage.setItem(LS_MINE, JSON.stringify(ids.slice(0, MAX_MINE)));
  } catch {
    /* приватный режим: кнопки «удалить мой» просто не будет */
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

export default function EntryComments({
  entryId,
  phones,
  count,
}: {
  entryId: number;
  /** Номера карточки как написаны — для выбора «о чём» и подписи «о номере …». */
  phones: string[];
  /** Сколько строк за кнопкой — серверный агрегат, по тем же правилам, что и лента. */
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mine, setMine] = useState<number[]>([]);
  const [said, setSaid] = useState<Record<number, string>>({});
  const [about, setAbout] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Только настоящие номера и без повторов: «по договору» — не номер (lib/phone-key.ts), а
  // один номер, записанный в карточке дважды, дал бы два одинаковых пункта выбора.
  const numbered = [
    ...new Map(phones.filter((p) => phoneKey(p) !== "").map((p) => [phoneKey(p), p])).values(),
  ];
  const label = (key: string) => numbered.find((p) => phoneKey(p) === key) ?? null;

  async function load(before: number | null) {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ entryId: String(entryId) });
      if (before !== null) qs.set("before", String(before));
      const r = await fetch(`/api/comment?${qs.toString()}`);
      const j = (await r.json()) as { items?: Item[]; more?: boolean; error?: string };
      if (!r.ok) {
        setLoadError(j.error ?? "Не загрузилось.");
        return;
      }
      setItems((prev) => (before === null ? (j.items ?? []) : [...prev, ...(j.items ?? [])]));
      setMore(Boolean(j.more));
      setMine(readMine());
    } catch {
      setLoadError("Нет связи.");
    } finally {
      setLoading(false);
    }
  }

  async function act(id: number, action: "report" | "remove") {
    try {
      const r = await fetch("/api/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, commentId: id, installId: installId() }),
      });
      const j = (await r.json()) as { hidden?: boolean; error?: string };
      if (!r.ok) {
        setSaid((d) => ({ ...d, [id]: j.error ?? "не получилось" }));
        return;
      }
      if (action === "remove") {
        writeMine(readMine().filter((x) => x !== id));
        setMine(readMine());
        setItems((xs) => xs.filter((x) => x.id !== id));
        return;
      }
      setSaid((d) => ({
        ...d,
        [id]: j.hidden ? "жалоба принята — скрыт до проверки" : "жалоба принята",
      }));
    } catch {
      setSaid((d) => ({ ...d, [id]: "нет связи" }));
    }
  }

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const website = String(new FormData(e.currentTarget).get("website") ?? "");
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch("/api/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, phone: about, text, installId: installId(), website }),
      });
      const j = (await r.json()) as { id?: number; error?: string };
      if (!r.ok) {
        setMsg(j.error ?? "Не получилось.");
        return;
      }
      if (typeof j.id === "number") {
        const id = j.id;
        writeMine([id, ...readMine()]);
        setMine(readMine());
        setItems((xs) => [
          {
            id,
            phoneKey: about ? phoneKey(about) : "",
            text: text.replace(/\s+/g, " ").trim(),
            at: new Date().toISOString(),
          },
          ...xs,
        ]);
      }
      setText("");
    } catch {
      setMsg("Нет связи.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="cmt">
      <button
        type="button"
        className="cmt-toggle"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && items.length === 0) void load(null);
        }}
      >
        {count > 0 ? `Комментарии (${count})` : "Оставить комментарий"} {open ? "▴" : "▾"}
      </button>

      {open && (
        <div className="cmt-body">
          {loading && items.length === 0 && <p className="share-meta">Загружаю…</p>}
          {loadError && <p className="rec-error">{loadError}</p>}

          {items.length > 0 && (
            <ul className="cmt-list">
              {items.map((c) =>
                c.text === null ? (
                  <li key={c.id} className="cmt-item cmt-hidden">
                    Комментарий скрыт до проверки
                  </li>
                ) : (
                  <li key={c.id} className="cmt-item">
                    {c.phoneKey && label(c.phoneKey) && (
                      <span className="cmt-badge">о номере {label(c.phoneKey)}</span>
                    )}
                    <p className="cmt-text">{c.text}</p>
                    <span className="cmt-meta">
                      {when(c.at)}
                      {" · "}
                      {mine.includes(c.id) ? (
                        <button type="button" className="cmt-act" onClick={() => void act(c.id, "remove")}>
                          удалить мой
                        </button>
                      ) : said[c.id] ? (
                        said[c.id]
                      ) : (
                        <button type="button" className="cmt-act" onClick={() => void act(c.id, "report")}>
                          пожаловаться
                        </button>
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}

          {more && (
            <button
              type="button"
              className="share-revoke"
              disabled={loading}
              onClick={() => void load(items[items.length - 1]?.id ?? null)}
            >
              показать ещё
            </button>
          )}

          <form className="cmt-form" onSubmit={send}>
            {numbered.length > 0 && (
              <label>
                О чём
                <select value={about} onChange={(e) => setAbout(e.target.value)}>
                  <option value="">об организации целиком</option>
                  {numbered.map((p) => (
                    <option key={p} value={p}>
                      о номере {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              minLength={10}
              maxLength={400}
              rows={3}
              aria-label="Ваш комментарий"
              placeholder="Например: трубку берут сразу, приехали за 10 минут, цена как указана"
            />
            {/* honeypot: люди его не видят, боты заполняют */}
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px" }}
            />
            <button type="submit" disabled={sending}>
              {sending ? "Публикую…" : "Опубликовать"}
            </button>
            {msg && <p className="suggest-error">{msg}</p>}
            <p className="cmt-rules">
              Комментарии публикуются сразу и заранее не проверяются: это мнения посетителей, а
              не наша оценка. Телефоны и ссылки в тексте не публикуем.{" "}
              <Link href="/pravila">Правила и как убрать комментарий</Link>
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
