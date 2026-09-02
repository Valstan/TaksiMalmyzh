import type { Metadata } from "next";
import Link from "next/link";
import TripViewMount from "@/components/TripViewMount";

// Страница просмотра поездки по ссылке доверенного контакта (M0.A §5, §6.4).
//
// Оболочка нарочно пустая: ни имени, ни координат, ни состояния — всё это клиент получит
// POST'ом, отдав verifier из фрагмента. Превью-бот мессенджера видит только «Поездка».
// Ни одного стороннего скрипта: карта из своих тайлов, как и везде на сайте.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Поездка — ПОЗВОНИ",
  description: "Поездка, которой с вами поделились.",
  robots: { index: false, follow: false },
  openGraph: { title: "Поездка · ПОЗВОНИ", description: "" },
};

export default async function TripPage({ params }: { params: Promise<{ lookup: string }> }) {
  const { lookup } = await params;
  return (
    <main className="page">
      <header className="page-header">
        <p className="site-crumbs">
          <Link href="/">ПОЗВОНИ</Link>
          <span aria-hidden="true"> › </span>
          <span>Поездка</span>
        </p>
        <h1>Поездка</h1>
      </header>

      <TripViewMount lookup={lookup} />

      <footer className="page-footer">
        <p>
          Ссылку дал вам человек, который едет: родитель, супруг, друг. Пока поездка идёт
          штатно, вы видите только её состояние. Маршрут откроется, если он включил его сам
          или если он перестал отвечать и не подтвердил, что всё в порядке.
        </p>
      </footer>
    </main>
  );
}
