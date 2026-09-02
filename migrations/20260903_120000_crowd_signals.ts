import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { CROWD_DDL_UP, CROWD_DDL_DOWN } from '../lib/crowd-ddl.ts'

// Спринт 5: краудсигналы по номерам справочника. Текст DDL — lib/crowd-ddl.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(CROWD_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(CROWD_DDL_DOWN))
}
