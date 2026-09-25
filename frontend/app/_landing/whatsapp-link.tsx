"use client";

/**
 * Link de WhatsApp da landing com medição de conversão.
 *
 * Todo botão de WhatsApp da página passa por aqui, para que a conversão seja
 * registrada num único lugar — e para que nenhum ponto de contato envie dado
 * do visitante por engano: `trackWhatsAppConversion()` não recebe parâmetros.
 *
 * Continua sendo um `<a>` de verdade (abre em nova aba, funciona sem JS e
 * preserva "abrir em nova janela" do botão do meio/⌘-clique). Só o clique
 * simples é interceptado, para disparar o evento antes de abrir.
 */
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { trackWhatsAppConversion } from "./analytics";

type WhatsAppLinkProps = {
  href: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children" | "onClick">;

export function WhatsAppLink({ href, children, ...props }: WhatsAppLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Deixa o navegador cuidar de ⌘/ctrl-clique, botão do meio e afins.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    trackWhatsAppConversion();
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} {...props}>
      {children}
    </a>
  );
}
