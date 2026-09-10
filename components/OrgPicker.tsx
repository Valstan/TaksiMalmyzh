"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/category-labels";
import type { EntryCategory } from "@/lib/sites";

// Поле «Организация» с подсказками — решение владельца 2026-09-10: «начинаешь набивать, и
// если есть похожие — в выпадашке подсказки, если такое такси уже есть».
//
// Приёмы — те же, что у `AddressSearch`: дебаунс 180 мс, отмена прежнего запроса, чтобы
// ответы не приходили не по порядку. Отличий три, и все про дубли:
//   • строка «нет в списке — это новая организация» видна ВСЕГДА, а не только когда список
//     пуст: подсказка мягкая, и среди похожих часто нет нужной;
//   • отказ сервера по лимиту назван вслух — тихая пустота здесь означала бы, что человек
//     не увидел «Стрелу» и завёл вторую;
//   • клавиатура по образцу WAI-ARIA combobox: стрелки, Enter, Esc; фокус не уходит из поля.

export type OrgHit = { id: number; name: string; category: EntryCategory; phones: string[] };

export default function OrgPicker({
  value,
  onChange,
  onPick,
  category,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Выбрана существующая организация — или `null`: «это новая». */
  onPick: (org: OrgHit | null) => void;
  /** Категория из формы: не фильтр, а бонус к порядку подсказок. */
  category?: string;
}) {
  const [hits, setHits] = useState<OrgHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [trouble, setTrouble] = useState<string | null>(null);
  /** Текст, для которого человек уже ответил «это новая»: список для него не всплывает. */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);

  const tooShort = value.trim().length < 2;
  const visible = tooShort ? [] : hits;
  const shown = open && !tooShort && dismissedFor !== value;
  const optionCount = visible.length + 1; // + «новая организация»

  useEffect(() => {
    if (tooShort) return;
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const qs = new URLSearchParams({ q: value });
        if (category) qs.set("category", category);
        const r = await fetch(`/api/orgs?${qs.toString()}`, { signal: controller.signal });
        const data = (await r.json()) as {
          hits?: OrgHit[];
          throttled?: boolean;
          unavailable?: boolean;
        };
        setHits(data.hits ?? []);
        setTrouble(
          !r.ok || data.throttled || data.unavailable
            ? "Подсказки сейчас недоступны — впишите название полностью, мы сверим сами."
            : null,
        );
        setActive(-1);
        setOpen(true);
      } catch {
        // Отменённый запрос — не ошибка, показывать нечего.
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [value, tooShort, category]);

  function choose(i: number) {
    if (i >= 0 && i < visible.length) {
      onPick(visible[i]);
      setOpen(false);
    } else {
      onPick(null);
      setDismissedFor(value);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!shown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % optionCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? optionCount - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      // Иначе Enter отправил бы форму, не дав выбрать подсказку.
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="search org-picker">
      <label className="search-label" htmlFor={`${listId}-input`}>
        Организация
      </label>
      <input
        id={`${listId}-input`}
        className="search-input"
        type="text"
        autoComplete="off"
        required
        minLength={2}
        maxLength={120}
        placeholder="начните набирать: «Стрела», «Ромашка»…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => visible.length > 0 && setOpen(true)}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
      />
      {shown && (
        <ul className="search-hits" id={listId} role="listbox" aria-label="Похожие организации">
          {visible.map((h, i) => (
            <li
              key={h.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? "org-opt is-active" : "org-opt"}
              // Нажатие не должно уводить фокус из поля: иначе список закроется раньше клика.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className="hit-label">{h.name}</span>
              <span className="hit-kind">
                {CATEGORY_LABELS[h.category]}
                {h.phones.length > 0 && ` · ${h.phones.length} ном.`}
              </span>
            </li>
          ))}
          <li
            id={optionId(visible.length)}
            role="option"
            aria-selected={active === visible.length}
            className={active === visible.length ? "org-opt org-new is-active" : "org-opt org-new"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(visible.length)}
          >
            {visible.length > 0
              ? "Нет в списке — это новая организация"
              : "Похожих нет — это новая организация"}
          </li>
        </ul>
      )}
      {trouble && <p className="search-empty">{trouble}</p>}
    </div>
  );
}
