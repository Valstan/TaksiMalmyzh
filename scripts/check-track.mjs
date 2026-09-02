// Сквозная проверка схемы трасс на живом PostgreSQL.
//
// Схему, которую нельзя прогнать до прода, проверяют на проде — самой дорогой площадке из
// возможных. Здесь в схеме `track` исполняется ТОТ ЖЕ DDL, что уходит миграцией
// (lib/track-ddl.ts — один экземпляр текста), и проверяется всё, что должно работать: приём
// пачками, идемпотентность досылки, шифрование и его привязка к месту, автозакрытие,
// свёртка на T+48 ч, удаление по возрасту вместе с его инвариантом.
//
// Проверка не декоративная: на первом же прогоне она поймала настоящий изъян — поездка без
// единой точки не сворачивалась и не гасилась по сроку, то есть оставалась строкой без
// конца жизни (запрещено M0.A §3.6). Теперь такие поездки удаляются с записью в журнал.
//
// Запуск: npm run check:track   (нужен PostgreSQL: локальный из .env.local или DATABASE_URI)
//
// Схема `track` в конце сносится. Если в ней уже есть поездки, проверка НЕ запускается.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

// DATABASE_URI из окружения имеет приоритет: в CI никакого .env.local нет.
let uri = process.env.DATABASE_URI;
if (!uri) {
  try {
    uri = readFileSync(".env.local", "utf8").match(/DATABASE_URI=(.*)/)?.[1]?.trim();
  } catch {
    /* .env.local может не существовать — сообщим ниже */
  }
}
if (!uri) {
  console.error("нет DATABASE_URI ни в окружении, ни в .env.local — сначала npm run db:setup");
  process.exit(1);
}

// Ключ шифрования для проверки — одноразовый, в репозиторий не попадает.
process.env.TRACK_ENCRYPTION_KEY = `1:${randomBytes(32).toString("base64")}`;

// Модули приёма читают DATABASE_URI из окружения — подставляем до их импорта.
process.env.DATABASE_URI = uri;

const { TRACK_DDL_ALL } = await import("../lib/track-ddl.ts");
const crypto = await import("../lib/track-crypto.ts");
const maint = await import("../lib/track-maintenance.ts");
const trips = await import("../lib/track-trips.ts");
const gate = await import("../lib/track-gate.ts");
const sched = await import("../lib/track-scheduler.ts");

let failed = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failed++; };
const eq = (a, b, m) => (a === b ? ok(`${m}: ${a}`) : fail(`${m}: получено ${a}, ожидалось ${b}`));
const utcToday = () => new Date().toISOString().slice(0, 10);

// Схема `track` поднимается в рабочей базе разработчика и сносится в конце: роль проекта
// намеренно не имеет права CREATEDB (npm run db:setup отзывает лишнее), и заводить ради
// проверки отдельную базу было бы либо расширением прав, либо ручным шагом.
//
// Предохранитель: если в схеме уже есть данные — не трогаем ничего. Проверка не должна
// однажды снести чью-то работу только потому, что её запустили не в тот момент.
const pool = new pg.Pool({ connectionString: uri });

