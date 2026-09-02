// Состояние одного прохода входа между `start` и `callback`.
//
// Живёт в httpOnly-куке, а не в базе: проход длится секунды, а состояние нужно ровно
// тому браузеру, который его начал. Кука ограничена путём роутов входа, чтобы не
// ездить с каждым запросом к сайту.

export const FLOW_COOKIE = "oidc-flow";

export interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  mode: "login" | "link";
  /** В режиме `link` — кому привязываем; в `callback` сверяется с живой сессией. */
  userId?: number;
}

const FLOW_TTL_SECONDS = 10 * 60;

export function flowCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/api/auth/oidc",
    maxAge: FLOW_TTL_SECONDS,
  };
}

export function parseFlow(raw: string | undefined): FlowState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FlowState>;
    if (
      typeof v.state !== "string" ||
      typeof v.nonce !== "string" ||
      typeof v.verifier !== "string" ||
      (v.mode !== "login" && v.mode !== "link")
    ) {
      return null;
    }
    return {
      state: v.state,
      nonce: v.nonce,
      verifier: v.verifier,
      mode: v.mode,
      userId: typeof v.userId === "number" ? v.userId : undefined,
    };
  } catch {
    return null;
  }
}
