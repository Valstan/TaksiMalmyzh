import Link from "next/link";
import { ECOSYSTEM_SERVICES_URL, ROOT_SITE, siteHref, type Site } from "@/lib/sites";

// Шапка, объясняющая матрёшку: человек, пришедший на `такси.вмалмыже.рф`, должен
// с первого экрана видеть и что это такси, и что такси — часть «ПОЗВОНИ», где
// есть остальной город. Без этой строчки поддомен выглядит отдельным сайтом, и
// весь смысл общей базы теряется.

/**
 * Пока `позвони.вмалмыже.рф` не заведён, «весь ПОЗВОНИ» — это полный справочник
 * на текущем домене. Дверь наружу не должна вести в ошибку DNS; когда домен
 * появится и в реестре встанет `live: true`, ссылки сами станут абсолютными,
 * а этот путь останется рабочим deep-link'ом «покажи всё».
 */
export const WHOLE_SERVICE_FALLBACK = "/nomera?scope=all";

export default function SiteHeader({
  site,
  page,
}: {
  site: Site;
  page: "home" | "directory";
}) {
  const isChild = site.id !== ROOT_SITE.id;
  const rootHref = siteHref(site, ROOT_SITE, "/", WHOLE_SERVICE_FALLBACK);

  return (
    <header className="page-header">
      {isChild && (
        <p className="site-crumbs">
          <a href={rootHref}>ПОЗВОНИ</a>
          <span aria-hidden="true"> › </span>
          <span>{site.title}</span>
        </p>
      )}

      <h1>{page === "home" ? site.title : "Справочник номеров"}</h1>
      <p className="page-sub">{site.tagline}</p>

      <nav className="top-nav">
        {page === "home" ? (
          <Link href="/nomera">Справочник номеров</Link>
        ) : (
          <Link href="/">← к карте</Link>
        )}
        {isChild && (
          <a href={siteHref(site, ROOT_SITE, "/nomera", WHOLE_SERVICE_FALLBACK)}>
            Весь справочник города
          </a>
        )}
        <a href={ECOSYSTEM_SERVICES_URL} rel="external">
          Сервисы Малмыжа
        </a>
      </nav>
    </header>
  );
}
