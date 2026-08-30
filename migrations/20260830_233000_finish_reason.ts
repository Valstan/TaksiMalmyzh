import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { TRACK_DDL_FINISH_REASON_UP, TRACK_DDL_FINISH_REASON_DOWN } from '../lib/track-ddl.ts'

// Причина завершения поездки.
//
// Поездка, завершённая человеком, и поездка, которую завершил таймер после неподвижности и
// трёх неотвеченных напоминаний, — разные события, и второе может означать не «забыл
// выключить», а «что-то случилось». Постфактум их не различить ничем другим: трасса у обеих
// одинаковая. Это вход для лестницы эскалации спринта 4 (M0.A §5.3).

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_FINISH_REASON_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_FINISH_REASON_DOWN))
}
