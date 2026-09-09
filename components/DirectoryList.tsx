import type { Entry } from "@/payload-types";
import type { EntryCategory } from "@/lib/sites";
// Подписи и порядок категорий живут в модели полок: их читает и витрина плашек, и этот
// список, и второй экземпляр разъехался бы с первым при первой же правке (класс #087).
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/shelves";
import { statsLine, type EntryStats } from "@/lib/crowd-signals";
import CallPhones from "@/components/CallPhones";
import EntryActions from "@/components/EntryActions";
import RateWidget from "@/components/RateWidget";
import KarmaVote from "@/components/KarmaVote";
import { ratingLine, type RatingStats } from "@/lib/ratings";
import { ORG_KEY } from "@/lib/phone-key";
import type { EntryKarma, KarmaCount } from "@/lib/karma";

export type Viewer = { id: number; role: string } | null;

// Отрисовка справочника, общая для страницы `/nomera` и для главной
// категорийного домена. Вынесено сюда не ради красоты: на такси-домене список
// номеров — это и есть главная, и второй экземпляр той же разметки разошёлся бы
// с первым при первой же правке (класс #087).

function EntryCard({
  entry, stats, viewer, claimed, rating, karma,
}: {
  entry: Entry; stats?: EntryStats; viewer: Viewer; claimed: number | null;
  rating?: RatingStats; karma?: EntryKarma;
}) {
  const line = statsLine(stats);
  const stars = ratingLine(rating);
  const ownerId = typeof entry.owner === "object" && entry.owner ? entry.owner.id : entry.owner;
  return (
    <li className="dir-card">
      <div className="dir-name">
        {entry.name}
        {stars && <span className="dir-rating"> {stars}</span>}
      </div>
      {entry.hours && <div className="dir-hours">{entry.hours}</div>}
      {/* Телефоны — клиентский компонент: после звонка спрашивает «дозвонились?» (спринт 5),
          и у каждого номера своя карма (решение владельца 2026-09-10). Map разворачивается
          в обычный объект: границу сервер→клиент так переезжать дешевле. */}
      <CallPhones
        entryId={entry.id}
        phones={entry.phones ?? []}
        karma={karma ? Object.fromEntries(karma.phones) : undefined}
      />
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
      {rating && rating.workers.length > 0 && (
        <p className="dir-workers">
          {rating.workers.map((w) => (
            <span key={w.id}>{w.name}{w.count > 0 && ` ★ ${w.avg.toFixed(1).replace(".", ",")}`}</span>
          ))}
        </p>
      )}
      {/* Две шкалы на одной карточке — поэтому у обеих подписи. Карма (±) отвечает на
          вопрос «стоит ли звонить», её ставят все и всем; звёзды (1–5) — «как возят», и
          они остаются только у карточек с кабинетом, потому что оценку получает тот, кому
          есть чем ответить (docs/RATINGS.md). Без подписей человек не понимает, что у него
          спрашивают дважды. */}
      <KarmaVote entryId={entry.id} count={karma?.org} label="Вся служба:" />
      {ownerId && <RateWidget entryId={entry.id} workers={rating?.workers ?? []} />}
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
  ratings,
  karma,
}: {
  entries: Entry[];
  showHeadings?: boolean;
  /** Краудсигналы за месяц по id записи (спринт 5); без них строка агрегата не рисуется. */
  stats?: Map<number, EntryStats>;
  /** Кто смотрит (спринт 8): для «Это мой бизнес». */
  viewer?: Viewer;
  /** Заявки этого посетителя по id записи → статус. */
  claims?: Map<number, number>;
  /** Рейтинги (спринт 9) по id записи. */
  ratings?: Map<number, RatingStats>;
  /** Карма (решение владельца 2026-09-10) по id записи. */
  karma?: Map<number, EntryKarma>;
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
                  rating={ratings?.get(entry.id)}
                  karma={karma?.get(entry.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
