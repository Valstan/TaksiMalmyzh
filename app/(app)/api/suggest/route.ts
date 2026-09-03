import { NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

// Приём предложений в справочник от посетителей.
//
// Правило владельца 2026-08-29: предложение НИКОГДА не публикуется само — оно
// создаётся черновиком и ждёт проверки супер-админом. Гейт продублирован дважды:
// здесь статус выставляется жёстко, а access-правило коллекции не отдаёт
// черновики анониму, даже если этот код когда-нибудь сломают.
//
// Ограничение частоты — общим счётчиком, не по IP: адрес посетителя мы намеренно
// не читаем и никуда не пишем (M0.A §3.6, меньше чужих данных в системе), а nginx
// со своей стороны не ставит X-Forwarded-For. ⚠️ Он его и не вычищает: заголовок,
// присланный самим клиентом, доедет сюда. Поэтому обещание держится на том, что
// этот код IP не читает, а не на конфигурации чужого прокси. Скромный общий потолок
// защищает от заливки мусором; таргетированную атаку остановит модерация.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 30;
let windowStart = 0;
let windowCount = 0;

function overLimit(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > MAX_PER_WINDOW;
}

const clamp = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const CATEGORIES = new Set(["taxi", "shop", "master", "brigade", "cargo", "other"]);

export async function POST(request: Request) {
  if (overLimit()) {
    return NextResponse.json(
      { error: "Слишком много предложений подряд — попробуйте позже." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Неверный запрос." }, { status: 400 });
  }

  // Honeypot: поле, которое человек не видит и не заполняет. Боты заполняют.
  if (clamp(body.website, 10)) {
    return NextResponse.json({ ok: true });
  }

  const name = clamp(body.name, 120);
  const phone = clamp(body.phone, 30);
  const note = clamp(body.note, 500);
  const category = CATEGORIES.has(body.category as string) ? (body.category as string) : "other";

  if (name.length < 2 || !/\d{5,}/.test(phone.replace(/\D/g, ""))) {
    return NextResponse.json(
      { error: "Нужны название и телефон с номером." },
      { status: 400 },
    );
  }

  const payload = await getPayload({ config });
  await payload.create({
    collection: "entries",
    data: {
      name,
      category: category as "taxi" | "shop" | "master" | "brigade" | "cargo" | "other",
      phones: [{ number: phone }],
      note: note || undefined,
      status: "draft", // жёстко: публикация только руками супер-админа
      source: "предложено посетителем",
    },
  });

  return NextResponse.json({ ok: true });
}
