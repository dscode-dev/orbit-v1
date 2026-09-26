/**
 * Rastreamento de marketing da landing page (Google Ads).
 *
 * Escopo: **somente a landing**. A tag é montada no layout do route group
 * `(landing)` e nunca no layout raiz, para que nenhuma rota autenticada
 * (plataforma, operador, portal do cliente) carregue script do Google nem
 * exponha caminhos internos.
 *
 * Privacidade: os eventos daqui carregam apenas identificadores estáticos
 * combinados com o marketing — nunca nome, telefone, e-mail, texto digitado,
 * id de usuário ou token. É a AÇÃO que é medida, não a pessoa.
 */

/** ID da conta do Google Ads (formato `AW-XXXXXXXXX`). Vazio = sem rastreio. */
export const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? "";

/**
 * Rótulo da conversão de clique no WhatsApp, fornecido pelo painel do Google
 * Ads (a parte depois da barra em `AW-123456789/AbC-D_efG`).
 *
 * Ainda não foi informado pela equipe de tráfego: enquanto estiver vazio, o
 * clique **não dispara conversão** (a tag segue medindo visitas normalmente).
 * Basta preencher `NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL` no .env para ativar,
 * sem mexer em código.
 */
export const WHATSAPP_CONVERSION_LABEL =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL ?? "";

/** Onde a resposta do banner de cookies é guardada. */
export const CONSENT_STORAGE_KEY = "climatize:cookie-consent";

/** Evento interno: o banner avisa a tag para entrar/sair sem recarregar. */
export const CONSENT_EVENT = "climatize:consent-changed";

/** Evento interno: pedido de reabrir o banner para rever a escolha. */
export const CONSENT_OPEN_EVENT = "climatize:consent-open";

export type ConsentChoice = "granted" | "denied";

/** Resposta já dada pelo visitante, ou `null` se o banner ainda não foi respondido. */
export function readConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    // localStorage bloqueado (janela privada, cookies desativados).
    return null;
  }
}

/**
 * Consentimento de cookies de marketing (LGPD, art. 7º).
 *
 * Só há rastreamento com aceite **explícito**: sem resposta ao banner, ou com
 * recusa, nenhum script do Google é carregado e nenhum evento é enviado.
 */
export function hasMarketingConsent(): boolean {
  return readConsent() === "granted";
}

/** Grava a escolha do visitante e avisa a página na hora. */
export function setMarketingConsent(choice: ConsentChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Sem storage a escolha não persiste entre visitas, mas vale nesta sessão.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
}

/**
 * Reabre o banner para o visitante rever a escolha (LGPD, art. 8º §5º: o
 * consentimento pode ser revogado a qualquer momento). Acionado pelo link
 * "Preferências de cookies" no rodapé da landing.
 */
export function openCookiePreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT));
}

/** `gtag` é injetado pela tag do Google; tipado aqui só para uso interno. */
type Gtag = (
  command: "event" | "consent",
  action: string,
  params: Record<string, string>,
) => void;

declare global {
  interface Window {
    gtag?: Gtag;
  }
}

/**
 * Consent Mode v2: confirma ao Google que o uso de cookies de anúncio foi
 * autorizado. A tag só é montada após o aceite, então isto é a segunda
 * tranca — se um dia ela passar a carregar antes da resposta, o padrão do
 * Google continua sendo "negado" até esta chamada.
 */
export function syncConsentMode(choice: ConsentChoice): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const value = choice === "granted" ? "granted" : "denied";
  window.gtag("consent", "update", {
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
    analytics_storage: value,
  });
}

/**
 * Conversão de clique no botão do WhatsApp.
 *
 * Tags `AW-` recebem conversão por `gtag('event', 'conversion', { send_to })`,
 * que é o que a tag do Google Ads escuta. (`sendGTMEvent` só faria sentido se
 * a conta passasse a usar um contêiner GTM: nesse caso troque a chamada por
 * `sendGTMEvent({ event: 'conversion', send_to: ... })` e nada mais muda.)
 *
 * O payload é fixo e sem dados do visitante — nenhum argumento é aceito de
 * propósito, para não abrir espaço a envio acidental de dado pessoal.
 */
export function trackWhatsAppConversion(): void {
  if (!GOOGLE_ADS_ID || !WHATSAPP_CONVERSION_LABEL) return;
  if (!hasMarketingConsent()) return;
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${WHATSAPP_CONVERSION_LABEL}`,
  });
}
