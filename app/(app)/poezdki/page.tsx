import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { sharedWithUser } from "@/lib/track-share";

// «Поездки знакомых» — трекер в приложении для вошедшего (решение владельца 2026-09-02,
// M0.A §8.8): кто однажды открыл ссылку, будучи вошедшим, дальше находит поездку здесь.
// Ключ доступа заново не нужен — доступ даёт сессия, привязанная к ссылке.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Поездки знакомых — ПОЗВОНИ",
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  recording: "идёт",
  silent: "⚠️ тревога: данных нет",
  disclosed: "⚠️ маршрут раскрыт",
  finished: "завершена",
  abandoned: "оборвана",
};

export default async function PoezdkiPage() {
  const user = await currentUser();
  const trips = user ? await sharedWithUser(user.id) : [];

  return (
    <main className="page">
      <header className="page-header">
        <p className="site-crumbs">
          <Link href="/">ПОЗВОНИ</Link>
          <span aria-hidden="true"> › </span>
          <span>Поездки знакомых</span>
        </p>
        <h1>Поездки знакомых</h1>
        <p className="page-sub">
          Поездки, ссылки на которые вам присылали. Откройте — увидите, идёт ли поездка, и
          маршрут, если он открыт.
        </p>
      </header>

      {!user && (
        <p className="page-sub">
          Чтобы поездки собирались здесь,{" "}
          {/* роут отвечает редиректом на чужой хост — полная навигация, не <Link> */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/auth/oidc/start?next=%2Fpoezdki">войдите</a> и откройте присланную
          ссылку ещё раз.
        </p>
      )}

      {user && trips.length === 0 && (
        <p className="page-sub">Пока пусто. Откройте присланную ссылку — поездка появится здесь.</p>
      )}

      {trips.length > 0 && (
        <ul className="share-list">
          {trips.map((t) => (
            <li key={t.lookup}>
              <Link href={`/t/${t.lookup}`}>
                {t.label ?? "поездка"} · {new Date(t.startedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
              </Link>
              <span className="share-meta">{STATUS[t.status] ?? t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
