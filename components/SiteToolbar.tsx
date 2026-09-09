import { Suspense } from "react";
import { headers } from "next/headers";
import ProfileButton from "@/components/ProfileButton";
import {
  BRAND,
  ECOSYSTEM_SERVICES_URL,
  ROOT_SITE,
  WHOLE_SERVICE_FALLBACK,
  resolveSite,
  serviceSites,
  siteHref,
} from "@/lib/sites";

// Общий тулбар всех страниц сайта (решение владельца 2026-09-10).
//
// Слева вордмарк «Позвони в Малмыже!», дальше плашки заведённых сервисов и дверь в
// каталог экосистемы, справа — одна кнопка профиля. До этого шапка жила ВНУТРИ страниц и
// потому была ровно у двух из семи: `/zapis`, `/dannye`, `/kabinet`, `/poezdki` и
// `/t/[lookup]` рисовали каждая свой заголовок и ни одна не давала ни входа, ни выхода к
// соседним сервисам.
//
// Плашки строятся из реестра, а не перечислены руками: заведут `услуги.вмалмыже.рф` —
// плашка появится сама, кода трогать не придётся (`serviceSites()`).

export default async function SiteToolbar() {
  const site = resolveSite((await headers()).get("host"));

  return (
    <header className="toolbar">
      {/* Вордмарк — он же дверь «вверх, ко всему ПОЗВОНИ». Работу хлебных крошек, которые
          стояли на дочерних доменах, делает он вместе с подсвеченной плашкой «ты здесь». */}
      <a className="tb-brand" href={siteHref(site, ROOT_SITE, "/", WHOLE_SERVICE_FALLBACK)}>
        {BRAND}
      </a>

      <nav className="tb-services" aria-label="Сервисы Малмыжа">
        {serviceSites().map((s) => {
          const here = s.id === site.id;
          return (
            <a
              key={s.id}
              className={here ? "tb-chip is-current" : "tb-chip"}
              href={siteHref(site, s, "/", WHOLE_SERVICE_FALLBACK)}
              // Не `aria-current="page"`: у дочернего домена это отдельный сайт, а не
              // текущая страница внутри одного.
              aria-current={here ? "true" : undefined}
            >
              {s.short}
            </a>
          );
        })}
        <a className="tb-chip tb-chip-ext" href={ECOSYSTEM_SERVICES_URL} rel="external">
          Сервисы Малмыжа
        </a>
      </nav>

      {/* Сессия — за границей Suspense: статическая половина бара (вордмарк и плашки)
          уходит в браузер, не дожидаясь запроса к базе. Заглушка нейтральная, а не
          «Войти»: моргнуть «Войти» вошедшему — значит соврать ему на полсекунды. */}
      <Suspense fallback={<span className="tb-profile is-wait" aria-hidden="true" />}>
        <ProfileButton site={site} />
      </Suspense>
    </header>
  );
}
