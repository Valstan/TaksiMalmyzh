import { NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { acceptablePhone, createEntryEdit, entryEditsReady } from "@/lib/entry-edits";
import { nameKey } from "@/lib/org-search";
import { phoneKey } from "@/lib/phone-key";
import { CATEGORIES, type EntryCategory } from "@/lib/sites";

// Приём предложений в справочник от посетителей.
//
// Правило владельца 2026-08-29: предложение НИКОГДА не публикуется само. Гейт продублирован
// дважды: здесь статус выставляется жёстко, а access-правило коллекции не отдаёт черновики
// анониму, даже если этот код когда-нибудь сломают.
//
// С 2026-09-10 (решение владельца: «при предложении нового номера — возможность выбрать
// организацию уже существующую») предложение бывает двух видов:
//   • НОВАЯ организация — создаётся черновик записи, как и раньше;
//   • номер к организации, которая УЖЕ ЕСТЬ, — запись справочника НЕ трогается вовсе: номер
//     ложится в очередь правок `market.entry_edit` и ждёт персонал (lib/entry-edits.ts).
//     Ни одна запись справочника не мутирует от анонимного запроса — ни опубликованная, ни
//     черновик.
//
// Человек не выбрал организацию из подсказки, а она есть? Сервер сверяет название по
// УЗКОМУ ключу (`nameKey`: регистр, «ё», кавычки, пробелы) в той же категории — и при
// совпадении тоже кладёт номер в очередь к найденной записи, а не заводит вторую. Ответ
// человеку при этом всегда один и тот же: иначе форма стала бы оракулом очереди модерации,
// и посторонний, перебирая названия, узнавал бы, что лежит в черновиках.
//
// Ограничение частоты — общим счётчиком, не по IP: адрес посетителя мы намеренно не читаем
// и никуда не пишем (M0.A §3.6), а nginx со своей стороны не ставит X-Forwarded-For.
// ⚠️ Он его и не вычищает: заголовок, присланный самим клиентом, доедет сюда. Поэтому
// обещание держится на том, что этот код IP не читает, а не на конфигурации чужого прокси.
// Скромный общий потолок защищает от заливки мусором; таргетированную атаку остановит
// модерация.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 30;
/** Номеров за одно предложение — у одной службы бывает несколько, но не десяток. */
const MAX_PHONES = 3;
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

/** Один ответ на все исходы — см. комментарий в шапке про оракул очереди. */
const done = () => NextResponse.json({ ok: true });

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
  if (clamp(body.website, 10)) return done();

  const name = clamp(body.name, 120);
  const note = clamp(body.note, 300);
  const category: EntryCategory = CATEGORIES.find((c) => c === body.category) ?? "other";

  // Номеров до трёх за раз. Старое поле `phone` понимаем, чтобы вкладка с прежней формой,
  // открытая до выкатки, не получила отказ.
  const rawPhones: unknown[] = Array.isArray(body.phones) ? body.phones : [body.phone];
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const p of rawPhones) {
    const clean = clamp(p, 30);
    if (!acceptablePhone(clean) || seen.has(phoneKey(clean))) continue;
    seen.add(phoneKey(clean));
    phones.push(clean);
    if (phones.length === MAX_PHONES) break;
  }
  if (phones.length === 0) {
    return NextResponse.json({ error: "Нужен хотя бы один телефон с номером." }, { status: 400 });
  }

  const payload = await getPayload({ config });

  // 1. Человек выбрал организацию из подсказки. id пришёл от клиента, поэтому перечитываем
  //    запись теми же правилами, что и весь мир (`overrideAccess: false`, без сессии —
  //    только опубликованное). Подделанный id черновика или несуществующей записи сюда не
  //    пройдёт, и в очереди персонала не появится строка «к записи #999999».
  let target: number | null = null;
  const pickedId =
    typeof body.entryId === "number" && Number.isInteger(body.entryId) ? body.entryId : null;
  if (pickedId !== null) {
    const found = await payload.find({
      collection: "entries",
      where: { id: { equals: pickedId } },
      limit: 1,
      depth: 0,
      overrideAccess: false,
    });
    target = found.docs[0]?.id ?? null;
  }

  // 2. Не выбрал (или выбранную тем временем сняли с публикации) — сверяем название по
  //    узкому ключу. Служебный запрос, `overrideAccess: true`: черновики тоже в счёт, иначе
  //    второй человек, знающий второй номер ещё не проверенной «Стрелы», завёл бы третью.
  //    Из этого запроса наружу не уходит ничего.
  let rejectedTwin: number | null = null;
  if (target === null) {
    if (name.length < 2) {
      return NextResponse.json({ error: "Нужны название и телефон." }, { status: 400 });
    }
    const key = nameKey(name);
    const { docs } = await payload.find({
      collection: "entries",
      where: { category: { equals: category } },
      limit: 1000,
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    const twins = docs.filter((d) => nameKey(d.name) === key);
    // Отклонённую запись не воскрешаем и в неё не пишем: номер, дописанный в невидимую
    // отклонённую карточку, исчез бы бесследно. Такое предложение становится новым
    // черновиком, но с пометкой для персонала, что это название уже отклонялось.
    const live = twins.find((d) => d.status !== "rejected");
    if (live) target = live.id;
    else if (twins[0]) rejectedTwin = twins[0].id;
  }

  if (target !== null) {
    if (!(await entryEditsReady())) {
      return NextResponse.json(
        { error: "Приём номеров к существующим организациям пока недоступен." },
        { status: 503 },
      );
    }
    for (const phone of phones) await createEntryEdit(target, phone, note || null);
    return done();
  }

  await payload.create({
    collection: "entries",
    data: {
      name,
      category,
      phones: phones.map((number) => ({ number })),
      note: note || undefined,
      status: "draft", // жёстко: публикация только руками супер-админа
      source: rejectedTwin
        ? `предложено посетителем; такое название уже отклонялось (#${rejectedTwin})`
        : "предложено посетителем",
    },
  });

  return done();
}
