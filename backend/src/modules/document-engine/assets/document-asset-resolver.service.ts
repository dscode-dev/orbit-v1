import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
// qrcode publishes a CommonJS entry point; import assignment keeps runtime interop deterministic.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import QRCode = require('qrcode');
import {
  DOCUMENT_PHOTO_JPEG_QUALITY,
  DOCUMENT_PHOTO_MAX_DIMENSION,
  DOCUMENT_STORAGE_PREFIX,
} from '../../../shared/constants/document-engine.constants';
import { SIGNATURE_STORAGE_PREFIX } from '../../../shared/constants/signatures.constants';
import {
  STORAGE_PROVIDER_TOKEN,
  type StoredFile,
  type StorageProviderContract,
} from '../../../infra/storage/storage-provider.type';
import { AppLoggerService } from '../../../infra/logger/app-logger.service';

/** Superfície mínima do sharp usada aqui (evita depender do interop de tipos). */
interface SharpInstance {
  rotate(): SharpInstance;
  resize(options: {
    width: number;
    height: number;
    fit: 'inside';
    withoutEnlargement: boolean;
  }): SharpInstance;
  jpeg(options: { quality: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: Buffer, options?: { failOn?: 'none' }) => SharpInstance;

/** Superfície mínima do jimp usada aqui (evita depender dos tipos do pacote). */
interface JimpImage {
  bitmap: { width: number; height: number };
  scaleToFit(width: number, height: number): JimpImage;
  quality(value: number): JimpImage;
  getBufferAsync(mime: string): Promise<Buffer>;
}
interface JimpStatic {
  read(data: Buffer): Promise<JimpImage>;
}

export interface SaveDocumentPdfInput {
  operationId?: string | null;
  sourceId?: string;
  documentType: string;
  content: Buffer;
}

export interface SaveSignatureImageInput {
  content: Buffer;
  extension: 'png' | 'jpg' | 'jpeg';
}

export interface ResolvedAsset {
  storageKey: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

/** Limite de itens no cache de imagens comprimidas (fotos ~50-300 KB cada). */
const COMPRESSED_IMAGE_CACHE_LIMIT = 256;

@Injectable()
export class DocumentAssetResolver {
  // Cache LRU em memória do resultado comprimido por storageKey. As fotos são
  // imutáveis (um storageKey nunca muda de conteúdo), então comprimir uma vez e
  // reusar evita reprocessar a cada preview/render/checagem de fingerprint — o
  // que deixava a pré-visualização lenta, sobretudo no fallback pure-JS (jimp).
  private readonly compressedImageCache = new Map<string, { content: Buffer; mimeType: string }>();

  constructor(
    @Inject(STORAGE_PROVIDER_TOKEN)
    private readonly storage: StorageProviderContract,
    private readonly logger: AppLoggerService,
  ) {}

  async saveDocumentPdf(input: SaveDocumentPdfInput): Promise<StoredFile> {
    const sourceId = input.operationId ?? input.sourceId ?? 'standalone';
    const storageKey = `${DOCUMENT_STORAGE_PREFIX}/${sourceId}/${input.documentType.toLowerCase()}-${randomUUID()}.pdf`;
    return this.storage.save({ storageKey, content: input.content });
  }

  getDocumentPdf(storageKey: string): Promise<StoredFile> {
    return this.storage.get(storageKey);
  }

  async saveSignatureImage(input: SaveSignatureImageInput): Promise<StoredFile> {
    const storageKey = `${SIGNATURE_STORAGE_PREFIX}/${randomUUID()}.${input.extension}`;
    return this.storage.save({ storageKey, content: input.content });
  }

  getSignatureImage(storageKey: string): Promise<StoredFile> {
    return this.storage.get(storageKey);
  }

  async resolveSignature(
    storageKey: string,
    metadata: { mimeType: string; fileSize: number },
  ): Promise<ResolvedAsset> {
    const stored = await this.storage.get(storageKey);
    return {
      storageKey,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize,
      contentBase64: stored.content.toString('base64'),
    };
  }

  async resolveLogo(storageKey: string, metadata: { mimeType: string; fileSize: number }): Promise<ResolvedAsset> {
    const stored = await this.storage.get(storageKey);
    return { storageKey, mimeType: metadata.mimeType, fileSize: metadata.fileSize, contentBase64: stored.content.toString('base64') };
  }

  async resolveWatermark(storageKey: string, metadata: { mimeType: string; fileSize: number }): Promise<ResolvedAsset> {
    const stored = await this.storage.get(storageKey);
    return { storageKey, mimeType: metadata.mimeType, fileSize: metadata.fileSize, contentBase64: stored.content.toString('base64') };
  }

  async resolveQrCode(storageKey: string, metadata: { mimeType: string; fileSize: number }): Promise<ResolvedAsset> {
    const stored = await this.storage.get(storageKey);
    return { storageKey, mimeType: metadata.mimeType, fileSize: metadata.fileSize, contentBase64: stored.content.toString('base64') };
  }

  async generateQrCode(payload: string): Promise<ResolvedAsset> {
    const normalized = payload.trim();
    if (!normalized || normalized.length > 500) throw new Error('Invalid QR payload');
    const content = await QRCode.toBuffer(normalized, {
      type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 320,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    return {
      storageKey: `generated:equipment-qr:${normalized}`,
      mimeType: 'image/png',
      fileSize: content.length,
      contentBase64: content.toString('base64'),
    };
  }

  async resolveDocumentImage(storageKey: string, metadata: { mimeType: string; fileSize: number }): Promise<ResolvedAsset> {
    // Cache hit: reusa o resultado comprimido sem ler o storage nem reprocessar.
    const cached = this.getCachedCompressed(storageKey);
    if (cached) {
      return this.toResolvedAsset(storageKey, cached);
    }
    const stored = await this.storage.get(storageKey);
    // Evidências fotográficas são a maior fonte de peso do PDF (fotos de campo em
    // alta resolução podem somar vários MB). Recomprimimos para JPEG reduzido
    // antes de embutir — laudos como o PMOC deixam de estourar o limite de e-mail.
    const compressed = await this.compressPhoto(stored.content, metadata.mimeType);
    this.rememberCompressed(storageKey, compressed);
    return this.toResolvedAsset(storageKey, compressed);
  }

  private toResolvedAsset(
    storageKey: string,
    compressed: { content: Buffer; mimeType: string },
  ): ResolvedAsset {
    return {
      storageKey,
      mimeType: compressed.mimeType,
      fileSize: compressed.content.length,
      contentBase64: compressed.content.toString('base64'),
    };
  }

  private getCachedCompressed(storageKey: string): { content: Buffer; mimeType: string } | null {
    const cached = this.compressedImageCache.get(storageKey);
    if (!cached) return null;
    // LRU: reinsere para marcar como usado recentemente.
    this.compressedImageCache.delete(storageKey);
    this.compressedImageCache.set(storageKey, cached);
    return cached;
  }

  private rememberCompressed(storageKey: string, compressed: { content: Buffer; mimeType: string }): void {
    this.compressedImageCache.set(storageKey, compressed);
    if (this.compressedImageCache.size > COMPRESSED_IMAGE_CACHE_LIMIT) {
      const oldest = this.compressedImageCache.keys().next().value;
      if (oldest !== undefined) this.compressedImageCache.delete(oldest);
    }
  }

  /**
   * Reduz resolução e recomprime a foto para JPEG. Tenta primeiro o `sharp`
   * (nativo, melhor) e, se ele não estiver disponível no ambiente, cai para o
   * `jimp` (pure-JS, sempre carrega) — assim a compressão não depende de um
   * binário nativo que pode falhar em certos deploys. Se ambos falharem, mantém
   * o original: a geração do documento nunca quebra por causa da compressão.
   */
  private async compressPhoto(
    content: Buffer,
    mimeType: string,
  ): Promise<{ content: Buffer; mimeType: string }> {
    if (!/^image\/(jpe?g|png|webp|heic|heif|tiff|gif|bmp)$/i.test(mimeType)) {
      return { content, mimeType };
    }
    const viaSharp = await this.compressWithSharp(content);
    if (viaSharp && viaSharp.length < content.length) {
      return { content: viaSharp, mimeType: 'image/jpeg' };
    }
    const viaJimp = await this.compressWithJimp(content);
    if (viaJimp && viaJimp.length < content.length) {
      return { content: viaJimp, mimeType: 'image/jpeg' };
    }
    // Nenhum motor conseguiu reduzir: torna a causa visível nos logs, pois é o
    // que faz um PDF (ex.: PMOC com fotos) voltar a ficar grande demais.
    this.logger.warn('Não foi possível comprimir imagem do documento; usando original', {
      mimeType,
      originalBytes: content.length,
    });
    return { content, mimeType };
  }

  /** Motor primário: sharp (libvips). Retorna null se indisponível/falhar. */
  private async compressWithSharp(content: Buffer): Promise<Buffer | null> {
    try {
      // Interop: compilado para CommonJS, `import('sharp')` vira `require('sharp')`,
      // que devolve a própria função (sem `.default`). `.default ?? módulo` cobre
      // os dois casos (ESM e CJS) — sem isso o sharp nunca era usado e a
      // compressão caía sempre no jimp (lento).
      const imported = (await import('sharp')) as unknown as SharpFactory & { default?: SharpFactory };
      const sharp: SharpFactory = imported.default ?? imported;
      return await sharp(content, { failOn: 'none' })
        .rotate() // respeita orientação EXIF antes de descartar os metadados
        .resize({
          width: DOCUMENT_PHOTO_MAX_DIMENSION,
          height: DOCUMENT_PHOTO_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        // Encoder JPEG padrão (sem mozjpeg): o resize já entrega ~99% da
        // redução, e o padrão é bem mais rápido — importa para a latência do
        // preview, que recomprime as fotos.
        .jpeg({ quality: DOCUMENT_PHOTO_JPEG_QUALITY })
        .toBuffer();
    } catch {
      return null;
    }
  }

  /** Fallback pure-JS: jimp. Retorna null se indisponível/falhar. */
  private async compressWithJimp(content: Buffer): Promise<Buffer | null> {
    try {
      const mod = (await import('jimp')) as unknown as JimpStatic & { default?: JimpStatic };
      const jimp: JimpStatic = mod.default ?? mod;
      const image = await jimp.read(content);
      if (
        image.bitmap.width > DOCUMENT_PHOTO_MAX_DIMENSION ||
        image.bitmap.height > DOCUMENT_PHOTO_MAX_DIMENSION
      ) {
        image.scaleToFit(DOCUMENT_PHOTO_MAX_DIMENSION, DOCUMENT_PHOTO_MAX_DIMENSION);
      }
      image.quality(DOCUMENT_PHOTO_JPEG_QUALITY);
      return await image.getBufferAsync('image/jpeg');
    } catch {
      return null;
    }
  }

  delete(storageKey: string): Promise<void> {
    return this.storage.delete(storageKey);
  }

  exists(storageKey: string): Promise<boolean> {
    return this.storage.exists(storageKey);
  }
}
