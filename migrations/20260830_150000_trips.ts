import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { TRACK_DDL_UP, TRACK_DDL_DOWN } from '../lib/track-ddl.ts'

// Схема поездок и точек — спринт 3.
//
// Текст DDL живёт в lib/track-ddl.ts, а не здесь: одно и то же надо уметь и влить
// миграцией, и поднять в одноразовой базе проверкой. Схема, которую нельзя прогнать до
// прода, проверяется только на проде.
//
// Гейт первой миграции (M0.A §8.0) снят: риск этапа A принят владельцем письменно
// 2026-08-30 — записано в M0.A §8 и GO_LIVE_CHECKLIST.
//
// ⚠️ prodMigrations применяет эту миграцию на старте прода САМА. Влить её и выкатить
// схему персональных данных на прод — одно действие.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_DOWN))
}
