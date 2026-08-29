"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Hit } from "./MapView";

export default function AddressSearch({ onPick }: { onPick: (hit: Hit) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);
  const picked = useRef<string | null>(null);

  // Слишком короткий запрос просто ничего не показывает. Раньше здесь стоял
  // setHits([]) внутри эффекта — лишнее состояние там, где хватает вычисления.
  const tooShort = query.trim().length < 2;
  const visible = tooShort ? [] : hits;

  useEffect(() => {
    if (tooShort) return;
    // Выбор из списка подставляет название в поле. Без этой проверки подстановка
    // считалась бы новым вводом и список открывался бы снова поверх карты.
    if (query === picked.current) return;

    // Ввод не должен слать запрос на каждую букву: и лишняя нагрузка, и лишний
    // след. Предыдущий запрос отменяется, чтобы ответы не приходили не по порядку.
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = (await r.json()) as { hits: Hit[] };
        setHits(data.hits);
        setOpen(true);
      } catch {
        // Отменённый запрос — не ошибка, показывать нечего.
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query, tooShort]);

  function pick(hit: Hit) {
    picked.current = hit.label;
    onPick(hit);
    setQuery(hit.label);
    setOpen(false);
  }

  return (
    <div className="search">
      <label className="search-label" htmlFor={`${listId}-input`}>
        Куда едем
      </label>
      <input
        id={`${listId}-input`}
        className="search-input"
        type="search"
        autoComplete="off"
        placeholder="улица и дом — например, Ленина 12"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => visible.length > 0 && setOpen(true)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
      />
      {open && visible.length > 0 && (
        <ul className="search-hits" id={listId} role="listbox">
          {visible.map((hit) => (
            <li key={`${hit.kind}:${hit.label}:${hit.lat}:${hit.lon}`}>
              <button type="button" role="option" aria-selected="false" onClick={() => pick(hit)}>
                <span className="hit-label">{hit.label}</span>
                <span className="hit-kind">{hit.kind === "address" ? "адрес" : "улица"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !tooShort && visible.length === 0 && (
        <p className="search-empty">В Малмыже такого адреса нет</p>
      )}
    </div>
  );
}
