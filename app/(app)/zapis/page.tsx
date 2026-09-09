import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TripRecorderMount from "@/components/TripRecorderMount";
import { currentUser } from "@/lib/session";
import { ROOT_SITE, resolveSite, siteHref } from "@/lib/sites";

// Страница записи поездки — этап A, только для собственных замеров владельца.
//
// Смысл существования: получить три величины, которые M0.A помечает как неизмеренные и
// без которых нельзя идти дальше, — расход батареи (§2.5), точность сырой трассы (§2.2) и
// порог поворота (§2.1, там прямо сказано, что 30° это 1,7σ шума и число подлежит
// настройке на реальных поездках).
//
// ⚠️ Раньше страница про гейт не знала: сервер закрывал запись, а страница «просто
// получала 404 и честно это показывала». На бумаге верно, на практике вышло хуже — гейт
// узнавался только ПОСЛЕ нажатия кнопки, а до того страница обещала запись кому угодно.
// Владельцу это стоило неудавшегося круга 09.09: до кнопки он вообще не дошёл, потому что
// ссылок сюда в интерфейсе не было ни одной, — а появись они, посетитель увидел бы
// обещание функции, которой ему не положено. Поэтому гейт теперь проверяется и здесь,
// теми же двумя вопросами, что и в lib/track-gate.ts.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Запись поездки",
  robots: { index: false, follow: false },
};

export default async function ZapisPage() {
  // Выключенная запись невидима целиком — 404, а не «нельзя»: «такого адреса нет» не
  // сообщает постороннему, что здесь что-то есть и оно чем-то закрыто (lib/track-gate.ts).
  if (process.env.TRACK_RECORDING !== "on") notFound();

  const site = resolveSite((await headers()).get("host"));
  const user = await currentUser();

  // Вошедшему посетителю — тот же 404: он уже доказал, что он не персонал, и незачем ему
  // знать про закрытую функцию. Гостю показываем вход: он мог быть персоналом, у которого
  // истекла сессия, — а «404» на этом месте выглядело бы как поломка сайта.
  if (user && user.role !== "superadmin") notFound();

  const loginHref = siteHref(
    site,
    ROOT_SITE,
    "/api/auth/oidc/start?next=%2Fzapis",
    "/api/auth/oidc/start?next=%2Fzapis",
  );

  return (
    <main className="page">
      <header className="page-header">
        <h1>Запись поездки</h1>
        <p className="page-sub">
          Служебная страница этапа A. Записывать можно только свои поездки там, где нет
          наёмного водителя: за рулём своей машины, на велосипеде, пешком. Поездка в
          настоящем такси — это уже трасса второго человека и другой этап.{" "}
          <Link href="/">← на главную</Link>
        </p>
      </header>

      {user ? (
        <TripRecorderMount loginHref={loginHref} />
      ) : (
        <p className="page-sub">
          {/* Роут отвечает редиректом на чужой хост — полная навигация, не <Link>. */}
          Чтобы записывать поездки, <a href={loginHref} rel="nofollow">войдите</a>. Вводить
          ничего сверх входа не потребуется: право записи даёт сама сессия.
        </p>
      )}

      <footer className="page-footer">
        <p>
          Трасса шифруется на сервере и живёт около месяца в сыром виде, дальше — свёрнутой.
          Из резервного образа хостера точку можно восстановить ещё примерно три недели.
        </p>
      </footer>
    </main>
  );
}
