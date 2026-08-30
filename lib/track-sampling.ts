// Политика записи точек на клиенте — M0.A §2.1, числами из таблицы, а не на глаз.
//
// Логика вынесена из компонента намеренно: решение «записывать этот фикс или нет» — это то
// единственное в клиенте, что определяет и качество трассы, и расход батареи, и объём
// хранилища. Такое проверяют детерминированными сценариями (scripts/check-sampling.mjs), а
// не наблюдением за собой на прогулке.
//
// Здесь нет ни одного обращения к браузеру: чистые функции над числами.

/** Фикс от геолокации, приведённый к тому, что нам нужно. */
export type Fix = {
  lat: number;
  lng: number;
  /** Заявленная точность, метры. */
  accuracyM: number;
  /** Скорость, м/с; null — браузер не дал. */
  speedMs: number | null;
  /** Миллисекунды от старта поездки. */
  tMs: number;
};

export type SamplerState = {
  /**
   * Последняя ЗАПИСАННАЯ точка ХОРОШЕГО качества — геометрическая база: от неё считаются
   * смещение и курс. Плохой фикс сюда не попадает никогда, иначе одна сотовая привязка за
   * 500 м утащила бы за собой всю последующую геометрию.
   */
  last: { lat: number; lng: number; tMs: number } | null;
  /**
   * Время последней записанной точки ЛЮБОГО качества — временна́я база: от неё считаются
   * пол, живость и heartbeat.
   *
   * Разведено с `last` не из аккуратности. Если считать heartbeat от геометрической базы,
   * то после heartbeat по плохому фиксу она не сдвигается — и heartbeat срабатывает на
   * КАЖДОМ следующем фиксе. При потере сигнала это не «одна точка в минуту», а поток
   * точек ровно тогда, когда они меньше всего нужны. Поймано проверкой.
   */
  lastRecordTMs: number | null;
  /** Курс последнего записанного отрезка, градусы; null пока отрезка нет. */
  lastHeading: number | null;
  /** Время последнего фикса вообще — для живости и heartbeat. */
  lastFixTMs: number | null;
  /** Когда скорость упала ниже порога стоянки; null — не стоим. */
  stopSince: number | null;
  /** Когда последний раз записали точку стоянки. */
  lastStopEmit: number | null;
  /** Сегмент записи открыт (первый фикс сегмента ещё не записан). */
  segmentPending: boolean;
};

export const FLAG_LOW_QUALITY = 0b0000_0001;
export const FLAG_SEGMENT_START = 0b0000_0010;
export const FLAG_SEGMENT_END = 0b0000_0100;
export const FLAG_STOP = 0b0000_1000;
export const FLAG_BATTERY = 0b0001_0000;

/** Пороги M0.A §2.1. Вынесены в константы, чтобы настройка была правкой числа, а не поиском. */
export const POLICY = {
  /** Фикс хуже этого в пороги не засчитывается (§2.1). */
  maxAccuracyM: 50,
  /** Жёсткий пол: не чаще одной точки в 2 с. watchPosition частоту не гарантирует. */
  floorMs: 2_000,
  /** Смещение ≈ 8 радиусов ошибки GPS: срабатывание означает реальное движение. */
  moveM: 40,
  /** Поворот. ⚠️ Порог подлежит эмпирической настройке (§2.1) — 30° это всего 1,7σ шума. */
  turnDeg: 30,
  /** Гвардия поворота: работает на скоростях ниже ~9 км/ч, где курс скачет от шума. */
  turnMinMoveM: 5,
  /** Живость при движении. */
  livenessMs: 30_000,
  /** Heartbeat в любом случае: «приложение было открыто и было вот здесь». */
  heartbeatMs: 60_000,
  /** Ниже этой скорости считаем, что стоим. */
  stopSpeedMs: 1,
  /** Стоянка длиннее — одна точка в минуту вместо N одинаковых. */
  stopAfterMs: 60_000,
} as const;

export function newSamplerState(): SamplerState {
  return {
    last: null,
    lastRecordTMs: null,
    lastHeading: null,
    lastFixTMs: null,
    stopSince: null,
    lastStopEmit: null,
    segmentPending: true,
  };
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Расстояние по большому кругу, метры. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Курс из точки в точку, градусы 0..360. */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI + 180;
}

/** Разница курсов по кратчайшей дуге, 0..180. */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export type Decision = {
  record: boolean;
  /** Почему записали — для отладки и для настройки порога поворота на реальных поездках. */
  reason: "segment-start" | "move" | "turn" | "liveness" | "heartbeat" | "stop" | "none";
  flags: number;
  /** Длительность стоянки в секундах — только для точек стоянки. */
  stopS: number;
};

const NO: Decision = { record: false, reason: "none", flags: 0, stopS: 0 };

/**
 * Решить, становится ли фикс точкой трассы. Состояние меняется ТОЛЬКО при записи —
 * иначе отброшенные фиксы сдвигали бы базу порогов и трасса зависела бы от частоты,
 * которую браузер не гарантирует.
 */
