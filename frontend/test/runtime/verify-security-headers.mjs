/**
 * Verifica, contra um servidor Next já em execução (`next build && next start`),
 * que os cabeçalhos de segurança estão presentes e que a CSP do `middleware.ts`
 * não quebra nenhuma página.
 *
 * O ponto crítico é o `nonce`: páginas pré-renderizadas em build sairiam com
 * scripts inline sem nonce e seriam bloqueadas em runtime. Por isso cada rota é
 * baixada e todo `<script>` inline precisa carregar o nonce daquela resposta.
 *
 * Uso: ORBIT_RUNTIME_VERIFY=true node test/runtime/verify-security-headers.mjs
 *      (opcional) ORBIT_RUNTIME_WEB=http://127.0.0.1:3000
 */
if (process.env.ORBIT_RUNTIME_VERIFY !== 'true') throw new Error('ORBIT_RUNTIME_VERIFY=true is required.');
const base = process.env.ORBIT_RUNTIME_WEB ?? 'http://127.0.0.1:3000';

const ROUTES = [
  '/',
  '/login',
  '/inicio',
  '/operator/login',
  '/customer/login',
  '/rvt',
  '/documentos',
  '/agenda',
  '/financial',
  '/pmoc',
  '/clientes',
  '/settings',
];

const STATIC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
};

/** Diretivas que não podem afrouxar sem alguém perceber. */
const REQUIRED_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "'strict-dynamic'",
];

const failures = [];

for (const route of ROUTES) {
  const response = await fetch(`${base}${route}`, { redirect: 'manual' });
  const html = await response.text();
  const fail = (message) => failures.push(`${route}: ${message}`);

  for (const [header, expected] of Object.entries(STATIC_HEADERS)) {
    const actual = response.headers.get(header);
    if (actual !== expected) fail(`${header} = ${actual ?? '(ausente)'} (esperado ${expected})`);
  }

  const csp = response.headers.get('content-security-policy');
  if (!csp) {
    fail('sem cabeçalho content-security-policy');
    continue;
  }
  for (const directive of REQUIRED_DIRECTIVES) {
    if (!csp.includes(directive)) fail(`CSP sem "${directive}"`);
  }
  if (csp.includes("'unsafe-eval'")) fail("CSP de produção não pode conter 'unsafe-eval'");

  const nonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  if (!nonce) {
    fail('CSP sem nonce');
    continue;
  }

  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]);
  const inlineWithoutNonce = scriptTags.filter(
    (attrs) => !/\ssrc=/.test(attrs) && !attrs.includes(`nonce="${nonce}"`),
  );
  if (inlineWithoutNonce.length > 0) {
    fail(`${inlineWithoutNonce.length} script(s) inline sem nonce — a página não hidrataria`);
  }

  // Qualquer recurso externo no HTML inicial precisaria estar na allowlist;
  // hoje não existe nenhum (tudo é servido pela própria origem).
  const externalScripts = [...html.matchAll(/<script\b[^>]*\ssrc="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const externalStyles = [...html.matchAll(/<link\b[^>]*\shref="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  if (externalScripts.length > 0) fail(`script externo no HTML inicial: ${externalScripts.join(', ')}`);
  if (externalStyles.length > 0) fail(`folha de estilo externa no HTML inicial: ${externalStyles.join(', ')}`);
}

if (failures.length > 0) {
  console.error(`FALHOU (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`OK — ${ROUTES.length} rotas com cabeçalhos de segurança e CSP consistentes.`);
