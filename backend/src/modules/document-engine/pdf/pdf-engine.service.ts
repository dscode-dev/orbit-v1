import { HttpStatus, Injectable } from '@nestjs/common';
// PDFKit is CommonJS; import assignment avoids a broken `.default` constructor in Node runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import {
  DOCUMENT_MAX_PDF_BYTES,
  DOCUMENT_PAGE,
} from '../../../shared/constants/document-engine.constants';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type { RenderedDocument, RenderedElement } from '../renderer/document-renderer.types';

export interface PdfEngineResult {
  buffer: Buffer;
  pageCount: number;
}

const NOTO_SANS_REGULAR = require.resolve(
  '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff',
);
const NOTO_SANS_BOLD = require.resolve(
  '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff',
);

/**
 * Binary PDF adapter for the official RenderedDocument.
 *
 * Layout decisions remain exclusively in DocumentRendererService. This adapter
 * maps the renderer's bottom-left coordinate system to PDFKit and embeds Noto
 * Sans so Portuguese and common Unicode punctuation survive unchanged.
 */
@Injectable()
export class PdfEngineService {
  async create(rendered: RenderedDocument): Promise<PdfEngineResult> {
    const document = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: rendered.blueprint.header.title,
        Author: rendered.blueprint.metadata.organization.tradeName,
        Subject: rendered.blueprint.metadata.documentNumber,
        Creator: 'Orbit ERP Document Engine',
        Producer: 'Orbit ERP PDFKit + Noto Sans',
      },
    });
    document.registerFont('OrbitRegular', NOTO_SANS_REGULAR);
    document.registerFont('OrbitBold', NOTO_SANS_BOLD);

    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.once('end', () => resolve(Buffer.concat(chunks)));
      document.once('error', reject);
    });

    for (const page of rendered.pages) {
      document.addPage({
        size: [DOCUMENT_PAGE.width, DOCUMENT_PAGE.height],
        margin: 0,
      });
      for (const element of page.elements) this.draw(document, element);
    }
    document.end();
    const buffer = await completed;

    if (buffer.length > DOCUMENT_MAX_PDF_BYTES) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_SIZE_LIMIT_EXCEEDED,
        'O PDF gerado ultrapassa o tamanho máximo permitido',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { buffer, pageCount: rendered.pages.length };
  }

  private draw(document: PDFKit.PDFDocument, element: RenderedElement): void {
    if (element.type === 'text') {
      document
        .font(element.bold ? 'OrbitBold' : 'OrbitRegular')
        .fontSize(element.size)
        .fillColor(element.color ?? '#0f172a')
        .text(element.text, element.x, this.textY(element.y, element.size), {
          lineBreak: false,
          width: Math.max(1, DOCUMENT_PAGE.width - element.x - DOCUMENT_PAGE.marginRight),
        });
      return;
    }
    if (element.type === 'line') {
      document
        .save()
        .strokeColor(element.color ?? '#cbd5e1')
        .lineWidth(0.6)
        .moveTo(element.x1, this.y(element.y1))
        .lineTo(element.x2, this.y(element.y2))
        .stroke()
        .restore();
      return;
    }
    if (element.type === 'rect') {
      document.save().lineWidth(0.6);
      const rectangle = document.rect(
        element.x,
        this.y(element.y + element.height),
        element.width,
        element.height,
      );
      if (element.fillColor && element.strokeColor) {
        rectangle.fillAndStroke(element.fillColor, element.strokeColor);
      } else if (element.fillColor) {
        rectangle.fill(element.fillColor);
      } else {
        rectangle.stroke(element.strokeColor ?? '#cbd5e1');
      }
      document.restore();
      return;
    }
    const content = Buffer.from(element.contentBase64, 'base64');
    document.image(content, element.x, this.y(element.y + element.height), {
      fit: [element.width, element.height],
      align: 'center',
      valign: 'center',
    });
  }

  private y(value: number): number {
    return DOCUMENT_PAGE.height - value;
  }

  private textY(baseline: number, fontSize: number): number {
    return this.y(baseline) - fontSize;
  }
}
