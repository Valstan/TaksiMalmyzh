import { oidcConfig } from "@/lib/oidc";

// Ссылка «войти через единый вход» под формой логина админки. Серверный компонент:
// решает по переменной окружения и ничего не отдаёт, пока вход не включён.
//
// Обычная ссылка, а не кнопка формы: начало входа — GET-редирект на ЕСА, и CSP
// `form-action 'self'` тут ни при чём.

export function EsaLoginLink() {
  if (!oidcConfig()) return null;
  return (
    <p style={{ margin: "1rem 0 0", textAlign: "center" }}>
      {/* Роут отвечает редиректом на чужой хост — нужна полная навигация, не <Link>. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/auth/oidc/start">Войти через единый вход (вход.вмалмыже.рф)</a>
      <br />
      <small>Работает после привязки: войдите паролем и привяжите на главной.</small>
    </p>
  );
}
