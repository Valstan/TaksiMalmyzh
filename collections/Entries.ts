import type { CollectionConfig } from "payload";

// Записи справочника «ПОЗВОНИ»: такси, магазины, мастера, бригады.
//
// Правило публикации — решение владельца 2026-08-29: наружу уходит ТОЛЬКО то, что
// супер-админ проверил руками. Всё, что приходит от посетителей или из сбора по
// открытым источникам, лежит черновиком до его решения. Неверный номер в
// справочнике — прямой вред, поэтому гейт живёт в access-правиле, а не в дисциплине.
export const Entries: CollectionConfig = {
  slug: "entries",
  labels: { singular: "Номер справочника", plural: "Справочник номеров" },
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "category", "status", "updatedAt"],
    description:
      "Публикуются только записи со статусом «Опубликован». Черновики видны только здесь.",
  },
  access: {
    // Публичное чтение — только опубликованное. Query-constraint, а не фильтр в
    // коде страницы: правило действует и для REST, и для любого будущего кода.
    read: ({ req }) => (req.user ? true : { status: { equals: "published" } }),
    create: ({ req }) => Boolean(req.user), // посетители идут через /api/suggest
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: "name", type: "text", label: "Название", required: true },
    {
      name: "category",
      type: "select",
      label: "Категория",
      required: true,
      defaultValue: "taxi",
      options: [
        { label: "Такси", value: "taxi" },
        { label: "Магазины", value: "shop" },
        { label: "Мастера и ремонт", value: "master" },
        { label: "Бригады и работы", value: "brigade" },
        { label: "Доставка и грузы", value: "cargo" },
        { label: "Другое", value: "other" },
      ],
    },
    {
      name: "phones",
      type: "array",
      label: "Телефоны",
      minRows: 1,
      required: true,
      fields: [{ name: "number", type: "text", label: "Номер", required: true }],
    },
    {
      name: "prices",
      type: "array",
      label: "Цены (справочные, не оферта)",
      fields: [
        { name: "label", type: "text", label: "За что", required: true },
        { name: "value", type: "text", label: "Цена", required: true },
      ],
    },
    { name: "note", type: "textarea", label: "Примечание (направления, часы работы)" },
    {
      name: "status",
      type: "select",
      label: "Статус",
      required: true,
      defaultValue: "draft",
      options: [
        { label: "На проверке", value: "draft" },
        { label: "Опубликован", value: "published" },
        { label: "Отклонён", value: "rejected" },
      ],
      admin: {
        description: "«Опубликован» ставится только после проверки номера звонком или лично.",
      },
    },
    {
      name: "source",
      type: "text",
      label: "Откуда номер",
      admin: { description: "Для проверки: сайт-источник или «предложен посетителем»." },
    },
  ],
};
