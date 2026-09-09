import PageHead from "@/components/PageHead";
import type { Metadata } from "next";
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
    <main className="page" id="main" tabIndex={-1}>
      <PageHead
        title="Поездка"
        sub={
          <>
            Чтобы поездка потом нашлась у вас в «Поездках знакомых»,{" "}
            {/* Роут отвечает редиректом на чужой хост — полная навигация, не <Link>.
                `next` обязателен именно здесь: без него вход уводит на главную корня, и
                человек теряет ссылку на поездку, за которой пришёл. */}
            <a href={`/api/auth/oidc/start?next=%2Ft%2F${encodeURIComponent(lookup)}`} rel="nofollow">
              войдите
            </a>{" "}
            — ссылка привяжется к вам.
          </>
        }
      />

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
