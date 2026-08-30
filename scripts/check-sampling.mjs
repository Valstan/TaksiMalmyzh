// Проверка политики записи точек — детерминированными сценариями, без браузера и без базы.
//
// Зачем отдельно от check-track: это единственное место в клиенте, которое определяет разом
// качество трассы, расход батареи и объём хранилища. Такое нельзя проверять наблюдением за
// собой на прогулке — там не воспроизвести ни ровную прямую, ни точный поворот, ни потерю
// сигнала, и уж точно не повторить это дважды одинаково.
//
// Запуск: npm run check:sampling   (ничего не нужно, кроме node)

import {
  decide,
  newSamplerState,
  closeSegment,
  distanceM,
  bearingDeg,
  headingDelta,
  POLICY,
  FLAG_SEGMENT_START,
  FLAG_LOW_QUALITY,
  FLAG_STOP,
  toApiPoint,
} from "../lib/track-sampling.ts";

let failed = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failed++; };
const eq = (a, b, m) => (a === b ? ok(`${m}: ${a}`) : fail(`${m}: получено ${a}, ожидалось ${b}`));
const near = (a, b, tol, m) =>
  Math.abs(a - b) <= tol ? ok(`${m}: ${a.toFixed(1)}`) : fail(`${m}: ${a.toFixed(1)}, ожидалось ${b}±${tol}`);

// --- геометрия: без неё все пороги считаются мимо
{
  const a = { lat: 56.512, lng: 50.703 };
  // 0,0001° широты ≈ 11,1 м
  near(distanceM(a, { lat: 56.5121, lng: 50.703 }), 11.1, 0.5, "расстояние по широте, м");
  // на широте 56,5° градус долготы короче в cos(56,5) ≈ 0,552 раза
  near(distanceM(a, { lat: 56.512, lng: 50.7031 }), 6.1, 0.5, "расстояние по долготе, м");
  near(headingDelta(bearingDeg(a, { lat: 56.513, lng: 50.703 }),
                    bearingDeg(a, { lat: 56.512, lng: 50.704 })), 90, 1, "поворот на 90°, градусов");
  eq(headingDelta(350, 10), 20, "разница курсов через ноль");
}

