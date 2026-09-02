import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { TRACK_DDL_SHARE_UP, TRACK_DDL_SHARE_DOWN } from '../lib/track-ddl.ts'

// Спринт 4: ссылки доступа доверенному контакту и состояние «мёртвой руки» (M0.A §5–§6).
// Текст DDL — в lib/track-ddl.ts, чтобы проверка схемы поднимала ровно то же.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_SHARE_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_SHARE_DOWN))
}
