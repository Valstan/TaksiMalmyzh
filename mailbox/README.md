# mailbox — исходящие письма Такси → brain

Кладём сюда `to-brain/YYYY-MM-DD-slug.md` с frontmatter: `from`, `to`, `date`, `kind`
(`note` | `feedback` | `request` | `proposal`), при необходимости `compliance`,
`urgency` и `ref:` со full-slug письма, на которое отвечаем. Коммитим через PR в свой
репо; brain читает со своей стороны. Входящие от brain — в
`../brain_matrica/mailboxes/TaksiMalmyzh/from-brain/` (read-only, туда НЕ пишем).
