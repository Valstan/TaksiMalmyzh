// Ретеншн аккаунтов посетителей.
//
// Решение владельца 2026-09-03: аккаунт посетителя, в который не входили 12 месяцев,
// удаляется. Основание — разбор brain 2026-09-02, принятый проектом без возражений:
// аккаунт с именем из ЕСА и устойчивым `sub` это чужие персональные данные, и этапность
// бумаг, сформулированная 25.08 «к появлению чужих данных», сработала в день первого
// посетителя, а не когда откроется запись поездок им. Обещание срока, которое некому
// исполнить, — это не обещание; поэтому чистка механизирована, как у трасс, и пишет в тот
// же журнал уничтожения.
//
// ЧЕГО ЭТА ПРОЦЕДУРА НЕ ДЕЛАЕТ И ПОЧЕМУ — важнее того, что делает.
//
// 1. Не трогает `superadmin`. Персонал входит паролем и может не заходить на сайт месяцами;
//    удалить владельца по сроку — потерять доступ к собственной админке.
//
// 2. Не трогает владельцев бизнеса. `entries.owner_id` объявлен `ON DELETE SET NULL`
//    (lib/market-ddl.ts): удаление такого аккаунта не упало бы с ошибкой, а ТИХО сняло бы
//    владельца с карточки — вместе с кабинетом, вызовами и правом заводить работников.
//    Аккаунт, от которого зависит карточка, по определению не «неиспользуемый», сколько бы
//    в него ни входили: им пользуется бизнес, а не человек.
//
// 3. Не трогает того, у кого висит неподтверждённая заявка «это мой бизнес»
//    (`market.claim.status = 0`). Заявку подтверждает персонал звонком, и между подачей и
//    звонком может пройти сколько угодно: удалить заявителя посреди процедуры — значит
//    оборвать её молча.
//    У исключения есть дно — 30 дней (`CLAIM_GRACE_DAYS`, решение владельца 2026-09-03):
//    заявка, до которой персонал не дошёл за срок, гаснет и перестаёт защищать аккаунт.
//    Исключение из срока не может само быть бессрочным, иначе оно отменяет срок.
//
// 4. Не трогает того, у кого нет `oidcSub`. Отметку входа двигает только выдача сессии
//    через единый вход (`lib/oidc-session.ts`); парольный вход Payload её не двигает, и
//    учётка, входящая паролем, выглядела бы для ретеншна мёртвой вечно. Сегодня все
//    `role = 'user'` заведены через ЕСА и `oidcSub` у них есть, так что живых строк это не
//    исключает, — но будущая рукотворная парольная учётка не будет удалена по сроку,
//    которого мы для неё не измеряем.
//
// Всё остальное — удаляем, и убираем за собой ссылки: у `market.claim`,
// `market.request.customer_user_id` и `track.share.viewer_user_id` внешних ключей на
// `users` нет вовсе, поэтому после удаления там остались бы висячие идентификаторы
// несуществующих людей. Это ровно те данные, срок которых мы и обещали выдержать.

import type { Pool, PoolClient } from "pg";
import { trackPool } from "./track-db.ts";
import { CLAIM_GRACE_DAYS } from "./market.ts";

/** Решение владельца 2026-09-03. Одно место, где живёт число. */
export const ACCOUNT_RETENTION_MONTHS = 12;

export interface AccountPruneResult {
  deleted: number;
  /** Пропущено как «используемые»: владельцы карточек, заявители, успевшие войти. */
  keptInUse: number;
  /** Удаление не прошло — аккаунт остался, регламент пошёл дальше. */
  failed: number;
  /** Снято висячих ссылок на несуществующих пользователей. */
  orphans: number;
}

/**
 * Готовность к прогону: схема `market` поднята.
 *
 * Ошибку НЕ глотаем. `to_regclass` на несуществующей схеме возвращает NULL и не бросает,
 * поэтому исключение здесь означало бы настоящий сбой базы, а не «миграции ещё нет».
 * Прежняя версия ловила его в `false` — и прогон продолжался по ОСЛАБЛЕННОМУ предикату,
 * без исключения по заявкам и без уборки ссылок. Чистка, которая при недоступности своей
 * схемы не пропускает прогон, а удаляет по неполному условию, опаснее не работающей.
 */
export async function accountRetentionReady(pool: Pool = trackPool()): Promise<boolean> {
  const { rows } = await pool.query<{ yes: boolean }>(
    `SELECT to_regclass('market.claim') IS NOT NULL
        AND to_regclass('market.request') IS NOT NULL AS yes`,
  );
  return rows[0]?.yes === true;
}

