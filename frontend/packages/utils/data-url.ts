/**
 * Converte uma data URL (ex.: `canvas.toDataURL()`) em File, decodificando no
 * próprio navegador.
 *
 * Não use `fetch(dataUrl)` para isso: a CSP da aplicação (`connect-src`) não
 * libera `data:`, e Safari/iOS e Firefox bloqueiam o fetch — o upload falha
 * antes de sair do aparelho, sem chegar à API. O Chrome não aplica essa regra,
 * por isso o problema só aparecia no celular.
 */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) {
    throw new Error("Data URL inválida");
  }
  const header = dataUrl.slice(5, comma); // ex.: "image/png;base64"
  const mimeType = header.split(";")[0] || "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  let bytes: Uint8Array<ArrayBuffer>;
  if (header.endsWith(";base64")) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new Uint8Array(new TextEncoder().encode(decodeURIComponent(payload)));
  }
  return new File([bytes], fileName, { type: mimeType });
}
