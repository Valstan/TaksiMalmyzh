"use client";

import { useState } from "react";

// Форма «предложить номер». Предложение уходит черновиком и публикуется только
// после проверки супер-админом — форма честно говорит об этом человеку.
export default function SuggestForm() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setState("busy");
    try {
      const r = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok) {
        setMessage(json.error ?? "Не получилось отправить.");
        setState("error");
        return;
      }
      form.reset();
      setState("done");
    } catch {
      setMessage("Не получилось отправить — проверьте связь.");
      setState("error");
    }
  }

  return (
    <section className="suggest">
      <h2>Предложить номер</h2>
      <p className="page-sub">
        Знаете службу, которой здесь нет? Добавьте — номер появится после проверки.
      </p>
      {state === "done" ? (
        <p className="suggest-done">
          Спасибо! Номер отправлен на проверку и появится после подтверждения.
        </p>
      ) : (
        <form className="suggest-form" onSubmit={submit}>
          <label>
            Название
            <input name="name" required minLength={2} maxLength={120} placeholder="Такси «Стрела»" />
          </label>
          <label>
            Телефон
            <input name="phone" required maxLength={30} placeholder="+7 912 000-00-00" />
          </label>
          <label>
            Категория
            <select name="category" defaultValue="taxi">
              <option value="taxi">Такси</option>
              <option value="shop">Магазины</option>
              <option value="master">Мастера и ремонт</option>
              <option value="brigade">Бригады и работы</option>
              <option value="cargo">Доставка и грузы</option>
              <option value="other">Другое</option>
            </select>
          </label>
          <label>
            Примечание (цены, направления — не обязательно)
            <input name="note" maxLength={500} placeholder="по городу от 100 ₽" />
          </label>
          {/* honeypot: люди его не видят, боты заполняют */}
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px" }}
          />
          <button type="submit" disabled={state === "busy"}>
            {state === "busy" ? "Отправляю…" : "Отправить на проверку"}
          </button>
          {state === "error" && <p className="suggest-error">{message}</p>}
        </form>
      )}
    </section>
  );
}