/** Синтетический фикс: смещение от точки старта задаётся в метрах на север/восток. */
const BASE = { lat: 56.512, lng: 50.703 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = 111_320 * Math.cos((BASE.lat * Math.PI) / 180);
const at = (northM, eastM, tMs, extra = {}) => ({
  lat: BASE.lat + northM / M_PER_DEG_LAT,
  lng: BASE.lng + eastM / mPerDegLng,
  accuracyM: 8,
  speedMs: 10,
  tMs,
  ...extra,
});

// --- первый фикс сегмента записывается всегда
{
  const s = newSamplerState();
  const d = decide(s, at(0, 0, 0));
  d.record && d.reason === "segment-start" ? ok("первый фикс сегмента записан") : fail("первый фикс не записан");
  (d.flags & FLAG_SEGMENT_START) ? ok("помечен началом сегмента") : fail("нет флага начала сегмента");
}

// --- жёсткий пол: чаще 1 точки в 2 с не пишем
{
  const s = newSamplerState();
  decide(s, at(0, 0, 0));
  const d = decide(s, at(0, 100, 1_000)); // 100 м, но всего через 1 с
  eq(d.record, false, "фикс через 1 с отброшен полом");
  const d2 = decide(s, at(0, 100, 2_100));
  d2.record && d2.reason === "move" ? ok("через 2 с тот же фикс записан по смещению") : fail("после пола не записался");
}

// --- прямая: пишем по смещению, а не по каждому фиксу
{
  const s = newSamplerState();
  let recorded = 0;
  // 600 м прямо на восток, фикс каждую секунду при 10 м/с
  for (let i = 0; i <= 60; i++) {
    if (decide(s, at(0, i * 10, i * 1000)).record) recorded++;
  }
  // 600 м при пороге 40 м — порядка 15 точек плюс начало сегмента. Допуск не узкий
  // намеренно: шаг 10 м попадает ровно в порог, и сравнение «≥ 40 м» на плавающей
  // арифметике то срабатывает на четвёртом шаге, то на пятом. В жизни такого совпадения
  // не бывает, и требовать от политики точности до точки здесь значило бы проверять
  // округление, а не политику.
  (recorded >= 12 && recorded <= 18)
    ? ok(`на 600 м прямой записано точек: ${recorded} (ожидалось 12–18)`)
    : fail(`на 600 м прямой записано ${recorded} точек, ожидалось 12–18`);
}

// --- поворот записывается раньше, чем набежит 40 м
{
  const s = newSamplerState();
  decide(s, at(0, 0, 0));
  decide(s, at(0, 45, 4_000));            // задаём курс: на восток
  const d = decide(s, at(20, 45, 8_000)); // 20 м на север — поворот на 90°, смещения 40 м нет
  d.record && d.reason === "turn"
    ? ok("поворот на 90° записан до порога смещения")
    : fail(`поворот не записан: ${JSON.stringify(d)}`);
}

// --- дрожание на месте не даёт поворотов: гвардия по смещению
{
  const s = newSamplerState();
  decide(s, at(0, 0, 0));
  let spurious = 0;
  // Стоим, координата дрожит в пределах ±2 м, скорость 0,2 м/с — гвардия 5 м должна держать
  for (let i = 1; i <= 20; i++) {
    const jitterN = ((i * 37) % 5) - 2;
    const jitterE = ((i * 53) % 5) - 2;
    const d = decide(s, at(jitterN, jitterE, i * 3_000, { speedMs: 0.2 }));
    if (d.record && d.reason === "turn") spurious++;
  }
  eq(spurious, 0, "ложных поворотов на дрожании");
}

// --- стоянка: одна точка в минуту, а не N одинаковых
{
  const s = newSamplerState();
  decide(s, at(0, 0, 0));
  let stops = 0;
  // Пять минут стоим, фикс каждые 5 с
  for (let t = 5_000; t <= 300_000; t += 5_000) {
    const d = decide(s, at(0, 0, t, { speedMs: 0.1 }));
    if (d.record && d.reason === "stop") stops++;
  }
  (stops >= 3 && stops <= 5)
    ? ok(`за 5 минут стоянки точек стоянки: ${stops} (ожидалось ~4)`)
    : fail(`за 5 минут стоянки ${stops} точек, ожидалось 3–5`);
}

// --- плохая точность: в пороги не идёт, но heartbeat проходит
{
  const s = newSamplerState();
  decide(s, at(0, 0, 0));
  const bad = decide(s, at(0, 500, 10_000, { accuracyM: 500 }));
  eq(bad.record, false, "фикс с точностью 500 м отброшен");

  // Через минуту — heartbeat обязан пройти даже по плохому фиксу: продукт обещает
  // «приложение было открыто и было вот здесь».
  const hb = decide(s, at(0, 500, 61_000, { accuracyM: 500 }));
  hb.record && hb.reason === "heartbeat" ? ok("heartbeat прошёл по плохому фиксу") : fail("heartbeat не прошёл");
  (hb.flags & FLAG_LOW_QUALITY) ? ok("помечен низким качеством") : fail("нет флага низкого качества");

  // Плохой фикс не стал ГЕОМЕТРИЧЕСКОЙ базой: смещение по-прежнему считается от точки
  // старта, а не от привязки за 500 м. Проверяем прямо по состоянию, а не по решению —
  // решение зависит ещё и от времени.
  Math.abs(s.last.lng - BASE.lng) < 1e-9
    ? ok("плохой фикс не стал геометрической базой")
    : fail("плохой фикс сдвинул геометрическую базу — вся последующая геометрия поедет");

  // А ВРЕМЕННА́Я база сдвинуться обязана. Если считать heartbeat от геометрической, то
  // после heartbeat по плохому фиксу он срабатывает на КАЖДОМ следующем фиксе: при потере
  // сигнала это поток точек ровно тогда, когда они меньше всего нужны.
  const right_after = decide(s, at(0, 501, 62_000, { accuracyM: 500 }));
  eq(right_after.record, false, "второй плохой фикс через 1 с после heartbeat не записан");
  const next_hb = decide(s, at(0, 502, 121_500, { accuracyM: 500 }));
  next_hb.record && next_hb.reason === "heartbeat"
    ? ok("следующий heartbeat — ровно через минуту, а не сразу")
    : fail("heartbeat через минуту не сработал");
}

// --- разрыв записи: следующий фикс — начало нового сегмента
{
  const s = newSamplerState();
  decide(s, at(0, 0, 0));
  closeSegment(s);
  const d = decide(s, at(0, 1, 1_000)); // 1 метр, 1 секунда — но это начало сегмента
  d.record && d.reason === "segment-start"
    ? ok("после разрыва первый фикс записан вопреки порогам")
    : fail("граница сегмента потеряна");
}

// --- рабочее число M0.A: ~150 точек на 8-минутную городскую поездку
{
  const s = newSamplerState();
  let recorded = 0;
  let t = 0;
  let n = 0, e = 0;
  // Городская поездка: кварталы по 150 м, повороты, две остановки на светофорах.
  for (let block = 0; block < 16; block++) {
    const east = block % 2 === 0;
    for (let step = 0; step < 15; step++) {          // 15 шагов по 10 м = 150 м
      if (east) e += 10; else n += 10;
      t += 1_000;
      if (decide(s, at(n, e, t, { speedMs: 10 })).record) recorded++;
    }
    if (block === 5 || block === 11) {                // светофор на 40 с
      for (let k = 0; k < 8; k++) {
        t += 5_000;
        if (decide(s, at(n, e, t, { speedMs: 0.1 })).record) recorded++;
      }
    }
  }
  const minutes = t / 60_000;
  ok(`городская поездка ${minutes.toFixed(1)} мин: записано ${recorded} точек (${(recorded / minutes).toFixed(1)}/мин)`);
  // M0.A ожидает ~19 точек/мин. Допуск широкий: маршрут синтетический, важна не цифра,
  // а что политика не даёт ни 1 Гц (было бы ~60/мин), ни голодания (единицы в минуту).
  const perMin = recorded / minutes;
  (perMin >= 8 && perMin <= 35)
    ? ok(`плотность в рабочем диапазоне: ${perMin.toFixed(1)} точек/мин`)
    : fail(`плотность ${perMin.toFixed(1)} точек/мин вне рабочего диапазона 8–35`);
}

// --- упаковка в API-точку не теряет и не переполняет
{
  const p = toApiPoint(at(0, 0, 1234, { accuracyM: 12.34, speedMs: 8.5 }),
    { record: true, reason: "move", flags: FLAG_STOP, stopS: 90 });
  eq(p.latE7, Math.round(BASE.lat * 1e7), "широта в E7");
  eq(p.accDm, 123, "точность в дециметрах");
  eq(p.spdCms, 850, "скорость в см/с");
  eq(p.stopS, 90, "длительность стоянки");
  const unknown = toApiPoint(at(0, 0, 0, { speedMs: null }), { record: true, reason: "move", flags: 0, stopS: 0 });
  eq(unknown.spdCms, 65535, "неизвестная скорость кодируется как 0xFFFF, а не как ноль");
}

console.log(`\nпороги политики: точность ≤ ${POLICY.maxAccuracyM} м, пол ${POLICY.floorMs / 1000} с, ` +
  `смещение ${POLICY.moveM} м, поворот ${POLICY.turnDeg}°, живость ${POLICY.livenessMs / 1000} с, ` +
  `heartbeat ${POLICY.heartbeatMs / 1000} с`);

if (failed > 0) {
  console.error(`\nпровалено проверок: ${failed}`);
  process.exit(1);
}
console.log("политика записи проверена");
