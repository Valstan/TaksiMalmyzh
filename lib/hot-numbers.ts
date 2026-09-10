// «Быстрый набор» — 3–5 самых нужных номеров над плашками полок.
//
// Владелец описал это как «самые горячие телефоны высвечиваются в небольшом списке над
// плашками, ну типа рекламного баннера». Выглядит как баннер, устроен наоборот: **место
// здесь не покупается и не назначается руками**. Порядок считает эта функция, и он
// детерминирован — при одних и тех же данных и той же дате результат один и тот же.
//
// ⚠️ ГЛАВНАЯ ОПАСНОСТЬ ЭТОГО БЛОКА — замкнутый круг. Витрина показывает номер, тап по нему
// пишет краудсигнал, сигнал поднимает счётчик, счётчик держит номер в витрине. Такой список
// самоподдерживается: попавший в него остаётся навсегда, а владельцу нечем ответить
// бизнесу, спросившему «почему не я». Круг разрывается выбором величины: считаем не
// нажатия, а **подтверждённые дозвоны** (`answered`) — строку с `outcome = 1` ставит человек
// рукой, ответив «Да» на вопрос «дозвонились?», и одним тапом из витрины она не появляется.
//
// Второе следствие того же правила: пока в базе нет ни одного ответа «дозвонились», все
// записи равны, и порядок задаёт дневная ротация. Это честно и это ровно то, что нужно в
// первые дни жизни сайта: список есть, он меняется, и никто не «прописался» в нём просто
// потому, что попал туда первым.

import type { EntryCategory } from "./sites.ts";
import { phoneKey } from "./phone-key.ts";
import type { EntryReach } from "./crowd-signals.ts";
import type { EntryKarma } from "./karma.ts";

export const HOT_MIN = 3;
export const HOT_MAX = 5;

export type HotPhone = { id?: string | null; number: string };

export type HotCandidate = {
  id: number;
  name: string;
  category: EntryCategory;
  phones: HotPhone[];
};

export type HotFacts = {
  reach?: EntryReach;
  karma?: EntryKarma;
};

export type HotRow = {
  entryId: number;
  name: string;
  category: EntryCategory;
  phone: HotPhone;
};

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Детерминированная перемешка. Не `Math.random`: список обязан быть одинаковым у всех, кто
 * открыл сайт в один день, иначе два человека увидят разное и «почему у меня не так» станет
 * вопросом без ответа. Меняется раз в сутки — иначе первые попавшие прописались бы навсегда.
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Кого нельзя рекомендовать. Витрина — это рекомендация, и она обязана уметь молчать.
 * При нуле сигналов ни одно исключение не срабатывает: все счётчики нулевые.
 */
function excluded(c: HotCandidate, f: HotFacts): boolean {
  if (c.phones.length === 0) return true;
  const r = f.reach;
  // Больше половины устройств не дозвонилось — такой номер советовать нельзя.
  if (r && r.noAnswer >= 3 && r.noAnswer * 2 > r.answered + r.noAnswer) return true;
  const k = f.karma?.org;
  if (k && k.down - k.up >= 5) return true;
  return false;
}

/** Какой из номеров карточки показать: с лучшей кармой, при равенстве — первый. */
function bestPhone(c: HotCandidate, f: HotFacts): HotPhone {
  const karma = f.karma?.phones;
  if (!karma || karma.size === 0) return c.phones[0];
  let best = c.phones[0];
  let bestScore = -Infinity;
  for (const p of c.phones) {
    const k = karma.get(phoneKey(p.number));
    const score = k ? k.up - k.down : 0;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Порядок. Чистая функция: ни базы, ни `Date.now()` — всё время приходит в `now`, иначе
 * проверить её было бы нечем.
 *
 * Ключи лексикографически: ступень охвата ↓, качество ↓, дневная ротация ↑, id ↑. Ступени,
 * а не сырое число, потому что разница между 19 и 20 дозвонами не значит ничего, а между 2
 * и 20 значит всё; внутри ступени решает качество, а при равном качестве — ротация.
 */
export function rankHot(
  candidates: HotCandidate[],
  facts: Map<number, HotFacts>,
  now: Date,
  limit: number = HOT_MAX,
): HotRow[] {
  const day = utcDay(now);

  const scored = candidates
    .map((c) => ({ c, f: facts.get(c.id) ?? {} }))
    .filter(({ c, f }) => !excluded(c, f))
    .map(({ c, f }) => {
      const a = f.reach?.answered ?? 0;
      const band = a >= 20 ? 3 : a >= 8 ? 2 : a >= 3 ? 1 : 0;
      const k = f.karma?.org;
      const quality = clamp(
        (f.reach ? f.reach.answered - 2 * f.reach.noAnswer : 0) + (k ? k.up - k.down : 0),
        -20,
        20,
      );
      return { c, f, band, quality, rot: hash32(`${day}:${c.id}`) };
    });

  scored.sort(
    (x, y) =>
      y.band - x.band || y.quality - x.quality || x.rot - y.rot || x.c.id - y.c.id,
  );

  return scored.slice(0, limit).map(({ c, f }) => ({
    entryId: c.id,
    name: c.name,
    category: c.category,
    phone: bestPhone(c, f),
  }));
}

/**
 * Подпись под блоком. Она обязана говорить, ПО ЧЕМУ список собран, — иначе «типа рекламный
 * баннер» человек и прочитает как рекламу, то есть как проданное место.
 *
 * Две правды, а не одна на все случаи: пока подтверждённых дозвонов нет, список честно
 * называется случайной выборкой из справочника, и обещать «самые нужные» было бы враньём.
 */
export function hotCaption(hasSignals: boolean): string {
  return hasSignals
    ? "Чаще всего дозваниваются за последний месяц. Место здесь не покупается: порядок считает сайт по вашим же отметкам «дозвонились»."
    : "Пока просто из справочника — по мере ваших отметок «дозвонились» список начнёт меняться. Место здесь не покупается.";
}

/** Собрать блок: кандидатов даёт страница, агрегаты — база, порядок — `rankHot`. */
export async function hotNumbers(
  candidates: HotCandidate[],
  now: Date,
): Promise<{ rows: HotRow[]; hasSignals: boolean }> {
  if (candidates.length < HOT_MIN) return { rows: [], hasSignals: false };

  const ids = candidates.map((c) => c.id);
  const facts = new Map<number, HotFacts>();
  let hasSignals = false;

  // Три источника под своими гейтами готовности: чего нет — того просто нет, блок от этого
  // не исчезает. Тот же приём, что у карточек справочника.
  const [{ crowdReady, entryReach }, { karmaReady, karmaStats }] = await Promise.all([
    import("./crowd-signals.ts"),
    import("./karma.ts"),
  ]);

  if (await crowdReady()) {
    for (const [id, reach] of await entryReach(ids, now)) {
      facts.set(id, { ...facts.get(id), reach });
      if (reach.answered > 0) hasSignals = true;
    }
  }
  if (await karmaReady()) {
    for (const [id, karma] of await karmaStats(ids)) {
      facts.set(id, { ...facts.get(id), karma });
    }
  }

  return { rows: rankHot(candidates, facts, now), hasSignals };
}
