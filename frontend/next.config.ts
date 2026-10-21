import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança fixos (sem variação por requisição). A CSP, que
 * depende de um `nonce` por requisição, fica no `middleware.ts`.
 */
const SECURITY_HEADERS = [
  // Impede MIME sniffing (um upload servido como texto não vira script).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Redundante com `frame-ancestors`, para browsers/proxies antigos.
  { key: "X-Frame-Options", value: "DENY" },
  // Não vaza caminho/ID de recurso interno para destinos externos.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Desliga APIs que a aplicação não usa. `camera` fica de fora de propósito:
  // o app do operador anexa fotos pela câmera do dispositivo.
  {
    key: "Permissions-Policy",
    value: "geolocation=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
  },
  // Evita que o Chrome agrupe esta origem com outras no mesmo processo.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Slim, self-contained server output for Docker (.next/standalone).
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