// Условие «кого можно удалять» — один экземпляр текста на выборку и на перепроверку.
// Разъехавшись, они дали бы худшее из возможного: кандидат отобран по одному правилу,
// удалён по другому. `entries.owner_id` и схема `market` приезжают одной миграцией
// (20260903_160000_business), поэтому отдельной пробы на колонку нет — есть общий гейт
// `accountRetentionReady`.
const EXPIRED_PREDICATE = `
        u."role" = 'user'
    AND u."oidc_sub" IS NOT NULL
    AND COALESCE(u."last_login_at", u."created_at") < now() - ($MONTHS || ' months')::interval`;

const OWNER_GUARD = `NOT EXISTS (SELECT 1 FROM "entries" e WHERE e."owner_id" = u."id")`;

// Заявку защищает аккаунт только пока она в работе. Возраст проверяется здесь, а не только
// через статус: `expireStaleClaims` гасит просроченные раз в час, и между её прогонами
// заявка ещё числится ждущей. Без этого условия исключение из срока само оказалось бы
// бессрочным — ровно та дыра, которую закрывает решение владельца 2026-09-03 о 30 днях.
const CLAIM_GUARD = `NOT EXISTS (
      SELECT 1 FROM market.claim c
       WHERE c.user_id = u."id" AND c.status = 0
         AND c.at > now() - interval '${CLAIM_GRACE_DAYS} days')`;

/**
 * Кандидаты на удаление и те, кого срок достал, но мы держим.
 *
 * `COALESCE(last_login_at, created_at)`: колонка отметки заведена 2026-09-03, и у аккаунтов,
 * созданных до неё, входов не записано ни одного. Придумывать им дату входа — соврать;
 * считаем срок от появления аккаунта, это честная нижняя оценка.
 */
async function selectExpired(
  pool: Pool,
  months: number,
): Promise<{ due: number[]; keptInUse: number }> {
  const { rows } = await pool.query<{ id: number; in_use: boolean }>(
    `SELECT u."id" AS id, NOT (${OWNER_GUARD} AND ${CLAIM_GUARD}) AS in_use
       FROM "users" u
      WHERE ${EXPIRED_PREDICATE.replace("$MONTHS", "$1")}
      ORDER BY u."id"`,
    [String(months)],
  );
  return {
    due: rows.filter((r) => !r.in_use).map((r) => r.id),
    keptInUse: rows.filter((r) => r.in_use).length,
  };
}

/**
 * Тот же предикат, но по одному человеку и на отдельном соединении, вплотную к удалению.
 *
 * Между выборкой кандидатов и удалением проходит время: за него человек может войти
 * (`last_login_at` сдвинется) или подать заявку на бизнес. Окно короткое, но исход
 * несимметричный — лишний прогон ретеншна не стоит ничего, а удалённый аккаунт живого
 * человека не восстанавливается.
 *
 * `SKIP LOCKED`, а не `NOWAIT`: занятая кем-то строка просто не вернётся, и кандидат
 * отложится до следующего часа. `NOWAIT` бросил бы 55P03 — редкое зависание обменялось бы
 * на регулярный отказ.
 */
async function stillExpired(c: PoolClient, userId: number, months: number): Promise<boolean> {
  const { rows } = await c.query<{ yes: boolean }>(
    `SELECT true AS yes
       FROM "users" u
      WHERE u."id" = $1
        AND ${EXPIRED_PREDICATE.replace("$MONTHS", "$2")}
        AND ${OWNER_GUARD}
        AND ${CLAIM_GUARD}
      FOR UPDATE SKIP LOCKED`,
    [userId, String(months)],
  );
  return rows.length === 1;
}

/**
 * Убрать ссылки на удалённого там, где внешнего ключа нет.
 *
 * Экспортируется, потому что путь удаления посетителя в проекте НЕ один: привязка единого
 * входа к учётке персонала сливает посетительскую оболочку и тоже удаляет строку
 * (`app/(app)/api/auth/oidc/callback`). Инвариант «после удаления человека не остаётся
 * висячих ссылок» обязан держаться обоими путями, иначе он не инвариант.
 */
export async function detachUserReferences(c: PoolClient, userId: number): Promise<void> {
  // Собственные заявки посетителя: подтверждённая уже сделала своё дело (владелец
  // проставлен в entries), отклонённая — история решения персонала. Ни та, ни другая не
  // должна пережить человека, потому что обе — про него.
  await c.query(`DELETE FROM market.claim WHERE user_id = $1`, [userId]);
  // Вызов принадлежит бизнесу и живёт своим сроком (30 суток, pruneRequests). Убираем
  // только привязку к человеку — сам вызов не наш, чтобы его удалять.
  await c.query(`UPDATE market.request SET customer_user_id = NULL WHERE customer_user_id = $1`, [
    userId,
  ]);
  // Ссылка на поездку принадлежит тому, кто поездку писал; посетитель мог лишь привязаться
  // к ней как знакомый. Отвязываем, ссылку не трогаем.
  await c.query(`UPDATE track.share SET viewer_user_id = NULL WHERE viewer_user_id = $1`, [userId]);
}

