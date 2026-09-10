// Полки города — модель витрины на главной (решение владельца 2026-09-10).
//
// «Плашки сервисов такси, магазины, услуги и т.д.» — так это сформулировал владелец.
// Тонкость в том, что категорий справочника шесть, а доменов матрёшки четыре, и два из
// них ещё не заведены. Полка — это не категория и не домен, а ответ на вопрос человека
// «куда мне»: одна плашка может покрывать несколько категорий (у «Услуг» их три), а
// категория, которую не покрыл никто, обязана куда-то деться, иначе номера в ней станут
// недостижимы с витрины.
//
// Поэтому полки выводятся ИЗ РЕЕСТРА доменов, а не перечислены руками: заведут
// `бригадир.вмалмыже.рф` — полка появится сама, из одной записи в `lib/sites.ts`. А то,
// что не покрыл ни один домен, сваливается в остаточную полку «Разное».

import { CATEGORIES, SITES, siteHref, type EntryCategory, type Site } from "./sites.ts";
import { CATEGORY_LABELS } from "./category-labels.ts";

// Подписи категорий живут в `lib/category-labels.ts`: их читает и клиентская выпадашка
// подсказок, а этот модуль тянет Payload. Отсюда они реэкспортируются, чтобы серверным
// потребителям не менять импорт.
export { CATEGORY_LABELS };

/** Порядок полок и секций справочника. Источник один — реестр категорий. */
export const CATEGORY_ORDER: readonly EntryCategory[] = CATEGORIES;

/** Ключ остаточной полки в адресе `?scope=`. */
export const REST_SHELF = "other";

export interface Shelf {
  /** Значение `?scope=`: id категорийного сайта либо имя категории для остатка. */
  key: string;
  title: string;
  /** Одна строка под названием: без неё «Услуги» ничего не значат. */
  hint: string;
  categories: EntryCategory[];
  /** Домен полки, если он есть в реестре. У остаточной полки домена нет и не будет. */
  site: Site | null;
}

/**
 * Полки города. Постоянные — по одной на категорийный домен реестра (включая ещё не
 * заведённые: полка существует, ссылка просто ведёт внутрь текущего домена). Последняя —
 * остаточная, из категорий, которые не покрыл никто.
 */
export function shelves(): Shelf[] {
  const byDomain = SITES.filter((s) => s.kind === "category" && s.categories?.length).map(
    (s): Shelf => ({
      key: s.id,
      title: shelfTitle(s),
      hint: s.categories!.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(", "),
      categories: s.categories!,
      site: s,
    }),
  );

  const covered = new Set(byDomain.flatMap((s) => s.categories));
  const rest = CATEGORIES.filter((c) => !covered.has(c));

  return rest.length === 0
    ? byDomain
    : [
        ...byDomain,
        {
          key: REST_SHELF,
          title: "Разное",
          hint: rest.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(", "),
          categories: [...rest],
          site: null,
        },
      ];
}

/** Заголовок полки: короткая метка домена в нижнем регистре с большой буквы. */
function shelfTitle(s: Site): string {
  const short = s.short ?? s.title;
  return short.charAt(0) + short.slice(1).toLowerCase();
}

/**
 * Куда ведёт плашка.
 *
 * Пустая полка ведёт **к форме предложения**, а не на витрину своего домена, даже если
 * домен живой: пустая полка по красивому адресу учит не возвращаться, а пустая полка,
 * которая просит номер, — вербует. Полка с номерами ведёт на свой домен, если он заведён,
 * и внутрь текущего, пока нет: ссылка на несуществующий поддомен это ошибка DNS у человека
 * в браузере, а не «пока не доехало».
 */
export function shelfHref(from: Site, shelf: Shelf, count: number): string {
  if (count === 0) return `/nomera?scope=${shelf.key}#predlozhit`;
  if (!shelf.site) return `/nomera?scope=${shelf.key}`;
  return siteHref(from, shelf.site, "/", `/nomera?scope=${shelf.key}`);
}

/**
 * Подпись под названием полки. Счётчик — единственное на витрине, что говорит правду о
 * размере полки ДО тапа: человек, тапнувший «Магазины» и увидевший два номера, второй
 * раз не тапнет ничего.
 *
 * ⚠️ Потолок 500 — не украшение: справочник на странице показывается срезом в 500 записей,
 * и обещать «12 номеров, все внутри» можно только до этой границы.
 */
export function shelfCount(count: number): string {
  if (count === 0) return "Собираем — добавьте первый номер";
  if (count > 500) return "500+ номеров";
  const tail = count % 100 >= 11 && count % 100 <= 14 ? 2 : [2, 0, 1, 1, 1, 2][Math.min(count % 10, 5)];
  return `${count} ${["номер", "номера", "номеров"][tail]}`;
}

// Полки обязаны покрывать все категории: номер в непокрытой категории не был бы виден с
// витрины вообще. Проверяется на импорте — сборка падает на месте, а не витрина у человека.
(function assertShelves() {
  const covered = new Set(shelves().flatMap((s) => s.categories));
  const missing = CATEGORIES.filter((c) => !covered.has(c));
  if (missing.length > 0) {
    throw new Error(`shelves: категории вне полок: ${missing.join(", ")}`);
  }
  for (const c of CATEGORIES) {
    if (!CATEGORY_LABELS[c]) throw new Error(`shelves: у категории ${c} нет подписи`);
  }
})();

/**
 * Сколько опубликованных номеров на каждой полке.
 *
 * Считается теми же access-правилами, что и содержимое полки (`overrideAccess: false`), —
 * значит расхождения «на плашке 12, внутри 7» быть не может: второй копии условия
 * «опубликовано» в проекте не появляется. Payload импортируется динамически, чтобы модуль
 * оставался пригодным там, где базы нет.
 */
export async function shelfCounts(list: Shelf[] = shelves()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
    await Promise.all(
      list.map(async (shelf) => {
        const { totalDocs } = await payload.count({
          collection: "entries",
          overrideAccess: false,
          where: { category: { in: shelf.categories } },
        });
        out.set(shelf.key, totalDocs);
      }),
    );
  } catch {
    // База недоступна — витрина рисуется без счётчиков, а не падает вместе со страницей.
  }
  return out;
}
