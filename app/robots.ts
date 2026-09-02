import type { MetadataRoute } from "next";

// Страницы поездок не индексируются никогда (M0.A §6.4): в адресе — ключ доступа.
// Служебные страницы тоже. Остальной сайт пока закрыт от индексации метатегом в layout.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/t/", "/zapis", "/poezdki", "/admin", "/api/"] }],
  };
}
