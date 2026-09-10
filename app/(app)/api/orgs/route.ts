import { NextResponse } from "next/server";
import { publishedOrgs } from "@/lib/org-cache";
import { searchOrgs } from "@/lib/org-search";
import { limited } from "@/lib/rate-limit";
import { CATEGORIES } from "@/lib/sites";

// Подсказки организаций для формы «предложить номер»: GET /api/orgs?q=…&category=…
//
// Отдельный путь, а не GET на /api/suggest: там POST «предложить», глагол другой, и две
// разные вещи под одним адресом — заготовка для будущей путаницы. Соседство с /api/search
// читается сразу: search — адреса, orgs — организации.
//
// Отдаём только опубликованное и только то, что и так лежит открыто на /nomera: название,
// категорию и телефоны. Телефоны нужны форме всерьёз — человек видит, что его номер у
// карточки уже есть, и не отправляет его. Ни статуса, ни источника, ни владельца наружу.
//
// Запросы не логируются — та же дисциплина, что у /api/search.

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const cat = url.searchParams.get("category");
  const category = CATEGORIES.find((c) => c === cat);

  if (q.trim().length < 2) return NextResponse.json({ hits: [] }, { headers: noStore });

  // ⚠️ Отказ по лимиту — 429 с пометкой, а НЕ пустой список со статусом 200. Тихая пустота
  // ровно та ситуация, ради предотвращения которой подсказки и делаются: человек не увидел
  // «Стрелу» и завёл вторую. Клиент на 429 честно пишет «подсказки временно недоступны».
  // Ключ — ресурс, не клиент: адресов посетителей у приложения нет. 600 в минуту при
  // дебаунсе 180 мс держат десятки одновременно печатающих.
  if (limited("orgs:query", 600)) {
    return NextResponse.json({ hits: [], throttled: true }, { status: 429, headers: noStore });
  }

  try {
    const hits = searchOrgs(await publishedOrgs(), q, category).map((h) => ({
      id: h.id,
      name: h.name,
      category: h.category,
      phones: h.phones,
    }));
    return NextResponse.json({ hits }, { headers: noStore });
  } catch {
    return NextResponse.json({ hits: [], unavailable: true }, { status: 503, headers: noStore });
  }
}
