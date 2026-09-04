import { withPayload } from "@payloadcms/next/withPayload";
import { DEFAULT_ISSUER } from "./lib/esa-issuer.mjs";
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

  // Прод-бокс маленький: собрать на нём Next-приложение не выйдет — процесс ловит OOM,
  // а swap на контейнерном VPS не включается (G20). Поэтому сборка идёт в CI, а на
  // сервер уезжает standalone-рантайм на полторы-три сотни мегабайт.
  output: "standalone",

  // Адресный справочник читается с диска в рантайме (lib/addresses.ts). В standalone
  // попадает только то, что трассировщик увидел в импортах, а этот файл читается по
  // пути — без явного включения поиск на проде отвечал бы «адрес не найден» на всё.
  outputFileTracingIncludes: {
    "/api/search": ["./data/addresses.json"],
  },

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
              // Хост ЕСА здесь — ради выхода: `form-action` проверяет не только адрес
              // формы, но и адрес редиректа после отправки, а форма «выйти» уводит на
              // `end_session` единого входа (app/(app)/api/auth/logout). Без этого браузер
              // молча оборвал бы последний шаг выхода.
              //
              // ⚠️ Значение фиксируется на СБОРКЕ (Next кладёт заголовки в манифест
              // маршрутов), поэтому берётся константа, а не `OIDC_ISSUER` из env бокса:
              // переменную здесь прочитал бы CI, а не прод. Переопределят issuer — править
              // и эту строку.
              `form-action 'self' ${DEFAULT_ISSUER}`,
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Страница поездки по ссылке (M0.A §6.4): не кэшировать, не индексировать.
        // Referrer-Policy: no-referrer стоит глобально выше — фрагмент с ключом и так не
        // уходит, но и путь с lookup не должен утекать по ссылкам со страницы.
        source: "/t/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
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

export default withPayload(nextConfig);
