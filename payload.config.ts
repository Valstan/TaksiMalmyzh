import path from "path";
import { fileURLToPath } from "url";
import { buildConfig, type Payload } from "payload";
import { postgresAdapter } from "@payloadcms/db-postgres";

import { Users } from "./collections/Users";
import { Entries } from "./collections/Entries";
import { directoryDraft } from "./seed/directory-draft";
import { migrations } from "./migrations";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Первый запуск на пустой базе заводит супер-админа admin/admin и черновики номеров.
//
// Про admin/admin: так попросил владелец — он сменит логин и пароль сам в админке
// (Пользователи → admin). Пока пароль не сменён, вход защищён только тем, что о
// нём никто не знает из этого публичного репозитория... то есть ничем. Поэтому
// сид работает ТОЛЬКО на пустой таблице пользователей, а смена пароля — первое,
// что владелец делает после входа.
async function onInit(payload: Payload): Promise<void> {
  const users = await payload.count({ collection: "users" });
  if (users.totalDocs === 0) {
    await payload.create({
      collection: "users",
      data: { username: "admin", password: "admin", role: "superadmin" },
    });
    payload.logger.info("Создан супер-админ admin/admin — сменить пароль при первом входе!");
  }

  // Черновики номеров: идемпотентно, по названию. Публикация — только руками
  // супер-админа после проверки (гейт владельца 2026-08-29).
  const entries = await payload.count({ collection: "entries" });
  if (entries.totalDocs === 0) {
    for (const draft of directoryDraft) {
      await payload.create({
        collection: "entries",
        data: { ...draft, status: "draft" },
      });
    }
    payload.logger.info(`Засеяно черновиков справочника: ${directoryDraft.length} (не опубликованы)`);
  }

  // Регламент трасс. M0.A §3.4 требует не написанной процедуры, а показанной работы
  // расписания — значит кто-то должен её запускать, и это единственное место в проекте,
  // которое исполняется ровно один раз при старте службы.
  //
  // Динамический импорт, а не обычный: модуль тянет за собой пул подключений к схеме
  // track, и в сборке, где база — заглушка, он не нужен вовсе.
  const { startMaintenanceScheduler } = await import("./lib/track-scheduler.ts");
  startMaintenanceScheduler({
    info: (m) => payload.logger.info(m),
    error: (m) => payload.logger.error(m),
  });
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: " — ПОЗВОНИ" },
  },
  collections: [Users, Entries],
  secret: process.env.PAYLOAD_SECRET || "",
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI || "" },
    // Миграции применяются на старте прода: на боксе нет ни исходников, ни CLI —
    // только standalone-рантайм, поэтому «прогнать migrate руками» там нечем (G20).
    prodMigrations: migrations,
  }),
  typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
  onInit,
  telemetry: false,
});
