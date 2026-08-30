import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
