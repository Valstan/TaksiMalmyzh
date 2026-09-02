import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { ENTRIES_BUSINESS_UP, ENTRIES_BUSINESS_DOWN, MARKET_DDL_UP, MARKET_DDL_DOWN } from '../lib/market-ddl.ts'

// Спринт 8: кабинеты бизнесов — поля карточки, заявки на владение, вызовы с адресом.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(ENTRIES_BUSINESS_UP))
  await db.execute(sql.raw(MARKET_DDL_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(MARKET_DDL_DOWN))
  await db.execute(sql.raw(ENTRIES_BUSINESS_DOWN))
}
