/** All field evidence is resized and encoded before applying the API size limit. */
export const EVIDENCE_PHOTO_TARGET_BYTES = 512 * 1024;
export const EVIDENCE_PHOTO_MAX_DIMENSION = 1600;
const SOURCE_LIMIT = 40 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export async function prepareEvidencePhoto(file: File): Promise<File> {
  if (!TYPES.has(file.type.toLowerCase()) || !file.size) throw new Error('Escolha uma foto JPEG, PNG ou WebP.');
  if (file.size > SOURCE_LIMIT) throw new Error('A foto original excede 40 MiB. Escolha uma imagem menor.');
  const source = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível abrir esta foto. Tente exportá-la como JPEG ou PNG.'));
      image.src = source;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('A imagem está vazia ou inválida.');
    const scale = Math.min(1, EVIDENCE_PHOTO_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto neste aparelho.');
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (let resize = 0; resize < 5; resize++) {
      canvas.width = width; canvas.height = height;
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
      // Modern mobile browsers apply the original EXIF orientation on decode.
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.82, 0.7, 0.58, 0.45]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('Não foi possível compactar a foto. Tente novamente.');
        if (blob.size <= EVIDENCE_PHOTO_TARGET_BYTES) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
        }
      }
      width = Math.max(1, Math.round(width * 0.75)); height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error('Não foi possível reduzir esta foto. Escolha outra imagem.');
  } finally {
    image.onload = null; image.onerror = null; image.src = ''; URL.revokeObjectURL(source);
  }
}
