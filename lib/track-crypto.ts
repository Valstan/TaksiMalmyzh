import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Шифрование трасс. Единственное место в системе, где встречается ключ.
//
// Решение и его обоснование — docs/TRIP_SCHEMA.md §1. Коротко: построчный AEAD
// ChaCha20-Poly1305 (IETF, RFC 8439) со СЛУЧАЙНЫМ ХРАНИМЫМ nonce, конвертная схема ключей.
//
// ⚠️ ОДНО ПРАВИЛО НА ВСЮ СИСТЕМУ, БЕЗ ИСКЛЮЧЕНИЙ:
// любой шифротекст имеет вид nonce(12) ‖ ct ‖ tag(16), nonce берётся из CSPRNG на КАЖДЫЙ
// вызов шифрования, AAD — канонический бинарный блок фиксированной длины, называющий слот.
//
// Соблазн «вывести nonce из (day, trip_id, seq) и сэкономить 12 байт» вернётся — и он
// ошибочен ровно потому, что шифрование происходит ДО COMMIT. Откат транзакции (deadlock,
// statement_timeout, обрыв, OOM-kill службы при MemoryMax=640M на общем боксе) оставляет
// шифротекст произведённым, а строки — не существующей. Повтор пачки зашифрует заново,
// возможно другой открытый текст, под тем же выводимым nonce — и ключевой поток потечёт.
// При хранимом случайном nonce откат безвреден.

const NONCE = 12;
const TAG = 16;
const ALGO = "chacha20-poly1305";

/** Открытый текст точки — ровно 19 байт, little-endian. Ширина фиксирована: см. TRIP_SCHEMA.md. */
export const POINT_PLAINTEXT_BYTES = 19;
/** Строка точки в базе: nonce ‖ ct ‖ tag. */
export const POINT_CIPHERTEXT_BYTES = NONCE + POINT_PLAINTEXT_BYTES + TAG; // 47

export type TrackPoint = {
  /** мс от `trip.started_at`; отрицательных не бывает. */
  tMs: number;
  /** Координаты в E7 — градусы × 1e7 (M0.A §2.3). */
  latE7: number;
  lngE7: number;
  /** Точность, дециметры. */
  accDm: number;
  /** Скорость, см/с; 0xFFFF — неизвестна. */
  spdCms: number;
  /** b0 низкое качество, b1 начало сегмента, b2 конец сегмента, b3 стоянка, b4 маяк батареи. */
  flags: number;
  /** Длительность стоянки, с. */
  stopS: number;
};

/** Слот шифротекста — входит в AAD, поэтому шифротекст нельзя переставить в чужое поле. */
export type Slot = "point" | "ends" | "dest" | "folded";
const SLOT_CODE: Record<Slot, number> = { point: 1, ends: 2, dest: 3, folded: 4 };

function u32(view: DataView, off: number, v: number) {
  view.setUint32(off, v >>> 0, false); // big-endian: AAD канонична и читается глазами
}

/**
 * Канонический AAD фиксированной длины — 24 байта, без разделителей.
 *
 * Почему не склейка строк: `${trip}|${seq}|${slot}` даёт одинаковую AAD для разных наборов
 * полей (классическая неоднозначность разделителя), и шифротекст одного слота начинает
 * приниматься как другой. Все поля фиксированной ширины, big-endian, разделителей нет.
 *
 * `startedAtMs` входит намеренно: это делает неизменность времени старта поездки
 * криптографическим инвариантом, а не комментарием в DDL.
 *
 * `keyEpoch` НЕ входит: иначе ротация мастер-ключа обесценила бы все теги точек.
 */
function aad(slot: Slot, tripId: number, seq: number, startedAtMs: number): Buffer {
  const b = Buffer.alloc(24);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  u32(v, 0, 1); // версия формата AAD
  u32(v, 4, SLOT_CODE[slot]);
  u32(v, 8, tripId);
  v.setInt32(12, seq, false); // -1 для слотов уровня поездки
  // время старта в мс не влезает в 32 бита — кладём двумя словами
  u32(v, 16, Math.floor(startedAtMs / 0x100000000));
  u32(v, 20, startedAtMs >>> 0);
  return b;
}

export function encodePoint(p: TrackPoint): Buffer {
  const b = Buffer.alloc(POINT_PLAINTEXT_BYTES);
  b.writeInt32LE(p.tMs, 0);
  b.writeInt32LE(p.latE7, 4);
  b.writeInt32LE(p.lngE7, 8);
  b.writeUInt16LE(p.accDm, 12);
  b.writeUInt16LE(p.spdCms, 14);
  b.writeUInt8(p.flags, 16);
  b.writeUInt16LE(p.stopS, 17);
  return b;
}

export function decodePoint(b: Buffer): TrackPoint {
  return {
    tMs: b.readInt32LE(0),
    latE7: b.readInt32LE(4),
    lngE7: b.readInt32LE(8),
    accDm: b.readUInt16LE(12),
    spdCms: b.readUInt16LE(14),
    flags: b.readUInt8(16),
    stopS: b.readUInt16LE(17),
  };
}

/** nonce ‖ ct ‖ tag. Свежий случайный nonce на каждый вызов — см. шапку файла. */
export function seal(key: Buffer, plaintext: Buffer, ad: Buffer): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv(ALGO, key, nonce, { authTagLength: TAG });
  c.setAAD(ad, { plaintextLength: plaintext.length });
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]);
}

