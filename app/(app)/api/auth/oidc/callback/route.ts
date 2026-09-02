import { NextResponse } from "next/server";
import { exchangeCode, oidcConfig } from "@/lib/oidc";
import { FLOW_COOKIE, flowCookieOptions, parseFlow } from "@/lib/oidc-flow";
import { issuePayloadSession } from "@/lib/oidc-session";
import type { User } from "@/payload-types";

// Возврат из ЕСА. Единственный redirect_uri клиента — сверяется на их стороне
// байт-в-байт, поэтому живёт только на корневом домене.
//
// Ответы словами, а не кодами: сюда приходит человек из браузера, и «403» ему ничего
// не скажет. Но и подробностей нет: что именно не сошлось (state, nonce, подпись) —
// в лог, не на экран.

export const dynamic = "force-dynamic";

const ADMIN_PATH = "/admin";

function page(text: string, status: number) {
  return new NextResponse(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const cfg = oidcConfig();
  if (!cfg) return new NextResponse("Not Found", { status: 404 });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = request.headers.get("cookie") ?? "";
  const rawFlow = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${FLOW_COOKIE}=`))
    ?.slice(FLOW_COOKIE.length + 1);
  const flow = parseFlow(rawFlow ? decodeURIComponent(rawFlow) : undefined);

  // Кука прохода одноразовая: что бы ни случилось дальше, второй раз она не сработает.
  const clear = (res: NextResponse) => {
    res.cookies.set(FLOW_COOKIE, "", { ...flowCookieOptions(request), maxAge: 0 });
    return res;
  };

  if (url.searchParams.get("error")) {
    return clear(page("Вход через единый вход не состоялся. Можно попробовать ещё раз.", 400));
  }
  if (!code || !state || !flow || state !== flow.state) {
    return clear(page("Сеанс входа не найден или устарел. Начните вход заново.", 400));
  }

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });

  let identity;
  try {
    identity = await exchangeCode(cfg, code, flow.verifier, flow.nonce);
  } catch (e) {
    payload.logger.warn(`oidc: обмен кода не прошёл: ${e instanceof Error ? e.message : e}`);
    return clear(page("Единый вход не подтвердил личность. Начните вход заново.", 400));
  }

  const bySub = await payload.find({
    collection: "users",
    where: { oidcSub: { equals: identity.sub } },
    limit: 1,
    overrideAccess: true,
  });
  const linked = bySub.docs[0] as User | undefined;

  if (flow.mode === "link") {
    // Привязка: живая сессия обязана быть и совпадать с тем, кто её начинал.
    const { user } = await payload.auth({ headers: request.headers });
    if (!user || Number(user.id) !== flow.userId) {
      return clear(page("Сессия истекла, привязка не выполнена. Войдите и повторите.", 401));
    }
    if (linked && Number(linked.id) !== Number(user.id)) {
      return clear(page("Этот аккаунт единого входа уже привязан к другому пользователю.", 409));
    }
    if (!linked) {
      await payload.update({
        collection: "users",
        id: user.id,
        data: { oidcSub: identity.sub },
        overrideAccess: true,
      });
      payload.logger.info(`oidc: пользователь ${user.id} привязал единый вход`);
    }
    return clear(NextResponse.redirect(new URL(ADMIN_PATH, url.origin), 302));
  }

  if (!linked) {
    // Регистрации нет: незнакомый sub — не ошибка ЕСА, а отсутствие привязки.
    return clear(
      page(
        "Этот аккаунт единого входа не привязан к ПОЗВОНИ. Войдите логином и паролем, " +
          "затем привяжите единый вход на главной странице админки.",
        403,
      ),
    );
  }

  const session = await issuePayloadSession(payload, linked);
  const res = NextResponse.redirect(new URL(ADMIN_PATH, url.origin), 302);
  res.cookies.set(session.cookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    expires: session.expiresAt,
  });
  payload.logger.info(`oidc: пользователь ${linked.id} вошёл через единый вход`);
  return clear(res);
}
