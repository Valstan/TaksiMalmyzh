import type { Metadata } from "next";
import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";
import { currentUser } from "@/lib/session";
import { marketReady, myClaims, ownedEntries, pendingClaims, requestsForOwner } from "@/lib/market";
import CabinetOwner from "@/components/CabinetOwner";
import CabinetStaff from "@/components/CabinetStaff";

// Кабинет (спринт 8). Одна страница, два лица по роли:
//  - бизнес (владелец записи): своя карточка и вызовы с адресом;
//  - персонал: заявки «это мой бизнес», ждущие звонка.
// Посетитель без карточек видит, как её получить.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Кабинет — ПОЗВОНИ",
  robots: { index: false, follow: false },
};

export default async function KabinetPage() {
  const user = await currentUser();
  const ready = await marketReady();

  let owned: Awaited<ReturnType<typeof ownedEntries>> = [];
  let requests: Awaited<ReturnType<typeof requestsForOwner>> = [];
  let claims: Awaited<ReturnType<typeof pendingClaims>> = [];
  let pendingMine = 0;
  if (user && ready) {
    const payload = await getPayload({ config });
    owned = await ownedEntries(payload, user.id);
    requests = await requestsForOwner(payload, user.id);
    pendingMine = [...(await myClaims(user.id)).values()].filter((s) => s === 0).length;
    if (user.role === "superadmin") claims = await pendingClaims(payload);
  }

  return (
    <main className="page">
      <header className="page-header">
        <p className="site-crumbs">
          <Link href="/">ПОЗВОНИ</Link>
          <span aria-hidden="true"> › </span>
          <span>Кабинет</span>
        </p>
        <h1>Кабинет</h1>
      </header>

      {!user && (
        <p className="page-sub">
          Кабинет бизнеса — для тех, кто ведёт свою карточку в справочнике.{" "}
          {/* роут отвечает редиректом на чужой хост — полная навигация, не <Link> */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/auth/oidc/start?next=%2Fkabinet">Войдите</a>, найдите свой номер в{" "}
          <Link href="/nomera">справочнике</Link> и нажмите «Это мой бизнес».
        </p>
      )}

      {user && !ready && <p className="page-sub">Кабинеты пока недоступны.</p>}

      {user && ready && user.role === "superadmin" && <CabinetStaff claims={claims} />}

      {user && ready && owned.length === 0 && user.role !== "superadmin" && (
        <p className="page-sub">
          {pendingMine > 0
            ? "Заявка отправлена: мы позвоним по номеру из справочника, чтобы подтвердить, что он ваш. После этого карточка появится здесь."
            : <>У вас пока нет карточек. Найдите свой номер в <Link href="/nomera">справочнике</Link> и нажмите «Это мой бизнес».</>}
        </p>
      )}

      {user && ready && owned.length > 0 && <CabinetOwner entries={owned} requests={requests} />}
    </main>
  );
}
