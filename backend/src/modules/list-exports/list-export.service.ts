import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DocumentTemplateType,
  EquipmentStatus,
  EquipmentType,
  OperationDocumentStatus,
  OperationStatus,
  Prisma,
} from '@prisma/client';
import {
  SYSTEM_SERVICE_TYPE_LABELS,
  type OperationType,
} from '../../shared/constants/service-types.constants';
import { DOCUMENT_PAGE } from '../../shared/constants/document-engine.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { PrismaService } from '../database/prisma.service';
import { PdfEngineService } from '../document-engine/pdf/pdf-engine.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import type { RenderedDocument, RenderedElement, RenderedPage } from '../document-engine/renderer/document-renderer.types';
import type {
  DocumentsPdfExportQueryDto,
  EquipmentsPdfExportQueryDto,
  OperationsPdfExportQueryDto,
} from './dto/list-export.dto';

const EXPORT_LIMIT = 500;
const PAGE = DOCUMENT_PAGE;
const CONTENT_WIDTH = PAGE.width - PAGE.marginLeft - PAGE.marginRight;
const ROW_HEIGHT = 18;

export type PdfExportResult = {
  buffer: Buffer;
  filename: string;
  recordCount: number;
  pageCount: number;
};

type TableColumn<T> = { label: string; width: number; value: (row: T) => string };

