import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Посетители: роль `user` и имя из единого входа.
//
// Решение владельца 2026-09-02: вход через ВК (через ЕСА) должен создавать аккаунт сам.
// Значение enum добавляется, а не пересоздаётся: у существующих строк роль `superadmin`,
// и она обязана пережить миграцию.
//
// ⚠️ `ADD VALUE` внутри транзакции разрешён с PostgreSQL 12, но использовать новое
// значение в той же транзакции НЕЛЬЗЯ — «unsafe use of new value». Первая версия этой
// миграции ставила `SET DEFAULT 'user'` следом и уронила прод 2026-09-02 (цикл рестартов,
// откат на предыдущий релиз). Умолчание в базе поэтому не трогаем: Payload всегда
// присылает роль явно (`defaultValue` поля живёт в приложении), базе умолчание не нужно.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_users_role" ADD VALUE IF NOT EXISTS 'user';`)
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Значение из enum PostgreSQL не убирается; откат снимает только колонку.
  await db.execute(sql`ALTER TABLE "users" DROP COLUMN IF EXISTS "name";`)
}
