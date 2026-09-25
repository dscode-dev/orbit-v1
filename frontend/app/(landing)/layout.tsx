/**
 * Layout exclusivo da landing page pública.
 *
 * Existe para isolar o rastreamento de marketing: a tag do Google Ads e o
 * banner de cookies são montados AQUI e em nenhum outro lugar. O layout raiz
 * (`app/layout.tsx`) continua sem qualquer script de terceiros, então
 * plataforma, app do operador e portal do cliente não carregam a tag — o
 * Google não enxerga rotas internas nem o comportamento de usuários
 * autenticados, e por isso também não precisam pedir consentimento.
 *
 * Route group: os parênteses não afetam a URL, a landing segue em `/`.
 */
import { CookieConsent } from "../_landing/cookie-consent";
import { LandingAnalytics } from "../_landing/landing-analytics";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CookieConsent />
      <LandingAnalytics />
    </>
  );
}
