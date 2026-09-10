import PageHead from "@/components/PageHead";
import type { Metadata } from "next";
import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";
import { currentUser } from "@/lib/session";
import { marketReady, myClaims, ownedEntries, pendingClaims, requestsForOwner } from "@/lib/market";
import CabinetOwner from "@/components/CabinetOwner";
import CabinetStaff from "@/components/CabinetStaff";
import { ratingsReady, ratingStats, type RatingStats } from "@/lib/ratings";
import { entryEditsReady, pendingEntryEdits, type EntryEdit } from "@/lib/entry-edits";

// Кабинет (спринт 8). Одна страница, два лица по роли:
//  - бизнес (владелец записи): своя карточка и вызовы с адресом;
//  - персонал: заявки «это мой бизнес», ждущие звонка, и (с 2026-09-10) новые номера,
//    предложенные посетителями к организациям, которые уже есть в справочнике.
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
  let edits: EntryEdit[] = [];
  let pendingMine = 0;
  let ratings = new Map<number, RatingStats>();
  if (user && ready) {
    const payload = await getPayload({ config });
    owned = await ownedEntries(payload, user.id);
    if (owned.length && (await ratingsReady())) ratings = await ratingStats(owned.map((e) => e.id));
    requests = await requestsForOwner(payload, user.id);
    pendingMine = [...(await myClaims(user.id)).values()].filter((s) => s === 0).length;
    if (user.role === "superadmin") {
      claims = await pendingClaims(payload);
      // Очередь новых номеров — свой гейт готовности: страница не должна зависеть от того,
      // доехала ли миграция.
      if (await entryEditsReady()) edits = await pendingEntryEdits(payload);
    }
  }

  return (
    <main className="page" id="main" tabIndex={-1}>
      <PageHead title="Кабинет" />

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

      {user && ready && user.role === "superadmin" && <CabinetStaff claims={claims} edits={edits} />}

      {user && ready && owned.length === 0 && user.role !== "superadmin" && (
        <p className="page-sub">
          {pendingMine > 0
            ? "Заявка отправлена: мы позвоним по номеру из справочника, чтобы подтвердить, что он ваш. После этого карточка появится здесь."
            : <>У вас пока нет карточек. Найдите свой номер в <Link href="/nomera">справочнике</Link> и нажмите «Это мой бизнес».</>}
        </p>
      )}

      {user && ready && owned.length > 0 && <CabinetOwner entries={owned} requests={requests} ratings={ratings} />}
    </main>
  );
}
