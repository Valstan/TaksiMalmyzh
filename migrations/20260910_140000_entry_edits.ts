import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { ENTRY_EDIT_DDL_UP, ENTRY_EDIT_DDL_DOWN } from '../lib/market-ddl.ts'

// Предложенные правки к записям справочника (решение владельца 2026-09-10).
// Текст DDL — lib/market-ddl.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(ENTRY_EDIT_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(ENTRY_EDIT_DDL_DOWN))
}
