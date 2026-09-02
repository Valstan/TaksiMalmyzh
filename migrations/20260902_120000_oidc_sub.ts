import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Привязка пользователя к единому входу экосистемы (вход.вмалмыже.рф).
//
// Один `sub` — одна учётка: уникальный индекс не даёт двум пользователям привязать один
// и тот же аккаунт ЕСА, а NULL у непривязанных под уникальность не попадает.
// Имена колонки и индекса — те, что построил бы сам Payload для поля `oidcSub`
// с `unique: true`, чтобы следующая автоматическая миграция не увидела расхождения.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users" ADD COLUMN "oidc_sub" varchar;
    CREATE UNIQUE INDEX "users_oidc_sub_idx" ON "users" USING btree ("oidc_sub");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "users_oidc_sub_idx";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "oidc_sub";
  `)
}
