import type { Metadata } from "next";
import { LandingPage } from "../_landing/landing-page";

export const metadata: Metadata = {
  title: "Climatize · Climatização e Refrigeração HVAC-R",
  description:
    "Manutenção, instalação e serviços preventivos em climatização e refrigeração. Relatórios digitais (PMOC, RVT e Ordem de Serviço) assinados por responsável técnico credenciado.",
  openGraph: {
    title: "Climatize · Climatização e Refrigeração HVAC-R",
    description:
      "Manutenção, instalação e preventiva em equipamentos de refrigeração. Documentação técnica 100% digital e assinada.",
    type: "website",
  },
};

export default function Page() {
  return <LandingPage />;
}
