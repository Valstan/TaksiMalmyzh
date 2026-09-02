// Текущий пользователь для серверных компонентов сайта.
//
// Одна точка, где страница узнаёт, кто пришёл: шапке нужно имя, гейтам — роль.
// Сломанная или чужая сессия — это гость, а не ошибка страницы.

import { headers } from "next/headers";

export interface SessionUser {
  id: number;
  role: "superadmin" | "user";
  /** Что показать в шапке: имя из единого входа, иначе логин. */
  label: string;
}

export async function currentUser(): Promise<SessionUser | null> {
  try {
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: await headers() });
    if (!user) return null;
    return {
      id: Number(user.id),
      role: user.role,
      label: user.name?.trim() || user.username,
    };
  } catch {
    return null;
  }
}
