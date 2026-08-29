// Проверка, что карта и адресный справочник на месте и не пустые.
//
// Зачем отдельным шагом: сборка проходит и без них — Next не знает, что
// `public/map/malmyzh.pmtiles` кому-то нужен. Отсутствие файла всплыло бы уже
// у пользователя серым прямоугольником вместо карты, а поиск отвечал бы
// «в Малмыже такого адреса нет» на любой запрос.
//
// Проверяются свойства, а не просто существование: заголовок PMTiles, диапазон
// зумов, непустой корпус адресов и четыре улицы приречной части — те самые,
// что выпадали из ошибочного bbox первой редакции M0.B (§5).

import { readFile, stat } from "node:fs/promises";

const CONTROL_STREETS = [
  "Прибрежная улица",
  "Пристанская улица",
  "Флотская улица",
  "Тихий переулок",
];

let failed = false;

function fail(message) {
  console.error(`✗ ${message}`);
  failed = true;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

// --- вырезка карты

try {
  const path = "public/map/malmyzh.pmtiles";
  const info = await stat(path);
  const head = (await readFile(path)).subarray(0, 127);

  if (head.subarray(0, 7).toString("latin1") !== "PMTiles" || head[7] !== 3) {
    fail(`${path}: не архив PMTiles v3`);
  } else if (info.size < 256 * 1024) {
    fail(`${path}: подозрительно мал — ${info.size} Б`);
  } else {
    ok(`карта: ${(info.size / 1024 ** 2).toFixed(2)} МиБ, зумы ${head[100]}..${head[101]}`);
  }
} catch (e) {
  fail(`вырезка карты не читается: ${e.message}`);
}

// --- шрифты и спрайты: без них карта рисуется без подписей

for (const path of [
  "public/map/fonts/Noto Sans Regular/1024-1279.pbf",
  "public/map/sprites/light.json",
]) {
  try {
    const info = await stat(path);
    if (info.size === 0) fail(`${path}: пустой файл`);
    else ok(`ассет на месте: ${path}`);
  } catch {
    fail(`нет файла ${path} — карта останется без подписей или значков`);
  }
}

// --- адресный справочник

try {
  const index = JSON.parse(await readFile("data/addresses.json", "utf8"));
  const names = new Set(index.streets.map((s) => s.name));
  const missing = CONTROL_STREETS.filter((s) => !names.has(s));

  if (index.addresses.length < 1500) {
    fail(`адресов всего ${index.addresses.length} — корпус собран неверно`);
  } else if (missing.length > 0) {
    fail(`нет улиц приречной части: ${missing.join(", ")} — bbox снова срезал город`);
  } else {
    ok(`справочник: улиц ${index.streets.length}, адресов ${index.addresses.length}`);
  }
} catch (e) {
  fail(`адресный справочник не читается: ${e.message}`);
}

process.exit(failed ? 1 : 0);
