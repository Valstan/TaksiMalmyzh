// Поиск организации по названию — для подсказок в форме «предложить номер» (решение
// владельца 2026-09-10: «начинаешь набивать и если есть похожие — в выпадашке подсказки»).
//
// Модуль чистый: ни базы, ни сети, ни времени. Корпус приходит аргументом, поэтому
// поведение проверяется утверждениями в scripts/check-track.mjs без Postgres.
//
// Почему в JS, а не `pg_trgm` в базе. Не из-за сложности запроса: сырой SELECT по
// public.entries прошёл бы МИМО access-правила Payload, и гейт публикации пришлось бы
// переписать руками внутри SQL — вторая копия правила ровно там, где она опаснее всего.
// Корпус же мал: десятки записей, в пределе сотни. Прецедент — lib/addresses.ts, где
// линейный проход по двум тысячам адресов отвечает за доли миллисекунды.
//
// ПРИНЦИП ПОРОГА — мягкость. Ложноположительная подсказка ничего не стоит: человек
// посмотрел и не выбрал. Ложноотрицательная стоит дубля в справочнике и работы персонала.
// Поэтому порог низкий, а строка «нет в списке — это новая организация» видна всегда.

import type { EntryCategory } from "./sites.ts";

export type OrgRow = { id: number; name: string; category: EntryCategory; phones: string[] };
export type OrgHit = OrgRow & { score: number };

export const ORG_HITS_MAX = 8;
const THRESHOLD = 0.45;
const CATEGORY_BONUS = 0.15;

// Раскладка QWERTY → ЙЦУКЕН: «Cnhtkf» → «стрела». Ровно 32 клавиши; для «ё» клавиши в
// этой таблице нет, и это не страшно — «ё» и так схлопывается в «е».
const LAT = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const CYR = "йцукенгшщзхъфывапролджэячсмитьбю";

/**
 * Перевод набранного не в той раскладке. Работает по СЫРОЙ строке и обязан идти ДО
 * нормализации: та заменяет `[ ; ' , .` пробелами — ровно те клавиши, ради которых таблица
 * и заведена («ьфпфяшт» набирают как «vfufpby», а «ж» — это `;`).
 */
export function fromLatinLayout(raw: string): string {
  let out = "";
  for (const ch of raw.toLowerCase()) {
    const i = LAT.indexOf(ch);
    out += i >= 0 ? CYR[i] : ch;
  }
  return out;
}

/** Широкая нормализация — только для ранжирования подсказок, где выбирает глаз человека. */
export function normalizeOrg(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

/**
 * Узкий ключ ДЕДУПЛИКАЦИИ: регистр, «ё», кавычки, пробелы — и больше ничего.
 *
 * ⚠️ Он намеренно уже, чем `normalizeOrg`. Сервер по нему сливает предложения молча, без
 * человека, и потому не имеет права на широкую нормализацию: сними он родовые слова, «Такси
 * „Стрела“» и «Стрела» (скажем, магазин) дали бы один ключ, и номер магазина уехал бы в
 * такси. Широкое сравнение живёт только в подсказке — там решает человек.
 */
export function nameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`„“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Родовые слова снимаются, только если после них что-то остаётся: «такси» само по себе —
// законный запрос, и отвечать на него пустотой нельзя.
const GENERIC = new Set([
  "такси", "магазин", "магазины", "служба", "ип", "ооо", "кафе", "аптека", "салон", "сервис",
]);

function words(s: string): string[] {
  const all = normalizeOrg(s).split(" ").filter(Boolean);
  const meaningful = all.filter((w) => !GENERIC.has(w));
  return meaningful.length > 0 ? meaningful : all;
}

function trigrams(w: string): Set<string> {
  const p = `  ${w} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i += 1) out.add(p.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common += 1;
  return (2 * common) / (a.size + b.size);
}

/** Расстояние с перестановкой соседних букв («стрлеа» от «стрела» — один шаг, а не два). */
function damerau(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Насколько токен запроса похож на лучшее из слов названия. Две метрики, а не одна, и это
 * посчитано, а не угадано: триграммы проваливают перестановку в коротком слове («стрлеа»
 * против «стрела» — Dice 0,43, ниже порога), а расстояние ловит её одним шагом; обратно,
 * «стрелла» по триграммам 0,8, а расстояние там уже ни при чём.
 */
function tokenScore(t: string, nameWords: string[]): number {
  let best = 0;
  const tt = trigrams(t);
  for (const w of nameWords) {
    let s = 0;
    if (w.startsWith(t)) s = 1;
    else if (w.includes(t)) s = 0.75;
    else if (t.length >= 4) {
      const d = dice(tt, trigrams(w));
      if (d >= THRESHOLD) s = d;
      else if (damerau(t, w) <= (t.length <= 5 ? 1 : 2)) s = 0.55;
    }
    if (s > best) best = s;
  }
  return best;
}

function nameScore(query: string, name: string): number {
  const q = words(query);
  // ⚠️ Запрос из одних родовых слов («такси») сравнивается с ПОЛНЫМ названием. Иначе у
  // «Такси „Стрела“» слово «такси» снято как родовое, и на законный запрос «такси» пришла
  // бы пустота — ровно та тихая пустота, от которой подсказки и заведены.
  const genericOnly = normalizeOrg(query).split(" ").filter(Boolean).every((w) => GENERIC.has(w));
  const n = genericOnly ? normalizeOrg(name).split(" ").filter(Boolean) : words(name);
  if (q.length === 0 || n.length === 0) return 0;
  const byWords = q.reduce((sum, t) => sum + tokenScore(t, n), 0) / q.length;
  // Склеенное сравнение закрывает «Автостоп» против «Авто стоп» — три строки кода.
  const glued = tokenScore(q.join(""), [n.join("")]);
  return Math.max(byWords, glued);
}

/** Есть ли в запросе латиница — тогда пробуем и перевод раскладки. */
const hasLatin = (s: string) => /[a-z]/i.test(s);

/**
 * Подсказки по запросу. Категория — не фильтр, а бонус к порядку: человек выбрал
 * «Магазины», а «Стрела» заведена в «Такси» — жёсткий фильтр её спрятал бы, и человек завёл
 * бы вторую «Стрелу». Именно так рождаются дубли.
 *
 * Чего НЕ ловит, честно: опечатку в слове из трёх букв и короче (триграмм слишком мало, а
 * мягкое расстояние дало бы шум); фонетическую латиницу («Strela» — это транслит, а не
 * раскладка); две ошибки в слове из четырёх-пяти букв; другое название той же организации.
 * По номеру телефона не ищет вовсе и специально: иначе эндпоинт стал бы способом проверять,
 * есть ли произвольный номер в справочнике.
 */
export function searchOrgs(
  rows: OrgRow[],
  query: string,
  category?: EntryCategory,
  limit: number = ORG_HITS_MAX,
): OrgHit[] {
  if (normalizeOrg(query).length < 2) return [];
  const variants = hasLatin(query) ? [query, fromLatinLayout(query)] : [query];

  const hits: OrgHit[] = [];
  for (const row of rows) {
    const base = Math.max(...variants.map((v) => nameScore(v, row.name)));
    if (base < THRESHOLD) continue;
    hits.push({ ...row, score: base + (category && row.category === category ? CATEGORY_BONUS : 0) });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      // живая карточка выше пустой
      b.phones.length - a.phones.length ||
      a.name.localeCompare(b.name, "ru"),
  );
  return hits.slice(0, limit);
}