try {
  const { rows: [exists] } = await pool.query(
    `SELECT to_regclass('track.trip') IS NOT NULL AS yes`,
  );
  if (exists.yes) {
    const { rows: [n] } = await pool.query(`SELECT count(*)::int c FROM track.trip`);
    if (n.c > 0) {
      console.error(`в схеме track уже ${n.c} поездок — проверка не запускается, чтобы ничего не снести`);
      process.exit(1);
    }
  }
  // --- ключ из systemd-credential имеет приоритет над переменной окружения
  //
  // На проде переменной TRACK_ENCRYPTION_KEY нет вовсе: ключ подаётся credential'ом, потому
  // что переменные окружения процесса читаются соседями по общему боксу через
  // /proc/<pid>/environ. Если приоритет однажды сломается, прод молча возьмёт не тот ключ —
  // а «не тот ключ» это нечитаемые трассы, обнаруживаемые в худший момент.
  {
    const dir = mkdtempSync(join(tmpdir(), "track-cred-"));
    // Эпоха в credential нарочно другая: так видно, ЧТО именно прочиталось.
    writeFileSync(join(dir, "track_key"), `7:${randomBytes(32).toString("base64")}\n`);
    process.env.CREDENTIALS_DIRECTORY = dir;
    crypto.resetKeyCacheForTests();
    eq(crypto.currentEpoch(), 7, "эпоха ключа прочитана из credential, а не из переменной");
    delete process.env.CREDENTIALS_DIRECTORY;
    rmSync(dir, { recursive: true, force: true });
    crypto.resetKeyCacheForTests();
    eq(crypto.currentEpoch(), 1, "без credential берётся переменная окружения");
  }

  await pool.query(`DROP SCHEMA IF EXISTS track CASCADE`);
  await pool.query(TRACK_DDL_ALL);
  ok("DDL применился");

  // --- гейт этапа A: запись закрыта по умолчанию
  //
  // Стенд открыт наружу, и открытый эндпоинт записи означал бы, что поездку может записать
  // посторонний — то есть переход на этап B без единого решения владельца. Гейт проверяется
  // здесь, а не только глазами в коде, потому что цена ошибки — пересечённая граница.
  //
  // Токена, который надо вводить, больше нет: право записи даёт сессия приложения. Здесь
  // проверяется мастер-выключатель — единственная часть гейта, которая не требует поднимать
  // Payload. Ветка «вошёл / не вошёл» проверяется по HTTP на релизном пакете.
  {
    const req = () => new Request("https://x/api/track");
    const saveR = process.env.TRACK_RECORDING;

    delete process.env.TRACK_RECORDING;
    eq((await gate.checkRecordingGate(req())).status, 404,
      "без TRACK_RECORDING запись невидима, код");

    // Выключатель отвечает на вопрос «открыт ли этап записи вообще» и обязан закрывать
    // дверь раньше, чем начнётся разговор о том, кто пришёл.
    process.env.TRACK_RECORDING = "off";
    eq((await gate.checkRecordingGate(req())).status, 404, "TRACK_RECORDING=off — тоже 404");

    if (saveR === undefined) delete process.env.TRACK_RECORDING; else process.env.TRACK_RECORDING = saveR;
  }

  const DAY = "2026-09-07";                       // понедельник
  const startedAt = new Date("2026-09-07T08:00:00Z");
  await maint.ensurePartitions(pool, startedAt);
  const runway = await maint.partitionRunwayDays(pool, startedAt);
  runway >= 14 ? ok(`партиций вперёд: ${runway} суток`) : fail(`партиций вперёд всего ${runway} суток`);

  // --- заводим поездку
  const tripKey = crypto.newTripKey();
  const epoch = crypto.currentEpoch();
  const { rows: [trip] } = await pool.query(
    `INSERT INTO track.trip (install_ref, lookup_id, started_at, day, trip_key_wrapped, key_epoch)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [crypto.installRef("install-проверка"), randomBytes(16), startedAt, DAY, Buffer.alloc(0), epoch],
  );
  await pool.query(`UPDATE track.trip SET trip_key_wrapped = $2 WHERE id = $1`,
    [trip.id, crypto.wrapTripKey(tripKey, trip.id, epoch)]);
  ok(`поездка ${trip.id} заведена`);

  // --- приём пачки
  // Трасса с поворотами, а не прямая: на прямой Douglas–Peucker честно оставляет две точки,
  // и такой «тест» проверял бы только то, что алгоритм умеет схлопывать отрезок.
  // Здесь пять кварталов с поворотами на 90°, шум GPS ±3 м — заметно ниже eps 15 м.
  const N = 150;
  const LEG = 30;
  const mkPoint = (i) => {
    const leg = Math.floor(i / LEG);          // какой квартал
    const k = i % LEG;                        // шаг внутри квартала
    const east = leg % 2 === 0;               // чередуем восток / север
    const base = { lat: 565120000, lng: 507030000 };
    for (let l = 0; l < leg; l++) {
      if (l % 2 === 0) base.lng += LEG * 900; else base.lat += LEG * 500;
    }
    return {
      tMs: i * 3000,
      latE7: base.lat + (east ? 0 : k * 500) + ((i * 37) % 60) - 30,
      lngE7: base.lng + (east ? k * 900 : 0) + ((i * 53) % 60) - 30,
      accDm: 80 + (i % 30),
      spdCms: 900 + (i % 100),
      flags: i === 0 ? 0b10 : i === N - 1 ? 0b100 : 0,
      stopS: 0,
    };
  };

  async function ingest(from, to) {
    const vals = [];
    const params = [];
    for (let i = from; i < to; i++) {
      const boxed = crypto.sealPoint(tripKey, trip.id, i, startedAt.getTime(), mkPoint(i));
      params.push(DAY, trip.id, i, boxed);
      const b = params.length;
      vals.push(`($${b - 3}, $${b - 2}, $${b - 1}, $${b})`);
    }
    const r = await pool.query(
      `INSERT INTO track.point (day, trip_id, seq, pt) VALUES ${vals.join(",")}
       ON CONFLICT (day, trip_id, seq) DO NOTHING`,
      params,
    );
    return r.rowCount;
  }

  eq(await ingest(0, 100), 100, "принято точек первой пачкой");
  eq(await ingest(0, 100), 0, "повтор той же пачки вставил");
  eq(await ingest(50, N), 50, "досылка с перекрытием вставила");

  const { rows: [cnt] } = await pool.query(
    `SELECT count(*)::int n FROM track.point WHERE day = $1 AND trip_id = $2`, [DAY, trip.id]);
  eq(cnt.n, N, "всего точек");

  // --- размер строки: то самое число, ради которого выбиралась раскладка
  const { rows: [sz] } = await pool.query(
    `SELECT sum(pg_relation_size(c.oid))::bigint heap, sum(pg_indexes_size(c.oid))::bigint idx
       FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname='track' AND p.relname='point'`);
  ok(`байт на точку на этом объёме: ${((Number(sz.heap) + Number(sz.idx)) / N).toFixed(1)} (мало строк — накладные партиции видны крупно)`);

  // --- расшифровка и защита от подмены
  const { rows: [one] } = await pool.query(
    `SELECT seq, pt FROM track.point WHERE day=$1 AND trip_id=$2 AND seq=42`, [DAY, trip.id]);
  const got = crypto.openPoint(tripKey, trip.id, 42, startedAt.getTime(), one.pt);
  eq(got.latE7, mkPoint(42).latE7, "координата расшифровалась");

  try {
    crypto.openPoint(tripKey, trip.id, 43, startedAt.getTime(), one.pt);
    fail("шифротекст точки 42 принят как точка 43 — AAD не связывает seq");
  } catch { ok("шифротекст нельзя переставить в чужой seq (AAD связывает)"); }

  try {
    const other = new Date(startedAt.getTime() + 1000).getTime();
    crypto.openPoint(tripKey, trip.id, 42, other, one.pt);
    fail("подмена started_at не обнаружена");
  } catch { ok("подмена started_at обнаружена (иммутабельность криптографическая)"); }

  // --- спринт 4: ссылка доступа и лестница «мёртвой руки» (M0.A §5.3, §6.3)
  //
  // Проверяется на той же поездке, на базе, без HTTP: правильность verifier'а, что маршрут
  // скрыт по умолчанию, и что лестница поднимает тревогу, снимает её по «всё в порядке» и
  // раскрывает маршрут только после окна отмены. Раскрытие необратимо — это тоже утверждение.
  {
    const share = await import("../lib/track-share.ts");
    const { createHash } = await import("node:crypto");
    const lookup = randomBytes(16);
    const verifier = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO track.share (trip_id, lookup_id, verifier_hash, label) VALUES ($1, $2, $3, 'маме')`,
      [trip.id, lookup, createHash("sha256").update(verifier).digest()],
    );
    eq(share.parseLookup(lookup.toString("base64url"))?.length, 16, "lookup из пути разбирается");

    let v = await share.resolveShare(lookup, verifier, null, startedAt);
    eq(v.ok, true, "ссылка открывается по verifier");
    eq(v.ok && v.view.status, "recording", "статус открытой поездки");
    eq(v.ok && v.view.trackVisible, false, "маршрут скрыт по умолчанию");
    eq((await share.resolveShare(lookup, "not-the-verifier-xxxxxxxx", null)).ok, false, "чужой verifier отвергнут");
    eq((await share.resolveShare(lookup, null, 7)).ok, false, "сессия без привязки не даёт доступа");

    // привязка к вошедшему: первое открытие с ключом, дальше — по сессии
    v = await share.resolveShare(lookup, verifier, 7, startedAt);
    eq(v.ok && v.view.boundToViewer, true, "вошедший привязан к ссылке");
    eq((await share.resolveShare(lookup, null, 7)).ok, true, "дальше — по сессии без ключа");
    eq((await share.resolveShare(lookup, null, 8)).ok, false, "чужая сессия — нет");

    // лестница на времени поездки: silenceMin молчания → тревога
    const min = (n) => new Date(startedAt.getTime() + n * 60_000);
    await pool.query(`UPDATE track.trip SET last_point_at = $2 WHERE id = $1`, [trip.id, startedAt]);
    let r = await share.escalateTrips(pool, min(share.ALARM.silenceMin - 1));
    eq(r.alarmed, 0, "до порога тревоги нет");
    r = await share.escalateTrips(pool, min(share.ALARM.silenceMin + 1));
    eq(r.alarmed, 1, "тревога после порога молчания");
    v = await share.resolveShare(lookup, verifier, null, min(share.ALARM.silenceMin + 1));
    eq(v.ok && v.view.status, "silent", "контакт видит «данные не поступают»");
    eq(v.ok && v.view.trackVisible, false, "маршрут ещё скрыт");

    // точки снова пошли → тревога снята
    await pool.query(`UPDATE track.trip SET last_point_at = $2 WHERE id = $1`, [trip.id, min(share.ALARM.silenceMin + 2)]);
    r = await share.escalateTrips(pool, min(share.ALARM.silenceMin + 3));
    eq(r.calmed, 1, "точки пошли — тревога снята");

    // молчание, тревога, окно отмены → раскрытие
    const t0 = share.ALARM.silenceMin + 2 + share.ALARM.silenceMin + 1;
    r = await share.escalateTrips(pool, min(t0));
    eq(r.alarmed, 1, "тревога повторно");
    r = await share.escalateTrips(pool, min(t0 + share.ALARM.cancelWindowMin - 1));
    eq(r.disclosed, 0, "внутри окна отмены раскрытия нет");
    r = await share.escalateTrips(pool, min(t0 + share.ALARM.cancelWindowMin + 1));
    eq(r.disclosed, 1, "после окна — раскрыто");
    v = await share.resolveShare(lookup, verifier, null, min(t0 + share.ALARM.cancelWindowMin + 1));
    eq(v.ok && v.view.status, "disclosed", "контакт видит раскрытие");
    eq(v.ok && v.view.track.length, N, "маршрут расшифрован целиком");
    eq(v.ok && v.view.track[42].lat, mkPoint(42).latE7 / 1e7, "координата точки 42 в маршруте");

    // необратимость: точки пошли снова — раскрытие остаётся
    await pool.query(`UPDATE track.trip SET last_point_at = $2 WHERE id = $1`, [trip.id, min(t0 + 30)]);
    r = await share.escalateTrips(pool, min(t0 + 31));
    eq(r.calmed, 0, "после раскрытия тревога не снимается");
    const { rows: [d] } = await pool.query(`SELECT disclosed_at IS NOT NULL AS yes FROM track.trip WHERE id = $1`, [trip.id]);
    eq(d.yes, true, "раскрытие необратимо");

    // отзыв
    await pool.query(`UPDATE track.share SET revoked_at = now() WHERE lookup_id = $1`, [lookup]);
    const rv = await share.resolveShare(lookup, verifier, null);
    eq(!rv.ok && rv.reason, "revoked", "отозванная ссылка → revoked");

    // вернуть поездку в исходное для дальнейших проверок регламента
    await pool.query(`UPDATE track.trip SET alarm_at = NULL, disclosed_at = NULL, all_ok_at = NULL, last_point_at = NULL WHERE id = $1`, [trip.id]);
    await pool.query(`DELETE FROM track.share WHERE trip_id = $1`, [trip.id]);
  }

  const tampered = Buffer.from(one.pt);
  tampered[20] ^= 1;
  try {
    crypto.openPoint(tripKey, trip.id, 42, startedAt.getTime(), tampered);
    fail("правка байта шифротекста не обнаружена — целостности нет");
  } catch { ok("правка байта шифротекста обнаружена"); }

  // --- приём через настоящие функции старта и приёма, а не в обход
  //
  // Выше точки вставлялись напрямую, чтобы проверить механику партиций. Здесь проверяется
  // путь, которым пойдёт клиент: startTrip выдаёт токен записи, ingestPoints его требует.
  {
    const h = await trips.startTrip("install-через-апи");
    h.writeToken.length >= 40 ? ok("startTrip выдал токен записи") : fail("токен записи короткий");
    eq(h.day, utcToday(), "day поездки — дата старта в UTC");

    const batch = (from, to) =>
      Array.from({ length: to - from }, (_, k) => ({ seq: from + k, point: mkPoint(from + k) }));

    const r1 = await trips.ingestPoints(h.tripId, h.writeToken, batch(0, 40));
    eq(r1.ok && r1.accepted, 40, "принято через ingestPoints");
    const r2 = await trips.ingestPoints(h.tripId, h.writeToken, batch(0, 40));
    eq(r2.ok && r2.accepted, 0, "повтор через ingestPoints вставил");
    const r3 = await trips.ingestPoints(h.tripId, h.writeToken, batch(20, 60));
    eq(r3.ok && r3.accepted, 20, "досылка с перекрытием через ingestPoints");

    // Внутренний trip_id — маленькое целое и перебирается за секунды. Без токена приём был
    // бы открыт любому, кто умеет считать, поэтому чужой токен обязан выглядеть как
    // «поездки нет», а не как «поездка есть, но не ваша».
    const bad = await trips.ingestPoints(h.tripId, "чужой-токен", batch(100, 101));
    (!bad.ok && bad.reason === "not_found")
      ? ok("чужой токен записи отклонён и не выдаёт существование поездки")
      : fail(`чужой токен не отклонён: ${JSON.stringify(bad)}`);

    // Причина завершения — вход для лестницы эскалации спринта 4. Поездка, закрытая
    // таймером после неподвижности и трёх неотвеченных напоминаний, может означать не
    // «забыл выключить», а «что-то случилось»; постфактум их не отличить — трасса у обеих
    // одинаковая, стоит на месте.
    await trips.finishTrip(h.tripId, h.writeToken, "idle");
    const { rows: [fr] } = await pool.query(
      `SELECT finish_reason, state FROM track.trip WHERE id = $1`, [h.tripId]);
    eq(fr.finish_reason, "idle", "причина завершения записана");
    eq(fr.state, 1, "поездка закрыта");

    const closed = await trips.ingestPoints(h.tripId, h.writeToken, batch(200, 201));
    (!closed.ok && closed.reason === "closed")
      ? ok("в закрытую поездку дописать нельзя")
      : fail("закрытая поездка приняла точку");

    const tooMany = await trips.ingestPoints(h.tripId, h.writeToken, batch(0, trips.MAX_BATCH + 1));
    (!tooMany.ok && tooMany.reason === "too_many")
      ? ok(`пачка больше ${trips.MAX_BATCH} отклонена`)
      : fail("слишком большая пачка принята");

    // Убираем эту поездку, чтобы не мешать проверкам ретеншна ниже.
    await pool.query(`DELETE FROM track.point WHERE trip_id = $1`, [h.tripId]);
    await pool.query(`DELETE FROM track.trip WHERE id = $1`, [h.tripId]);
  }

  // --- регламент: прогон пишет аудит, и его свежесть измерима
  //
  // M0.A §3.4 требует не написанной процедуры, а показанной работы расписания: отсутствие
  // строки аудита за 25 часов — сигнал поломки. Значит строка обязана появляться даже
  // тогда, когда делать было нечего, иначе «нет строки» перестаёт что-либо означать.
  {
    // Ветка «прогонов не было вовсе» проверяется явно: именно она отличает «расписание
    // сломалось» от «расписание ещё не запускалось», и путать их нельзя.
    await pool.query(`DELETE FROM track.maintenance_run`);
    const before = await sched.hoursSinceLastRun();
    before === null ? ok("без прогонов свежесть — null, а не ноль") : fail(`ожидался null, получено ${before}`);

    const r = await maint.runMaintenance(pool, startedAt);
    typeof r.runway === "number" ? ok(`прогон регламента вернул запас партиций: ${r.runway} сут`) : fail("прогон не вернул запас");

    const after = await sched.hoursSinceLastRun();
    (after !== null && after < 1)
      ? ok("после прогона свежесть измеряется и близка к нулю")
      : fail(`свежесть после прогона: ${after}`);

    const { rows: [audit] } = await pool.query(
      `SELECT count(*)::int n FROM track.maintenance_run WHERE job='ensure_partitions' AND ok`);
    audit.n > 0 ? ok("прогон записал строку аудита") : fail("прогон не оставил строки аудита");
  }

  // --- автозакрытие
  await pool.query(`UPDATE track.trip SET last_point_at = $2 WHERE id = $1`,
    [trip.id, new Date(startedAt.getTime() + N * 3000)]);
  const later = new Date(startedAt.getTime() + 10 * 3600000);
  const closed = await maint.closeAbandoned(pool, later);
  eq(closed.abandoned, 1, "оборванных поездок закрыто");

  // Поездка без единой точки — отдельная ветка, иначе висела бы вечно
  await pool.query(
    `INSERT INTO track.trip (install_ref, lookup_id, started_at, day, trip_key_wrapped, key_epoch)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [crypto.installRef("i2"), randomBytes(16), startedAt, DAY, Buffer.alloc(1), epoch]);
  eq((await maint.closeAbandoned(pool, later)).voided, 1, "поездок без точек удалено");
  const { rows: [empty] } = await pool.query(
    `SELECT count(*)::int n FROM track.erasure_log WHERE action='delete_empty_trip'`);
  empty.n === 1 ? ok("удаление пустой поездки записано в журнал") : fail("пустая поездка удалена без записи в журнал");

  // --- свёртка на T+48 ч
  const afterFold = new Date(startedAt.getTime() + 60 * 3600000);
  eq(await maint.foldDueTrips(pool, afterFold), 1, "свёрнуто поездок");
  const { rows: [f] } = await pool.query(
    `SELECT folded_vertices, folded_track, rolled_at FROM track.trip WHERE id=$1`, [trip.id]);
  f.rolled_at ? ok("отметка свёртки поставлена") : fail("rolled_at не проставлен");
  (f.folded_vertices > 2 && f.folded_vertices < N)
    ? ok(`вершин после прореживания: ${f.folded_vertices} из ${N} (${f.folded_track.length} Б блоб)`)
    : fail(`прореживание дало ${f.folded_vertices} вершин из ${N}`);
  const unpacked = crypto.openTripField(tripKey, "folded", trip.id, startedAt.getTime(), f.folded_track);
  unpacked.length > 0 ? ok("свёрнутая трасса расшифровывается") : fail("свёрнутая трасса пуста");

  // --- удаление по возрасту: инвариант «не уносить несвёрнутое»
  await pool.query(`UPDATE track.trip SET rolled_at = NULL WHERE id = $1`, [trip.id]);
  const wayLater = new Date(startedAt.getTime() + 60 * 86400000);

  // Пустые партиции соседних недель уходят законно — инвариант защищает не «все партиции»,
  // а ту, в которой лежат точки несвёрнутой поездки. Проверяем именно её.
  const dropped1 = await maint.dropAgedPartitions(pool, wayLater);
  const { rows: [survived] } = await pool.query(
    `SELECT count(*)::int n FROM track.point WHERE day = $1 AND trip_id = $2`, [DAY, trip.id]);
  survived.n === N
    ? ok(`партиция несвёрнутой поездки уцелела (пустых соседних удалено ${dropped1.length})`)
    : fail(`сырьё несвёрнутой поездки удалено: осталось ${survived.n} из ${N}`);
  const { rows: [skip] } = await pool.query(
    `SELECT count(*)::int n FROM track.maintenance_run WHERE job='drop_partition' AND ok = false`);
  skip.n > 0 ? ok("отказ удаления записан в журнал прогонов (громко, а не тихо)") : fail("отказ удаления нигде не записан");

  await pool.query(`UPDATE track.trip SET rolled_at = now() WHERE id = $1`, [trip.id]);
  const dropped = await maint.dropAgedPartitions(pool, wayLater);
  dropped.length > 0 ? ok(`партиций удалено после свёртки: ${dropped.length}`) : fail("партиции не удалились и после свёртки");

  const { rows: [left] } = await pool.query(`SELECT count(*)::int n FROM track.point`);
  eq(left.n, 0, "сырых точек осталось");

  const { rows: [jr] } = await pool.query(
    `SELECT count(*)::int n FROM track.erasure_log WHERE action='drop_partition'`);
  jr.n > 0 ? ok("удаление записано в журнал уничтожения") : fail("журнал уничтожения пуст");

  // --- холодный слой по сроку
  eq(await maint.pruneFolded(pool, new Date(startedAt.getTime() + 200 * 86400000)), 1, "свёрнутых трасс погашено по сроку");
} finally {
  // Схема пересоздаётся пустой, а не сносится: миграция в payload_migrations помечена
  // применённой, и база разработчика без схемы разошлась бы со своим же журналом миграций.
  await pool.query(`DROP SCHEMA IF EXISTS track CASCADE`).catch(() => {});
  await pool.query(TRACK_DDL_ALL).catch(() => {});
  await pool.end();
  console.log("схема track очищена и пересоздана пустой");
}

if (failed > 0) {
  console.error(`\nпровалено проверок: ${failed}`);
  process.exit(1);
}
console.log("\nсхема трасс проверена целиком");
