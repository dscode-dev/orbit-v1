"use client";

/**
 * Banner de consentimento de cookies (LGPD).
 *
 * Só aparece quando há rastreamento configurado e o visitante ainda não
 * respondeu. Enquanto ele não aceitar, nenhum script do Google é carregado —
 * o bloqueio real está em `hasMarketingConsent()`, este componente apenas
 * coleta a resposta.
 *
 * Fica no layout do route group `(landing)`: a área logada não tem
 * rastreamento, então também não precisa pedir consentimento.
 */
import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import {
  CONSENT_OPEN_EVENT,
  GOOGLE_ADS_ID,
  readConsent,
  setMarketingConsent,
} from "./analytics";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Só monta no cliente: a resposta vive no navegador do visitante.
    if (!GOOGLE_ADS_ID) return;
    setVisible(readConsent() === null);
    // "Preferências de cookies" no rodapé reabre o banner: quem recusou (ou
    // aceitou) precisa poder mudar de ideia — a LGPD garante a revogação.
    const reopen = () => setVisible(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!visible) return null;

  const answer = (choice: "granted" | "denied") => {
    setMarketingConsent(choice);
    setVisible(false);
  };

  return (
    <div className="cc" role="dialog" aria-live="polite" aria-label="Aviso de cookies">
      <style>{CSS}</style>
      <span className="cc__icon" aria-hidden>
        <Cookie size={20} />
      </span>
      <p className="cc__text">
        Usamos cookies de publicidade para entender de onde vêm as visitas e medir nossos anúncios.
        Eles só são ativados com a sua autorização e não coletam dados pessoais seus nesta página.
      </p>
      <div className="cc__actions">
        <button type="button" className="cc__btn cc__btn--ghost" onClick={() => answer("denied")}>
          Recusar
        </button>
        <button type="button" className="cc__btn cc__btn--primary" onClick={() => answer("granted")}>
          Aceitar
        </button>
      </div>
    </div>
  );
}

const CSS = `
.cc {
  position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 60;
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  max-width: 720px; margin: 0 auto; padding: 16px 18px;
  border-radius: 16px; border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
  background: var(--color-background);
  box-shadow: 0 18px 44px color-mix(in srgb, var(--color-foreground) 18%, transparent);
  animation: cc-in .35s ease-out both;
}
@keyframes cc-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.cc__icon { display: inline-flex; color: var(--lp-primary, #2563eb); }
.cc__text { flex: 1 1 320px; margin: 0; font-size: 13.5px; line-height: 1.5;
  color: color-mix(in srgb, var(--color-foreground) 78%, transparent); }
.cc__actions { display: flex; gap: 8px; margin-left: auto; }
.cc__btn { height: 38px; padding: 0 18px; border-radius: 999px; font-size: 14px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; transition: opacity .2s, background .2s; }
.cc__btn--primary { color: #fff; background: var(--lp-primary, #2563eb); }
.cc__btn--primary:hover { opacity: .92; }
.cc__btn--ghost { color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
  border-color: color-mix(in srgb, var(--color-foreground) 16%, transparent); background: transparent; }
.cc__btn--ghost:hover { background: color-mix(in srgb, var(--color-foreground) 6%, transparent); }
@media (max-width: 560px) {
  .cc { gap: 10px; padding: 14px; }
  .cc__actions { width: 100%; margin-left: 0; }
  .cc__btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .cc { animation: none; } }
`;
