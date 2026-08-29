import { NextResponse } from "next/server";
import { search } from "@/lib/addresses";

// Поиск адреса — серверный, как и задумано в M0.B §6: наружу не уходит ни один
// запрос, справочник наш. Логировать эти запросы нельзя (M0.A §2.3 запрещает
// накапливать семантику мест), поэтому здесь нет и не должно появиться логирования.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const hits = await search(q);

  return NextResponse.json(
    { hits },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