export function open(key: Buffer, boxed: Buffer, ad: Buffer): Buffer {
  if (boxed.length < NONCE + TAG) throw new Error("шифротекст короче nonce+tag");
  const nonce = boxed.subarray(0, NONCE);
  const ct = boxed.subarray(NONCE, boxed.length - TAG);
  const tag = boxed.subarray(boxed.length - TAG);
  const d = createDecipheriv(ALGO, key, nonce, { authTagLength: TAG });
  d.setAAD(ad, { plaintextLength: ct.length });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export function sealPoint(
  tripKey: Buffer,
  tripId: number,
  seq: number,
  startedAtMs: number,
  p: TrackPoint,
): Buffer {
  return seal(tripKey, encodePoint(p), aad("point", tripId, seq, startedAtMs));
}

export function openPoint(
  tripKey: Buffer,
  tripId: number,
  seq: number,
  startedAtMs: number,
  boxed: Buffer,
): TrackPoint {
  return decodePoint(open(tripKey, boxed, aad("point", tripId, seq, startedAtMs)));
}

export function sealTripField(
  tripKey: Buffer,
  slot: Exclude<Slot, "point">,
  tripId: number,
  startedAtMs: number,
  plaintext: Buffer,
): Buffer {
  return seal(tripKey, plaintext, aad(slot, tripId, -1, startedAtMs));
}

export function openTripField(
  tripKey: Buffer,
  slot: Exclude<Slot, "point">,
  tripId: number,
  startedAtMs: number,
  boxed: Buffer,
): Buffer {
  return open(tripKey, boxed, aad(slot, tripId, -1, startedAtMs));
}

// --- конвертное шифрование ключей -------------------------------------------------

/**
 * Мастер-ключ эпохи. Живёт вне БД — в systemd-credential на боксе (решение владельца
 * 2026-08-30): переменная окружения читается соседями по общему боксу через
 * /proc/<pid>/environ, credential — нет.
 *
 * Формат переменной: `<эпоха>:<base64 32 байт>`, например `1:AAAA…`. Несколько эпох через
 * запятую — для ротации: заворачиваем новой, разворачиваем любой известной.
 */
function readMasterKeys(): Map<number, Buffer> {
  const raw = process.env.TRACK_ENCRYPTION_KEY;
  if (!raw) throw new Error("TRACK_ENCRYPTION_KEY не задан — шифровать трассы нечем");
  const out = new Map<number, Buffer>();
  for (const part of raw.split(",")) {
    const [epochStr, b64] = part.trim().split(":");
    const epoch = Number(epochStr);
    if (!Number.isInteger(epoch) || !b64) throw new Error("TRACK_ENCRYPTION_KEY: ожидался формат «эпоха:base64»");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`TRACK_ENCRYPTION_KEY: ключ эпохи ${epoch} не 32 байта`);
    out.set(epoch, key);
  }
  return out;
}

let cached: Map<number, Buffer> | null = null;
function masterKeys(): Map<number, Buffer> {
  if (!cached) cached = readMasterKeys();
  return cached;
}

/** Текущая эпоха — наибольшая из известных. Заворачиваем всегда ей. */
export function currentEpoch(): number {
  return Math.max(...masterKeys().keys());
}

/**
 * Ключ поездки — случайные 32 байта, не производные от trip_id.
 * Производный ключ пришлось бы пересчитывать при ротации по всем поездкам; случайный
 * достаточно перезавернуть, не трогая ни одной строки точки.
 */
export function newTripKey(): Buffer {
  return randomBytes(32);
}

/** AAD завёртки называет эпоху: подмена номера эпохи даёт громкий отказ, а не тихий. */
function wrapAad(tripId: number, epoch: number): Buffer {
  const b = Buffer.alloc(12);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  u32(v, 0, 1);
  u32(v, 4, tripId);
  u32(v, 8, epoch);
  return b;
}

export function wrapTripKey(tripKey: Buffer, tripId: number, epoch = currentEpoch()): Buffer {
  const master = masterKeys().get(epoch);
  if (!master) throw new Error(`нет мастер-ключа эпохи ${epoch}`);
  // Отдельный ключ завёртки, выведенный из мастера: мастер сам ничего не шифрует напрямую.
  const kek = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from("wrap"), 32));
  return seal(kek, tripKey, wrapAad(tripId, epoch));
}

export function unwrapTripKey(wrapped: Buffer, tripId: number, epoch: number): Buffer {
  const master = masterKeys().get(epoch);
  if (!master) throw new Error(`нет мастер-ключа эпохи ${epoch} — ключ уничтожен или не подан`);
  const kek = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from("wrap"), 32));
  return open(kek, wrapped, wrapAad(tripId, epoch));
}

/**
 * Псевдоним установки: HMAC от install_id под ключом, выведенным из мастера.
 * Не сам install_id — дамп базы не должен отвечать на вопрос «какое это устройство».
 * Детерминирован намеренно: без этого не собрать «мою историю» (§3.5), и цена названа
 * в TRIP_SCHEMA.md §4.
 */
export function installRef(installId: string): Buffer {
  const master = masterKeys().get(currentEpoch())!;
  const k = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from("install"), 32));
  return createHmac("sha256", k).update(installId, "utf8").digest().subarray(0, 16);
}

/** Сравнение секретов без утечки по времени — для токенов доступа спринта 4. */
export function equalSecret(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Тестовый доступ: сбросить кэш ключей после подмены переменной окружения. */
export function resetKeyCacheForTests(): void {
  cached = null;
}
