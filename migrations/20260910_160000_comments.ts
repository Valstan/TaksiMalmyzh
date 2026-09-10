import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { COMMENTS_DDL_UP, COMMENTS_DDL_DOWN } from '../lib/market-ddl.ts'

// Комментарии посетителей под номерами справочника (решение владельца 2026-09-10).
// Текст DDL — lib/market-ddl.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(COMMENTS_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(COMMENTS_DDL_DOWN))
}
