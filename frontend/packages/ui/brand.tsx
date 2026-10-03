/**
 * BrandLogo — logo institucional da empresa contratante (white-label).
 *
 * Servida de /brand/logo.png: versão "selo" gerada a partir de
 * `logo-principal.png`, com o miolo da moldura preenchido de branco para
 * continuar legível no tema escuro. Ao trocar de empresa, substitua o arquivo
 * (mantendo a proporção larga) — nenhum componente referencia a marca pelo nome.
 * Usa <img> simples para evitar a configuração remota do next/image.
 */
export function BrandLogo({ className = "", height = 32, alt = "Logo da empresa" }: { className?: string; height?: number; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo.png" alt={alt} height={height} style={{ height, width: "auto" }} className={className} />
  );
}
