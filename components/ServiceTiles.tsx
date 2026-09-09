import Link from "next/link";
import { shelfCount, shelfHref, type Shelf } from "@/lib/shelves";
import type { Site } from "@/lib/sites";

// Плашки полок города (решение владельца 2026-09-10): «под шапкой сайта находятся плашки
// сервисов такси, магазины, услуги и т.д.».
//
// Один компонент на оба случая, а не две разметки: на корне это витрина «куда мне», на
// категорийном домене — выход к соседним полкам, поставленный после списка номеров. Любая
// развилка «а как это выглядит на такси-сайте» немедленно стала бы двумя расходящимися
// копиями — тот самый класс #087, о котором предупреждает шапка `lib/sites.ts`.

export default function ServiceTiles({
  from,
  shelves,
  counts,
  title,
  exclude,
}: {
  from: Site;
  shelves: Shelf[];
  /** Число опубликованных номеров на полке, по ключу полки. */
  counts: Map<string, number>;
  title?: string;
  /** Не показывать полку своего домена: плашка «сюда же» бесполезна. */
  exclude?: string;
}) {
  const list = shelves.filter((s) => {
    if (exclude && s.site?.id === exclude) return false;
    // Пустые полки показываем — они вербуют. Кроме остаточной: звать людей нести номера
    // в «Разное» бессмысленно, у этой полки нет собственного смысла, только остаток.
    if ((counts.get(s.key) ?? 0) === 0 && s.site === null) return false;
    return true;
  });

  if (list.length === 0) return null;

  return (
    <section className="tiles-wrap" aria-label={title ?? "Полки города"}>
      {title && <h2 className="tiles-title">{title}</h2>}
      <ul className="tiles">
        {list.map((shelf) => {
          const count = counts.get(shelf.key) ?? 0;
          const href = shelfHref(from, shelf, count);
          const className = count === 0 ? "tile tile-empty" : "tile";
          const inner = (
            <>
              <span className="tile-name">{shelf.title}</span>
              <span className="tile-hint">{shelf.hint}</span>
              <span className="tile-count">{shelfCount(count)}</span>
            </>
          );
          return (
            <li key={shelf.key}>
              {/* Полка живого соседнего домена — чужой хост: нужна полная навигация, а не
                  клиентский переход внутри этого приложения. */}
              {href.startsWith("https://") ? (
                <a className={className} href={href}>
                  {inner}
                </a>
              ) : (
                <Link className={className} href={href}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
