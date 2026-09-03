import { trackPool } from "./track-db.ts";
import { partitionRunwayDays, runMaintenance } from "./track-maintenance.ts";
import { escalateTrips } from "./track-share.ts";
import { crowdReady, pruneCrowdSignals } from "./crowd-signals.ts";
import { pruneChat } from "./track-chat.ts";
import { expireStaleClaims, marketReady, pruneRequests } from "./market.ts";
import { pruneRatings, ratingsReady } from "./ratings.ts";
import {
  ACCOUNT_RETENTION_MONTHS,
  accountRetentionReady,
  pruneVisitorAccounts,
} from "./account-retention.ts";

/** Лестница «мёртвой руки» считает минуты — и проверяется раз в минуту (M0.A §5.3). */
const ESCALATE_EVERY_MS = 60 * 1000;

// Планировщик регламента трасс.
//
// M0.A §3.4 требует не написанной процедуры, а ПОКАЗАННОЙ РАБОТЫ РАСПИСАНИЯ: «возраст самой
// старой партиции ≤ 30 суток плюс ширина партиции, проверяется ежедневно; отсутствие строки
// аудита за 25 часов — алерт; отказ процедуры должен быть громким, а не тихим».
//
// Почему в процессе приложения, а не pg_cron и не системным таймером:
// - pg_cron требует правки конфигурации всего кластера, которым проект не распоряжается
//   единолично (бокс общий с тремя соседями), и его наличие на боевой конфигурации не
//   проверено;
// - системный таймер потребовал бы отдельного входа в приложение с правами на схему track,
//   то есть второго канала доступа к персональным данным;
// - процесс приложения уже имеет и подключение, и ключ, и один экземпляр на боксе.
//
// Все процедуры идемпотентны, поэтому планировщик взаимозаменяем: если однажды понадобится
// внешний, достаточно перестать запускать этот и дёргать те же функции.

/** Час — компромисс: партиции нужны за сутки вперёд, свёртка не срочная. */
const EVERY_MS = 60 * 60 * 1000;
/** Первый прогон не на старте: пусть приложение сначала поднимется и ответит людям. */
const FIRST_DELAY_MS = 30 * 1000;
/** Меньше этого запаса партиций — кричим: у приёма точек кончается взлётная полоса. */
const RUNWAY_ALERT_DAYS = 3;

let started = false;

type Logger = { info: (m: string) => void; error: (m: string) => void };

async function schemaReady(): Promise<boolean> {
  try {
    const { rows } = await trackPool().query<{ yes: boolean }>(
      `SELECT to_regclass('track.point') IS NOT NULL AS yes`,
    );
    return rows[0]?.yes === true;
  } catch {
    return false;
  }
}

/** M0.A §3.4: отсутствие строки аудита за 25 часов — алерт. */
const STALE_ALERT_HOURS = 25;

