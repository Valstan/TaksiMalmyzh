import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Такси Малмыж",
  description: "Карта Малмыжа и поиск адреса.",
  // Стенд этапа A закрыт снаружи, но запрет индексации ставим сразу: включать его
  // потом — значит однажды забыть (docs/GO_LIVE_CHECKLIST.md, этап A).
  robots: { index: false, follow: false },
};

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
