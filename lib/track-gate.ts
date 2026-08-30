import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Гейт этапа A для эндпоинтов записи поездки.
//
// ⚠️ Зачем он вообще существует. Стенд открыт наружу — решение владельца 2026-08-29. Если
// эндпоинты записи открыты вместе с ним, поездку сможет записать любой посторонний, а
// чужая трасса это персональные данные второго субъекта, то есть **этап B**, в который
// проект ещё не входил (M0.A §8.0: граница A→B — первый посторонний пассажир). Открытый
// эндпоинт записи пересекал бы эту границу молча, без единого решения владельца.
//
// Поэтому запись выключена по умолчанию и включается двумя переменными сразу:
//
//   TRACK_RECORDING=on        — включает эндпоинты вообще
//   TRACK_ETAP_A_TOKEN=<...>  — общий секрет; без него ни один запрос не проходит
//
// ⚠️ Токен обязан быть ASCII. Он едет в заголовке `Authorization`, а заголовки по
// спецификации ByteString: кириллица в токене не «работает хуже», а делает запрос
// невозможным — клиент падает при попытке его собрать. Проверено; в проекте с кириллицей
// повсюду это ошибка, которую сделаешь не задумываясь.
//
// На проде обеих нет, значит записи нет. Владелец включает её осознанно, когда собирается
// ехать сам — и выключает, когда закончил.
//
// Выключенные эндпоинты отвечают 404, а не 403: «такого адреса нет» не сообщает
// постороннему, что здесь что-то есть и оно чем-то закрыто.

export type GateResult = { ok: true } | { ok: false; status: 404 | 401 };

function hash(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/**
 * Ожидаемый токен: сперва systemd-credential, потом переменная окружения.
 *
 * Credential не из симметрии с ключом шифрования, а по существу: переменные окружения
 * процесса читаются соседями по общему боксу через `/proc/<pid>/environ`, а сосед, узнавший
 * токен, сможет писать поездки в нашу систему — то есть заводить чужие персональные данные.
 * Это ровно та граница A→B, которую гейт и защищает, так что защищать надо и сам токен.
 */
function expectedToken(): string | undefined {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (dir) {
    try {
      const v = readFileSync(join(dir, "etap_a_token"), "utf8").trim();
      if (v) return v;
    } catch {
      /* credential не подан — падаем на переменную окружения */
    }
  }
  return process.env.TRACK_ETAP_A_TOKEN;
}

export function checkRecordingGate(request: Request): GateResult {
  if (process.env.TRACK_RECORDING !== "on") return { ok: false, status: 404 };

  const expected = expectedToken();
  // Включить запись, забыв задать токен, — это открыть её всему интернету. Такая
  // комбинация трактуется как «выключено», а не как «включено без пароля».
  if (!expected) return { ok: false, status: 404 };

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) return { ok: false, status: 401 };

  // Сравнение по хэшам фиксированной длины: timingSafeEqual требует равных длин, а
  // сравнивать сырые строки разной длины значило бы сливать длину токена таймингом.
  return timingSafeEqual(hash(presented), hash(expected))
    ? { ok: true }
    : { ok: false, status: 401 };
}
