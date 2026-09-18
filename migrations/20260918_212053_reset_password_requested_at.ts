import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Отметка последней заявки на сброс пароля — служебное поле Payload 3.90.0.
//
// В 3.90.0 «забыли пароль» получил троттлинг: повторная заявка раньше, чем через
// `auth.forgotPassword.minRequestInterval`, отбрасывается, а сам сброс теперь гасит замок
// аккаунта. Опора троттлинга — новое поле `resetPasswordRequestedAt` у auth-коллекции.
//
// ⚠️ Поле появляется БЕЗ нашего участия. В конфигурации `collections/Users.ts` секции
// `forgotPassword` нет вовсе, и по коду `getAuthFields` поле добавляется только при
// `minRequestInterval > 0` — но `collections/config/defaults.js` проставляет умолчание
// 15000 раньше, чем это условие проверяется. То есть колонка нужна всем, кто обновился,
// а не только тем, кто троттлинг настроил: без неё Payload на первом же запросе к
// `users` уйдёт в ошибку по отсутствующей колонке. Проверено перегенерацией
// `payload-types.ts` — поле там появилось само.
//
// Колонка nullable намеренно: у существующих строк заявок на сброс не было, и придумывать
// им дату — значит соврать. Троттлинг такую строку пропускает как «заявок ещё не было»,
// что и есть правда.
//
// ⚠️ Никакого `SET DEFAULT` и никакого использования новых значений enum: грабля
// 2026-09-02, уронившая прод, описана в 20260902_180000_visitor_role_name.ts.
//
// Имя и тип колонки взяты не по памяти, а из миграции, которую сгенерировал сам Payload
// (`payload migrate:create`); остальное из того вывода отброшено — локальная база отстала
// от цепочки, и drizzle надиффил заново уже применённое.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at" timestamp(3) with time zone;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_requested_at";`,
  )
}
