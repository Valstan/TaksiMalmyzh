// Вход через ЕСА (вход.вмалмыже.рф) — OpenID Connect, Authorization Code + PKCE.
//
// Зачем: владелец попросил «вход через ВК». Прямой интеграции с ВК нет и не будет —
// единый вход экосистемы делает ЕСА, а ВК для неё лишь один из способов войти. Нам
// ЕСА отдаёт устойчивый `sub` (один на человека для всех сервисов) и `name`; как
// именно человек вошёл туда, сайту невидимо — решение владельца D-063, 2026-09-02.
//
// Клиент ПУБЛИЧНЫЙ: секрета не существует, хранить и ротировать нечего. Взамен
// обязателен PKCE S256 на каждом `authorize` и `code_verifier` на обмене.
//
// Redirect URI — ровно один, на корневом домене матрёшки (`lib/sites.ts`). Вход
// всегда возвращается на `позвони.вмалмыже.рф`; иначе каждый новый поддомен
// становился бы заявкой на чужой стороне (письмо to-brain 2026-08-30 §1).
//
// Мастер-выключатель — переменная OIDC_CLIENT_ID. Без неё роутов входа не существует
// (404), как и у записи поездок: отсутствие функции не должно выглядеть как «закрыто».

import { createRemoteJWKSet, jwtVerify } from "jose";
import { ROOT_SITE } from "./sites";

/** `вход.вмалмыже.рф` в punycode: в OAuth-полях кириллица не проходит (G108). */
export const DEFAULT_ISSUER = "https://xn--b1ae3a1a.xn--80adkdyec4j.xn--p1ai";

export const CALLBACK_PATH = "/api/auth/oidc/callback";

/**
 * Публичный адрес корневого домена — для редиректов и флага Secure у кук.
 *
 * ⚠️ Не `new URL(request.url).origin`: за nginx приложение видит себя как
 * `localhost:<порт>`, и первый живой вход 2026-09-02 вернул владельца ровно туда.
 * Локально (`next dev`) публичного адреса нет — тогда origin запроса и http.
 */
export function publicOrigin(request: Request): { origin: string; secure: boolean } {
  if (process.env.NODE_ENV === "production") {
    return { origin: `https://${ROOT_SITE.host}`, secure: true };
  }
  const u = new URL(request.url);
  return { origin: u.origin, secure: u.protocol === "https:" };
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

/** Конфигурация или `null`, если вход через ЕСА не включён. */
export function oidcConfig(): OidcConfig | null {
  const clientId = process.env.OIDC_CLIENT_ID;
  if (!clientId) return null;
  return {
    issuer: (process.env.OIDC_ISSUER || DEFAULT_ISSUER).replace(/\/$/, ""),
    clientId,
    redirectUri: `https://${ROOT_SITE.host}${CALLBACK_PATH}`,
    // Только то, что нужно: `sub` и имя. Почту не просим — лишних данных не собираем.
    scope: "openid profile",
  };
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  issuer: string;
}

let discoveryCache: { at: number; doc: Discovery } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/**
 * Discovery-документ ЕСА. Адреса эндпоинтов берутся отсюда, а не из письма: письмо
 * называло ключи `/oidc/jwks`, живой документ — `/.well-known/jwks.json`. Документ — истина.
 */
export async function discover(cfg: OidcConfig): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.doc;
  }
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`discovery ${res.status}`);
  const doc = (await res.json()) as Discovery;
  if (doc.issuer !== cfg.issuer) {
    // Документ от другого issuer — либо подмена, либо ошибка конфигурации.
    throw new Error("discovery: issuer не совпадает");
  }
  discoveryCache = { at: Date.now(), doc };
  return doc;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor = "";

function remoteJwks(uri: string) {
  if (!jwks || jwksFor !== uri) {
    jwks = createRemoteJWKSet(new URL(uri));
    jwksFor = uri;
  }
  return jwks;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256: challenge = BASE64URL(SHA256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export interface AuthorizeParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export async function authorizeUrl(cfg: OidcConfig, p: AuthorizeParams): Promise<string> {
  const doc = await discover(cfg);
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", p.state);
  url.searchParams.set("nonce", p.nonce);
  url.searchParams.set("code_challenge", p.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface Identity {
  sub: string;
  name: string | null;
}

/**
 * Обмен кода на токены и проверка ID-токена: подпись по JWKS, issuer, audience,
 * nonce. Личность берётся из проверенного ID-токена, а не из `/userinfo`: так
 * `sub` подтверждён подписью, а не только TLS-каналом.
 */
export async function exchangeCode(
  cfg: OidcConfig,
  code: string,
  codeVerifier: string,
  nonce: string,
): Promise<Identity> {
  const doc = await discover(cfg);
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("token: нет id_token");

  const { payload } = await jwtVerify(tokens.id_token, remoteJwks(doc.jwks_uri), {
    issuer: cfg.issuer,
    audience: cfg.clientId,
    algorithms: ["RS256"],
    clockTolerance: 60,
  });
  if (payload.nonce !== nonce) throw new Error("id_token: nonce не совпадает");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("id_token: нет sub");

  return {
    sub: payload.sub,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
