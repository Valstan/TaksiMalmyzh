import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { TRACK_DDL_WRITE_TOKEN_UP, TRACK_DDL_WRITE_TOKEN_DOWN } from '../lib/track-ddl.ts'

// Токен записи в поездку.
//
// Право писать точки и право читать трассу — разные права: lookup_id уходит доверенному
// контакту по ссылке, и если бы он же разрешал дописывать, контакт мог бы подделать трассу.
// Хранится хэш токена, не сам токен.
//
// Колонка nullable намеренно: на проде уже есть применённая схема, и добавлять NOT NULL без
// значения по умолчанию значило бы либо упасть на существующих строках, либо придумывать им
// фиктивный токен. Строк там сейчас ноль, но полагаться на это в миграции неправильно —
// миграция должна быть верной и на непустой таблице.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_WRITE_TOKEN_UP))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(TRACK_DDL_WRITE_TOKEN_DOWN))
}
