import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { TRACK_DDL_CHAT_UP, TRACK_DDL_CHAT_DOWN } from '../lib/track-ddl.ts'

// Спринт 6: переписка на странице поездки и номер для связи. Текст DDL — lib/track-ddl.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_CHAT_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_CHAT_DOWN))
}
