import Link from "next/link";
import { oidcConfig } from "@/lib/oidc";
import { currentUser } from "@/lib/session";
import { unseenForUser } from "@/lib/market";
import { ROOT_SITE, siteHref, type Site } from "@/lib/sites";

// Правая часть тулбара: одна кнопка вместо строки из шести ссылок (решение владельца
// 2026-09-10). Гостю — «Войти», вошедшему — его имя, а всё, что раньше висело в строке
// (поездки знакомых, кабинет, админка, Ваши данные, выйти), сворачивается под неё.
//
// Меню — нативный `<details>/<summary>`, без единой строки клиентского JS. Это не
// аскеза: `<summary>` уже кнопка с состоянием развёрнутости, его читает скринридер,
// он работает до гидрации и не тянет ни байта в бандл на КАЖДОЙ странице сайта.
// Цена — Esc не закрывает меню (такой возможности у `<details>` в HTML нет); закрывает
// повторное нажатие, тап мимо и переход по ссылке.
//
// ⚠️ **Имя видно только на корневом домене.** Кука сессии host-only намеренно (кука на
// всю зону уезжала бы соседям по `вмалмыже.рф` — класс #285), поэтому на
// `такси.вмалмыже.рф` `currentUser()` всегда возвращает null, и там кнопка говорит
// «Войти» даже вошедшему владельцу. Это ограничение архитектуры входа, а не недоделка
// шапки: показать имя на дочернем домене можно только куки на всю зону, то есть ценой
// той самой дыры. Записано в docs/DOMAINS.md и в handoff.

export default async function ProfileButton({ site }: { site: Site }) {
  // Вход не настроен (стенд без OIDC) — кнопки нет вовсе, как было и в прежней шапке.
  if (!oidcConfig()) return null;

  const user = await currentUser();

  // Вход живёт на корневом домене: там единственный зарегистрированный redirect_uri
  // клиента, и там же остаётся сессия. С поддомена ссылка абсолютная.
  const loginHref = siteHref(
    site,
    ROOT_SITE,
    "/api/auth/oidc/start",
    "/api/auth/oidc/start",
  );

  if (!user) {
    return (
      <span className="tb-right">
        {/* «Ваши данные» обязаны быть в шапке рядом со входом (docs/AUTH_ESA.md,
            «Уведомление»): это точка, где данные и появляются, и невошедшему она нужна
            ровно так же — ему как раз важно, что до входа мы не знаем, КТО он. У
            вошедшего эта ссылка живёт внутри меню, как и просил владелец; у гостя меню
            нет, поэтому она стоит рядом. */}
        <Link className="tb-data" href="/dannye">
          Ваши данные
        </Link>
        {/* Роут отвечает редиректом на чужой хост — нужна полная навигация, не <Link>. */}
        <a className="tb-profile" href={loginHref} rel="nofollow">
          Войти
        </a>
      </span>
    );
  }

  const unseen = await unseenForUser(user.id);

  return (
    <details className="tb-menu">
      <summary
        className="tb-profile"
        aria-label={
          unseen > 0
            ? `Профиль: ${user.label}, непросмотренных вызовов: ${unseen}`
            : `Профиль: ${user.label}`
        }
      >
        <span className="tb-name">{user.label}</span>
        {/* Бейдж — дубль того, что уже сказано в aria-label кнопки. */}
        {unseen > 0 && (
          <span className="tb-badge" aria-hidden="true">
            {unseen}
          </span>
        )}
      </summary>

      <div className="tb-panel">
        <Link href="/poezdki">Поездки знакомых</Link>
        <Link href="/kabinet">{unseen > 0 ? `Кабинет (${unseen})` : "Кабинет"}</Link>
        {user.role === "superadmin" && (
          <>
            <Link href="/admin">Админка</Link>
            {/* Единственное постоянное место входа в запись поездки. Показывается только
                персоналу и только при включённом выключателе — оба условия те же, что в
                lib/track-gate.ts, чтобы пункт меню не вёл в 404. Граница этапа A: запись
                положена персоналу, значит ссылка живёт там, где её не видит посетитель. */}
            {process.env.TRACK_RECORDING === "on" && <Link href="/zapis">Запись поездки</Link>}
          </>
        )}
        <Link href="/dannye">Ваши данные</Link>
        <form action="/api/auth/logout" method="post">
          <button type="submit">Выйти</button>
        </form>
      </div>
    </details>
  );
}
