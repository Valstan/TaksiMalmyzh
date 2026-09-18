// Убирает прошлый релизный пакет ПЕРЕД сборкой.
//
// Зачем отдельный шаг, ведь `package-release.mjs` и так чистит `release/` перед
// упаковкой. Потому что поздно: к моменту упаковки мусор уже внутри
// `.next/standalone`.
//
// Как получалась матрёшка `release/release/release/...`:
//
//   1. `payload.config.ts` задаёт `typescript.outputFile` как
//      `path.resolve(dirname, "payload-types.ts")`, где `dirname` выводится из
//      `import.meta.url`. В собранном чанке значение `dirname` статически не
//      вычисляется, и трассировщик (`@vercel/nft`) вместо одного файла берёт
//      маску — по сути `**/payload-types.ts` от корня проекта.
//   2. Маска ловит не только корневой `payload-types.ts`, но и его копию в
//      лежащем рядом `release/` от прошлой упаковки. Файл попадает в
//      `.next/standalone/release/payload-types.ts`.
//   3. `npm run package` копирует standalone в `release/` целиком — и уровень
//      вложенности прирастает с каждой парой сборка+упаковка.
//
// В CI этого не бывает: там чистый checkout, а `release/` в .gitignore. Ловушка
// срабатывает только на машине разработчика, где пакет остаётся лежать. Один
// уровень стоит 8 КиБ, так что заметили её не сразу — по глубине каталога.
//
// Сам разрыв цепочки — `outputFileTracingExcludes` в `next.config.mjs`: он выбрасывает
// `release/**` из трасс, и этого достаточно (проверено контрольным прогоном 2026-09-19).
// Этот шаг убирает не следствие, а вход: прошлого пакета на диске просто нет, а заодно
// не лежит несколько десятков мегабайт от позапрошлой упаковки. Третий слой — проверка
// постфактум в `scripts/package-release.mjs`.

import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const OUT = "release";

if (existsSync(OUT)) {
  await rm(OUT, { recursive: true, force: true });
  console.log(`· убран прошлый пакет ${OUT}/ — иначе трассировщик затянет его в сборку`);
}
