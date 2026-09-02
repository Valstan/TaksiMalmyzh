import type { Entry } from "@/payload-types";
import type { EntryCategory } from "@/lib/sites";
import { statsLine, type EntryStats } from "@/lib/crowd-signals";
import CallPhones from "@/components/CallPhones";
import EntryActions from "@/components/EntryActions";

export type Viewer = { id: number; role: string } | null;

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

function EntryCard({
  entry, stats, viewer, claimed,
}: { entry: Entry; stats?: EntryStats; viewer: Viewer; claimed: number | null }) {
  const line = statsLine(stats);
  const ownerId = typeof entry.owner === "object" && entry.owner ? entry.owner.id : entry.owner;
  return (
    <li className="dir-card">
      <div className="dir-name">{entry.name}</div>
      {entry.hours && <div className="dir-hours">{entry.hours}</div>}
      {/* Телефоны — клиентский компонент: после звонка спрашивает «дозвонились?» (спринт 5). */}
      <CallPhones entryId={entry.id} phones={entry.phones ?? []} />
      {line && <p className="dir-stats">{line}</p>}
      {entry.prices && entry.prices.length > 0 && (
        <ul className="dir-prices">
          {entry.prices.map((price) => (
            <li key={price.id}>
              {price.label}: <b>{price.value}</b>
            </li>
          ))}
        </ul>
      )}
      {entry.description && <p className="dir-note">{entry.description}</p>}
      {entry.note && <p className="dir-note">{entry.note}</p>}
      <EntryActions entryId={entry.id} hasOwner={Boolean(ownerId)} viewer={viewer} claimed={claimed} />
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
  stats,
  viewer,
  claims,
}: {
  entries: Entry[];
  showHeadings?: boolean;
  /** Краудсигналы за месяц по id записи (спринт 5); без них строка агрегата не рисуется. */
  stats?: Map<number, EntryStats>;
  /** Кто смотрит (спринт 8): для «Это мой бизнес». */
  viewer?: Viewer;
  /** Заявки этого посетителя по id записи → статус. */
  claims?: Map<number, number>;
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
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  stats={stats?.get(entry.id)}
                  viewer={viewer ?? null}
                  claimed={claims?.get(entry.id) ?? null}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
