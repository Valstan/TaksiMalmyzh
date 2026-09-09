import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import SiteToolbar from "@/components/SiteToolbar";
import { resolveSite } from "@/lib/sites";
import "./globals.css";

// Заголовок и описание зависят от домена матрёшки (`lib/sites.ts`): на
// `такси.вмалмыже.рф` во вкладке должно стоять «ТАКСИ МАЛМЫЖ», а не «ПОЗВОНИ» —
// иначе поддомен выглядит чужой страницей, случайно отдавшей другой сайт.
export async function generateMetadata(): Promise<Metadata> {
  const site = resolveSite((await headers()).get("host"));

  return {
    title: { default: site.metaTitle, template: "%s" },
    description: site.tagline,
    // Каждый домен матрёшки канонизирует сам себя: содержимое у них разное
    // (такси-домен показывает только такси), дублей нет. Абсолютный canonical
    // ставится только для заведённого домена — ссылка на несуществующий хост
    // хуже, чем её отсутствие.
    alternates: site.live ? { canonical: `https://${site.host}/` } : undefined,
    // Стенд этапа A закрыт снаружи, но запрет индексации ставим сразу: включать его
    // потом — значит однажды забыть (docs/GO_LIVE_CHECKLIST.md, этап A).
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f5f2",
};

// ⚠️ Тулбар в корневом layout делает динамическими ВСЕ страницы группы `(app)`: он читает
// `Host` и сессию. Сегодня это ничего не ломает — все семь страниц и так объявляли
// `dynamic = "force-dynamic"`, — но с этого дня статической страницы под `(app)` быть уже
// не может, и это ограничение постоянное.
//
// ⚠️ И второе следствие: имя вошедшего теперь есть в HTML ЛЮБОЙ страницы. Общий кэш перед
// приложением (`proxy_cache` у nginx, CDN) стал бы утечкой имён между людьми. Сейчас его
// нет — динамические ответы App Router уходят с `no-store`, а `deploy/nginx.conf.example`
// кэш не включает; появится — это инвариант, который придётся держать явно.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        {/* Бар добавляет четыре-шесть остановок табуляции перед содержимым на каждой
            странице — без этой ссылки клавиатурой до текста не добраться коротким путём. */}
        <a className="skip-link" href="#main">
          К содержимому
        </a>
        <SiteToolbar />
        {children}
      </body>
    </html>
  );
}
