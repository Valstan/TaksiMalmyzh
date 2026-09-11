// Имя и атрибуты сессионной куки — в одном месте.
//
// Кука с префиксом `__Host-` (класс #285, письмо brain 2026-09-05): браузер принимает
// такую куку только с `Secure`, `Path=/` и БЕЗ `Domain`, а значит сосед по зоне
// `вмалмыже.рф` не может поставить её на всю зону и подсунуть нам чужую сессию. До
// 2026-09-11 кука звалась `payload-token`, как у всех на Payload, и доменная кука соседа с
// тем же именем прочиталась бы как своя — а у нас есть необратимое действие по сессии:
// привязка единого входа к учётке.
//
// ⚠️ Имя куки собирает не только наш код. Парольный вход в админку ставит её сам Payload
// (`generatePayloadCookie`), и `Secure` он берёт ТОЛЬКО из `auth.cookies` коллекции
// `users`, а не отсюда — без `cookies.secure: true` в `collections/Users.ts` кука уйдёт без
// `Secure`, браузер её молча отбросит, и вход в админку превратится в бесконечный круг
// «вошёл — снова форма» без единой ошибки в журнале. Три места должны сходиться:
// `payload.config.ts` (префикс), `collections/Users.ts` (атрибуты), этот файл (наши роуты).
//
// Цена префикса, принятая осознанно: `cookiePrefix` общий и для кук админки `-theme` и
// `-lng`, которые Payload пишет без `Secure` из кода, до которого нам не дотянуться. С
// префиксом `__Host-` браузер их отбрасывает: тема и язык админки не запоминаются между
// заходами (тема — системная, язык — из `Accept-Language`). Вход и сайт это не трогает.

import type { NextResponse } from "next/server";

export const SESSION_COOKIE_PREFIX = "__Host-payload";
export const SESSION_COOKIE = `${SESSION_COOKIE_PREFIX}-token`;

/** Имя до 2026-09-11. Больше нигде не читается; гасится, чтобы браузер не таскал мусор. */
export const LEGACY_SESSION_COOKIE = "payload-token";

/**
 * `Secure` — ВСЕГДА, а не «в проде»: префикс `__Host-` без него не принимается, а на
 * `http://localhost` и `*.localhost` браузеры Secure-куки принимают (доверенный origin).
 * Разработка по LAN-адресу с телефона этим ломается — тогда нужен https-туннель.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: true,
  path: "/",
} as const;

/**
 * Снять сессионную куку — и новую, и старую. Гасить обязательно с `Path=/` и без
 * `Domain`: браузер отождествляет куки по тройке имя+domain+path, остальные атрибуты на
 * совпадение не влияют. Доменную куку соседа мы так не снимем и не должны — защита держится
 * не на гашении, а на том, что старое имя сервер больше не читает.
 */
export function clearSessionCookies(res: NextResponse): NextResponse {
  for (const name of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    res.cookies.set(name, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  }
  return res;
}
