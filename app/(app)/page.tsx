import { headers } from "next/headers";
import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";
import HomeMap from "@/components/HomeMap";
import SiteHeader from "@/components/SiteHeader";
import DirectoryList from "@/components/DirectoryList";
import { resolveSite, siteCategories } from "@/lib/sites";
import { crowdReady, entryStats } from "@/lib/crowd-signals";

// Главная зависит от домена (матрёшка, `lib/sites.ts`) и на категорийных
// доменах ходит в базу — пререндерить нельзя ни то, ни другое.
export const dynamic = "force-dynamic";

export default async function Home() {
  const site = resolveSite((await headers()).get("host"));
  const categories = siteCategories(site);

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
        })
      ).docs
    : [];
  const stats = entries.length && (await crowdReady()) ? await entryStats(entries.map((e) => e.id)) : undefined;

  return (
    <main className="page">
      <SiteHeader site={site} page="home" />

      {categories && (
        <>
          {entries.length > 0 ? (
            <DirectoryList entries={entries} showHeadings={categories.length > 1} stats={stats} />
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
