// Кладёт воркер MapLibre на нашу статику — в каталог, названный версией пакета.
//
// Зачем воркер у себя. MapLibre вычисляет адрес воркера из `import.meta.url`,
// подставляя соседний файл рядом с собой. Под сборщиком это путь чанка, соседа по
// нему нет, и воркер молча не грузится: карта остаётся серой, а в консоли —
// «non-JavaScript MIME type». Поэтому адрес задаётся явно через setWorkerUrl,
// а файлы кладутся к себе.
//
// Зачем версия В ПУТИ, а не в query. Nginx отдаёт /map/ с `immutable` на год —
// это обещание, что по этому адресу навсегда те же байты и те же заголовки.
// Обещание надо держать, иначе получается ловушка, в которую мы уже попали
// 2026-08-30: в mime.types не было `.mjs`, воркер уехал как octet-stream и
// закэшировался у посетителей НА ГОД. Правка на сервере таких посетителей уже
// не догоняет — их лечит только новый адрес.
//
// Версия именно в каталоге, а не `?v=`: воркер импортирует соседний
// maplibre-gl-shared.mjs ОТНОСИТЕЛЬНЫМ путём, и query до него не доезжает —
// апгрейд MapLibre подсунул бы новый воркер со старым shared. Версионный каталог
// переносит оба файла разом.
//
// Файлы генерируемые — в Git не попадают (.gitignore), пересоздаются перед
// каждым dev и build.

import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { version } = require("maplibre-gl/package.json");
const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const out = path.join(process.cwd(), "public", "map", "maplibre", version);

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(out, { recursive: true });
for (const name of FILES) {
  await copyFile(path.join(dist, name), path.join(out, name));
}

console.log(`· воркер MapLibre положен в public/map/maplibre/${version}: ${FILES.join(", ")}`);
