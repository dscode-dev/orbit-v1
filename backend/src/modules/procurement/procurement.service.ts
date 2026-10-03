import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AssetLifecycleEventType,
  Prisma,
  PurchaseHistoryAction,
  PurchaseOrderStatus,
  StockMovementType,
} from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import {
  PROCUREMENT_AUDIT_ACTIONS,
  PURCHASE_ITEM_RESOURCE,
  PURCHASE_ORDER_RESOURCE,
  PURCHASE_RECEIPT_RESOURCE,
} from '../../shared/constants/procurement.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { InventoryService, type InventoryAuditContext } from '../inventory/inventory.service';
import type {
  CreatePurchaseOrderDto,
  CreatePurchaseOrderItemDto,
  CreatePurchaseReceiptDto,
  ListPurchaseOrdersQueryDto,
  UpdatePurchaseOrderDto,
  UpdatePurchaseOrderItemDto,
} from './dto/procurement.dto';

export type ProcurementAuditContext = InventoryAuditContext;

const ORDER_INCLUDE = {
  supplier: true,
  creator: { select: { id: true, name: true, email: true, username: true } },
  items: { where: { deletedAt: null }, include: { product: true }, orderBy: { createdAt: 'asc' } },
  receipts: { orderBy: { receivedAt: 'desc' }, take: 10 },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type PurchaseItemWithProduct = Prisma.PurchaseOrderItemGetPayload<{ include: { product: true; purchaseOrder: true } }>;

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly lifecycle: LifecyclePublisher,
  ) {}

  async list(query: ListPurchaseOrdersQueryDto): Promise<PaginatedResponse<PurchaseOrderWithRelations>> {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { notes: { contains: query.search, mode: 'insensitive' } },
              { supplier: { legalName: { contains: query.search, mode: 'insensitive' } } },
              { supplier: { tradeName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<PurchaseOrderWithRelations> {
    return this.orderOrThrow(id);
  }

  async create(dto: CreatePurchaseOrderDto, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<PurchaseOrderWithRelations> {
    const organizationId = await this.organizationId();
    await this.supplierOrThrow(dto.supplierId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
        data: {
          organizationId,
          supplierId: dto.supplierId,
          notes: this.optionalClean(dto.notes),
          expectedDelivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : null,
          createdBy: actor.id,
        },
        include: ORDER_INCLUDE,
      });
      await this.historyTx(tx, order.id, actor.id, PurchaseHistoryAction.CREATED, null, order.status, { supplierId: order.supplierId });
      await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.ORDER_CREATED, PURCHASE_ORDER_RESOURCE, actor, context, { purchaseOrderId: order.id, number: order.number });
      await this.lifecycle.publishPurchaseEventTx?.(tx, { purchaseOrderId: order.id, actorId: actor.id, type: AssetLifecycleEventType.PURCHASE_CREATED, description: `Purchase order #${order.number} created` }, context);
      return order;
    });
  }

  async update(id: string, dto: UpdatePurchaseOrderDto, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<PurchaseOrderWithRelations> {
    const current = await this.orderOrThrow(id);
    this.assertEditable(current.status);
    if (dto.supplierId) await this.supplierOrThrow(dto.supplierId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
          ...(dto.expectedDelivery !== undefined ? { expectedDelivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : null } : {}),
          ...(dto.notes !== undefined ? { notes: this.optionalClean(dto.notes) } : {}),
        },
        include: ORDER_INCLUDE,
      });
      await this.historyTx(tx, id, actor.id, PurchaseHistoryAction.UPDATED, current.status, order.status, { changedFields: Object.keys(dto) });
      await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.ORDER_UPDATED, PURCHASE_ORDER_RESOURCE, actor, context, { purchaseOrderId: id, changedFields: Object.keys(dto) });
      return order;
    });
  }

  async send(id: string, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<PurchaseOrderWithRelations> {
    const current = await this.orderOrThrow(id);
    if (current.status !== PurchaseOrderStatus.DRAFT) throw this.invalidState('Only draft purchase orders can be sent');
    if (!current.items.length) throw this.invalidState('Purchase order must have at least one item');
    return this.transitionOrder(id, current.status, PurchaseOrderStatus.SENT, PurchaseHistoryAction.SENT, actor, context, PROCUREMENT_AUDIT_ACTIONS.ORDER_SENT);
  }

  async cancel(id: string, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<PurchaseOrderWithRelations> {
    const current = await this.orderOrThrow(id);
    if (current.status === PurchaseOrderStatus.RECEIVED || current.status === PurchaseOrderStatus.CANCELED) {
      throw this.invalidState('Received or canceled purchase orders cannot be canceled');
    }
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.CANCELED, canceledAt: new Date() },
        include: ORDER_INCLUDE,
      });
      await this.historyTx(tx, id, actor.id, PurchaseHistoryAction.CANCELED, current.status, order.status, {});
      await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.ORDER_CANCELED, PURCHASE_ORDER_RESOURCE, actor, context, { purchaseOrderId: id });
      await this.lifecycle.publishPurchaseEventTx?.(tx, { purchaseOrderId: id, actorId: actor.id, type: AssetLifecycleEventType.PURCHASE_CANCELED, description: `Purchase order #${order.number} canceled` }, context);
      return order;
    });
  }

  async listItems(orderId: string): Promise<unknown> {
    await this.orderOrThrow(orderId);
    return this.prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId, deletedAt: null }, include: { product: true }, orderBy: { createdAt: 'asc' } });
  }

  async createItem(orderId: string, dto: CreatePurchaseOrderItemDto, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<unknown> {
    const order = await this.orderOrThrow(orderId);
    this.assertEditable(order.status);
    const product = await this.productOrThrow(dto.productId);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: orderId,
          productId: dto.productId,
          quantity: dto.quantity,
          unit: dto.unit ?? product.unit,
          snapshotCost: dto.snapshotCost,
          snapshotDescription: this.optionalClean(dto.snapshotDescription) ?? product.name,
        },
        include: { product: true },
      });
      await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.ITEM_CREATED, PURCHASE_ITEM_RESOURCE, actor, context, { purchaseOrderId: orderId, itemId: item.id });
      return item;
    });
  }

  async updateItem(id: string, dto: UpdatePurchaseOrderItemDto, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<unknown> {
    const item = await this.itemOrThrow(id);
    this.assertEditable(item.purchaseOrder.status);
    if (Number(item.receivedQuantity) > 0) throw this.invalidState('Received purchase items cannot be edited');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrderItem.update({
        where: { id },
        data: {
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
          ...(dto.snapshotCost !== undefined ? { snapshotCost: dto.snapshotCost } : {}),
          ...(dto.snapshotDescription !== undefined ? { snapshotDescription: this.clean(dto.snapshotDescription) } : {}),
        },
        include: { product: true },
      });
      await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.ITEM_UPDATED, PURCHASE_ITEM_RESOURCE, actor, context, { itemId: id, changedFields: Object.keys(dto) });
      return updated;
    });
  }

  async deleteItem(id: string, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<{ deleted: true }> {
    const item = await this.itemOrThrow(id);
    this.assertEditable(item.purchaseOrder.status);
    if (Number(item.receivedQuantity) > 0) throw this.invalidState('Received purchase items cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.ITEM_DELETED, PURCHASE_ITEM_RESOURCE, actor, context, { itemId: id, purchaseOrderId: item.purchaseOrderId });
    });
    return { deleted: true };
  }

  async listReceipts(orderId: string): Promise<unknown> {
    await this.orderOrThrow(orderId);
    return this.prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: orderId }, orderBy: { receivedAt: 'desc' } });
  }

  async receive(orderId: string, dto: CreatePurchaseReceiptDto, actor: AuthenticatedUser, context: ProcurementAuditContext): Promise<unknown> {
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();

    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
        if (!order) throw new ApplicationException(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, 'Pedido de compra não encontrado', HttpStatus.NOT_FOUND);
        const receivableStatuses: PurchaseOrderStatus[] = [PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED];
        if (!receivableStatuses.includes(order.status)) {
          throw this.invalidState('Only sent or partially received purchase orders can be received');
        }
        const lineMap = new Map(dto.items.map((line) => [line.itemId, line.quantity]));
        const items = order.items.filter((item) => lineMap.has(item.id));
        if (items.length !== dto.items.length) throw new ApplicationException(ERROR_CODES.PURCHASE_ITEM_NOT_FOUND, 'Um ou mais itens de compra não foram encontrados', HttpStatus.NOT_FOUND);
        const receipt = await tx.purchaseReceipt.create({
          data: {
            purchaseOrderId: orderId,
            receivedBy: actor.id,
            receivedAt,
            notes: this.optionalClean(dto.notes),
            metadata: { items: this.receiptLinesMetadata(dto.items) },
          },
        });
        for (const item of items) {
          const quantity = lineMap.get(item.id)!;
          const nextReceived = new Prisma.Decimal(item.receivedQuantity).plus(quantity);
          if (nextReceived.gt(item.quantity)) {
            throw new ApplicationException(ERROR_CODES.PURCHASE_INVALID_RECEIPT, 'Received quantity exceeds purchased quantity', HttpStatus.CONFLICT);
          }
          const itemUpdate = await tx.purchaseOrderItem.updateMany({
            where: {
              id: item.id,
              purchaseOrderId: orderId,
              deletedAt: null,
              receivedQuantity: item.receivedQuantity,
            },
            data: { receivedQuantity: { increment: quantity } },
          });
          if (itemUpdate.count !== 1) {
            throw new ApplicationException(ERROR_CODES.PURCHASE_INVALID_RECEIPT, 'O recebimento conflitou com outra tentativa de recebimento', HttpStatus.CONFLICT);
          }
          const inventoryItem = await this.inventory.ensureInventoryItemInTransaction(tx, { organizationId: order.organizationId, productId: item.productId, location: null });
          await this.inventory.createMovementInTransaction(
            tx,
            {
              inventoryItemId: inventoryItem.id,
              quantity,
              type: StockMovementType.IN,
              reason: `Purchase receipt #${order.number}`,
              operationId: null,
              userId: actor.id,
              occurredAt: receivedAt,
            },
            actor,
            context,
          );
        }
        const freshItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId, deletedAt: null }, select: { quantity: true, receivedQuantity: true } });
        const allReceived = freshItems.every((item) => new Prisma.Decimal(item.receivedQuantity).gte(item.quantity));
        const nextStatus = allReceived ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
        const orderTransition = await tx.purchaseOrder.updateMany({
          where: { id: orderId, status: order.status },
          data: { status: nextStatus },
        });
        if (orderTransition.count !== 1) {
          throw this.invalidState('Purchase order changed while receipt was being processed');
        }
        const updated = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
        await this.historyTx(tx, orderId, actor.id, allReceived ? PurchaseHistoryAction.RECEIVED : PurchaseHistoryAction.PARTIALLY_RECEIVED, order.status, nextStatus, { receiptId: receipt.id, items: this.receiptLinesMetadata(dto.items) });
        await this.auditTx(tx, PROCUREMENT_AUDIT_ACTIONS.RECEIPT_CREATED, PURCHASE_RECEIPT_RESOURCE, actor, context, { purchaseOrderId: orderId, receiptId: receipt.id, status: nextStatus });
        await this.lifecycle.publishPurchaseEventTx?.(tx, { purchaseOrderId: orderId, actorId: actor.id, type: AssetLifecycleEventType.PURCHASE_RECEIVED, description: `Purchase order #${updated.number} received`, metadata: { receiptId: receipt.id, status: nextStatus } }, context);
        return { receipt, purchaseOrder: updated };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  async stats(): Promise<Record<string, unknown>> {
    const [total, draft, sent, partiallyReceived, received, canceled] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count(),
      this.prisma.purchaseOrder.count({ where: { status: PurchaseOrderStatus.DRAFT } }),
      this.prisma.purchaseOrder.count({ where: { status: PurchaseOrderStatus.SENT } }),
      this.prisma.purchaseOrder.count({ where: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED } }),
      this.prisma.purchaseOrder.count({ where: { status: PurchaseOrderStatus.RECEIVED } }),
      this.prisma.purchaseOrder.count({ where: { status: PurchaseOrderStatus.CANCELED } }),
    ]);
    return { total, draft, sent, partiallyReceived, received, canceled };
  }

  async history(orderId: string, query: ListPurchaseOrdersQueryDto): Promise<PaginatedResponse<unknown>> {
    await this.orderOrThrow(orderId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseHistory.findMany({ where: { purchaseOrderId: orderId }, include: { actor: { select: { id: true, name: true, email: true, username: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.purchaseHistory.count({ where: { purchaseOrderId: orderId } }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  private async orderOrThrow(id: string): Promise<PurchaseOrderWithRelations> {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new ApplicationException(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, 'Pedido de compra não encontrado', HttpStatus.NOT_FOUND);
    return order;
  }

  private async itemOrThrow(id: string): Promise<PurchaseItemWithProduct> {
    const item = await this.prisma.purchaseOrderItem.findFirst({ where: { id, deletedAt: null }, include: { product: true, purchaseOrder: true } });
    if (!item) throw new ApplicationException(ERROR_CODES.PURCHASE_ITEM_NOT_FOUND, 'Item do pedido de compra não encontrado', HttpStatus.NOT_FOUND);
    return item;
  }

  private async productOrThrow(id: string): Promise<{ id: string; name: string; unit: string }> {
    const product = await this.prisma.product.findFirst({ where: { id, isActive: true }, select: { id: true, name: true, unit: true, isPurchasable: true } });
    if (!product) throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto não encontrado', HttpStatus.NOT_FOUND);
    if (!product.isPurchasable) throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_PURCHASABLE, 'O produto não está habilitado para compras', HttpStatus.CONFLICT);
    return product;
  }

  private async supplierOrThrow(id: string): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, isActive: true }, select: { id: true } });
    if (!supplier) throw new ApplicationException(ERROR_CODES.SUPPLIER_NOT_FOUND, 'Fornecedor não encontrado', HttpStatus.NOT_FOUND);
  }

  private assertEditable(status: PurchaseOrderStatus): void {
    const editableStatuses: PurchaseOrderStatus[] = [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SENT];
    if (!editableStatuses.includes(status)) {
      throw this.invalidState('Purchase order cannot be changed in current status');
    }
  }

  private invalidState(message: string): ApplicationException {
    return new ApplicationException(ERROR_CODES.PURCHASE_INVALID_STATE, message, HttpStatus.CONFLICT);
  }

  private async transitionOrder(id: string, previous: PurchaseOrderStatus, next: PurchaseOrderStatus, action: PurchaseHistoryAction, actor: AuthenticatedUser, context: ProcurementAuditContext, auditAction: string): Promise<PurchaseOrderWithRelations> {
    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const order = await tx.purchaseOrder.update({ where: { id }, data: { status: next }, include: ORDER_INCLUDE });
        await this.historyTx(tx, id, actor.id, action, previous, next, {});
        await this.auditTx(tx, auditAction, PURCHASE_ORDER_RESOURCE, actor, context, { purchaseOrderId: id, status: next });
        return order;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  private async runSerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryablePersistenceConflict(error) || attempt === attempts) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  private isRetryablePersistenceConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
  }

  private async historyTx(tx: Prisma.TransactionClient, purchaseOrderId: string, actorId: string, action: PurchaseHistoryAction, previousStatus: PurchaseOrderStatus | null, newStatus: PurchaseOrderStatus, metadata: Prisma.InputJsonObject): Promise<void> {
    await tx.purchaseHistory.create({ data: { purchaseOrderId, actorId, action, previousStatus, newStatus, metadata } });
  }

  private async auditTx(tx: Prisma.TransactionClient, action: string, resource: string, actor: AuthenticatedUser, context: ProcurementAuditContext, metadata: Record<string, unknown>): Promise<void> {
    await tx.auditLog.create({ data: { action, resource, actor: actor.id, metadata: { requestId: context.requestId, ip: context.ip, userAgent: context.userAgent, ...metadata } } });
  }

  private async organizationId(): Promise<string> {
    const organization = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!organization) throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organização não encontrada', HttpStatus.NOT_FOUND);
    return organization.id;
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private optionalClean(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const clean = this.clean(value);
    return clean.length ? clean : null;
  }

  private receiptLinesMetadata(items: CreatePurchaseReceiptDto['items']): Prisma.InputJsonArray {
    return items.map((item) => ({ itemId: item.itemId, quantity: item.quantity }));
  }
}