@Injectable()
export class ListExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfEngineService,
    private readonly access: OperationAccessService,
  ) {}

  async operations(query: OperationsPdfExportQueryDto, actor: AuthenticatedUser): Promise<PdfExportResult> {
    const where = { AND: [this.operationWhere(query), this.access.operationScope(actor)] };
    const total = await this.prisma.operation.count({ where });
    this.assertLimit(total);
    const rows = await this.prisma.operation.findMany({
      where,
      take: EXPORT_LIMIT,
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        type: true,
        status: true,
        scheduledFor: true,
        completedAt: true,
        createdAt: true,
        customer: { select: { name: true, tradeName: true } },
        equipment: { select: { name: true, tag: true } },
        operator: { select: { name: true } },
      },
    });
    return this.tablePdf({
      title: 'Exportação de Operações',
      filenamePrefix: 'orbit-operacoes',
      filterSummary: this.filterSummary(query),
      total,
      organization: await this.organizationIdentity(),
      columns: [
        { label: 'Operação', width: 56, value: (row) => `#${row.number}` },
        { label: 'Cliente', width: 108, value: (row) => row.customer?.tradeName || row.customer?.name || '—' },
        { label: 'Equipamento', width: 102, value: (row) => [row.equipment?.tag, row.equipment?.name].filter(Boolean).join(' · ') || '—' },
        { label: 'Tipo', width: 72, value: (row) => this.operationTypeLabel(row.type) },
        { label: 'Status', width: 72, value: (row) => this.operationStatusLabel(row.status) },
        { label: 'Operador', width: 78, value: (row) => row.operator?.name || '—' },
        { label: 'Agendada', width: 58, value: (row) => this.date(row.scheduledFor ?? row.createdAt) },
        { label: 'Concluída', width: 58, value: (row) => this.date(row.completedAt) },
      ],
      rows,
    });
  }

  async equipments(query: EquipmentsPdfExportQueryDto): Promise<PdfExportResult> {
    const where = this.equipmentWhere(query);
    const total = await this.prisma.equipment.count({ where });
    this.assertLimit(total);
    const rows = await this.prisma.equipment.findMany({
      where,
      take: EXPORT_LIMIT,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        name: true,
        tag: true,
        type: true,
        status: true,
        manufacturer: true,
        model: true,
        serialNumber: true,
        equipmentTypeCatalog: { select: { title: true } },
        customer: { select: { name: true, tradeName: true } },
        address: { select: { name: true, city: true, state: true } },
      },
    });
    return this.tablePdf({
      title: 'Exportação de Equipamentos',
      filenamePrefix: 'orbit-equipamentos',
      filterSummary: this.filterSummary(query),
      total,
      organization: await this.organizationIdentity(),
      columns: [
        { label: 'Identificação', width: 96, value: (row) => [row.tag, row.name].filter(Boolean).join(' · ') || row.name },
        { label: 'Cliente', width: 104, value: (row) => row.customer?.tradeName || row.customer?.name || '—' },
        { label: 'Local', width: 86, value: (row) => [row.address?.name, row.address?.city, row.address?.state].filter(Boolean).join(' / ') || '—' },
        { label: 'Tipo', width: 80, value: (row) => row.equipmentTypeCatalog?.title ?? this.equipmentTypeLabel(row.type) },
        { label: 'Fabricante', width: 76, value: (row) => row.manufacturer || '—' },
        { label: 'Modelo', width: 72, value: (row) => row.model || '—' },
        { label: 'Série', width: 70, value: (row) => row.serialNumber || '—' },
        { label: 'Status', width: 68, value: (row) => this.equipmentStatusLabel(row.status) },
      ],
      rows,
    });
  }

  async documents(query: DocumentsPdfExportQueryDto, actor: AuthenticatedUser): Promise<PdfExportResult> {
    const where = { AND: [this.documentWhere(query), this.access.documentScope(actor)] };
    const total = await this.prisma.operationDocument.count({ where });
    this.assertLimit(total);
    const rows = await this.prisma.operationDocument.findMany({
      where,
      take: EXPORT_LIMIT,
      orderBy: [{ renderedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        number: true,
        type: true,
        status: true,
        fileSize: true,
        renderedAt: true,
        createdAt: true,
        operation: {
          select: {
            number: true,
            customer: { select: { name: true, tradeName: true } },
            equipment: { select: { name: true, tag: true } },
            operator: { select: { name: true } },
          },
        },
        budget: { select: { number: true, title: true } },
      },
    });
    return this.tablePdf({
      title: 'Exportação de Documentos',
      filenamePrefix: 'orbit-documentos',
      filterSummary: this.filterSummary(query),
      total,
      organization: await this.organizationIdentity(),
      columns: [
        { label: 'Documento', width: 90, value: (row) => row.number },
        { label: 'Tipo', width: 92, value: (row) => this.documentTypeLabel(row.type) },
        { label: 'Origem', width: 92, value: (row) => row.operation ? `Operação #${row.operation.number}` : row.budget ? `Orçamento ${row.budget.number}` : '—' },
        { label: 'Cliente', width: 104, value: (row) => row.operation?.customer?.tradeName || row.operation?.customer?.name || '—' },
        { label: 'Equipamento', width: 98, value: (row) => [row.operation?.equipment?.tag, row.operation?.equipment?.name].filter(Boolean).join(' · ') || '—' },
        { label: 'Status', width: 70, value: (row) => this.documentStatusLabel(row.status) },
        { label: 'Versão', width: 44, value: () => 'v1' },
        { label: 'Renderizado', width: 72, value: (row) => this.date(row.renderedAt ?? row.createdAt) },
      ],
      rows,
    });
  }

  private async tablePdf<T>(input: {
    title: string;
    filenamePrefix: string;
    filterSummary: string;
    total: number;
    organization: { legalName: string; tradeName: string; cnpj: string; email: string; phone: string; city: string; state: string; primaryColor: string; secondaryColor: string };
    columns: TableColumn<T>[];
    rows: T[];
  }): Promise<PdfExportResult> {
    const org = input.organization;
    const pages: RenderedPage[] = [];
    let current = this.newPage(1, input.title, input.filterSummary, input.total);
    let y = PAGE.height - PAGE.marginTop - 108;
    const bottom = PAGE.marginBottom + 28;
    const drawHeader = (): void => {
      let x = PAGE.marginLeft;
      for (const column of input.columns) {
        current.elements.push({ type: 'text', text: this.fit(column.label, column.width, 7), x, y, size: 7, bold: true });
        x += column.width;
      }
      current.elements.push({ type: 'line', x1: PAGE.marginLeft, y1: y - 5, x2: PAGE.marginLeft + CONTENT_WIDTH, y2: y - 5 });
      y -= ROW_HEIGHT;
    };
    drawHeader();
    for (const row of input.rows) {
      if (y < bottom) {
        pages.push(current);
        current = this.newPage(pages.length + 1, input.title, input.filterSummary, input.total);
        y = PAGE.height - PAGE.marginTop - 108;
        drawHeader();
      }
      let x = PAGE.marginLeft;
      for (const column of input.columns) {
        current.elements.push({ type: 'text', text: this.fit(column.value(row), column.width, 7), x, y, size: 7 });
        x += column.width;
      }
      y -= ROW_HEIGHT;
    }
    if (input.rows.length === 0) {
      current.elements.push({ type: 'text', text: 'Nenhum registro encontrado para os filtros atuais.', x: PAGE.marginLeft, y, size: 10 });
    }
    pages.push(current);
    for (const page of pages) {
      page.elements.push({ type: 'text', text: `Página ${page.pageNumber} de ${pages.length}`, x: PAGE.marginLeft, y: PAGE.marginBottom - 12, size: 8 });
    }
    const rendered: RenderedDocument = {
      blueprint: {
        version: '1.0',
        metadata: {
          operationId: 'list-export',
          documentId: `export-${Date.now()}`,
          documentNumber: input.filenamePrefix,
          documentType: 'REPORT',
          generatedAt: new Date().toISOString(),
          locale: 'pt-BR',
          timezone: 'America/Recife',
          currency: 'BRL',
          organization: {
            legalName: org.legalName,
            tradeName: org.tradeName,
            cnpj: org.cnpj,
            email: org.email,
            phone: org.phone,
            website: '',
            address: `${org.city}/${org.state}`,
            city: org.city,
            state: org.state,
            primaryColor: org.primaryColor,
            secondaryColor: org.secondaryColor,
          },
        },
        header: {
          title: input.title,
          subtitle: input.filterSummary,
          organizationName: org.tradeName,
          documentNumber: input.filenamePrefix,
        },
        footer: {
          content: 'Exportação administrativa — não é documento oficial emitido.',
          generatedAt: new Date().toISOString(),
        },
        sections: [],
      },
      pages,
    };
    const pdf = await this.pdf.create(rendered);
    return {
      buffer: pdf.buffer,
      filename: `${input.filenamePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`,
      recordCount: input.rows.length,
      pageCount: pdf.pageCount,
    };
  }

  private newPage(pageNumber: number, title: string, filterSummary: string, total: number): RenderedPage {
    const generatedAt = new Date();
    const elements: RenderedElement[] = [
      { type: 'text', text: 'Orbit ERP', x: PAGE.marginLeft, y: PAGE.height - PAGE.marginTop, size: 11, bold: true },
      { type: 'text', text: title, x: PAGE.marginLeft, y: PAGE.height - PAGE.marginTop - 20, size: 16, bold: true },
      { type: 'text', text: `Gerado em: ${this.dateTime(generatedAt)} · Registros: ${total}`, x: PAGE.marginLeft, y: PAGE.height - PAGE.marginTop - 40, size: 9 },
      { type: 'text', text: this.fit(`Filtros: ${filterSummary || 'sem filtros'}`, CONTENT_WIDTH, 9), x: PAGE.marginLeft, y: PAGE.height - PAGE.marginTop - 56, size: 9 },
      { type: 'line', x1: PAGE.marginLeft, y1: PAGE.height - PAGE.marginTop - 76, x2: PAGE.marginLeft + CONTENT_WIDTH, y2: PAGE.height - PAGE.marginTop - 76 },
    ];
    return { pageNumber, elements };
  }

  private operationWhere(query: OperationsPdfExportQueryDto): Prisma.OperationWhereInput {
    return {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
      ...(query.operatorId ? { operatorId: query.operatorId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [{ customer: { name: { contains: query.search, mode: 'insensitive' } } }, { equipment: { name: { contains: query.search, mode: 'insensitive' } } }, { operator: { name: { contains: query.search, mode: 'insensitive' } } }] } : {}),
    };
  }

  private async organizationIdentity(): Promise<{ legalName: string; tradeName: string; cnpj: string; email: string; phone: string; city: string; state: string; primaryColor: string; secondaryColor: string }> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: {
        legalName: true,
        tradeName: true,
        cnpj: true,
        email: true,
        phone: true,
        city: true,
        state: true,
        primaryColor: true,
        secondaryColor: true,
      },
    });
    return organization ?? {
      legalName: 'Orbit ERP',
      tradeName: 'Orbit ERP',
      cnpj: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      primaryColor: '#000000',
      secondaryColor: '#000000',
    };
  }

  private equipmentWhere(query: EquipmentsPdfExportQueryDto): Prisma.EquipmentWhereInput {
    return {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.addressId ? { addressId: query.addressId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { tag: { contains: query.search, mode: 'insensitive' } }, { serialNumber: { contains: query.search, mode: 'insensitive' } }, { model: { contains: query.search, mode: 'insensitive' } }, { manufacturer: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
  }

  private documentWhere(query: DocumentsPdfExportQueryDto): Prisma.OperationDocumentWhereInput {
    return {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId || query.equipmentId || query.operatorId || query.customer || query.equipment || query.operator || query.search
        ? {
            operation: {
              ...(query.customerId ? { customerId: query.customerId } : {}),
              ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
              ...(query.operatorId ? { operatorId: query.operatorId } : {}),
              ...(query.customer ? { customer: { name: { equals: query.customer } } } : {}),
              ...(query.equipment ? { equipment: { name: { equals: query.equipment } } } : {}),
              ...(query.operator ? { operator: { name: { equals: query.operator } } } : {}),
              ...(query.search ? { OR: [{ customer: { name: { contains: query.search, mode: 'insensitive' } } }, { equipment: { name: { contains: query.search, mode: 'insensitive' } } }, { operator: { name: { contains: query.search, mode: 'insensitive' } } }] } : {}),
            },
          }
        : {}),
      ...(query.from || query.to
        ? {
            OR: [
              { renderedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: this.endOfDay(query.to) } : {}) } },
              { renderedAt: null, createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: this.endOfDay(query.to) } : {}) } },
            ],
          }
        : {}),
    };
  }

  private assertLimit(total: number): void {
    if (total > EXPORT_LIMIT) {
      throw new ApplicationException(
        ERROR_CODES.BAD_REQUEST,
        `Export exceeds the ${EXPORT_LIMIT} record limit. Narrow the filters and try again.`,
        HttpStatus.BAD_REQUEST,
        { limit: EXPORT_LIMIT, total },
      );
    }
  }

  private filterSummary(query: object): string {
    return Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('; ');
  }

  private fit(value: string, width: number, size: number): string {
    const max = Math.max(6, Math.floor(width / (size * 0.45)));
    const cleaned = String(value ?? '—').replace(/\s+/g, ' ').trim() || '—';
    return cleaned.length > max ? `${cleaned.slice(0, Math.max(0, max - 1))}…` : cleaned;
  }

  private date(value: Date | null): string {
    return value ? value.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
  }

  private dateTime(value: Date): string {
    return value.toLocaleString('pt-BR', { timeZone: 'UTC' });
  }

  private endOfDay(value: string): Date {
    const date = new Date(value);
    date.setUTCHours(23, 59, 59, 999);
    return date;
  }

  private operationTypeLabel(type: OperationType): string {
    // Tipos do sistema têm rótulo conhecido; tipos custom exibem a própria chave.
    return SYSTEM_SERVICE_TYPE_LABELS[type] ?? type;
  }

  private operationStatusLabel(status: OperationStatus): string {
    return { DRAFT: 'Rascunho', PENDING: 'Pendente', IN_PROGRESS: 'Em andamento', REVIEW: 'Revisão', COMPLETED: 'Concluída', CANCELED: 'Cancelada' }[status];
  }

  private equipmentTypeLabel(type: EquipmentType): string {
    return { SPLIT: 'Split', CHILLER: 'Chiller', CONDENSER: 'Condensadora', EVAPORATOR: 'Evaporadora', AIR_HANDLER: 'AHU', SOLAR_INVERTER: 'Inversor solar', ELECTRICAL_PANEL: 'Painel elétrico', GENERATOR: 'Gerador', OTHER: 'Outro' }[type];
  }

  private equipmentStatusLabel(status: EquipmentStatus): string {
    return { ACTIVE: 'Ativo', MAINTENANCE: 'Manutenção', INACTIVE: 'Inativo', RETIRED: 'Baixado' }[status];
  }

  private documentTypeLabel(type: DocumentTemplateType): string {
    return { BUDGET: 'Orçamento', QUOTE: 'Cotação', WORK_ORDER: 'Ordem de Serviço', RECEIPT: 'Recibo', REPORT: 'Relatório', TECHNICAL_REPORT: 'Relatório Técnico', TECHNICAL_OPINION: 'Parecer Técnico', PMOC: 'PMOC' }[type];
  }

  private documentStatusLabel(status: OperationDocumentStatus): string {
    return { DRAFT: 'Rascunho', READY: 'Pronto', VALIDATED: 'Validado', SENT: 'Enviado' }[status];
  }
}
