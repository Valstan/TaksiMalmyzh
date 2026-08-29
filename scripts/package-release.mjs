// Собирает релизный пакет для выкатки на прод-бокс.
//
// Зачем отдельный шаг: `output: "standalone"` кладёт в `.next/standalone` только
// рантайм и трассированные зависимости. Статика (`.next/static`) и `public/` туда
// НЕ попадают — Next оставляет их копирование на вызывающего. Без них приложение
// поднимется, но отдаст страницу без стилей и без карты.
//
// Почему пакет вообще нужен: прод-бокс маленький, `next build` на нём ловит OOM,
// а swap на контейнерном VPS не включается. Сборка идёт в CI, на сервер уезжает
// готовый рантайм (G20).
//
// Запуск:  npm run package   (после npm run build)
// Результат: release/ — то, что кладётся на сервер целиком.

import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const OUT = "release";
const STANDALONE = path.join(".next", "standalone");

if (!existsSync(STANDALONE)) {
  console.error("✗ нет .next/standalone — сначала `npm run build`");
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 1. рантайм. dereference: standalone содержит симлинки на трассированные пакеты,
// а создание симлинка на Windows требует привилегий — копируем содержимое.
await cp(STANDALONE, OUT, { recursive: true, dereference: true });

// 2. статика сборки — её Next не кладёт в standalone
await cp(path.join(".next", "static"), path.join(OUT, ".next", "static"), { recursive: true });

// 3. public целиком: карта, глифы, спрайты, воркер MapLibre
await cp("public", path.join(OUT, "public"), { recursive: true });

// 4. подсказка тому, кто будет разбираться на сервере
await writeFile(
  path.join(OUT, "README.txt"),
  [
    "Релизный пакет TaksiMalmyzh.",
    "",
    "Запуск:  node server.js",
    "Переменные: PORT, HOSTNAME (см. docs/DEPLOY.md в репозитории).",
    "",
    "Собран в CI: на прод-боксе сборка не помещается в память (G20).",
    "",
  ].join("\n"),
  "utf8",
);

async function dirSize(dir) {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

const size = await dirSize(OUT);
console.log(`· пакет собран: ${OUT}/ — ${(size / 1024 ** 2).toFixed(1)} МиБ`);

for (const required of [
  path.join(OUT, "server.js"),
  path.join(OUT, ".next", "static"),
  path.join(OUT, "public", "map", "malmyzh.pmtiles"),
  path.join(OUT, "data", "addresses.json"),
]) {
  if (!existsSync(required)) {
    console.error(`✗ в пакете нет ${required}`);
    process.exit(1);
  }
}
console.log("· проверено: рантайм, статика, карта и справочник на месте");
