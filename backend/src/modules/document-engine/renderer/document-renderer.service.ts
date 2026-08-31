import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DOCUMENT_MAX_PAGES,
  DOCUMENT_PAGE,
} from '../../../shared/constants/document-engine.constants';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type {
  ChecklistComponent,
  ChecklistColumnsComponent,
  DocumentBlueprint,
  DocumentBlueprintComponent,
  ImageGalleryComponent,
  ImageComponent,
  ListComponent,
  MetadataComponent,
  ObservationComponent,
  ParagraphComponent,
  QrCodeComponent,
  SignatureComponent,
  SignaturePlaceholderComponent,
  TableComponent,
} from '../blueprint/document-blueprint.types';
import type {
  LayoutBlock,
  RenderedDocument,
  RenderedElement,
  RenderedPage,
} from './document-renderer.types';
import { LayoutEngine } from '../layout/layout-engine.service';

const LINE_HEIGHT = 13;
const SMALL_LINE_HEIGHT = 11;
const SECTION_TITLE_HEIGHT = 24;
const HEADER_ACCENT_HEIGHT = 8;
const HEADER_LOGO_WIDTH = 100;
const HEADER_LOGO_HEIGHT = 32;
const HEADER_TOP_PADDING = 30;
const HEADER_LOGO_ROW_HEIGHT = 38;
const HEADER_ROW_GAP = 12;
const HEADER_COMPANY_WIDTH = 245;

@Injectable()
export class DocumentRendererService {
  constructor(private readonly layout: LayoutEngine) {}

