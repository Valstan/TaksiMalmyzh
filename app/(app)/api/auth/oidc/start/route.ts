import { NextResponse } from "next/server";
import { authorizeUrl, oidcConfig, pkceChallenge, randomToken } from "@/lib/oidc";
import { FLOW_COOKIE, flowCookieOptions, type FlowState } from "@/lib/oidc-flow";

// Начало входа через ЕСА.
//
// Два режима, и выбирает их не параметр, а факт сессии:
//  - гость → `login`: после возврата ищем пользователя по `sub`;
//  - вошедший → `link`: после возврата привязываем `sub` к ЕГО учётке.
//
// Регистрации снаружи нет и не появляется: незнакомый `sub` не создаёт пользователя.
// Привязка — единственный способ появиться в списке, и делает её тот, кто уже вошёл
// паролем. Это удерживает этап A: «вошедший» по-прежнему ровно тот, кого завёл владелец.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = oidcConfig();
  if (!cfg) return new NextResponse("Not Found", { status: 404 });

  let mode: FlowState["mode"] = "login";
  let userId: number | undefined;
  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    if (user) {
      mode = "link";
      userId = Number(user.id);
    }
  } catch {
    // Сломанная сессия — это гость.
  }

  const verifier = randomToken(48);
  const flow: FlowState = {
    state: randomToken(),
    nonce: randomToken(),
    verifier,
    mode,
    userId,
  };

  let target: string;
  try {
    target = await authorizeUrl(cfg, {
      state: flow.state,
      nonce: flow.nonce,
      codeChallenge: await pkceChallenge(verifier),
    });
  } catch {
    return new NextResponse("Единый вход сейчас недоступен. Попробуйте позже.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const res = NextResponse.redirect(target, 302);
  res.cookies.set(FLOW_COOKIE, JSON.stringify(flow), flowCookieOptions(request));
  return res;
}
