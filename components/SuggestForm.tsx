"use client";

import { useState } from "react";
import OrgPicker, { type OrgHit } from "@/components/OrgPicker";
import { CATEGORY_LABELS } from "@/lib/category-labels";
import { phoneKey } from "@/lib/phone-key";
import { CATEGORIES } from "@/lib/sites";

// Форма «предложить номер». Предложение уходит на проверку и публикуется только после
// решения персонала — форма честно говорит об этом человеку.
//
// С 2026-09-10 форма про два сценария (решение владельца): новой организации и нового
// номера у организации, которая уже есть. Сначала поле «Организация» с подсказками: выбрал
// существующую — форма просит только номера и не спрашивает категорию (она у карточки уже
// есть); не нашёл — это новая, и тогда нужна категория.

const MAX_PHONES = 3;

/**
 * Один текст на все исходы. Сервер, не найдя организацию в подсказке, сам сверит название и
 * положит номер к существующей — и форма не должна подтверждать, нашлось ли что-то: иначе
 * она стала бы оракулом очереди модерации.
 */
const DONE_TEXT =
  "Спасибо! Отправлено на проверку. Если такая организация у нас уже есть или уже " +
  "предложена — номер добавится к ней, а не появится вторая карточка.";

export default function SuggestForm({
  defaultCategory = "taxi",
}: {
  /**
   * Какая категория выбрана заранее. Приходит из полки, с которой человек пришёл: с
   * пустой плашки «Магазины» он попадает прямо сюда по якорю, и форма, открытая на
   * «Такси», отправила бы магазин в такси.
   */
  defaultCategory?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<OrgHit | null>(null);
  const [category, setCategory] = useState(defaultCategory);
  const [phones, setPhones] = useState<string[]>([""]);
  const [note, setNote] = useState("");

  // Номер, который у выбранной организации уже есть, отправлять незачем. Сверка по тому же
  // ключу, что у сервера и у кармы (`lib/phone-key.ts`): «8912…» и «+7 912 …» — один номер.
  const known = new Set((picked?.phones ?? []).map(phoneKey));
  const isKnown = (p: string) => picked !== null && p.trim() !== "" && known.has(phoneKey(p));

  function reset() {
    setName("");
    setPicked(null);
    setCategory(defaultCategory);
    setPhones([""]);
    setNote("");
    setMessage("");
    setState("idle");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const website = String(new FormData(event.currentTarget).get("website") ?? "");
    const fresh = phones.map((p) => p.trim()).filter((p) => p !== "" && !isKnown(p));
    if (fresh.length === 0) {
      setMessage(
        picked
          ? "Все эти номера у организации уже указаны — добавлять нечего."
          : "Нужен хотя бы один телефон.",
      );
      setState("error");
      return;
    }

    setState("busy");
    try {
      const r = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: picked?.id,
          name: picked ? picked.name : name,
          category: picked ? picked.category : category,
          phones: fresh,
          note,
          website,
        }),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok) {
        setMessage(json.error ?? "Не получилось отправить.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setMessage("Не получилось отправить — проверьте связь.");
      setState("error");
    }
  }

  return (
    // Якорь: на него ведут пустые плашки витрины («Собираем — добавьте первый номер»).
    <section className="suggest" id="predlozhit">
      <h2>Предложить номер</h2>
      <p className="page-sub">
        Знаете службу, которой здесь нет, или ещё один номер известной? Начните набирать
        название — если она уже есть, выберите её из подсказки. Номер появится после проверки.
      </p>
      {state === "done" ? (
        <>
          <p className="suggest-done">{DONE_TEXT}</p>
          <button type="button" className="share-revoke" onClick={reset}>
            предложить ещё
          </button>
        </>
      ) : (
        <form className="suggest-form" onSubmit={submit}>
          {picked ? (
            <div className="org-chip">
              <span>
                <b>{picked.name}</b> · {CATEGORY_LABELS[picked.category]}
              </span>
              <span className="share-meta">
                уже в справочнике{picked.phones.length > 0 && `: ${picked.phones.join(", ")}`}
              </span>
              <button type="button" className="share-revoke" onClick={() => setPicked(null)}>
                другая организация
              </button>
            </div>
          ) : (
            <>
              <OrgPicker
                value={name}
                onChange={setName}
                onPick={(org) => {
                  if (org) setPicked(org);
                }}
                category={category}
              />
              <label>
                Категория
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <fieldset className="phone-set">
            <legend>{picked ? "Новый номер этой организации" : "Телефон"}</legend>
            {phones.map((p, i) => (
              <div key={i} className="phone-row">
                <input
                  value={p}
                  onChange={(e) =>
                    setPhones((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  inputMode="tel"
                  maxLength={30}
                  required={i === 0}
                  placeholder="+7 912 000-00-00"
                  aria-label={`Телефон ${i + 1}`}
                />
                {phones.length > 1 && (
                  <button
                    type="button"
                    className="share-revoke"
                    onClick={() => setPhones((ps) => ps.filter((_, j) => j !== i))}
                  >
                    убрать
                  </button>
                )}
                {isKnown(p) && <span className="share-meta">этот номер у неё уже есть</span>}
              </div>
            ))}
            {phones.length < MAX_PHONES && (
              <button
                type="button"
                className="share-revoke"
                onClick={() => setPhones((ps) => [...ps, ""])}
              >
                + ещё номер
              </button>
            )}
          </fieldset>

          <label>
            Примечание (цены, направления — не обязательно)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="по городу от 100 ₽"
            />
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
