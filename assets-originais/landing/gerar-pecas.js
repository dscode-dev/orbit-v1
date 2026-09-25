const sharp = require('/Users/ds_/Documents/Devs/AllBlueLabs/Applications/ERP_Operation/backend/node_modules/sharp');
const SRC = '/Users/ds_/Documents/Devs/AllBlueLabs/Applications/ERP_Operation/assets-originais/landing/condensadora-evaporadora-do-ar-condicionado.jpg';
const SD = '/private/tmp/claude-501/-Users-ds--Documents-Devs-AllBlueLabs-Applications-ERP-Operation/ed4f8992-5216-4715-8709-c774887d0bd4/scratchpad', OUT = '/Users/ds_/Documents/Devs/AllBlueLabs/Applications/ERP_Operation/frontend/public/landing';
const SCALE = 2.5;

/**
 * Recorte do fundo branco.
 *
 * O flood fill sozinho dá alpha binário: sobra a franja clara que a arte tinha
 * contra o branco e a borda fica serrilhada ao ampliar. Então a máscara é
 * suavizada (feather) e o limiar deslocado (erosão de ~meio pixel), o que come
 * a franja e devolve uma borda com antialias de verdade.
 */
async function cutout() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Limiar conservador: o corpo tem áreas quase brancas encostando na borda,
  // e afrouxar isso faz o preenchimento vazar e comer a peça inteira.
  const isWhite = (i) => data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250;
  const mask = Buffer.alloc(width * height, 255); // 255 = objeto
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (mask[p] === 0 || !isWhite(p * channels)) return;
    mask[p] = 0; stack.push(p);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % width, y = (p - x) / width;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // Atenção: o sharp devolve a máscara borrada em 3 canais (sRGB), não em 1,
  // então o passo de leitura vem do info — ler como 1 canal pega pixel errado.
  const { data: soft, info: softInfo } = await sharp(mask, { raw: { width, height, channels: 1 } })
    .blur(1).raw().toBuffer({ resolveWithObject: true });
  const step = softInfo.channels;
  let edge = 0;
  for (let p = 0; p < width * height; p++) {
    // Limiar deslocado para dentro: encolhe ~1px (come a franja clara que a
    // arte tinha contra o branco) e mantém o degradê da borda.
    const a = Math.max(0, Math.min(1, (soft[p * step] / 255 - 0.55) / 0.4));
    data[p * channels + 3] = Math.round(a * 255);
    if (a > 0.02 && a < 0.98) edge++;
  }
  console.log('pixels de borda com alpha parcial:', edge);
  await sharp(data, { raw: { width, height, channels } }).png().toFile(SD + '/cutout-hd.png');
}

/** Peça sólida: recorte + upscale (sharp premultiplica, então a borda sobe limpa). */
async function unit(name, box) {
  const cut = await sharp(SD + '/cutout-hd.png').extract(box).png().toBuffer();
  const width = Math.round(box.width * SCALE);
  await sharp(cut).resize({ width, kernel: 'lanczos3' })
    .webp({ quality: 94, alphaQuality: 100 }).toFile(`${OUT}/${name}.webp`);
  console.log(name, `${box.width}x${box.height} -> ${width}px`);
}

/**
 * O jato é tinta clara sobre branco: recortá-lo como sólido deixaria um véu
 * retangular. O alpha vem da distância ao branco, filtrado pelo tom azulado
 * (sombras cinza do aparelho ficam de fora), e leva um desfoque leve — é névoa.
 */
async function air(name, box) {
  const { data, info } = await sharp(SRC).extract(box).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const d = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
    const cool = Math.max(0, Math.min(1, (b - r - 4) / 9));
    const a = Math.min(0.72, Math.pow(Math.min(1, d / 20), 0.75) * 0.66) * cool;
    data[i + 3] = a < 0.015 ? 0 : Math.round(a * 255);
  }
  const out = Math.round(width * SCALE);
  await sharp(data, { raw: { width, height, channels } })
    .resize({ width: out, kernel: 'lanczos3' }).blur(2.5)
    .webp({ quality: 92, alphaQuality: 100 }).toFile(`${OUT}/${name}.webp`);
  console.log(name, `${width}x${height} -> ${out}px`);
}

(async () => {
  await cutout();
  await unit('evaporadora', { left: 76, top: 100, width: 448, height: 148 });
  await unit('condensadora', { left: 609, top: 93, width: 387, height: 263 });
  await air('fluxo-ar', { left: 76, top: 248, width: 448, height: 132 });

  // zoom nas bordas, sobre fundo escuro, para conferir o resultado
  const z = async (file, box) => sharp(`${OUT}/${file}.webp`).extract(box).resize({ width: box.width * 2, kernel: 'nearest' }).png().toBuffer();
  await sharp({ create: { width: 1400, height: 700, channels: 4, background: '#0b1220' } })
    .composite([
      { input: await z('evaporadora', { left: 0, top: 0, width: 340, height: 260 }), left: 10, top: 10 },
      { input: await z('condensadora', { left: 0, top: 0, width: 340, height: 260 }), left: 706, top: 10 },
    ]).png().toFile(SD + '/zoom-edges.png');
})();
