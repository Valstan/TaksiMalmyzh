import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";
import { headers } from "next/headers";
import type { Metadata } from "next";
import SuggestForm from "@/components/SuggestForm";
import PageHead from "@/components/PageHead";
import DirectoryList from "@/components/DirectoryList";
import {
  ROOT_SITE,
  WHOLE_SERVICE_FALLBACK,
  resolveScope,
  resolveSite,
  siteHref,
} from "@/lib/sites";
import { CATEGORY_LABELS, shelves } from "@/lib/shelves";
import { crowdReady, entryStats } from "@/lib/crowd-signals";
import { currentUser } from "@/lib/session";
import { marketReady, myClaims } from "@/lib/market";
import { ratingsReady, ratingStats } from "@/lib/ratings";
import { karmaReady, karmaStats } from "@/lib/karma";

// Страница ходит в базу — пререндерить её на сборке нельзя (в CI базы нет),
// а кэшировать надолго не нужно: правки супер-админа должны быть видны сразу.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const site = resolveSite((await headers()).get("host"));
  return {
    title: `Справочник номеров — ${site.metaTitle}`,
    description: site.tagline,
  };
}

export default async function NomeraPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const site = resolveSite((await headers()).get("host"));

  // `?scope=` — общий адрес полки: сюда ведут плашки витрины, и он же остаётся дверью
  // «покажи всё» (`scope=all`, `WHOLE_SERVICE_FALLBACK`). Разбор значений и поведение при
  // мусоре в адресе — `resolveScope` в `lib/sites.ts`.
  const scope = (await searchParams).scope;
  const categories = resolveScope(site, scope);
  const showAll = categories === null;

  // Заголовки категорий над секциями нужны, только когда категорий больше одной: над
  // единственной полкой «Магазины» заголовок «Магазины» не сообщает ничего сверх того,
  // что уже сказано строкой состояния.
  const showHeadings = categories === null || categories.length > 1;

  // Полка, выбранная скоупом, — она же категория по умолчанию в форме предложения. Без
  // этого человек, пришедший с пустой плашки «Магазины», предложил бы магазин в такси:
  // форма всегда открывалась на «Такси».
  const shelfHere = scope ? shelves().find((s) => s.key === scope.trim().toLowerCase()) : undefined;
  const defaultCategory =
    shelfHere?.categories.length === 1
      ? shelfHere.categories[0]
      : categories?.length === 1
        ? categories[0]
        : undefined;

  const payload = await getPayload({ config });
  // Access-правило коллекции само отдаёт анониму только опубликованное;
  // overrideAccess: false здесь — чтобы страница жила по тем же правилам,
  // что и весь остальной мир, а не в обход них.
  const { docs } = await payload.find({
    collection: "entries",
    overrideAccess: false,
    ...(categories ? { where: { category: { in: categories } } } : {}),
    limit: 500,
    sort: "name",
    depth: 0, // owner — id, не документ: посетителю чужой пользователь не отдаётся
  });
  // Агрегат сигналов — если схема уже есть; страница не зависит от миграции спринта 5.
  const stats = (await crowdReady()) ? await entryStats(docs.map((d) => d.id)) : undefined;
  // Кто смотрит (спринт 8): вошедшему — «Это мой бизнес» и состояние его заявок.
  const viewer = await currentUser();
  const claims = viewer && (await marketReady()) ? await myClaims(viewer.id) : undefined;
  const ratings = (await ratingsReady()) ? await ratingStats(docs.map((d) => d.id)) : undefined;
  const karma = (await karmaReady()) ? await karmaStats(docs.map((d) => d.id)) : undefined;

  return (
    <main className="page" id="main" tabIndex={-1}>
      <PageHead title="Справочник номеров" sub={site.tagline}>
        <Link href="/">← к карте</Link>
        {site.id !== ROOT_SITE.id && !showAll && (
          <a href={siteHref(site, ROOT_SITE, "/nomera", WHOLE_SERVICE_FALLBACK)}>
            Весь справочник города
          </a>
        )}
      </PageHead>

      <p className="page-sub">
        {categories === null
          ? "Весь справочник Малмыжа. "
          : `Полка: ${categories.map((c) => CATEGORY_LABELS[c]).join(", ")}. `}
        Нажмите на номер — телефон наберёт сам. Цены справочные, не оферта: уточняйте
        при звонке.
      </p>

      {docs.length === 0 && (
        <p className="page-sub">
          Пока пусто: номера появляются после проверки. Предложите свой — форма ниже.
        </p>
      )}

      <DirectoryList
        entries={docs}
        showHeadings={showHeadings}
        stats={stats}
        viewer={viewer}
        claims={claims}
        ratings={ratings}
        karma={karma}
      />

      <SuggestForm defaultCategory={defaultCategory} />

      <footer className="page-footer">
        <p>
          Заметили неверный номер или цену? Напишите об этом в форме выше — проверим и
          поправим.
        </p>
      </footer>
    </main>
  );
}
