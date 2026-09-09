import { headers } from "next/headers";
import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";
import HomeMap from "@/components/HomeMap";
import PageHead from "@/components/PageHead";
import DirectoryList from "@/components/DirectoryList";
import ServiceTiles from "@/components/ServiceTiles";
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

  // На категорийном домене номера — это и есть продукт: человек пришёл на
  // `такси.вмалмыже.рф` за телефоном такси, а не за картой. Карта остаётся
  // ниже, потому что адрес всё равно приходится называть в трубку.
  const entries = categories
    ? (
        await (
          await getPayload({ config })
        ).find({
          collection: "entries",
          // Гейт публикации живёт в access-правиле коллекции; `overrideAccess:
          // false` — чтобы страница ходила по тем же правилам, что и весь мир.
          overrideAccess: false,
          where: { category: { in: categories } },
          limit: 200,
          sort: "name",
          depth: 0,
        })
      ).docs
    : [];
  const stats = entries.length && (await crowdReady()) ? await entryStats(entries.map((e) => e.id)) : undefined;
  const viewer = entries.length ? await currentUser() : null;
  const claims = viewer && (await marketReady()) ? await myClaims(viewer.id) : undefined;
  const ratings = entries.length && (await ratingsReady()) ? await ratingStats(entries.map((e) => e.id)) : undefined;

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

      {/* ⚠️ На КОРНЕ витрина стоит сразу под шапкой и заменяет собой список номеров.
          Работа корня — не показать номера, а ответить «куда мне»: двести карточек над
          картой похоронили бы и карту, и смысл корня, а до любой полки отсюда один тап. */}
      {!categories && <ServiceTiles from={site} shelves={shelfList} counts={counts} />}

      {categories && (
        <>
          {entries.length > 0 ? (
            <DirectoryList entries={entries} showHeadings={categories.length > 1} stats={stats} viewer={viewer} claims={claims} ratings={ratings} />
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
