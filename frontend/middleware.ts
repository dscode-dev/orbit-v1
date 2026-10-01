/**
 * Cabeçalhos de segurança da aplicação web — principalmente a Content Security
 * Policy (CSP).
 *
 * Por que existe: os tokens de sessão ficam no `localStorage` (ver
 * `packages/api/tokens.ts`), o que é confortável para o fluxo multi-escopo
 * (plataforma / operador / portal) mas deixa o token legível por qualquer
 * script injetado. A CSP é a mitigação: nenhum script inline sem `nonce`
 * executa e o `connect-src` restringe para onde dados podem sair, de modo que
 * um XSS deixa de ser exfiltração garantida de sessão.
 *
 * O `nonce` é gerado por requisição e repassado ao Next pelo cabeçalho de
 * requisição `content-security-policy` — o framework então assina os próprios
 * scripts inline (bootstrap e payload RSC). `strict-dynamic` cobre os scripts
 * que esses scripts carregam depois (chunks e o gtag da landing).
 *
 * Em caso de incidente em produção, trocar `CSP_REPORT_ONLY` para `true`
 * desarma a política (passa a apenas reportar no console) sem remover o resto
 * dos cabeçalhos. É uma constante — e não env — porque middleware tem o
 * `process.env` embutido em build, então uma env não teria efeito em runtime.
 */
import { NextResponse, type NextRequest } from "next/server";

const CSP_REPORT_ONLY = false;

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Origem absoluta da API, quando configurada. Em produção o padrão é `/api/v1`
 * (mesma origem, atrás do proxy reverso), e aí `'self'` já cobre.
 */
const API_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

/** Domínios de onde o Google Ads carrega a tag (somente na landing). */
const GOOGLE_TAG = "https://www.googletagmanager.com";
/** Destinos dos pings de conversão do Google Ads (img/beacon). */
const GOOGLE_CONVERSION = [
  "https://www.google.com",
  "https://www.google.com.br",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
];

function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // `strict-dynamic` faz o browser ignorar a allowlist de hosts e confiar
    // apenas no nonce (+ no que script confiável injetar). `https:` e
    // `'unsafe-inline'` ficam como fallback para browsers antigos, que não
    // entendem `strict-dynamic` — browsers modernos os descartam.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https:",
      "'unsafe-inline'",
      // O modo dev do Next compila com eval.
      ...(IS_DEV ? ["'unsafe-eval'"] : []),
    ],
    // Tailwind e os `<style>` da landing são inline; não há como assinar todos.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", GOOGLE_TAG, ...GOOGLE_CONVERSION],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(API_ORIGIN ? [API_ORIGIN] : []),
      // Busca de endereço por CEP.
      "https://viacep.com.br",
      GOOGLE_TAG,
      ...GOOGLE_CONVERSION,
      // HMR do Next em desenvolvimento.
      ...(IS_DEV ? ["ws:", "wss:"] : []),
    ],
    "media-src": ["'self'", "blob:", "data:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // O gtag cria iframes ocultos para o conversion linker; fora isso a
    // aplicação não embute nada.
    "frame-src": ["'self'", GOOGLE_TAG, ...GOOGLE_CONVERSION],
    "frame-ancestors": ["'none'"],
  };

  const serialized = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  return IS_DEV ? serialized : `${serialized}; upgrade-insecure-requests`;
}

export function middleware(request: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);

  // O Next lê o nonce do cabeçalho de REQUISIÇÃO para assinar seus scripts
  // inline — por isso ele vai sempre como `content-security-policy`, mesmo
  // quando a resposta sai em report-only.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(
    CSP_REPORT_ONLY ? "content-security-policy-report-only" : "content-security-policy",
    csp,
  );
  return response;
}

export const config = {
  // Estáticos e imagens não precisam de CSP por requisição (os cabeçalhos
  // fixos vêm do `next.config.ts`); deixá-los fora mantém o cache do Next.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|json|webmanifest)$).*)",
  ],
};
