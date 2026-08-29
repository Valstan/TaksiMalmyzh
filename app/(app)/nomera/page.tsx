import { getPayload } from "payload";
import config from "@payload-config";
import Link from "next/link";
import SuggestForm from "@/components/SuggestForm";

// Страница ходит в базу — пререндерить её на сборке нельзя (в CI базы нет),
// а кэшировать надолго не нужно: правки супер-админа должны быть видны сразу.
export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  taxi: "Такси",
  shop: "Магазины",
  master: "Мастера и ремонт",
  brigade: "Бригады и работы",
  cargo: "Доставка и грузы",
  other: "Другое",
};

function telHref(raw: string): string {
  return "tel:" + raw.replace(/[^\d+]/g, "");
}

export const metadata = {
  title: "Справочник номеров — ПОЗВОНИ",
  description: "Телефоны такси и услуг Малмыжа: звонок в одно касание.",
};

export default async function NomeraPage() {
  const payload = await getPayload({ config });
  // Access-правило коллекции само отдаёт анониму только опубликованное;
  // overrideAccess: false здесь — чтобы страница жила по тем же правилам,
  // что и весь остальной мир, а не в обход них.
  const { docs } = await payload.find({
    collection: "entries",
    overrideAccess: false,
    limit: 500,
    sort: "name",
  });

  const byCategory = new Map<string, typeof docs>();
  for (const doc of docs) {
    const list = byCategory.get(doc.category) ?? [];
    list.push(doc);
    byCategory.set(doc.category, list);
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Справочник номеров</h1>
        <p className="page-sub">
          Нажмите на номер — телефон наберёт сам. Цены справочные, не оферта: уточняйте
          при звонке. <Link href="/">← к карте</Link>
        </p>
      </header>

      {docs.length === 0 && (
        <p className="page-sub">
          Пока пусто: номера появляются после проверки. Предложите свой — форма ниже.
        </p>
      )}

      {Object.keys(CATEGORY_LABELS).map((cat) => {
        const list = byCategory.get(cat);
        if (!list || list.length === 0) return null;
        return (
          <section key={cat} className="dir-section">
            <h2>{CATEGORY_LABELS[cat]}</h2>
            <ul className="dir-list">
              {list.map((entry) => (
                <li key={entry.id} className="dir-card">
                  <div className="dir-name">{entry.name}</div>
                  <div className="dir-phones">
                    {(entry.phones ?? []).map((p) => (
                      <a key={p.id} className="dir-phone" href={telHref(p.number)}>
                        {p.number}
                      </a>
                    ))}
                  </div>
                  {entry.prices && entry.prices.length > 0 && (
                    <ul className="dir-prices">
                      {entry.prices.map((price) => (
                        <li key={price.id}>
                          {price.label}: <b>{price.value}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry.note && <p className="dir-note">{entry.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <SuggestForm />

      <footer className="page-footer">
        <p>
          Заметили неверный номер или цену? Напишите об этом в форме выше — проверим и
          поправим.
        </p>
      </footer>
    </main>
  );
}
