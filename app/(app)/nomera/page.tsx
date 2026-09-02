import { getPayload } from "payload";
import config from "@payload-config";
import { headers } from "next/headers";
import type { Metadata } from "next";
import SuggestForm from "@/components/SuggestForm";
import SiteHeader from "@/components/SiteHeader";
import DirectoryList from "@/components/DirectoryList";
import { resolveSite, siteCategories } from "@/lib/sites";
import { crowdReady, entryStats } from "@/lib/crowd-signals";
import { currentUser } from "@/lib/session";
import { marketReady, myClaims } from "@/lib/market";

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

  // `?scope=all` — дверь из категорийного домена во весь справочник. Нужна,
  // пока `позвони.вмалмыже.рф` не заведён (`components/SiteHeader.tsx`), и
  // остаётся полезной после: «покажи всё» без ухода с домена.
  const showAll = (await searchParams).scope === "all";
  const categories = showAll ? null : siteCategories(site);

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

  return (
    <main className="page">
      <SiteHeader site={site} page="directory" />

      <p className="page-sub">
        Нажмите на номер — телефон наберёт сам. Цены справочные, не оферта: уточняйте
        при звонке.
      </p>

      {docs.length === 0 && (
        <p className="page-sub">
          Пока пусто: номера появляются после проверки. Предложите свой — форма ниже.
        </p>
      )}

      <DirectoryList entries={docs} stats={stats} viewer={viewer} claims={claims} />

      <SuggestForm />

      <footer className="page-footer">
        <p>
          Заметили неверный номер или цену? Напишите об этом в форме выше — проверим и
          поправим.
        </p>
      </footer>
    </main>
  );
}
