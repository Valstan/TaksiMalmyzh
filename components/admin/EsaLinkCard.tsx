import type { ServerProps } from "payload";
import { oidcConfig } from "@/lib/oidc";

// Карточка привязки на главной админки. Показывает, привязан ли текущий пользователь
// к единому входу, и даёт привязать: та же ссылка `start`, но из живой сессии — роут
// сам поймёт, что это привязка, а не вход.

export function EsaLinkCard({ user }: ServerProps) {
  if (!oidcConfig() || !user) return null;
  const linked = Boolean((user as { oidcSub?: string | null }).oidcSub);

  return (
    <section style={{ margin: "2rem 0", padding: "1rem", border: "1px solid var(--theme-elevation-150)", borderRadius: "4px" }}>
      <h3 style={{ margin: "0 0 .5rem" }}>Единый вход экосистемы</h3>
      {linked ? (
        <p style={{ margin: 0 }}>
          Привязан к вход.вмалмыже.рф. Теперь входить можно и через него — ссылка под
          формой логина.
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          {/* Роут отвечает редиректом на чужой хост — нужна полная навигация, не <Link>. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          Не привязан. <a href="/api/auth/oidc/start">Привязать единый вход</a> — вас
          отправит на вход.вмалмыже.рф и вернёт сюда; после этого в админку можно входить
          через него, в том числе через ВКонтакте.
        </p>
      )}
    </section>
  );
}
