// Заводит локальную базу и роль проекта в общем PostgreSQL этой машины.
//
// Сервер на машине один и обслуживает несколько репозиториев, поэтому у каждого
// проекта своя роль и своя база, а подключиться к чужой базе роль не может: право
// CONNECT у PUBLIC отзывается. По умолчанию PostgreSQL его выдаёт, и на общей
// машине это не то, чего ждёшь.
//
// Скрипт идемпотентен: повторный запуск ничего не ломает. Пароль роли генерируется
// один раз и кладётся в .env.local — файл под .gitignore. В репозиторий пароль не
// попадает ни при каком запуске.
//
// Запуск:  npm run db:setup
//
// Пароль суперпользователя берётся из PGPASSWORD, иначе из PGSUPERPASSWORD, иначе
// пробуется значение по умолчанию, которое ставит автоматический установщик.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROLE = "taksi";
const DB = "taksi_dev";
const HOST = "127.0.0.1";
const PORT = process.env.PGPORT ?? "5432";
const SUPER = process.env.PGSUPERUSER ?? "postgres";
const SUPER_PW = process.env.PGPASSWORD ?? process.env.PGSUPERPASSWORD ?? "postgres";
const ENV_FILE = ".env.local";

// Windows-установщик кладёт psql сюда и в PATH его не добавляет.
const CANDIDATES = [
  "psql",
  "C:/Program Files/PostgreSQL/17/bin/psql.exe",
  "C:/Program Files/PostgreSQL/18/bin/psql.exe",
  "/usr/bin/psql",
];

function findPsql() {
  for (const c of CANDIDATES) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      // следующий кандидат
    }
  }
  console.error("✗ psql не найден. Установите PostgreSQL или добавьте psql в PATH.");
  process.exit(1);
}

const psql = findPsql();

function run(db, sql, { asSuper = true, password } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dbsetup-"));
  const file = path.join(dir, "q.sql");
  try {
    // SQL уходит файлом, а не аргументом: внутри бывают кавычки и не-ASCII,
    // а командная строка Windows их коверкает (мандат D-046).
    writeFileSync(file, sql, "utf8");
    return execFileSync(
      psql,
      ["-h", HOST, "-p", PORT, "-U", asSuper ? SUPER : ROLE, "-d", db,
       "-v", "ON_ERROR_STOP=1", "-tA", "-f", file],
      { env: { ...process.env, PGPASSWORD: password ?? SUPER_PW }, encoding: "utf8" },
    ).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- пароль роли: берём существующий из .env.local, иначе генерируем

let rolePassword = null;
if (existsSync(ENV_FILE)) {
  const m = readFileSync(ENV_FILE, "utf8").match(/^DATABASE_URI=postgres:\/\/[^:]+:([^@]+)@/m);
  if (m) rolePassword = decodeURIComponent(m[1]);
}
const generated = rolePassword === null;
rolePassword ??= randomBytes(18).toString("base64url");

// --- роль

const esc = rolePassword.replace(/'/g, "''");
run(
  "postgres",
  `DO $$ BEGIN
     IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN
       ALTER ROLE ${ROLE} LOGIN PASSWORD '${esc}';
     ELSE
       CREATE ROLE ${ROLE} LOGIN PASSWORD '${esc}';
     END IF;
   END $$;`,
);
console.log(`· роль ${ROLE}: ${generated ? "создана" : "пароль подтверждён"}`);

// --- база

const exists = run("postgres", `SELECT 1 FROM pg_database WHERE datname = '${DB}';`);
if (!exists) {
  // CREATE DATABASE нельзя внутри транзакции, поэтому отдельным вызовом.
  run("postgres", `CREATE DATABASE ${DB} OWNER ${ROLE} ENCODING 'UTF8';`);
  console.log(`· база ${DB} создана`);
} else {
  console.log(`· база ${DB} уже есть`);
}

// --- изоляция от соседних проектов на том же сервере

run(
  DB,
  `REVOKE CONNECT ON DATABASE ${DB} FROM PUBLIC;
   GRANT CONNECT ON DATABASE ${DB} TO ${ROLE};
   ALTER SCHEMA public OWNER TO ${ROLE};`,
);
console.log("· изоляция: CONNECT у PUBLIC отозван, схема public принадлежит роли");

// --- .env.local

const uri = `postgres://${ROLE}:${encodeURIComponent(rolePassword)}@${HOST}:${PORT}/${DB}`;
let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (/^DATABASE_URI=/m.test(env)) {
  env = env.replace(/^DATABASE_URI=.*$/m, `DATABASE_URI=${uri}`);
} else {
  env +=
    (env && !env.endsWith("\n") ? "\n" : "") +
    "\n# Заведено scripts/setup-local-db.mjs. Файл под .gitignore.\n" +
    `DATABASE_URI=${uri}\n`;
}
writeFileSync(ENV_FILE, env, "utf8");
console.log(`· строка подключения записана в ${ENV_FILE} (пароль в репозиторий не попадает)`);

// --- проверка: роль реально подключается и умеет писать

const check = run(
  DB,
  `CREATE TABLE IF NOT EXISTS _setup_probe(id int primary key);
   DROP TABLE _setup_probe;
   SELECT current_user || '/' || current_database();`,
  { asSuper: false, password: rolePassword },
);
console.log(`· проверено подключение и запись: ${check}`);
