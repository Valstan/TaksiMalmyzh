import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { KARMA_DDL_UP, KARMA_DDL_DOWN } from '../lib/crowd-ddl.ts'

// Карма справочника (решение владельца 2026-09-10). Текст DDL — lib/crowd-ddl.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(KARMA_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(KARMA_DDL_DOWN))
}
