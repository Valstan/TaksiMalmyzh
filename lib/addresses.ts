import { readFile } from "node:fs/promises";
import path from "node:path";

export type Street = { name: string; lat: number | null; lon: number | null; n: number };
export type Address = [street: string, house: string, lat: number, lon: number];

export type AddressIndex = {
  source: string;
  licence: string;
  attribution: string;
  boundary: string;
  streets: Street[];
  addresses: Address[];
};

export type Hit = {
  kind: "street" | "address";
  label: string;
  lat: number;
  lon: number;
};

// Справочник живёт на диске и читается один раз за процесс. Здесь он намеренно
// не в базе: спринт 1 не заводит ни одной таблицы, потому что персональных данных
// в нём нет вообще (docs/SPRINT_PLAN.md). Перенос в PostgreSQL меняет только этот
// файл — интерфейс поиска для остального приложения останется прежним.
let cached: Promise<AddressIndex> | null = null;

export function loadIndex(): Promise<AddressIndex> {
  if (!cached) {
    const file = path.join(process.cwd(), "data", "addresses.json");
    cached = readFile(file, "utf8").then((raw) => JSON.parse(raw) as AddressIndex);
  }
  return cached;
}

/** Регистр и «ё» не должны мешать найти улицу. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").trim();
}

/**
 * Разбирает запрос на «улица» и «дом». Люди пишут и «Ленина 12», и «12 Ленина»,
 * и «ул. Ленина, д. 12» — поэтому номер дома ищется как отдельное слово в любом
 * месте строки, а остальное считается названием.
 */
function splitQuery(q: string): { street: string; house: string | null } {
  const tokens = normalize(q)
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^(ул|улица|пер|переулок|пр|проезд|д|дом)$/.test(t));

  const houseAt = tokens.findIndex((t) => /^\d+[а-я]?(\/\d+)?$/.test(t));
  if (houseAt === -1) return { street: tokens.join(" "), house: null };

  const house = tokens[houseAt];
  const rest = tokens.slice(0, houseAt).concat(tokens.slice(houseAt + 1));
  return { street: rest.join(" "), house };
}

/**
 * Поиск по подстроке. Внешнего геокодера нет по решению M0.B §6: весь корпус —
 * сто с небольшим улиц и две тысячи адресов, поэтому линейный проход отвечает
 * за доли миллисекунды и не требует ни индекса, ни сетевого вызова.
 */
export async function search(query: string, limit = 12): Promise<Hit[]> {
  const q = normalize(query);
  if (q.length < 2) return [];

  const index = await loadIndex();
  const { street, house } = splitQuery(query);
  const hits: Hit[] = [];

  if (house !== null && street) {
    for (const [st, hs, lat, lon] of index.addresses) {
      if (normalize(hs) === house && normalize(st).includes(street)) {
        hits.push({ kind: "address", label: `${st}, ${hs}`, lat, lon });
        if (hits.length >= limit) return hits;
      }
    }
  }

  const streetQuery = street || q;
  const matched = index.streets
    .filter((s) => s.lat !== null && normalize(s.name).includes(streetQuery))
    // Улицы, у которых есть адреса, человеку нужнее, чем безымянные проезды.
    .sort((a, b) => b.n - a.n || normalize(a.name).indexOf(streetQuery) - normalize(b.name).indexOf(streetQuery));

  for (const s of matched) {
    hits.push({ kind: "street", label: s.name, lat: s.lat as number, lon: s.lon as number });
    if (hits.length >= limit) break;
  }

  return hits;
}
