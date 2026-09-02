import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Посетители: роль `user` и имя из единого входа.
//
// Решение владельца 2026-09-02: вход через ВК (через ЕСА) должен создавать аккаунт сам.
// Значение enum добавляется, а не пересоздаётся: у существующих строк роль `superadmin`,
// и она обязана пережить миграцию. Умолчание колонки меняется на `user` — так же, как
// `defaultValue` поля в `collections/Users.ts`, чтобы автомиграция не увидела расхождения.
//
// `ADD VALUE` внутри транзакции разрешён с PostgreSQL 12; использовать новое значение в
// той же транзакции нельзя — здесь и не используем.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_users_role" ADD VALUE IF NOT EXISTS 'user';`)
  await db.execute(sql`
    ALTER TABLE "users" ADD COLUMN "name" varchar;
    ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Значение из enum PostgreSQL не убирается; откат возвращает умолчание и снимает колонку.
  await db.execute(sql`
    ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'superadmin';
    ALTER TABLE "users" DROP COLUMN IF EXISTS "name";
  `)
}
