import { NextResponse } from "next/server";
import { eraseUser, ownsEntries } from "@/lib/account-retention";
import { publicOrigin } from "@/lib/oidc";
import { trackPool } from "@/lib/track-db";

// Удаление собственного аккаунта по просьбе человека (решение владельца 2026-09-03).
//
// До этого удаление раньше срока делалось «просьбой персоналу» — то есть человек не мог
// забрать свои данные сам, а страница `/dannye` обещала то, чего в продукте не было.
//
// POST, а не GET: удаление необратимо, и ссылку на него дёрнул бы любой сторонний
// `<img src>`. Форма проходит CSP `form-action 'self'`, как и выход.
//
// Идёт через `eraseUser` — ту же точку, что и регламент: ссылки снимаются, строка уходит в
// журнал уничтожения. Отличается только основание: `request`, а не `retention_12m`. Обещание
// «удаляем и убираем за собой» должно быть верно для обоих путей, иначе оно верно ни для
// одного.

export const dynamic = "force-dynamic";

const back = (origin: string, status: string) =>
  NextResponse.redirect(new URL(`/dannye?${status}`, origin), 303);

export async function POST(request: Request) {
  const { origin, secure } = publicOrigin(request);

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: request.headers });

  if (!user) return back(origin, "delete=noauth");

  // Персоналу — нельзя. Учётка `superadmin` это доступ к админке и к записи поездок; её
  // удаляют осознанно из админки, а не кнопкой на странице о данных, где сотрудник может
  // оказаться просто потому, что зашёл посмотреть.
  if (user.role === "superadmin") return back(origin, "delete=staff");

  const pool = trackPool();
  if (await ownsEntries(pool, Number(user.id))) {
    // Не отказ ради отказа: удалив, мы бы молча сняли владельца с карточки бизнеса вместе с
    // кабинетом и работниками. Человеку объясняем словами, что снять владение должен
    // персонал, — это делается звонком, как и подтверждение.
    return back(origin, "delete=owner");
  }

  await eraseUser(payload, pool, Number(user.id), "request", (m) => payload.logger.error(m));
  payload.logger.info(`аккаунт ${user.id} удалён по просьбе владельца аккаунта`);

  // Кука снимается вручную: пользователя, которому она принадлежала, больше нет, и без
  // этого браузер продолжал бы слать мёртвый токен до истечения.
  const res = back(origin, "delete=ok");
  res.cookies.set(`${payload.config.cookiePrefix}-token`, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return res;
}
