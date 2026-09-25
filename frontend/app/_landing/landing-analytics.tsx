"use client";

/**
 * Tag do Google Ads — montada **apenas** pelo layout do route group
 * `(landing)`. Nada aqui pode ser importado pelo layout raiz nem por rotas
 * autenticadas: é essa separação que impede o Google de enxergar caminhos
 * internos e o comportamento de quem está logado.
 *
 * A tag só entra depois do aceite no banner de cookies (LGPD). Como o banner
 * avisa por evento, aceitar liga o rastreamento na hora, sem recarregar.
 */
import { useEffect, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import {
  CONSENT_EVENT,
  GOOGLE_ADS_ID,
  hasMarketingConsent,
  syncConsentMode,
} from "./analytics";

export function LandingAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(hasMarketingConsent());
    sync();
    // Resposta do banner nesta aba…
    window.addEventListener(CONSENT_EVENT, sync);
    // …e em outra aba aberta no mesmo site.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Confirma o consentimento ao Google assim que a tag estiver disponível.
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => syncConsentMode("granted"), 0);
    return () => window.clearTimeout(timer);
  }, [allowed]);

  if (!GOOGLE_ADS_ID || !allowed) return null;

  /*
   * `GoogleAnalytics` é o componente do pacote oficial que injeta o gtag.js
   * (`googletagmanager.com/gtag/js?id=…`) via next/script com a estratégia
   * recomendada e faz o `config` do id — exatamente o snippet que o Google Ads
   * pede. Serve para qualquer id gtag, inclusive `AW-`, apesar do nome.
   */
  return <GoogleAnalytics gaId={GOOGLE_ADS_ID} />;
}
