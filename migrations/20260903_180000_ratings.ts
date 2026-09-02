import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { RATINGS_DDL_UP, RATINGS_DDL_DOWN } from '../lib/market-ddl.ts'

// Спринт 9: работники бизнеса и звёзды. Текст DDL — lib/market-ddl.ts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(RATINGS_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(RATINGS_DDL_DOWN))
}
