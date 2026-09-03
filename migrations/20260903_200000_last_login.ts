import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Отметка последнего входа — опора ретеншна аккаунтов посетителей.
//
// Решение владельца 2026-09-03: неиспользуемый аккаунт посетителя живёт 12 месяцев.
// Считать «использование» по `updated_at` нельзя: его двигает любая правка строки, в том
// числе наша же чистка сессий, — тогда аккаунт стал бы вечным. Нужна отдельная отметка,
// которую двигает только вход.
//
// Колонка nullable намеренно: у существующих строк входа не было записано ни одного, и
// придумывать им дату — значит соврать. Ретеншн для таких берёт `created_at`
// (`COALESCE` в lib/account-retention.ts), то есть считает срок от появления аккаунта.
//
// ⚠️ Никакого `SET DEFAULT` и никакого использования новых значений enum: грабля
// 2026-09-02, уронившая прод, описана в 20260902_180000_visitor_role_name.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp(3) with time zone;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "users" DROP COLUMN IF EXISTS "last_login_at";`)
}
