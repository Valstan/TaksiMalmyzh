// Текущий пользователь для серверных компонентов сайта.
//
// Одна точка, где страница узнаёт, кто пришёл: шапке нужно имя, гейтам — роль.
// Сломанная или чужая сессия — это гость, а не ошибка страницы.

import { cache } from "react";
import { headers } from "next/headers";

export interface SessionUser {
  id: number;
  role: "superadmin" | "user";
  /** Что показать в шапке: имя из единого входа, иначе логин. */
  label: string;
}

/**
 * ⚠️ Обёрнута в `cache()` не ради скорости, а потому что с 2026-09-10 тулбар в общем
 * layout зовёт её на КАЖДОЙ странице — а `/`, `/nomera`, `/kabinet`, `/dannye` и
 * `/poezdki` зовут её же в своём теле. Без дедупликации это два `payload.auth()` за
 * один рендер: две проверки одной и той же куки, два запроса к базе. `cache()` из React
 * действует в пределах одного запроса и ключуется по аргументам — их здесь нет, значит
 * попадание всегда.
 */
export const currentUser = cache(async function currentUser(): Promise<SessionUser | null> {
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
});
