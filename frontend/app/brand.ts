/**
 * Identidade da empresa contratante usada fora do banco (metadados do HTML,
 * manifesto do PWA e atalho do iOS). É o único lugar a ajustar no código ao
 * implantar para outra empresa — junto com os arquivos de imagem:
 * public/brand/logo.png, app/icon.png, app/apple-icon.png, app/favicon.ico
 * e public/icons/icon-*.png.
 */
export const BRAND = {
  /** Nome completo (título da aba e do app instalado). */
  name: "Clima Certo Refrigeração",
  /** Rótulo do atalho na tela inicial do celular (até ~12 caracteres). */
  shortName: "Clima Certo",
  /** Azul-marinho da logo: barra de status do celular e cor do app instalado. */
  themeColor: "#01188a",
} as const;
