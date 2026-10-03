import type { MetadataRoute } from "next";
import { BRAND } from "./brand";

/**
 * Manifesto do PWA. O app instalável é o Operador (campo), então `start_url`
 * e `scope` apontam para /operator. O `short_name` é o rótulo do atalho na
 * tela inicial do celular — mantenha até ~12 caracteres para não ser cortado.
 *
 * Ícones: PNG (exigido por Android/Chrome para instalar e gerar a splash),
 * um "maskable" com margem de segurança para os recortes redondos/squircle do
 * Android, e o apple-icon (app/apple-icon.png) para o iOS.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/operator",
    name: `${BRAND.name} — Operador`,
    short_name: BRAND.shortName,
    description: `Aplicativo de campo da ${BRAND.name}: agenda, atendimentos, QR e assinatura.`,
    start_url: "/operator",
    scope: "/operator",
    display: "standalone",
    orientation: "portrait",
    lang: "pt-BR",
    background_color: "#ffffff",
    theme_color: BRAND.themeColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
