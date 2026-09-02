import Link from "next/link";
import { oidcConfig } from "@/lib/oidc";
import { currentUser } from "@/lib/session";
import { marketReady, unseenRequests } from "@/lib/market";
import { ECOSYSTEM_SERVICES_URL, ROOT_SITE, siteHref, type Site } from "@/lib/sites";

// Шапка, объясняющая матрёшку: человек, пришедший на `такси.вмалмыже.рф`, должен
// с первого экрана видеть и что это такси, и что такси — часть «ПОЗВОНИ», где
// есть остальной город. Без этой строчки поддомен выглядит отдельным сайтом, и
// весь смысл общей базы теряется.
//
// Здесь же вход: кнопка «Войти» ведёт в единый вход экосистемы (в том числе через
// ВКонтакте), после входа на её месте имя и «выйти» — решение владельца 2026-09-02.

/**
 * Пока `позвони.вмалмыже.рф` не заведён, «весь ПОЗВОНИ» — это полный справочник
 * на текущем домене. Дверь наружу не должна вести в ошибку DNS; когда домен
 * появится и в реестре встанет `live: true`, ссылки сами станут абсолютными,
 * а этот путь останется рабочим deep-link'ом «покажи всё».
 */
export const WHOLE_SERVICE_FALLBACK = "/nomera?scope=all";

const PAGE_PATH = { home: "/", directory: "/nomera" } as const;

export default async function SiteHeader({
  site,
  page,
}: {
  site: Site;
  page: "home" | "directory";
}) {
  const isChild = site.id !== ROOT_SITE.id;
  const rootHref = siteHref(site, ROOT_SITE, "/", WHOLE_SERVICE_FALLBACK);

  const loginEnabled = Boolean(oidcConfig());
  const user = loginEnabled ? await currentUser() : null;
  // Уведомление бизнесу о вызове — в приложении (§8.8): число непросмотренных в шапке.
  let unseen = 0;
  if (user && (await marketReady())) {
    try {
      const { getPayload } = await import("payload");
      const { default: config } = await import("@payload-config");
      unseen = await unseenRequests(await getPayload({ config }), user.id);
    } catch { /* кабинет не обязателен для шапки */ }
  }
  // Вход живёт на корневом домене (единственный redirect_uri клиента): с поддомена
  // кнопка ведёт туда, и после входа человек остаётся на корне — там же и сессия.
  // Кука сессии хостовая намеренно: кука на всю зону уезжала бы соседним проектам.
  const loginHref = siteHref(
    site,
    ROOT_SITE,
    `/api/auth/oidc/start?next=${encodeURIComponent(PAGE_PATH[page])}`,
    "/api/auth/oidc/start",
  );

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
        {loginEnabled &&
          (user ? (
            <span className="who">
              <span aria-label="Вы вошли как">👤 {user.label}</span>
              <Link href="/poezdki">поездки знакомых</Link>
              <Link href="/kabinet">{unseen > 0 ? `кабинет (${unseen})` : "кабинет"}</Link>
              {user.role === "superadmin" && <Link href="/admin">админка</Link>}
              <form action="/api/auth/logout" method="post">
                <button type="submit">выйти</button>
              </form>
            </span>
          ) : (
            // Роут отвечает редиректом на чужой хост — нужна полная навигация, не <Link>.
            <a href={loginHref} rel="nofollow">
              Войти
            </a>
          ))}
      </nav>
    </header>
  );
}
