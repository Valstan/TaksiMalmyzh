// Простой рейт-лимит в памяти процесса: окно на ключ.
//
// Адресов посетителей у приложения нет намеренно (nginx их не передаёт, M0.A §3.6),
// поэтому ключ — не клиент, а ресурс: ссылка поездки, поездка. Этого достаточно против
// превью-ботов и перебора; против распределённой атаки на один ресурс — нет, и это
// принято: цена ошибки здесь — лишний запрос к базе, а не утечка.

const hits = new Map<string, { at: number; n: number }>();

export function limited(key: string, maxPerWindow: number, windowMs = 60_000, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || now - h.at > windowMs) {
    hits.set(key, { at: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > maxPerWindow;
}