export function decide(state: SamplerState, fix: Fix): Decision {
  const poor = fix.accuracyM > POLICY.maxAccuracyM;
  const sinceFix = state.lastFixTMs === null ? Infinity : fix.tMs - state.lastFixTMs;
  state.lastFixTMs = fix.tMs;

  const commit = (d: Decision): Decision => {
    if (!d.record) return d;
    // Временна́я база сдвигается всегда: точка записана, значит следующий heartbeat —
    // через минуту после неё, а не через минуту после последней хорошей.
    state.lastRecordTMs = fix.tMs;
    // Геометрическая — только по хорошему фиксу.
    if (!poor) {
      state.lastHeading = state.last ? bearingDeg(state.last, fix) : state.lastHeading;
      state.last = { lat: fix.lat, lng: fix.lng, tMs: fix.tMs };
    }
    state.segmentPending = false;
    return d;
  };

  // Первая точка сегмента записи — всегда, без оглядки на пол и пороги: границы сегментов
  // ценнее прочих точек, запись рвётся by-design (§2.1).
  if (state.segmentPending) {
    return commit({
      record: true,
      reason: "segment-start",
      flags: FLAG_SEGMENT_START | (poor ? FLAG_LOW_QUALITY : 0),
      stopS: 0,
    });
  }

  // Время считается от последней ЗАПИСАННОЙ точки любого качества, геометрия — от
  // последней хорошей. Разница существенна ровно при потере сигнала (см. SamplerState).
  const sinceRecord = state.lastRecordTMs === null ? Infinity : fix.tMs - state.lastRecordTMs;

  // Heartbeat — единственное, что проходит сквозь плохую точность: продукт обещает
  // «приложение было открыто и было вот здесь», и молчание здесь дороже неточности.
  if (sinceRecord >= POLICY.heartbeatMs) {
    return commit({
      record: true,
      reason: "heartbeat",
      flags: poor ? FLAG_LOW_QUALITY : 0,
      stopS: 0,
    });
  }

  // Всё остальное считается только по хорошим фиксам.
  if (poor) return NO;
  // Жёсткий пол: watchPosition может сыпать чаще, чем нужно.
  if (sinceRecord < POLICY.floorMs) return NO;
  if (state.last === null) return NO;

  const moved = distanceM(state.last, fix);
  const standing = (fix.speedMs ?? 0) < POLICY.stopSpeedMs;

  // Стоянка: N одинаковых точек несут ноль информации и жгут больше всего байт.
  if (standing) {
    if (state.stopSince === null) state.stopSince = fix.tMs;
    const stoodMs = fix.tMs - state.stopSince;
    if (stoodMs >= POLICY.stopAfterMs) {
      const sinceEmit = state.lastStopEmit === null ? Infinity : fix.tMs - state.lastStopEmit;
      if (sinceEmit >= POLICY.stopAfterMs) {
        state.lastStopEmit = fix.tMs;
        return commit({
          record: true,
          reason: "stop",
          flags: FLAG_STOP,
          stopS: Math.round(stoodMs / 1000),
        });
      }
      return NO;
    }
  } else {
    state.stopSince = null;
    state.lastStopEmit = null;
  }

  if (moved >= POLICY.moveM) {
    return commit({ record: true, reason: "move", flags: 0, stopS: 0 });
  }

  // Поворот. Гвардия по смещению активна только на малых скоростях: выше 9 км/ч пять
  // метров проезжаются быстрее, чем истекает пол в 2 с, и условие выполняется всегда.
  if (state.lastHeading !== null && moved > POLICY.turnMinMoveM) {
    const delta = headingDelta(state.lastHeading, bearingDeg(state.last, fix));
    if (delta >= POLICY.turnDeg) {
      return commit({ record: true, reason: "turn", flags: 0, stopS: 0 });
    }
  }

  if (!standing && sinceRecord >= POLICY.livenessMs) {
    return commit({ record: true, reason: "liveness", flags: 0, stopS: 0 });
  }

  // sinceFix участвует только в диагностике разрывов: если фиксы перестали приходить,
  // это видно снаружи по heartbeat, а не по этому значению.
  void sinceFix;
  return NO;
}

/** Явно закрыть сегмент записи: следующий фикс станет его началом. */
export function closeSegment(state: SamplerState): void {
  state.segmentPending = true;
  state.lastHeading = null;
}

/** Точка трассы в том виде, в каком её ждёт API (координаты в E7 — M0.A §2.3). */
export function toApiPoint(fix: Fix, d: Decision) {
  return {
    tMs: Math.max(0, Math.round(fix.tMs)),
    latE7: Math.round(fix.lat * 1e7),
    lngE7: Math.round(fix.lng * 1e7),
    accDm: Math.min(65_535, Math.max(0, Math.round(fix.accuracyM * 10))),
    // 0xFFFF — «скорость неизвестна», а не «ноль»: браузер часто не даёт её вовсе.
    spdCms: fix.speedMs === null ? 65_535 : Math.min(65_534, Math.max(0, Math.round(fix.speedMs * 100))),
    flags: d.flags,
    stopS: Math.min(65_535, d.stopS),
  };
}
