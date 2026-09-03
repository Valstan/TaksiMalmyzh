import type { CollectionConfig } from "payload";

// Пользователи. Две роли:
//  - `superadmin` — владелец/персонал: админка, модерация, запись поездок этапа A;
//  - `user` — посетитель, вошедший через единый вход экосистемы (решение владельца
//    2026-09-02: вход через ВК с автосозданием аккаунта). В админку не попадает.
//
// Забор M0.A §10 при этом цел: аккаунт посетителя НЕ соединяется с трассами — запись
// поездок по-прежнему только у `superadmin` (lib/track-gate.ts), пока владелец не решит
// открыть её посетителям (это этап B: чужие персональные данные).
export const Users: CollectionConfig = {
  slug: "users",
  labels: { singular: "Пользователь", plural: "Пользователи" },
  auth: {
    // Владелец входит логином, не почтой. Почта не обязательна — лишних данных
    // не собираем. Второй способ войти — единый вход экосистемы (вход.вмалмыже.рф),
    // привязанный к учётке по полю `oidcSub` ниже; форм регистрации нет ни там, ни тут.
    loginWithUsername: {
      allowEmailLogin: false,
      requireEmail: false,
      requireUsername: true,
    },
    // Подбор пароля тормозится штатным замком Payload.
    maxLoginAttempts: 10,
    lockTime: 10 * 60 * 1000,
  },
  admin: { useAsTitle: "username" },
  access: {
    // В админку — только персонал. Посетитель с сессией остаётся на сайте.
    admin: ({ req }) => req.user?.role === "superadmin",
    // Персонал видит всех; посетитель — только себя (query-constraint, действует и в REST).
    read: ({ req }) =>
      req.user?.role === "superadmin" ? true : req.user ? { id: { equals: req.user.id } } : false,
    // Заводит, правит и удаляет пользователей только персонал. Автосоздание при первом
    // входе через ЕСА идёт локальным API с overrideAccess — не через это правило.
    create: ({ req }) => req.user?.role === "superadmin",
    update: ({ req }) => req.user?.role === "superadmin",
    delete: ({ req }) => req.user?.role === "superadmin",
  },
  fields: [
    {
      name: "role",
      type: "select",
      label: "Роль",
      options: [
        { label: "Супер-админ", value: "superadmin" },
        { label: "Посетитель", value: "user" },
      ],
      defaultValue: "user",
      required: true,
      // Роль не поднимается ничьей рукой, кроме персонала.
      access: { update: ({ req }) => req.user?.role === "superadmin" },
    },
    {
      // Имя из ЕСА (claim `name`) — показывается в шапке сайта. Для персонала пусто:
      // им показывать имя незачем, а логин и так есть.
      name: "name",
      type: "text",
      label: "Имя",
      admin: { description: "Как представился в едином входе." },
    },
    {
      // Устойчивый `sub` из ID-токена ЕСА — один на человека для всех сервисов
      // экосистемы (D-063). Заполняется только привязкой через /api/auth/oidc/start
      // из живой сессии; руками в админке не редактируется, чтобы привязку нельзя было
      // «переписать на себя» — уникальный индекс держит то же на уровне базы.
      name: "oidcSub",
      type: "text",
      label: "Единый вход (sub)",
      unique: true,
      index: true,
      admin: { readOnly: true, description: "Привязка к вход.вмалмыже.рф. Пусто — не привязан." },
      access: { update: () => false },
    },
    {
      // Отметка последнего входа — единственная опора ретеншна аккаунтов посетителей
      // (решение владельца 2026-09-03: 12 месяцев без входа — удаление,
      // `lib/account-retention.ts`). Двигает её только выдача сессии, поэтому по
      // `updated_at` считать нельзя: его сдвинет любая правка строки, включая нашу же
      // чистку сессий, и аккаунт стал бы вечным.
      name: "lastLoginAt",
      type: "date",
      label: "Последний вход",
      admin: {
        readOnly: true,
        description: "Двигается входом. Пусто — входов после 2026-09-03 не было.",
      },
      access: { update: () => false },
    },
  ],
};
