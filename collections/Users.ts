import type { CollectionConfig } from "payload";

// Пользователи админки. Это НЕ пассажиры: пассажиры Фазы 1 псевдонимны и аккаунтов
// не имеют (M0.A). Здесь живёт супер-админ и, позже, кабинеты бизнесов (спринт 8).
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
    // Только вошедшие видят и правят пользователей; наружу коллекция закрыта.
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: "role",
      type: "select",
      label: "Роль",
      options: [{ label: "Супер-админ", value: "superadmin" }],
      defaultValue: "superadmin",
      required: true,
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
  ],
};
