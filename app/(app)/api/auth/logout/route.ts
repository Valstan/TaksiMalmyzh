import { NextResponse } from "next/server";
import { endSessionUrl, oidcConfig, publicOrigin } from "@/lib/oidc";

// Выход. POST, а не GET: ссылку на выход мог бы дёрнуть любой сторонний `<img src>`.
// Форма в шапке проходит CSP `form-action`, куда ради последнего шага добавлен хост ЕСА
// (next.config.mjs): политика проверяет и адрес редиректа после отправки формы.
//
// Сессия отзывается на сервере, не только кука: у Payload сессии живут в `users.sessions`,
// и без отзыва украденный токен работал бы до истечения.
//
// Последний шаг — выход из единого входа: гасим свою сессию и уводим человека на
// `end_session` ЕСА, иначе его кука там осталась бы живой и молча вернула бы его
// авторизованным (владелец, 2026-09-03). Отказ ЕСА выход у нас не отменяет.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { origin, secure } = publicOrigin(request);
  let cookieName = "payload-token";

  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
    cookieName = `${payload.config.cookiePrefix}-token`;
    const { user } = await payload.auth({ headers: request.headers });
    const sid = (user as { _sid?: string } | null)?._sid;
    if (user && sid) {
      const live = (user.sessions ?? []).filter((s) => s.id !== sid);
      await payload.update({
        collection: "users",
        id: user.id,
        data: { sessions: live },
        overrideAccess: true,
      });
    }
  } catch {
    // Нечего отзывать — просто снимаем куку.
  }

  // Своя сессия погашена — теперь единый вход. Если он недоступен или выхода не объявляет,
  // человек всё равно уходит на главную уже вышедшим у нас: свой выход не должен зависеть
  // от чужой службы.
  let target = new URL("/", origin).toString();
  const cfg = oidcConfig();
  if (cfg) {
    try {
      target = (await endSessionUrl(cfg)) ?? target;
    } catch {
      // ЕСА не ответил — выходим хотя бы у себя.
    }
  }

  const res = NextResponse.redirect(target, 303);
  res.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return res;
}
