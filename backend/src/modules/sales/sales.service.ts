import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, SaleHistoryAction, SaleStatus } from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { SALE_AUDIT_ACTIONS, SALE_RESOURCE } from '../../shared/constants/sales.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type { CreateSaleDto, ListSalesQueryDto, SaleItemInputDto, UpdateSaleDto } from './dto/sale.dto';

type AuditContext = { requestId: string; ip: string | null; userAgent: string | null };
const INCLUDE = {
  customer: {
    select: {
      id: true,
      name: true,
      tradeName: true,
      cpf: true,
      cnpj: true,
      email: true,
      phone: true,
    },
  },
  customerAddress: true,
  creator: { select: { id: true, name: true, role: true } },
  items: { include: { product: true }, orderBy: { sortOrder: 'asc' as const } },
  receiptOperations: { select: { id: true, number: true, status: true, requestedDocumentType: true, createdAt: true } },
} satisfies Prisma.SaleInclude;
type SaleRecord = Prisma.SaleGetPayload<{ include: typeof INCLUDE }>;
type SaleSnapshotItem = { productId: string; description: string; quantity: string; unit: string; snapshotUnitPrice: string; snapshotCost: string; total: string; sortOrder: number };
type SaleTotals = { subtotal: string; discount: string; total: string };
type SaleWarranty = { warrantyDays: number | null; warrantyStartsAt: Date | null; warrantyEndsAt: Date | null };

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService, private readonly pricing: PricingService) {}

  async list(query: ListSalesQueryDto): Promise<unknown> {
    const where: Prisma.SaleWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { soldAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      ...(query.search ? { OR: [{ customer: { name: { contains: query.search, mode: 'insensitive' } } }, { notes: { contains: query.search, mode: 'insensitive' } }, ...(Number.isInteger(Number(query.search)) ? [{ number: Number(query.search) }] : [])] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({ where, include: INCLUDE, orderBy: [{ soldAt: 'desc' }, { number: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.sale.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  get(id: string): Promise<SaleRecord> { return this.saleOrThrow(id); }

  async create(dto: CreateSaleDto, actor: AuthenticatedUser, context: AuditContext): Promise<SaleRecord> {
    const organization = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!organization) throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organização não encontrada', HttpStatus.NOT_FOUND);
    await this.validateRelations(dto.customerId, dto.customerAddressId);
    const soldAt = new Date(dto.soldAt);
    const items = await this.snapshotItems(dto.items, soldAt);
    const totals = this.totals(items, dto.discount ?? 0);
    const warranty = this.warranty(dto.warrantyDays, dto.warrantyStartsAt, soldAt);
    const id = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({ data: { organizationId: organization.id, customerId: dto.customerId, customerAddressId: dto.customerAddressId ?? null, soldAt, ...warranty, ...totals, notes: dto.notes ?? null, createdBy: actor.id, items: { create: items } } });
      await this.history(tx, sale.id, actor.id, SaleHistoryAction.CREATED, { total: totals.total });
      await this.audit(tx, SALE_AUDIT_ACTIONS.SALE_CREATED, actor, context, { saleId: sale.id, customerId: dto.customerId, number: sale.number });
      return sale.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.saleOrThrow(id);
  }

  async update(id: string, dto: UpdateSaleDto, actor: AuthenticatedUser, context: AuditContext): Promise<SaleRecord> {
    const current = await this.saleOrThrow(id);
    this.assertDraft(current);
    await this.validateRelations(current.customerId, dto.customerAddressId ?? current.customerAddressId ?? undefined);
    const soldAt = dto.soldAt ? new Date(dto.soldAt) : current.soldAt;
    const items = dto.items ? await this.snapshotItems(dto.items, soldAt) : null;
    const totals = items ? this.totals(items, dto.discount ?? Number(current.discount)) : { subtotal: Number(current.subtotal).toFixed(2), discount: (dto.discount ?? Number(current.discount)).toFixed(2), total: Math.max(0, Number(current.subtotal) - (dto.discount ?? Number(current.discount))).toFixed(2) };
    const warranty = this.warranty(dto.warrantyDays ?? current.warrantyDays ?? undefined, dto.warrantyStartsAt ?? current.warrantyStartsAt?.toISOString(), soldAt);
    await this.prisma.$transaction(async (tx) => {
      if (items) { await tx.saleItem.deleteMany({ where: { saleId: id } }); await tx.saleItem.createMany({ data: items.map((item) => ({ ...item, saleId: id })) }); }
      await tx.sale.update({ where: { id }, data: { ...(dto.customerAddressId !== undefined ? { customerAddressId: dto.customerAddressId } : {}), soldAt, ...warranty, ...totals, ...(dto.notes !== undefined ? { notes: dto.notes } : {}) } });
      await this.history(tx, id, actor.id, SaleHistoryAction.UPDATED, { changedFields: Object.keys(dto) });
      await this.audit(tx, SALE_AUDIT_ACTIONS.SALE_UPDATED, actor, context, { saleId: id, changedFields: Object.keys(dto) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.saleOrThrow(id);
  }

  async complete(id: string, actor: AuthenticatedUser, context: AuditContext): Promise<SaleRecord> {
    const current = await this.saleOrThrow(id); this.assertDraft(current);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.sale.updateMany({ where: { id, status: SaleStatus.DRAFT }, data: { status: SaleStatus.COMPLETED, completedAt: new Date() } });
      if (result.count !== 1) throw new ApplicationException(ERROR_CODES.SALE_INVALID_STATE, 'Sale state changed concurrently', HttpStatus.CONFLICT);
      await this.history(tx, id, actor.id, SaleHistoryAction.COMPLETED, {});
      await this.audit(tx, SALE_AUDIT_ACTIONS.SALE_COMPLETED, actor, context, { saleId: id });
    });
    return this.saleOrThrow(id);
  }

  async cancel(id: string, actor: AuthenticatedUser, context: AuditContext): Promise<SaleRecord> {
    const current = await this.saleOrThrow(id);
    if (current.status === SaleStatus.CANCELED) throw new ApplicationException(ERROR_CODES.SALE_INVALID_STATE, 'A venda já está cancelada', HttpStatus.CONFLICT);
    await this.prisma.$transaction(async (tx) => {
      await tx.sale.update({ where: { id }, data: { status: SaleStatus.CANCELED, canceledAt: new Date() } });
      await this.history(tx, id, actor.id, SaleHistoryAction.CANCELED, { previousStatus: current.status });
      await this.audit(tx, SALE_AUDIT_ACTIONS.SALE_CANCELED, actor, context, { saleId: id });
    });
    return this.saleOrThrow(id);
  }

  async receiptPrefill(id: string): Promise<unknown> {
    const sale = await this.saleOrThrow(id);
    if (sale.status !== SaleStatus.COMPLETED) throw new ApplicationException(ERROR_CODES.SALE_INVALID_STATE, 'Somente vendas concluídas podem originar recibos', HttpStatus.CONFLICT);
    const itemDescription = sale.items
      .map((item) => `${String(item.quantity)} ${item.unit} — ${item.description}`)
      .join('\n');
    return {
      origin: 'SALE',
      saleId: sale.id,
      receiptNumber: `REC-V${String(sale.number).padStart(6, '0')}`,
      issuedAt: sale.soldAt,
      amount: sale.total,
      service: sale.items.map((item) => item.description).join(', '),
      description: [itemDescription, sale.notes ? `Observações: ${sale.notes}` : null]
        .filter(Boolean)
        .join('\n'),
      warrantyDays: sale.warrantyDays,
      warrantyStartsAt: sale.warrantyStartsAt,
      warrantyEndsAt: sale.warrantyEndsAt,
      customer: sale.customer,
      address: sale.customerAddress,
    };
  }

  private async snapshotItems(inputs: SaleItemInputDto[], at: Date): Promise<SaleSnapshotItem[]> {
    return Promise.all(inputs.map(async (input, index) => {
      const product = await this.prisma.product.findFirst({ where: { id: input.productId, isActive: true } });
      if (!product) throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto não encontrado ou inativo', HttpStatus.NOT_FOUND);
      if (!product.isSellable) throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_SELLABLE, 'Produto não está habilitado para venda', HttpStatus.CONFLICT);
      const price = await this.pricing.resolveForConsumer(product.id, 'SALE', at);
      const unitPrice = Number(price.salePrice); const quantity = input.quantity;
      return { productId: product.id, description: product.name, quantity: quantity.toFixed(3), unit: product.unit, snapshotUnitPrice: unitPrice.toFixed(2), snapshotCost: Number(price.costPrice).toFixed(2), total: (unitPrice * quantity).toFixed(2), sortOrder: index };
    }));
  }

  private totals(items: Array<{ total: string }>, discount: number): SaleTotals { const subtotal = items.reduce((sum, item) => sum + Number(item.total), 0); if (discount > subtotal) throw new ApplicationException(ERROR_CODES.BAD_REQUEST, 'O desconto não pode exceder o subtotal da venda', HttpStatus.BAD_REQUEST); return { subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: (subtotal - discount).toFixed(2) }; }
  private warranty(days: number | undefined, startsAt: string | undefined, soldAt: Date): SaleWarranty { if (!days) return { warrantyDays: null, warrantyStartsAt: null, warrantyEndsAt: null }; const start = startsAt ? new Date(startsAt) : soldAt; const end = new Date(start); end.setUTCDate(end.getUTCDate() + days); return { warrantyDays: days, warrantyStartsAt: start, warrantyEndsAt: end }; }
  private async validateRelations(customerId: string, addressId?: string): Promise<void> { const customer = await this.prisma.customer.findFirst({ where: { id: customerId, isActive: true } }); if (!customer) throw new ApplicationException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Cliente não encontrado ou inativo', HttpStatus.NOT_FOUND); if (addressId && !(await this.prisma.customerAddress.findFirst({ where: { id: addressId, customerId } }))) throw new ApplicationException(ERROR_CODES.SALE_INVALID_RELATIONSHIP, 'O endereço não pertence ao cliente', HttpStatus.CONFLICT); }
  private async saleOrThrow(id: string): Promise<SaleRecord> { const sale = await this.prisma.sale.findUnique({ where: { id }, include: INCLUDE }); if (!sale) throw new ApplicationException(ERROR_CODES.SALE_NOT_FOUND, 'Venda não encontrada', HttpStatus.NOT_FOUND); return sale; }
  private assertDraft(sale: SaleRecord): void { if (sale.status !== SaleStatus.DRAFT) throw new ApplicationException(ERROR_CODES.SALE_INVALID_STATE, 'Somente vendas em rascunho podem ser alteradas', HttpStatus.CONFLICT); }
  private async history(tx: Prisma.TransactionClient, saleId: string, actorId: string, action: SaleHistoryAction, metadata: Record<string, unknown>): Promise<void> { await tx.saleHistory.create({ data: { saleId, actorId, action, metadata: metadata as Prisma.InputJsonValue } }); }
  private async audit(tx: Prisma.TransactionClient, action: string, actor: AuthenticatedUser, context: AuditContext, metadata: Record<string, unknown>): Promise<void> { await tx.auditLog.create({ data: { action, resource: SALE_RESOURCE, actor: actor.id, metadata: { requestId: context.requestId, ip: context.ip, userAgent: context.userAgent, ...metadata } } }); }
}
