// Кладёт воркер MapLibre на нашу статику.
//
// Зачем. MapLibre вычисляет адрес воркера из `import.meta.url`, подставляя соседний
// файл рядом с собой. Под сборщиком это путь чанка, соседа по нему нет, и воркер
// молча не грузится: карта остаётся серой, а в консоли — «non-JavaScript MIME type».
// Поэтому адрес задаётся явно через setWorkerUrl, а файлы кладутся к себе.
//
// Копируются двое: сам воркер и общий модуль, который он импортирует относительным
// путём. Файлы генерируемые — в Git не попадают (.gitignore), пересоздаются перед
// каждым dev и build.

import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const out = path.join(process.cwd(), "public", "map", "maplibre");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(out, { recursive: true });
for (const name of FILES) {
  await copyFile(path.join(dist, name), path.join(out, name));
}

console.log(`· воркер MapLibre положен в public/map/maplibre: ${FILES.join(", ")}`);
