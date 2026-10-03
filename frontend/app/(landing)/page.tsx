import type { Metadata } from "next";
import { LandingPage } from "../_landing/landing-page";
import { BRAND } from "../brand";

export const metadata: Metadata = {
  title: `${BRAND.name} · Ar-condicionado e Refrigeração`,
  description:
    "Instalação, manutenção preventiva e corretiva, PMOC e projetos em ar-condicionado e refrigeração. Relatórios digitais (PMOC, RVT e Ordem de Serviço) assinados por responsável técnico credenciado.",
  openGraph: {
    title: `${BRAND.name} · Ar-condicionado e Refrigeração`,
    description:
      "O clima na medida certa para cada ambiente: instalação, manutenção e PMOC com documentação técnica 100% digital e assinada.",
    type: "website",
  },
};

export default function Page() {
  return <LandingPage />;
}