async function tick(log: Logger): Promise<void> {
  try {
    // Отставание обнаруживается ДО прогона: после него строка свежая, и факт того, что
    // расписание сутки не работало, был бы затёрт собственным успехом.
    const behind = await hoursSinceLastRun();
    if (behind !== null && behind > STALE_ALERT_HOURS) {
      log.error(
        `регламент трасс отставал ${behind.toFixed(1)} ч (порог ${STALE_ALERT_HOURS} ч) — ` +
          `служба была недоступна дольше суток; проверить, не пропал ли срок хранения`,
      );
    }

    const r = await runMaintenance(trackPool());
    // Строка в журнал уходит всегда, даже когда делать было нечего: её ОТСУТСТВИЕ и есть
    // сигнал о поломке расписания (M0.A §3.4), а значит молчание при успехе недопустимо.
    log.info(
      `регламент трасс: партиций ${r.partitions}, закрыто ${r.abandoned}, удалено пустых ` +
        `${r.voided}, свёрнуто ${r.folded}, партиций удалено ${r.dropped.length}, ` +
        `погашено ${r.pruned}, запас партиций ${r.runway} сут`,
    );
    // Чат (спринт 6): переписка и номер для связи умирают со свёрткой поездки.
    try {
      const chatPruned = await pruneChat(trackPool());
      if (chatPruned) log.info(`чат поездок: удалено со свёрткой ${chatPruned}`);
    } catch (e) {
      // Таблицы ещё может не быть (миграция не применена) — не роняем регламент.
      log.error(`чат поездок: чистка не прошла: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Вызовы (спринт 8): телефон клиента не лежит дольше 30 суток.
    if (await marketReady(trackPool())) {
      const reqPruned = await pruneRequests(trackPool());
      if (reqPruned) log.info(`вызовы: удалено по сроку ${reqPruned}`);
      // Заявки на владение, до которых персонал не дошёл за срок (решение владельца
      // 2026-09-03). Гасим, а не удаляем: заявитель должен увидеть, что произошло, и иметь
      // возможность подать снова. Заодно это снимает исключение из ретеншна аккаунтов —
      // иначе оно было бы бессрочным и отменяло сам срок.
      const expired = await expireStaleClaims(trackPool());
      if (expired) log.info(`заявки на владение: истекло без ответа ${expired}`);
    }
    // Рейтинги (спринт 9): голоса старше года — вон.
    if (await ratingsReady(trackPool())) {
      const rp = await pruneRatings(trackPool());
      if (rp) log.info(`рейтинги: удалено по сроку ${rp}`);
    }
    // Краудсигналы (спринт 5): строки старше срока — вон. Своя схема, свой guard.
    if (await crowdReady(trackPool())) {
      const pruned = await pruneCrowdSignals(trackPool());
      if (pruned) log.info(`краудсигналы: удалено по сроку ${pruned}`);
    }
    // Аккаунты посетителей (решение владельца 2026-09-03): 12 месяцев без входа — удаление.
    // Гейт готовности снаружи, как у вызовов, рейтингов и краудсигналов: не подтверждена
    // схема — прогон пропускается целиком, а не идёт по ослабленному условию.
    // Payload берём динамическим импортом по той же причине, что и в lib/track-gate.ts:
    // `@payload-config` — алиас сборщика, и обычный node его не резолвит, а модуль должен
    // оставаться пригодным для проверок, где Payload не поднимают.
    if (await accountRetentionReady(trackPool())) {
      try {
        const { getPayload } = await import("payload");
        const { default: config } = await import("@payload-config");
        const acc = await pruneVisitorAccounts(
          await getPayload({ config }),
          trackPool(),
          ACCOUNT_RETENTION_MONTHS,
          (m) => log.error(m),
        );
        if (acc.deleted || acc.keptInUse || acc.orphans) {
          log.info(
            `аккаунты посетителей: удалено по сроку ${acc.deleted} ` +
              `(${ACCOUNT_RETENTION_MONTHS} мес), оставлено используемых ${acc.keptInUse}, ` +
              `подметено висячих ссылок ${acc.orphans}`,
          );
        }
        if (acc.failed) {
          log.error(
            `аккаунты посетителей: НЕ УДАЛОСЬ удалить ${acc.failed} — они остались в базе ` +
              `со своими данными, срок по ним не исполнен`,
          );
        }
      } catch (e) {
        // Не роняем весь регламент: срок трасс важнее и не должен зависеть от Payload.
        log.error(
          `аккаунты посетителей: чистка НЕ ОТРАБОТАЛА: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (r.runway < RUNWAY_ALERT_DAYS) {
      log.error(
        `регламент трасс: запас партиций всего ${r.runway} суток — приём точек скоро начнёт ` +
          `падать с «для строки не найдена секция»`,
      );
    }
  } catch (e) {
    // Громко, а не тихо: сообщение уходит в журнал systemd, где его видно рядом с
    // падениями службы. Тихий отказ ретеншна — это молча нарушенное обещание срока.
    log.error(`регламент трасс НЕ ОТРАБОТАЛ: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Запустить планировщик. Идемпотентно: повторный вызов ничего не делает.
 *
 * Таймер `unref`нут — он не должен удерживать процесс, если тот решил завершиться.
 */
export function startMaintenanceScheduler(log: Logger): void {
  if (started) return;
  if (!process.env.DATABASE_URI) return;
  started = true;

  const run = () => {
    void (async () => {
      if (!(await schemaReady())) {
        // Схемы ещё нет (миграция не применена) — не шумим на каждом часу.
        return;
      }
      await tick(log);
    })();
  };

  setTimeout(run, FIRST_DELAY_MS).unref?.();
  setInterval(run, EVERY_MS).unref?.();

  // Тревога и раскрытие — отдельным, частым тиком: часовой регламент для них слишком редок,
  // а ошибка в нём не должна останавливать лестницу. Пишет в лог только когда что-то
  // изменилось: тихий прогон раз в минуту не должен засорять журнал.
  const escalate = () => {
    void (async () => {
      if (!(await schemaReady())) return;
      try {
        const r = await escalateTrips(trackPool());
        if (r.alarmed || r.calmed || r.disclosed) {
          log.info(`мёртвая рука: тревог ${r.alarmed}, снято ${r.calmed}, раскрыто ${r.disclosed}`);
        }
      } catch (e) {
        log.error(`мёртвая рука НЕ ОТРАБОТАЛА: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };
  setInterval(escalate, ESCALATE_EVERY_MS).unref?.();
  log.info(`регламент трасс: планировщик запущен, прогон раз в ${EVERY_MS / 60000} мин`);
}

/** Для проверок: сбросить флаг, чтобы можно было запустить ещё раз. */
export function resetSchedulerForTests(): void {
  started = false;
}

/**
 * Свежесть регламента: сколько часов прошло с последнего успешного прогона.
 * `null` — прогонов не было вовсе. M0.A §3.4: больше 25 часов — алерт.
 */
export async function hoursSinceLastRun(): Promise<number | null> {
  const { rows } = await trackPool().query<{ h: string | null }>(
    `SELECT EXTRACT(EPOCH FROM (now() - max(started_at))) / 3600 AS h
       FROM track.maintenance_run WHERE job = 'ensure_partitions' AND ok`,
  );
  return rows[0]?.h === null || rows[0]?.h === undefined ? null : Number(rows[0].h);
}
