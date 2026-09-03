// Сессия Payload для пользователя, вошедшего через ЕСА.
//
// Payload умеет выдавать сессию только операцией login по паролю. Здесь повторён
// ровно тот же путь, что проходит `login` (payload/dist/auth/operations/login.js):
// запись сессии в `sessions` пользователя → подпись JWT тем же секретом → та же кука
// `payload-token`. Поэтому для админки и для гейта записи поездок такой вход
// неотличим от парольного: `payload.auth()` увидит обычного пользователя.

import { getFieldsToSign, jwtSign, type Payload } from "payload";
import type { User } from "@/payload-types";

export interface IssuedSession {
  cookieName: string;
  token: string;
  expiresAt: Date;
}

export async function issuePayloadSession(payload: Payload, user: User): Promise<IssuedSession> {
  const collection = payload.collections.users.config;
  const ttlSeconds = collection.auth.tokenExpiration;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // Отметка входа ставится ВСЕГДА, а не только при включённых сессиях: на ней держится
  // ретеншн аккаунтов посетителей (12 месяцев, решение владельца 2026-09-03). Если бы она
  // ехала внутри ветки `useSessions`, выключение сессий тихо сделало бы все аккаунты
  // вечными — ретеншн перестал бы находить кандидатов, ничего при этом не сломав.
  const data: Partial<Pick<User, "lastLoginAt" | "sessions">> = {
    lastLoginAt: now.toISOString(),
  };

  let sid: string | undefined;
  if (collection.auth.useSessions) {
    sid = crypto.randomUUID();
    const live = (user.sessions ?? []).filter((s) => new Date(s.expiresAt) > now);
    data.sessions = [
      ...live,
      { id: sid, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
    ];
  }

  await payload.update({
    collection: "users",
    id: user.id,
    data,
    overrideAccess: true,
  });

  const fieldsToSign = getFieldsToSign({
    collectionConfig: collection,
    email: user.email ?? "",
    sid,
    user: { ...user, collection: "users" },
  });
  const { token } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: ttlSeconds,
  });

  return { cookieName: `${payload.config.cookiePrefix}-token`, token, expiresAt };
}
