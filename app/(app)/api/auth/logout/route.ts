import { NextResponse } from "next/server";
import { endSessionUrl, oidcConfig, publicOrigin } from "@/lib/oidc";
import { clearSessionCookies } from "@/lib/session-cookie";

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
//
// Имя куки — константа, а не значение из конфига, добытое внутри `try`: если бы конфиг
// или база не поднялись, роут гасил бы не ту куку и человек, нажавший «выйти», остался
// бы вошедшим. Кука снимается всегда, отзыв сессии — когда есть что отзывать.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { origin } = publicOrigin(request);

  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
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

  return clearSessionCookies(NextResponse.redirect(target, 303));
}
