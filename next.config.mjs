// В режиме разработки React использует eval() для восстановления стека ошибок.
// В сборке этого нет, поэтому послабление действует только на dev-стенде и в прод
// не уезжает.
const dev = process.env.NODE_ENV === "development";
const scriptSrc = dev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Стенд этапа A закрыт снаружи, но заголовки ставим с первого дня: их отсутствие
  // потом не замечают. Разбор — docs/PRIVACY_GEODATA_DESIGN.md §6.4.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Ни один сторонний хост не должен требоваться для работы страницы:
          // тайлы, шрифты и спрайты лежат у нас. Политика это фиксирует, а не
          // надеется на дисциплину — нарушение станет видно как ошибка в консоли.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob:",
              "worker-src 'self' blob:",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
              "font-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Вырезка карты и глифы неизменны между пересборками — их можно кэшировать
        // надолго. Обновляются они примерно раз в год вместе с выгрузкой OSM.
        source: "/map/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
