import CallPhones from "@/components/CallPhones";
import { CATEGORY_LABELS } from "@/lib/shelves";
import type { HotRow } from "@/lib/hot-numbers";

// «Быстрый набор» — небольшой список над плашками полок (решение владельца 2026-09-10:
// «самые горячие телефоны высвечиваются в небольшом списке над плашками, типа рекламного
// баннера»).
//
// Выглядит как баннер, устроен наоборот: место здесь не покупается и не назначается
// руками. Поэтому под блоком стоит строка, объясняющая, откуда взялся порядок, — без неё
// человек прочитает блок ровно как рекламу, то есть как проданное место, и перестанет
// верить остальному справочнику тоже.
//
// Номера — тот же `CallPhones`, что и в карточках: он и звонит, и спрашивает
// «дозвонились?», и несёт карму номера. Второй экземпляр этой логики разъехался бы с
// первым при первой же правке (класс #087).

export default function HotNumbers({
  rows,
  caption,
}: {
  rows: HotRow[];
  caption: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="hot" aria-label="Быстрый набор">
      <h2 className="hot-title">Быстрый набор</h2>
      <ul className="hot-list">
        {rows.map((r) => (
          <li key={r.entryId} className="hot-row">
            <span className="hot-name">
              {r.name}
              <span className="hot-cat">{CATEGORY_LABELS[r.category]}</span>
            </span>
            <CallPhones entryId={r.entryId} phones={[r.phone]} />
          </li>
        ))}
      </ul>
      <p className="hot-caption">{caption}</p>
    </section>
  );
}
