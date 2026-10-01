import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@erp/ui/theme/theme-provider";
import { AppProviders } from "./app-providers";
import "./globals.css";

/**
 * Renderização dinâmica em todas as rotas.
 *
 * Necessário para a CSP com `nonce` do `middleware.ts`: uma página
 * pré-renderizada em build sai com scripts inline sem nonce e seria bloqueada
 * pela política em runtime (HTML aparece, hidratação não acontece). Como quase
 * tudo aqui é client-side atrás de autenticação, o custo é um SSR por
 * requisição de um shell pequeno.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Climatize - ERP",
  description: "Plataforma de gestão e operação de campo.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};  

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // O `next-themes` injeta um script inline para aplicar o tema antes da
  // pintura; repassamos o nonce da CSP para que ele não seja bloqueado.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <AppProviders>{children}</AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