/**
 * Подмести висячие ссылки на пользователей, которых уже нет.
 *
 * Нужна по двум причинам, и обе настоящие. Первая: между `payload.delete` и уборкой ссылок
 * есть окно, и падение процесса в нём оставило бы висячие идентификаторы. Вторая: удаление
 * из админки и слияние оболочки при привязке ЕСА идут мимо этой процедуры. Подметание
 * идемпотентно и дёшево, поэтому чинит оба случая, не требуя, чтобы каждый путь удаления
 * помнил про уборку.
 */
export async function sweepOrphanUserRefs(pool: Pool = trackPool()): Promise<number> {
  const absent = (col: string) => `NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = ${col})`;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const a = await c.query(`DELETE FROM market.claim WHERE ${absent("user_id")}`);
    const b = await c.query(
      `UPDATE market.request SET customer_user_id = NULL
        WHERE customer_user_id IS NOT NULL AND ${absent("customer_user_id")}`,
    );
    const d = await c.query(
      `UPDATE track.share SET viewer_user_id = NULL
        WHERE viewer_user_id IS NOT NULL AND ${absent("viewer_user_id")}`,
    );
    const n = (a.rowCount ?? 0) + (b.rowCount ?? 0) + (d.rowCount ?? 0);
    if (n > 0) {
      // Подметание — тоже уничтожение данных, и молчать о нём нельзя: строка в журнале
      // отличает «за нами убрали» от «этого никогда не было».
      await c.query(
        `INSERT INTO track.erasure_log (action, basis, target, rows_est, detail)
         VALUES ('sweep_orphan_user_refs', 'integrity', 'users', $1, $2)`,
        [n, JSON.stringify({ claims: a.rowCount, requests: b.rowCount, shares: d.rowCount })],
      );
    }
    await c.query("COMMIT");
    return n;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

interface PayloadLike {
  delete: (args: {
    collection: "users";
    id: number;
    overrideAccess: boolean;
    context?: Record<string, unknown>;
  }) => Promise<unknown>;
}

type Log = (message: string) => void;

/**
 * Ключ в `req.context`, которым удаление помечает себя как «уборка уже на мне».
 *
 * Хук `afterDelete` на коллекции ловит удаления, пришедшие мимо `eraseUser` (админка), и
 * по отсутствию этого ключа понимает, что убирать за собой некому.
 */
export const ERASURE_CONTEXT_KEY = "erasureBasis";

/**
 * Уборка и запись в журнал — ЕДИНСТВЕННАЯ реализация на все пути удаления человека.
 *
 * Вызывается из двух мест: `eraseUser` (срок и просьба — там мы контролируем порядок) и
 * хук `afterDelete` коллекции `users` (админка — туда иначе не дотянуться). Логика одна,
 * различается только основание в журнале.
 *
 * Не бросает: удаление уже состоялось, и падать после него значит оставить человека
 * удалённым, а нас — без записи о том, что мы за ним убрали. Ошибку отдаём наверх словами.
 */
export async function recordUserErasure(
  pool: Pool,
  userId: number,
  basis: string,
  role: string,
  log: Log = () => {},
): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await detachUserReferences(c, userId);
    // Ни имени, ни `sub` в журнал не пишем: журнал доказывает исполнение срока, а не
    // хранит то, срок чего вышел. Действие различает посетителя и сотрудника — это
    // разные события, и сводить их в одну строку значило бы потерять смысл обоих.
    await c.query(
      `INSERT INTO track.erasure_log (action, basis, target, rows_est, detail)
       VALUES ($1, $2, $3, 1, $4)`,
      [
        role === "superadmin" ? "delete_staff_account" : "delete_visitor_account",
        basis,
        String(userId),
        JSON.stringify({ role, basis }),
      ],
    );
    await c.query("COMMIT");
    return true;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    log(
      `удаление аккаунта ${userId}: уборка ссылок не прошла: ` +
        (e instanceof Error ? e.message : String(e)),
    );
    return false;
  } finally {
    c.release();
  }
}

/**
 * Держит ли на человеке карточка бизнеса.
 *
 * Нужно кнопке «удалить аккаунт»: удовлетворить просьбу человека, молча обезглавив при этом
 * чужую карточку (`entries.owner_id` объявлен `ON DELETE SET NULL`), — не то же самое, что
 * её исполнить. Такому человеку отвечаем словами, а не действием.
 */
