import type { Entry } from "@/payload-types";
import type { EntryCategory } from "@/lib/sites";

// Отрисовка справочника, общая для страницы `/nomera` и для главной
// категорийного домена. Вынесено сюда не ради красоты: на такси-домене список
// номеров — это и есть главная, и второй экземпляр той же разметки разошёлся бы
// с первым при первой же правке (класс #087).

export const CATEGORY_LABELS: Record<EntryCategory, string> = {
  taxi: "Такси",
  shop: "Магазины",
  master: "Мастера и ремонт",
  brigade: "Бригады и работы",
  cargo: "Доставка и грузы",
  other: "Другое",
};

/** Порядок полок на странице. Он же — порядок ключей объекта выше. */
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as EntryCategory[];

// Телефон в `tel:` — только цифры и плюс. Пробелы и скобки из аккуратно
// записанного номера часть звонилок понимает, часть молча не набирает.
function telHref(raw: string): string {
  return "tel:" + raw.replace(/[^\d+]/g, "");
}

function EntryCard({ entry }: { entry: Entry }) {
  return (
    <li className="dir-card">
      <div className="dir-name">{entry.name}</div>
      <div className="dir-phones">
        {(entry.phones ?? []).map((p) => (
          <a key={p.id} className="dir-phone" href={telHref(p.number)}>
            {p.number}
          </a>
        ))}
      </div>
      {entry.prices && entry.prices.length > 0 && (
        <ul className="dir-prices">
          {entry.prices.map((price) => (
            <li key={price.id}>
              {price.label}: <b>{price.value}</b>
            </li>
          ))}
        </ul>
      )}
      {entry.note && <p className="dir-note">{entry.note}</p>}
    </li>
  );
}

/**
 * Список записей по полкам-категориям.
 *
 * `showHeadings: false` — когда домен и так про одну категорию: на
 * `такси.вмалмыже.рф` заголовок «Такси» над единственной полкой не сообщает
 * ничего сверх того, что уже написано в шапке.
 */
export default function DirectoryList({
  entries,
  showHeadings = true,
}: {
  entries: Entry[];
  showHeadings?: boolean;
}) {
  const byCategory = new Map<EntryCategory, Entry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  return (
    <>
      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory.get(cat);
        if (!list || list.length === 0) return null;
        return (
          <section key={cat} className="dir-section">
            {showHeadings && <h2>{CATEGORY_LABELS[cat]}</h2>}
            <ul className="dir-list">
              {list.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
