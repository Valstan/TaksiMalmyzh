import { NextResponse } from "next/server";

// Выход. POST, а не GET: ссылку на выход мог бы дёрнуть любой сторонний `<img src>`.
// Форма в шапке проходит CSP `form-action 'self'`.
//
// Сессия отзывается на сервере, не только кука: у Payload сессии живут в `users.sessions`,
// и без отзыва украденный токен работал бы до истечения.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const res = NextResponse.redirect(new URL("/", url.origin), 303);
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

  res.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return res;
}