export async function ownsEntries(pool: Pool, userId: number): Promise<boolean> {
  const { rows } = await pool.query<{ yes: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM "entries" WHERE "owner_id" = $1) AS yes`,
    [userId],
  );
  return rows[0]?.yes === true;
}

/**
 * Удалить человека и убрать за собой — единственная точка, через которую это делается.
 *
 * Путей, которыми аккаунт исчезает, три: срок (регламент), просьба самого человека (кнопка
 * на `/dannye`) и рука персонала в админке. Первые два обязаны давать одинаковый результат,
 * иначе обещание «удаляем и убираем ссылки» верно только для одного из них; третий закрыт
 * подметанием `sweepOrphanUserRefs`.
 *
 * `basis` — основание в журнале уничтожения: `retention_12m` у срока, `request` у просьбы.
 * По нему потом отличают «истёк срок» от «человек попросил», а это разные истории.
 *
 * ПОРЯДОК: сначала удаление, потом уборка и журнал. Обратный при отказе удаления оставил бы
 * ЖИВОГО человека без его заявок и со строкой в журнале о том, что его стёрли.
 */
export async function eraseUser(
  payload: PayloadLike,
  pool: Pool,
  userId: number,
  basis: string,
  log: Log = () => {},
  role = "user",
): Promise<void> {
  // Метка в контексте говорит хуку коллекции «не трогай, уборка на мне»: иначе она
  // случилась бы дважды — из хука и отсюда, и в журнале завелось бы по две строки на
  // человека.
  await payload.delete({
    collection: "users",
    id: userId,
    overrideAccess: true,
    context: { [ERASURE_CONTEXT_KEY]: basis },
  });

  // Уборка ПОСЛЕ того, как `delete` вернул управление: значит транзакция Payload уже
  // закоммичена, и мы не пишем в журнал про человека, удаление которого потом откатится.
  // Ровно этим путь через `eraseUser` лучше хука — там такой гарантии нет.
  await recordUserErasure(pool, userId, basis, role, log);
}

/**
 * Прогон ретеншна. Идемпотентен: повторный вызов не находит уже удалённых.
 *
 * Удаление идёт локальным API Payload, а не `DELETE` по таблице: у коллекции есть сессии
 * и хуки, и обходить их значит оставить за собой мусор в тех местах, о которых мы сегодня
 * не думаем. Отвязка ссылок — сырым SQL, потому что те таблицы Payload не знает.
 *
 * ПОРЯДОК ВАЖЕН: перепроверка → удаление → уборка и запись в журнал. Обратный порядок
 * (сначала уборка и журнал, потом удаление) выглядит безопаснее, но при отказе удаления
 * оставляет ЖИВОГО человека без его заявок и со строкой в журнале, утверждающей, что его
 * стёрли. Цена выбранного порядка — окно между удалением и уборкой; его закрывает
 * `sweepOrphanUserRefs`, которая всё равно нужна из-за других путей удаления.
 */
export async function pruneVisitorAccounts(
  payload: PayloadLike,
  pool: Pool = trackPool(),
  months: number = ACCOUNT_RETENTION_MONTHS,
  log: Log = () => {},
): Promise<AccountPruneResult> {
  if (!Number.isInteger(months) || months < 1) {
    // `months = 0` вырождает предикат в «создан раньше, чем сейчас», то есть в удаление
    // всех посетителей разом. Такой аргумент — всегда опечатка, и лучше упасть.
    throw new Error(`ретеншн аккаунтов: срок должен быть целым числом месяцев ≥ 1, получено ${months}`);
  }
  if (!(await accountRetentionReady(pool))) {
    throw new Error("ретеншн аккаунтов: схема market не готова — прогон не запускается");
  }

  const { due, keptInUse } = await selectExpired(pool, months);

  let deleted = 0;
  let racedBack = 0;
  let failed = 0;

  for (const id of due) {
    const c = await pool.connect();
    let proceed = false;
    try {
      await c.query("BEGIN");
      proceed = await stillExpired(c, id, months);
      // Блокировку снимаем сразу: `payload.delete` идёт своим соединением и на удерживаемой
      // строке заблокировал бы сам себя.
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    if (!proceed) {
      racedBack++;
      continue;
    }

    try {
      await eraseUser(payload, pool, id, `retention_${months}m`, log);
    } catch (e) {
      // Один битый аккаунт не должен останавливать очередь: иначе он навсегда первый по
      // `ORDER BY id`, и все остальные не удаляются никогда — при внешне работающем
      // регламенте. Ссылки при этом не тронуты, человек цел.
      failed++;
      log(`ретеншн аккаунтов: не удалось удалить ${id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    deleted++;
  }

  const orphans = await sweepOrphanUserRefs(pool);

  // Успевшие «ожить» между выборкой и удалением попадают в тот же счётчик используемых:
  // для читателя журнала разница между «владеет карточкой» и «вошёл минуту назад» одна —
  // человек пользуется аккаунтом, и мы его не тронули.
  return { deleted, keptInUse: keptInUse + racedBack, failed, orphans };
}
