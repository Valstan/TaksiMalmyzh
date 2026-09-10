import { headers } from "next/headers";
import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";
import HomeMap from "@/components/HomeMap";
import PageHead from "@/components/PageHead";
import DirectoryList from "@/components/DirectoryList";
import ServiceTiles from "@/components/ServiceTiles";
import HotNumbers from "@/components/HotNumbers";
import { hotCaption, hotNumbers, type HotCandidate } from "@/lib/hot-numbers";
import { shelfCounts, shelves } from "@/lib/shelves";
import {
  ROOT_SITE,
  WHOLE_SERVICE_FALLBACK,
  resolveSite,
  siteCategories,
  siteHref,
} from "@/lib/sites";
import { crowdReady, entryStats } from "@/lib/crowd-signals";
import { currentUser } from "@/lib/session";
import { marketReady, myClaims } from "@/lib/market";
import { ratingsReady, ratingStats } from "@/lib/ratings";
import { karmaReady, karmaStats } from "@/lib/karma";
import { commentCounts, commentsReady } from "@/lib/comments";

// Главная зависит от домена (матрёшка, `lib/sites.ts`) и ходит в базу — пререндерить
// нельзя ни то, ни другое.
//
// ⚠️ С 2026-09-10 в базу ходит и КОРЕНЬ, чего раньше не было: витрине полок нужны
// счётчики номеров. Полного списка номеров на корне по-прежнему нет.
export const dynamic = "force-dynamic";

export default async function Home() {
  const site = resolveSite((await headers()).get("host"));
  const categories = siteCategories(site);
  const isChild = site.id !== ROOT_SITE.id;

  // Витрина полок города — решение владельца 2026-09-10. Считается на обоих лицах, но
  // ставится в разные места: см. комментарий у блоков ниже.
  const shelfList = shelves();
  const counts = await shelfCounts(shelfList);

  // Записи читаются ОДИН раз и на обе нужды: список на категорийном домене и кандидаты в
  // быстрый набор. Раньше корень в базу не ходил вовсе, теперь ходит — но одним запросом,
  // а не двумя.
  //
  // Гейт публикации живёт в access-правиле коллекции; `overrideAccess: false` — чтобы
  // страница ходила по тем же правилам, что и весь мир. Условия «опубликовано» в SQL
  // агрегатов ниже нет и быть не должно: это была бы вторая копия гейта.
  const payload = await getPayload({ config });
  const { docs: entries } = await payload.find({
    collection: "entries",
    overrideAccess: false,
    ...(categories ? { where: { category: { in: categories } } } : {}),
    limit: 300,
    sort: "name",
    depth: 0, // owner — id, не документ: посетителю чужой пользователь не отдаётся
  });

  const candidates: HotCandidate[] = entries.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    phones: (d.phones ?? []).map((ph) => ({ id: ph.id, number: ph.number })),
  }));
  const hot = await hotNumbers(candidates, new Date());
  // ⚠️ Агрегаты карточек нужны только там, где карточки рисуются, — то есть на
  // категорийном домене. Корень записи читает (для быстрого набора), но списка не
  // показывает, и спрашивать под него сигналы, рейтинги, карму, заявки и комментарии было
  // бы пятью запросами в никуда. Гейт — `categories`, а не `entries.length`: до 2026-09-10
  // это было одно и то же, а теперь нет.
  const forCards = categories ? entries.map((e) => e.id) : [];
  const stats = forCards.length && (await crowdReady()) ? await entryStats(forCards) : undefined;
  const viewer = forCards.length ? await currentUser() : null;
  const claims = viewer && (await marketReady()) ? await myClaims(viewer.id) : undefined;
  const ratings = forCards.length && (await ratingsReady()) ? await ratingStats(forCards) : undefined;
  // Карма и комментарии — свой гейт готовности, как у сигналов и рейтингов: страница не
  // должна зависеть от того, доехала ли миграция.
  const karma = forCards.length && (await karmaReady()) ? await karmaStats(forCards) : undefined;
  const comments =
    forCards.length && (await commentsReady()) ? await commentCounts(entries) : undefined;

  return (
    <main className="page" id="main" tabIndex={-1}>
      <PageHead title={site.title} sub={site.tagline}>
        <Link href="/nomera">Справочник номеров</Link>
        {isChild && (
          <a href={siteHref(site, ROOT_SITE, "/nomera", WHOLE_SERVICE_FALLBACK)}>
            Весь справочник города
          </a>
        )}
      </PageHead>

      {/* Быстрый набор — над плашками на обоих лицах: это самое короткое, что сайт может
          дать человеку, пришедшему позвонить. */}
      <HotNumbers rows={hot.rows} caption={hotCaption(hot.hasSignals)} />

      {/* ⚠️ На КОРНЕ витрина стоит сразу под шапкой и заменяет собой список номеров.
          Работа корня — не показать номера, а ответить «куда мне»: двести карточек над
          картой похоронили бы и карту, и смысл корня, а до любой полки отсюда один тап. */}
      {!categories && <ServiceTiles from={site} shelves={shelfList} counts={counts} />}

      {categories && (
        <>
          {entries.length > 0 ? (
            <DirectoryList
              entries={entries}
              showHeadings={categories.length > 1}
              stats={stats}
              viewer={viewer}
              claims={claims}
              ratings={ratings}
              karma={karma}
              comments={comments}
            />
          ) : (
            <p className="page-sub">
              Номера появляются в справочнике после проверки. Пока пусто —{" "}
              <Link href="/nomera">предложите свой</Link>.
            </p>
          )}
          <p className="page-sub">
            Цены справочные, не оферта: уточняйте при звонке.{" "}
            <Link href="/nomera">Весь раздел →</Link>
          </p>
        </>
      )}

      {/* ⚠️ А на КАТЕГОРИЙНОМ домене витрина стоит ПОСЛЕ номеров. Человек уже вошёл в
          дверь «такси» — сетка полок над списком вытолкнула бы телефон под сгиб и звала
          уйти оттуда, куда он только что пришёл. Соседние полки это выход, а выход ставят
          на выходе. Правило «главная категорийного домена начинается с номеров» записано
          в docs/DOMAINS.md §5 и этим PR не нарушается. */}
      {categories && (
        <ServiceTiles
          from={site}
          shelves={shelfList}
          counts={counts}
          title="Другие полки Малмыжа"
          exclude={site.id}
        />
      )}

      <HomeMap />

      <footer className="page-footer">
        <p>
          Картографические данные —{" "}
          <a href="https://openstreetmap.org/copyright" rel="noreferrer">
            © OpenStreetMap contributors
          </a>
          , лицензия{" "}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noreferrer">
            ODbL 1.0
          </a>
          . Поиск адреса работает по данным OpenStreetMap.
        </p>
      </footer>
    </main>
  );
}
