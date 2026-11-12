/** Decode a canvas PNG locally. fetch(data:) is blocked by the production CSP. */
export function signatureDataUrlToFile(dataUrl: string): File {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("A imagem da assinatura é inválida. Confirme a assinatura novamente.");
  const binary = atob(dataUrl.slice(prefix.length));
  if (!binary.length) throw new Error("A assinatura está vazia. Desenhe e confirme novamente.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], "assinatura.png", { type: "image/png" });
}