  render(blueprint: DocumentBlueprint): RenderedDocument {
    const pages: RenderedPage[] = [];
    let current = this.newPage(blueprint, 1);
    pages.push(current);
    let y = this.layout.contentTop();
    const x = DOCUMENT_PAGE.marginLeft;
    const width = this.layout.contentWidth();

    for (const [sectionIndex, section] of blueprint.sections.entries()) {
      if (sectionIndex > 0) y -= 10;
      const sectionHeader = this.sectionHeader(
        section.title,
        blueprint.metadata.organization.primaryColor,
      );
      // Para decidir se a seção começa aqui, basta caber o cabeçalho + o mínimo
      // do primeiro componente (para tabelas, cabeçalho + 1 linha) — o restante
      // da tabela flui para as próximas páginas.
      const firstBlockHeight = section.components[0]
        ? this.minFirstBlockHeight(section.components[0], width)
        : 0;
      if (this.layout.shouldBreak(y, sectionHeader.height + firstBlockHeight)) {
        current = this.newPage(blueprint, pages.length + 1);
        pages.push(current);
        y = this.layout.contentTop();
      }
      current.elements.push(...sectionHeader.draw(x, y, width));
      y -= sectionHeader.height;

      for (const component of section.components) {
        // Tabelas fatiam considerando o espaço restante da página atual; os
        // demais componentes usam blocos atômicos.
        const blocks =
          component.kind === 'table'
            ? this.tableBlocks(component, width, y - this.layout.contentBottom())
            : this.blocks(component, width);
        for (const block of blocks) {
          if (block.height > this.layout.availableHeight()) {
            throw new ApplicationException(
              ERROR_CODES.DOCUMENT_SIZE_LIMIT_EXCEEDED,
              'A document block exceeds the available page height',
              HttpStatus.BAD_REQUEST,
            );
          }
          if (this.layout.shouldBreak(y, block.height)) {
            current = this.newPage(blueprint, pages.length + 1);
            pages.push(current);
            y = this.layout.contentTop();
          }
          current.elements.push(...block.draw(x, y, width));
          y -= block.height;
        }
      }
      y -= 10;
      if (section.pageBreakAfter && sectionIndex < blueprint.sections.length - 1) {
        current = this.newPage(blueprint, pages.length + 1);
        pages.push(current);
        y = this.layout.contentTop();
      }
    }

    if (pages.length > DOCUMENT_MAX_PAGES) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_SIZE_LIMIT_EXCEEDED,
        'Document exceeds the maximum number of pages',
        HttpStatus.BAD_REQUEST,
      );
    }

    return { blueprint, pages };
  }

  private blocks(component: DocumentBlueprintComponent, width: number): LayoutBlock[] {
    switch (component.kind) {
      case 'metadata':
        return [this.metadataBlock(component)];
      case 'paragraph':
        return this.paragraphBlocks(component, width);
      case 'observation':
        return this.observationBlocks(component, width);
      case 'list':
        return [this.listBlock(component, width)];
      case 'checklist':
        return this.checklistBlocks(component);
      case 'checklistColumns':
        return this.checklistColumnsBlocks(component, width);
      case 'table':
        return this.tableBlocks(component, width);
      case 'image':
        return [this.imageBlock(component)];
      case 'imageGallery':
        return this.imageGalleryBlocks(component);
      case 'qrCode':
        return [this.qrBlock(component)];
      case 'signature':
        return [this.signatureComponentBlock(component)];
      case 'signaturePlaceholder':
        return [this.signatureBlock(component)];
    }
  }

  /**
   * Altura mínima que o primeiro componente de uma seção precisa para começar na
   * página atual. Para tabelas é cabeçalho + 1 linha (o resto pagina depois);
   * para os demais componentes é o próprio bloco.
   */
  private minFirstBlockHeight(component: DocumentBlueprintComponent, width: number): number {
    if (component.kind === 'table') {
      const blockPadding = 6;
      const widths = this.tableColumnWidths(component, width);
      const headerHeight = Math.max(
        18,
        ...component.columns.map(
          (column, index) =>
            this.wrap(column.label, Math.max(20, widths[index] - 8), 8).length * 9 + 8,
        ),
      );
      const firstRow = component.rows[0];
      const firstRowHeight = firstRow
        ? Math.max(
            17,
            ...component.columns.map(
              (column, index) =>
                this.wrap(firstRow[column.key] ?? '—', Math.max(20, widths[index] - 8), 8).length *
                  9 +
                7,
            ),
          )
        : 17;
      return headerHeight + firstRowHeight + blockPadding;
    }
    return this.blocks(component, width)[0]?.height ?? 0;
  }

  private sectionHeader(title: string, primaryColor: string): LayoutBlock {
    return {
      component: { id: `section-${title}`, kind: 'paragraph', text: title },
      height: SECTION_TITLE_HEIGHT,
      draw: (x, y, width) => [
        { type: 'text', x, y, text: title, size: 13, bold: true, color: primaryColor },
        { type: 'line', x1: x, y1: y - 8, x2: x + width, y2: y - 8, color: '#e2e8f0' },
      ],
    };
  }

  private metadataBlock(component: MetadataComponent): LayoutBlock {
    const rows = Math.ceil(component.items.length / 2);
    const height = 14 + rows * 32;
    return {
      component,
      height,
      draw: (x, y, width): RenderedElement[] => {
        const elements: RenderedElement[] = [
          {
            type: 'rect',
            x,
            y: y - height + 4,
            width,
            height,
            fillColor: '#f8fafc',
            strokeColor: '#e2e8f0',
          },
        ];
        component.items.forEach((item, index) => {
          const column = index % 2;
          const row = Math.floor(index / 2);
          const itemX = x + 10 + column * (width / 2);
          const labelY = y - 12 - row * 32;
          elements.push({
            type: 'text',
            x: itemX,
            y: labelY,
            text: item.label.toUpperCase(),
            size: 7,
            bold: true,
            color: '#64748b',
          });
          elements.push({
            type: 'text',
            x: itemX,
            y: labelY - 13,
            text: item.value,
            size: 9,
            color: '#0f172a',
          });
        });
        return elements;
      },
    };
  }

  private paragraphBlocks(component: ParagraphComponent, width: number): LayoutBlock[] {
    const lines = this.wrap(component.text, width, 10);
    const linesPerBlock = Math.max(
      1,
      Math.floor((this.layout.availableHeight() - 8) / LINE_HEIGHT),
    );
    return this.chunk(lines, linesPerBlock).map((blockLines) => ({
      component,
      height: 8 + blockLines.length * LINE_HEIGHT,
      draw: (x, y) =>
        blockLines.map((line, index) => ({
          type: 'text',
          x,
          y: y - index * LINE_HEIGHT,
          text: line,
          size: 10,
          bold: component.emphasis === 'strong',
        })),
    }));
  }

  private observationBlocks(component: ObservationComponent, width: number): LayoutBlock[] {
    const lines = this.wrap(component.text, width - 16, 10);
    const linesPerBlock = Math.max(
      1,
      Math.floor((this.layout.availableHeight() - 18) / LINE_HEIGHT),
    );
    return this.chunk(lines, linesPerBlock).map((blockLines) => {
      const height = 18 + blockLines.length * LINE_HEIGHT;
      return {
        component,
        height,
        draw: (x, y, blockWidth) => [
          {
            type: 'rect' as const,
            x,
            y: y - height + 4,
            width: blockWidth,
            height,
            fillColor: '#f8fafc',
            strokeColor: '#e2e8f0',
          },
          ...blockLines.map((line, index) => ({
            type: 'text' as const,
            x: x + 8,
            y: y - 14 - index * LINE_HEIGHT,
            text: line,
            size: 10,
          })),
        ],
      };
    });
  }

  private listBlock(component: ListComponent, width: number): LayoutBlock {
    const items = component.items.length > 0 ? component.items : ['Nenhum documento relacionado.'];
    const lines = items.flatMap((item) => this.wrap(`• ${item}`, width, 10));
    return {
      component,
      height: 8 + lines.length * LINE_HEIGHT,
      draw: (x, y) =>
        lines.map((line, index) => ({
          type: 'text',
          x,
          y: y - index * LINE_HEIGHT,
          text: line,
          size: 10,
        })),
    };
  }

  private checklistBlocks(component: ChecklistComponent): LayoutBlock[] {
    const items =
      component.items.length > 0
        ? component.items
        : [{ label: 'Nenhum checklist informado.', done: false, note: null }];
    return items.map((item, index) => ({
      component,
      height: item.note ? 30 : 18,
      draw: (x, y, width) => [
        {
          type: 'rect',
          x,
          y: y - 12,
          width: 9,
          height: 9,
          strokeColor: item.done ? '#0f766e' : '#94a3b8',
        },
        ...(item.done
          ? [
              {
                type: 'line' as const,
                x1: x + 1.5,
                y1: y - 7,
                x2: x + 4,
                y2: y - 10,
                color: '#0f766e',
              },
              {
                type: 'line' as const,
                x1: x + 1.5,
                y1: y - 6.5,
                x2: x + 4,
                y2: y - 9.5,
                color: '#0f766e',
              },
              {
                type: 'line' as const,
                x1: x + 4,
                y1: y - 10,
                x2: x + 8.5,
                y2: y - 3,
                color: '#0f766e',
              },
              {
                type: 'line' as const,
                x1: x + 4,
                y1: y - 9.5,
                x2: x + 8.5,
                y2: y - 2.5,
                color: '#0f766e',
              },
            ]
          : []),
        {
          type: 'text' as const,
          x: x + 16,
          y: y - 9,
          text: `${index + 1}. ${item.label}`,
          size: 10,
        },
        ...(item.note
          ? this.wrap(item.note, width - 24, 8).map((line, lineIndex) => ({
              type: 'text' as const,
              x: x + 24,
              y: y - 22 - lineIndex * SMALL_LINE_HEIGHT,
              text: line,
              size: 8,
            }))
          : []),
      ],
    }));
  }

  private checklistColumnsBlocks(
    component: ChecklistColumnsComponent,
    width: number,
  ): LayoutBlock[] {
    const columns =
      component.columns.length > 0
        ? component.columns
        : [{ title: '—', selected: false, items: [] as Array<{ label: string; done: boolean }> }];
    const gap = 14;
    const headerHeight = 22;
    const rowGap = 6;
    const columnWidth = (width - gap * (columns.length - 1)) / columns.length;
    const labelWidth = Math.max(30, columnWidth - 26);

    const measured = columns.map((column) => {
      const items =
        column.items.length > 0 ? column.items : [{ label: 'Nenhum item registrado.', done: false }];
      let height = 0;
      const rows = items.map((item) => {
        const lines = this.wrap(item.label, labelWidth, 9);
        const rowHeight = Math.max(16, lines.length * 12) + rowGap;
        height += rowHeight;
        return { item, lines, rowHeight };
      });
      return { column, rows, height };
    });

    const bodyHeight = Math.max(...measured.map((c) => c.height), 24);
    const blockHeight = headerHeight + bodyHeight + 12;

    return [
      {
        component,
        height: blockHeight,
        draw: (x, y, blockWidth): RenderedElement[] => {
          const elements: RenderedElement[] = [];
          const colWidth = (blockWidth - gap * (columns.length - 1)) / columns.length;
          elements.push({
            type: 'rect',
            x,
            y: y - blockHeight + 8,
            width: blockWidth,
            height: blockHeight,
            strokeColor: '#cbd5e1',
          });
          measured.forEach(({ column, rows }, index) => {
            const colX = x + index * (colWidth + gap);
            elements.push({
              type: 'rect',
              x: colX,
              y: y - headerHeight + 4,
              width: colWidth,
              height: headerHeight,
              fillColor: column.selected ? '#e0f2f1' : '#f1f5f9',
              strokeColor: '#cbd5e1',
            });
            elements.push({
              type: 'text',
              x: colX + 8,
              y: y - 11,
              text: `${column.title.toUpperCase()}  ( ${column.selected ? 'X' : '  '} )`,
              size: 10,
              bold: true,
              color: column.selected ? '#0f766e' : '#334155',
            });
            let rowTop = y - headerHeight - 4;
            rows.forEach(({ item, lines }) => {
              elements.push({
                type: 'rect',
                x: colX + 6,
                y: rowTop - 12,
                width: 9,
                height: 9,
                strokeColor: item.done ? '#0f766e' : '#94a3b8',
              });
              if (item.done) {
                elements.push(
                  { type: 'line', x1: colX + 7.5, y1: rowTop - 7, x2: colX + 10, y2: rowTop - 10, color: '#0f766e' },
                  { type: 'line', x1: colX + 10, y1: rowTop - 10, x2: colX + 14.5, y2: rowTop - 3, color: '#0f766e' },
                );
              }
              lines.forEach((line, lineIndex) =>
                elements.push({
                  type: 'text',
                  x: colX + 22,
                  y: rowTop - 9 - lineIndex * 12,
                  text: line,
                  size: 9,
                }),
              );
              rowTop -= Math.max(16, lines.length * 12) + rowGap;
            });
          });
          return elements;
        },
      },
    ];
  }

  private tableBlocks(
    component: TableComponent,
    width: number,
    // Espaço vertical disponível para o PRIMEIRO bloco (o restante da página
    // atual). Os blocos seguintes usam a página inteira. Assim a tabela aproveita
    // o espaço que sobra numa página com conteúdo antes de continuar na próxima.
    firstAvailableHeight = this.layout.availableHeight(),
  ): LayoutBlock[] {
    const blockPadding = 6;
    const widths = this.tableColumnWidths(component, width);
    const headerHeight = Math.max(
      18,
      ...component.columns.map(
        (column, index) =>
          this.wrap(column.label, Math.max(20, widths[index] - 8), 8).length * 9 + 8,
      ),
    );
    const sourceRows =
      component.rows.length > 0
        ? component.rows
        : [Object.fromEntries(component.columns.map((column) => [column.key, '—']))];
    const measuredRows = sourceRows.map((row, rowIndex) => {
      const lines = component.columns.map((column, index) =>
        this.wrap(row[column.key] ?? '—', Math.max(20, widths[index] - 8), 8),
      );
      return {
        row,
        lines,
        height: Math.max(17, ...lines.map((cell) => cell.length * 9 + 7)),
        emphasized: component.emphasizedRowIndexes?.includes(rowIndex) === true,
      };
    });
    const chunks: (typeof measuredRows)[] = [];
    const fullBudget = this.layout.availableHeight() - headerHeight - blockPadding;
    const firstRowHeight = measuredRows[0]?.height ?? 17;
    const firstBudget = firstAvailableHeight - headerHeight - blockPadding;
    // O primeiro bloco só aproveita o espaço restante se couber cabeçalho + 1
    // linha; caso contrário começa numa página nova (orçamento cheio).
    let budget = firstBudget >= firstRowHeight ? firstBudget : fullBudget;
    let current: typeof measuredRows = [];
    let currentHeight = 0;
    for (const row of measuredRows) {
      if (current.length > 0 && currentHeight + row.height > budget) {
        chunks.push(current);
        current = [];
        currentHeight = 0;
        budget = fullBudget;
      }
      current.push(row);
      currentHeight += row.height;
    }
    if (current.length > 0) chunks.push(current);

    return chunks.map((rows) => ({
      component,
      height: headerHeight + rows.reduce((total, row) => total + row.height, 0) + blockPadding,
      draw: (x, y, blockWidth) =>
        this.tableElements(component, rows, x, y, blockWidth, headerHeight),
    }));
  }

  private tableElements(
    component: TableComponent,
    rows: Array<{
      row: Record<string, string>;
      lines: string[][];
      height: number;
      emphasized: boolean;
    }>,
    x: number,
    y: number,
    width: number,
    headerHeight: number,
  ): RenderedElement[] {
    const elements: RenderedElement[] = [];
    const widths = this.tableColumnWidths(component, width);
    let cursor = x;
    elements.push({
      type: 'rect',
      x,
      y: y - headerHeight + 4,
      width,
      height: headerHeight,
      fillColor: '#f1f5f9',
      strokeColor: '#cbd5e1',
    });
    component.columns.forEach((column, index) => {
      this.wrap(column.label, Math.max(20, widths[index] - 8), 8).forEach((line, lineIndex) =>
        elements.push({
          type: 'text',
          x: cursor + 4,
          y: y - 9 - lineIndex * 9,
          text: line,
          size: 8,
          bold: true,
        }),
      );
      cursor += widths[index];
    });
    let rowsHeight = 0;
    rows.forEach(({ lines, height, emphasized }) => {
      const rowY = y - headerHeight - rowsHeight;
      if (emphasized) {
        elements.push({
          type: 'rect',
          x,
          y: rowY - height,
          width,
          height,
          fillColor: '#f0f9ff',
          strokeColor: '#dbeafe',
        });
      }
      elements.push({ type: 'line', x1: x, y1: rowY, x2: x + width, y2: rowY });
      cursor = x;
      component.columns.forEach((_column, columnIndex) => {
        lines[columnIndex].forEach((line, lineIndex) =>
          elements.push({
            type: 'text',
            x: cursor + 4,
            y: rowY - 11 - lineIndex * 9,
            text: line,
            size: 8,
            bold: emphasized,
            color: emphasized && columnIndex === component.columns.length - 1 ? '#075985' : undefined,
          }),
        );
        cursor += widths[columnIndex];
      });
      rowsHeight += height;
    });
    return elements;
  }

  private tableColumnWidths(component: TableComponent, width: number): number[] {
    const widths = component.columns.map((column) =>
      Math.floor(width * (column.width ?? 1 / component.columns.length)),
    );
    const totalWidth = widths.reduce((sum, value) => sum + value, 0);
    widths[widths.length - 1] += width - totalWidth;
    return widths;
  }

  private imageBlock(component: ImageComponent): LayoutBlock {
    const height = component.image ? 172 : 96;
    return {
      component,
      height,
      draw: (x, y, width): RenderedElement[] => {
        const elements: RenderedElement[] = [
          { type: 'rect', x, y: y - height + 4, width, height },
          {
            type: 'text',
            x: x + 8,
            y: y - 18,
            text: `Imagem: ${component.caption ?? component.sourceId}`,
            size: 10,
            bold: true,
          },
          {
            type: 'text',
            x: x + 8,
            y: y - 34,
            text: `${component.mimeType} · ${component.fileSize} bytes`,
            size: 8,
          },
        ];
        if (component.image) {
          elements.push({
            type: 'image',
            x: x + 8,
            y: y - 160,
            width: Math.min(width - 16, 260),
            height: 112,
            mimeType: component.image.mimeType,
            contentBase64: component.image.contentBase64,
          });
        } else {
          elements.push({
            type: 'text',
            x: x + 8,
            y: y - 52,
            text: 'Conteúdo binário protegido no storage.',
            size: 8,
          });
        }
        return elements;
      },
    };
  }

  private imageGalleryBlocks(component: ImageGalleryComponent): LayoutBlock[] {
    const rowHeight = 128;
    return this.chunk(component.images, 4).map((images) => ({
      component,
      height: Math.ceil(images.length / component.columns) * rowHeight + 4,
      draw: (x, y, width): RenderedElement[] => {
        const gap = 10;
        const cardWidth = (width - gap) / component.columns;
        return images.flatMap((image, index): RenderedElement[] => {
          const column = index % component.columns;
          const row = Math.floor(index / component.columns);
          const cardX = x + column * (cardWidth + gap);
          const cardTop = y - row * rowHeight;
          const elements: RenderedElement[] = [
            {
              type: 'rect',
              x: cardX,
              y: cardTop - rowHeight + 6,
              width: cardWidth,
              height: rowHeight - 6,
              fillColor: '#f8fafc',
              strokeColor: '#cbd5e1',
            },
            {
              type: 'text',
              x: cardX + 7,
              y: cardTop - 14,
              text: image.caption ?? 'Evidência fotográfica',
              size: 8,
              bold: true,
            },
          ];
          if (image.image) {
            elements.push({
              type: 'image',
              x: cardX + 7,
              y: cardTop - 116,
              width: cardWidth - 14,
              height: 92,
              mimeType: image.image.mimeType,
              contentBase64: image.image.contentBase64,
            });
          } else {
            elements.push({
              type: 'text',
              x: cardX + 7,
              y: cardTop - 42,
              text: 'Imagem protegida indisponível.',
              size: 8,
            });
          }
          return elements;
        });
      },
    }));
  }

  private qrBlock(component: QrCodeComponent): LayoutBlock {
    const height = 112;
    return {
      component,
      height,
      draw: (x, y, width) => [
        {
          type: 'rect',
          x,
          y: y - 100,
          width,
          height: 104,
          fillColor: '#f8fafc',
          strokeColor: '#e2e8f0',
        },
        {
          type: 'image',
          x: x + 8,
          y: y - 92,
          width: 88,
          height: 88,
          mimeType: component.image.mimeType,
          contentBase64: component.image.contentBase64,
        },
        { type: 'text', x: x + 112, y: y - 22, text: component.label, size: 10, bold: true },
        { type: 'text', x: x + 112, y: y - 40, text: component.value, size: 8 },
        {
          type: 'text',
          x: x + 112,
          y: y - 56,
          text: 'Escaneie para abrir o equipamento no fluxo oficial Orbit.',
          size: 8,
        },
      ],
    };
  }

  private signatureBlock(component: SignaturePlaceholderComponent): LayoutBlock {
    const height = 78;
    return {
      component,
      height,
      draw: (x, y, width) => [
        { type: 'line', x1: x + 60, y1: y - 48, x2: x + width - 60, y2: y - 48 },
        { type: 'text', x: x + 60, y: y - 62, text: component.label, size: 9 },
        {
          type: 'text',
          x: x + 60,
          y: y - 74,
          text: `Estratégia preparada: ${component.strategy}${component.signedAt ? ` · ${component.signedAt}` : ''}`,
          size: 8,
        },
      ],
    };
  }

  private signatureComponentBlock(component: SignatureComponent): LayoutBlock {
    // Assinaturas em pares lado a lado: a coletada do cliente ocupa a coluna
    // esquerda e a do responsável técnico a direita (ordem vinda do builder).
    const itemHeight = 122;
    const columns = Math.min(2, Math.max(1, component.signatures.length));
    const rows = Math.max(1, Math.ceil(component.signatures.length / 2));
    const height = 18 + rows * itemHeight;
    return {
      component,
      height,
      draw: (x, y, width): RenderedElement[] => {
        const elements: RenderedElement[] = [];
        elements.push({
          type: 'text',
          x,
          y: y - 4,
          text: 'Assinaturas',
          size: 8,
        });
        const gap = 24;
        const columnWidth = (width - gap * (columns - 1)) / columns;
        component.signatures.forEach((signature, index) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const left = x + column * (columnWidth + gap);
          const top = y - 18 - row * itemHeight;
          const centerX = left + columnWidth / 2;
          const imageWidth = Math.min(190, columnWidth - 20);
          if (signature.image) {
            elements.push({
              type: 'image',
              x: centerX - imageWidth / 2,
              y: top - 42,
              width: imageWidth,
              height: 44,
              mimeType: signature.image.mimeType,
              contentBase64: signature.image.contentBase64,
            });
          } else {
            elements.push({
              type: 'text',
              x: centerX - 60,
              y: top - 28,
              text: 'Assinatura pendente',
              size: 8,
            });
          }
          elements.push({
            type: 'line',
            x1: left + 16,
            y1: top - 54,
            x2: left + columnWidth - 16,
            y2: top - 54,
          });
          const nameMaxChars = Math.max(16, Math.floor((columnWidth - 32) / 5));
          const detailMaxChars = Math.max(20, Math.floor((columnWidth - 32) / 4.4));
          elements.push({
            type: 'text',
            x: left + 16,
            y: top - 68,
            text: this.truncate(signature.name ?? signature.label, nameMaxChars),
            size: 9,
            bold: true,
          });
          elements.push({
            type: 'text',
            x: left + 16,
            y: top - 81,
            text: this.truncate(signature.title ?? signature.label, detailMaxChars),
            size: 8,
          });
          if (signature.caption) {
            elements.push({
              type: 'text',
              x: left + 16,
              y: top - 94,
              text: this.truncate(signature.caption, detailMaxChars),
              size: 8,
            });
          }
          if (signature.signedAt) {
            elements.push({
              type: 'text',
              x: left + 16,
              y: top - 107,
              text: `Assinado em: ${this.formatDate(signature.signedAt)}`,
              size: 8,
              bold: true,
            });
          }
        });
        return elements;
      },
    };
  }

  private newPage(blueprint: DocumentBlueprint, pageNumber: number): RenderedPage {
    const corporate = blueprint.header.corporate;
    const logo = corporate?.logo ?? blueprint.header.logo;
    const headerContentTop = DOCUMENT_PAGE.height - HEADER_ACCENT_HEIGHT;
    const secondRowTop =
      headerContentTop - HEADER_TOP_PADDING - HEADER_LOGO_ROW_HEIGHT - HEADER_ROW_GAP;
    const organizationX = DOCUMENT_PAGE.width - DOCUMENT_PAGE.marginRight - HEADER_COMPANY_WIDTH;
    const logoY = headerContentTop - HEADER_TOP_PADDING - HEADER_LOGO_HEIGHT;
    return {
      pageNumber,
      elements: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          width: DOCUMENT_PAGE.width,
          height: DOCUMENT_PAGE.height,
          fillColor: '#ffffff',
          strokeColor: '#ffffff',
        },
        {
          type: 'rect',
          x: 0,
          y: DOCUMENT_PAGE.height - 8,
          width: DOCUMENT_PAGE.width,
          height: 8,
          fillColor: blueprint.metadata.organization.primaryColor,
          strokeColor: blueprint.metadata.organization.primaryColor,
        },
        {
          ...(logo
            ? {
                type: 'image' as const,
                x: DOCUMENT_PAGE.marginLeft,
                y: logoY,
                width: HEADER_LOGO_WIDTH,
                height: HEADER_LOGO_HEIGHT,
                mimeType: logo.mimeType,
                contentBase64: logo.contentBase64,
              }
            : {
                type: 'rect' as const,
                x: DOCUMENT_PAGE.marginLeft,
                y: DOCUMENT_PAGE.height - 30,
                width: 0,
                height: 0,
              }),
        },
        {
          type: 'text',
          x: DOCUMENT_PAGE.marginLeft,
          y: secondRowTop - 18,
          text: blueprint.header.title,
          size: 16,
          bold: true,
        },
        {
          type: 'text',
          x: DOCUMENT_PAGE.marginLeft,
          y: secondRowTop - 38,
          text: blueprint.header.documentNumber,
          size: 9,
          bold: true,
        },
        ...this.corporateHeaderElements(
          blueprint,
          organizationX,
          HEADER_COMPANY_WIDTH,
          secondRowTop - 11,
        ),
        {
          type: 'line',
          x1: DOCUMENT_PAGE.marginLeft,
          y1: DOCUMENT_PAGE.height - DOCUMENT_PAGE.headerHeight,
          x2: DOCUMENT_PAGE.width - DOCUMENT_PAGE.marginRight,
          y2: DOCUMENT_PAGE.height - DOCUMENT_PAGE.headerHeight,
        },
        {
          type: 'line',
          x1: DOCUMENT_PAGE.marginLeft,
          y1: DOCUMENT_PAGE.marginBottom,
          x2: DOCUMENT_PAGE.width - DOCUMENT_PAGE.marginRight,
          y2: DOCUMENT_PAGE.marginBottom,
        },
        {
          type: 'text',
          x: DOCUMENT_PAGE.marginLeft,
          y: DOCUMENT_PAGE.marginBottom - 18,
          text: blueprint.footer.content,
          size: 8,
        },
        {
          type: 'text',
          x: DOCUMENT_PAGE.width - 92,
          y: DOCUMENT_PAGE.marginBottom - 18,
          text: `Página ${pageNumber}`,
          size: 8,
        },
      ],
    };
  }

  private corporateHeaderElements(
    blueprint: DocumentBlueprint,
    x: number,
    width: number,
    startY: number,
  ): RenderedElement[] {
    const corporate = blueprint.header.corporate;
    if (!corporate) {
      return [
        {
          type: 'text',
          x,
          y: startY,
          text: blueprint.header.organizationName,
          size: 9,
          bold: true,
        },
        {
          type: 'text',
          x,
          y: startY - 13,
          text: blueprint.metadata.organization.address,
          size: 7,
        },
        {
          type: 'text',
          x,
          y: startY - 25,
          text: `${blueprint.metadata.organization.phone} · ${blueprint.metadata.organization.email}`,
          size: 7,
        },
      ];
    }

    const documents = [
      corporate.cnpj ? `CNPJ ${corporate.cnpj}` : null,
      corporate.stateRegistration ? `IE ${corporate.stateRegistration}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const contacts = [...corporate.phoneNumbers, corporate.email].filter(Boolean).join(' · ');
    const lines = [
      { text: corporate.tradeName || corporate.legalName, size: 9, bold: true },
      ...(corporate.tradeName && corporate.legalName !== corporate.tradeName
        ? [{ text: corporate.legalName, size: 7, bold: false }]
        : []),
      { text: documents, size: 7, bold: false },
      { text: corporate.fullAddress, size: 7, bold: false },
      { text: contacts, size: 7, bold: false },
      { text: corporate.website, size: 7, bold: false },
    ].filter((line) => line.text);

    const elements: RenderedElement[] = [];
    let y = startY;
    for (const line of lines) {
      for (const wrappedLine of this.wrap(line.text, width, line.size)) {
        elements.push({
          type: 'text',
          x,
          y,
          text: wrappedLine,
          size: line.size,
          bold: line.bold,
        });
        y -= line.size >= 9 ? 12 : 10;
      }
    }
    return elements;
  }

  private wrap(text: string, width: number, fontSize: number): string[] {
    return this.layout.wrapText(text, width, fontSize);
  }

  private formatDate(value: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Recife',
    }).format(new Date(value));
  }

  private truncate(value: string, maxChars: number): string {
    return value.length > maxChars ? `${value.slice(0, Math.max(1, maxChars - 1))}…` : value;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size)
      chunks.push(items.slice(index, index + size));
    return chunks;
  }
}
