// Черновик первичной базы номеров, собранный из открытых источников 2026-08-29.
//
// ⚠️ ВСЁ здесь заводится со статусом «На проверке» и наружу НЕ публикуется:
// гейт владельца — каждый номер проверяется звонком или лично до публикации
// (решение 2026-08-29). Источник записан у каждой записи — по нему проверять.
//
// Сеется идемпотентно: запись с таким же названием повторно не создаётся.

type DraftEntry = {
  name: string;
  category: "taxi" | "shop" | "master" | "brigade" | "cargo" | "other";
  phones: { number: string }[];
  prices?: { label: string; value: string }[];
  note?: string;
  source: string;
};

export const directoryDraft: DraftEntry[] = [
  {
    name: "Такси «Фортуна»",
    category: "taxi",
    phones: [{ number: "+7 922 664-90-77" }, { number: "+7 919 529-10-20" }],
    prices: [{ label: "По городу", value: "от 100 ₽" }],
    note: "Город и межгород",
    source: "reiting-taksi.ru/malmyzh, спутник-такси.рф — сверить оба",
  },
  {
    name: "Такси «Гермес»",
    category: "taxi",
    phones: [{ number: "+7 953 135-02-74" }, { number: "+7 912 717-04-16" }],
    prices: [{ label: "По городу", value: "от 100 ₽" }],
    source: "reiting-taksi.ru/malmyzh, спутник-такси.рф — сверить оба",
  },
  {
    name: "«Любимое такси»",
    category: "taxi",
    phones: [{ number: "+7 912 370-81-05" }],
    source: "reiting-taksi.ru/malmyzh",
  },
  {
    name: "Такси «Ветер»",
    category: "taxi",
    phones: [{ number: "+7 912 717-69-08" }],
    source: "reiting-taksi.ru/malmyzh",
  },
  {
    name: "Такси «Круиз»",
    category: "taxi",
    phones: [{ number: "+7 912 717-69-08" }, { number: "+7 922 970-87-95" }],
    note: "⚠️ Первый номер совпадает с «Ветром» — возможно, одна служба под двумя именами",
    source: "reiting-taksi.ru/malmyzh",
  },
  {
    name: "Яндекс Такси (федеральный)",
    category: "taxi",
    phones: [{ number: "8 800 770-70-74" }],
    note: "Федеральная линия; работает ли подача в Малмыже — проверить",
    source: "reiting-taksi.ru/malmyzh",
  },
  {
    name: "Межгород Малмыж—Казань",
    category: "taxi",
    phones: [{ number: "+7 917 249-79-00" }],
    prices: [{ label: "До Казани", value: "≈ 3 800 ₽" }],
    note: "⚠️ Агрегатор-справочник, не местная служба — проверить особо",
    source: "mezhgorod-taksi.ru/malmyzh",
  },
  {
    name: "Межгород (диспетчерская, круглосуточно)",
    category: "taxi",
    phones: [{ number: "+7 939 555-01-39" }],
    prices: [
      { label: "До Казани", value: "≈ 3 800 ₽" },
      { label: "До Ижевска", value: "≈ 7 200 ₽" },
      { label: "До Йошкар-Олы", value: "≈ 5 600 ₽" },
    ],
    note: "⚠️ Агрегатор-справочник, не местная служба — проверить особо",
    source: "mezhgorod-taksi.ru/malmyzh",
  },
];
