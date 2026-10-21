import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import {
  INVENTORY_AUDIT_ACTIONS,
  INVENTORY_RESOURCE,
  OPERATION_PART_RESOURCE,
  PRODUCT_RESOURCE,
  STOCK_MOVEMENT_RESOURCE,
  SUPPLIER_RESOURCE,
} from '../../shared/constants/inventory.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import type {
  CreateOperationMaterialDto,
  CreateProductDto,
  CreateStockMovementDto,
  CreateSupplierDto,
  ListInventoryQueryDto,
  ListProductsQueryDto,
  ListStockMovementsQueryDto,
  ListSuppliersQueryDto,
  UpdateInventoryItemDto,
  UpdateProductDto,
  UpdateSupplierDto,
} from './dto/inventory.dto';

export interface InventoryAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const PRODUCT_INCLUDE = {
  inventoryItems: {
    select: {
      id: true,
      currentQuantity: true,
      reservedQuantity: true,
      availableQuantity: true,
      minimumQuantity: true,
      idealQuantity: true,
      location: true,
      isActive: true,
    },
  },
  suppliers: {
    include: {
      supplier: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.ProductInclude;

const INVENTORY_INCLUDE = {
  product: true,
  organization: { select: { id: true, tradeName: true, legalName: true } },
} satisfies Prisma.InventoryItemInclude;

const MOVEMENT_INCLUDE = {
  inventoryItem: { include: { product: true } },
  operation: { select: { id: true, number: true, equipmentId: true, customerId: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.StockMovementInclude;

const OPERATION_PART_INCLUDE = {
  product: true,
  inventoryItem: { include: { product: true } },
} satisfies Prisma.OperationPartInclude;

type ProductWithInventory = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;
type InventoryItemWithProduct = Prisma.InventoryItemGetPayload<{ include: typeof INVENTORY_INCLUDE }>;
type StockMovementWithRelations = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;
type BasicOperation = { id: string };
type OperationForInventory = { id: string; number: number; equipmentId: string | null; completedAt: Date | null };

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: LifecyclePublisher,
    private readonly access: OperationAccessService,
  ) {}

  async listProducts(query: ListProductsQueryDto): Promise<unknown> {
    const where: Prisma.ProductWhereInput = {
      ...(query.active !== undefined ? { isActive: query.active } : {}),
      ...(query.purchasable !== undefined ? { isPurchasable: query.purchasable } : {}),
      ...(query.sellable !== undefined ? { isSellable: query.sellable } : {}),
      ...(query.category ? { category: { contains: query.category, mode: 'insensitive' } } : {}),
      ...(query.brand ? { brand: { contains: query.brand, mode: 'insensitive' } } : {}),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' } },
              { internalCode: { contains: query.search, mode: 'insensitive' } },
              { manufacturerCode: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { category: { contains: query.search, mode: 'insensitive' } },
              { brand: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async getProduct(id: string): Promise<unknown> {
    return this.productOrThrow(id);
  }

  async createProduct(
    dto: CreateProductDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    this.assertCommercialClassification(dto.isPurchasable, dto.isSellable);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: this.productData(dto),
        });
        await this.syncPrimarySupplierTx(tx, product.id, dto.primarySupplierId);
        const organization = await tx.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (organization) {
          await tx.inventoryItem.create({
            data: {
              organizationId: organization.id,
              productId: product.id,
              minimumQuantity: 0,
              idealQuantity: 0,
              reservedQuantity: 0,
              currentQuantity: 0,
              availableQuantity: 0,
              location: 'Almoxarifado principal',
            },
          });
        }
        await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.PRODUCT_CREATED, PRODUCT_RESOURCE, actor, context, {
          productId: product.id,
          sku: product.sku,
          primarySupplierId: dto.primarySupplierId ?? null,
        });
        return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: PRODUCT_INCLUDE });
      });
    } catch (error) {
      this.throwConflict(error, ERROR_CODES.PRODUCT_CONFLICT, 'Já existe um produto com este SKU ou código interno');
    }
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    const current = await this.productOrThrow(id);
    this.assertCommercialClassification(
      dto.isPurchasable ?? current.isPurchasable,
      dto.isSellable ?? current.isSellable,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id },
          data: this.productData(dto),
        });
        await this.syncPrimarySupplierTx(tx, id, dto.primarySupplierId);
        await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.PRODUCT_UPDATED, PRODUCT_RESOURCE, actor, context, {
          productId: id,
          changedFields: Object.keys(dto),
          primarySupplierId: dto.primarySupplierId ?? undefined,
        });
        return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: PRODUCT_INCLUDE });
      });
    } catch (error) {
      this.throwConflict(error, ERROR_CODES.PRODUCT_CONFLICT, 'Já existe um produto com este SKU ou código interno');
    }
  }

  async deleteProduct(
    id: string,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<{ deleted: true }> {
    await this.productOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { isActive: false, disabledAt: new Date() } });
      await tx.inventoryItem.updateMany({
        where: { productId: id },
        data: { isActive: false, disabledAt: new Date() },
      });
      await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.PRODUCT_DELETED, PRODUCT_RESOURCE, actor, context, {
        productId: id,
      });
    });
    return { deleted: true };
  }

  async listInventory(query: ListInventoryQueryDto): Promise<unknown> {
    const where: Prisma.InventoryItemWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.location ? { location: { contains: query.location, mode: 'insensitive' } } : {}),
    };
    if (query.critical) {
      delete where.availableQuantity;
      where.AND = [{ availableQuantity: { lte: 0 } }, { minimumQuantity: { gt: 0 } }];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        include: INVENTORY_INCLUDE,
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async getInventoryItem(id: string): Promise<unknown> {
    return this.inventoryItemOrThrow(id);
  }

  async updateInventoryItem(
    id: string,
    dto: UpdateInventoryItemDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    await this.inventoryItemOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.InventoryItemUpdateInput = {
        ...(dto.minimumQuantity !== undefined ? { minimumQuantity: dto.minimumQuantity } : {}),
        ...(dto.idealQuantity !== undefined ? { idealQuantity: dto.idealQuantity } : {}),
        ...(dto.reservedQuantity !== undefined ? { reservedQuantity: dto.reservedQuantity } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.isActive !== undefined
          ? { isActive: dto.isActive, disabledAt: dto.isActive ? null : new Date() }
          : {}),
      };
      const updated = await tx.inventoryItem.update({ where: { id }, data, include: INVENTORY_INCLUDE });
      await this.recalculateInventoryTx(tx, id);
      await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.INVENTORY_ITEM_UPDATED, INVENTORY_RESOURCE, actor, context, {
        inventoryItemId: id,
        changedFields: Object.keys(dto),
      });
      return updated;
    });
  }

  async inventoryStats(actor: AuthenticatedUser): Promise<unknown> {
    const from = new Date(Date.now() - 30 * 86_400_000);
    const movementScope = this.access.stockMovementScope(actor);
    const operationPartScope = this.access.operationPartScope(actor);
    const [totalItems, critical, empty, products, movements, mostUsed, byEquipment, byCustomer] = await this.prisma.$transaction([
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.count({
        where: { isActive: true, minimumQuantity: { gt: 0 }, availableQuantity: { lte: 0 } },
      }),
      this.prisma.inventoryItem.count({ where: { isActive: true, currentQuantity: { lte: 0 } } }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.stockMovement.count({
        where: { ...movementScope, type: StockMovementType.CONSUMPTION, occurredAt: { gte: from } },
      }),
      this.prisma.operationPart.groupBy({
        by: ['productId'],
        where: { ...operationPartScope, deletedAt: null, createdAt: { gte: from } },
        _sum: { quantity: true },
        _count: true,
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      this.prisma.operationPart.groupBy({
        by: ['operationId'],
        where: { ...operationPartScope, deletedAt: null, operation: { equipmentId: { not: null } }, createdAt: { gte: from } },
        _sum: { quantity: true },
        orderBy: { operationId: 'asc' },
      }),
      this.prisma.operationPart.groupBy({
        by: ['operationId'],
        where: { ...operationPartScope, deletedAt: null, createdAt: { gte: from } },
        _sum: { quantity: true },
        orderBy: { operationId: 'asc' },
      }),
    ]);
    const [productNames, operations] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: mostUsed.map((item) => item.productId) } },
        select: { id: true, name: true, sku: true },
      }),
      this.prisma.operation.findMany({
        where: { id: { in: [...new Set([...byEquipment, ...byCustomer].map((item) => item.operationId))] } },
        select: {
          id: true,
          equipmentId: true,
          customerId: true,
          equipment: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, tradeName: true } },
        },
      }),
    ]);
    const productMap = new Map(productNames.map((product) => [product.id, product]));
    const operationMap = new Map(operations.map((operation) => [operation.id, operation]));
    return {
      totalItems,
      activeProducts: products,
      minimumStockAlerts: critical,
      productsWithoutStock: empty,
      consumptionMovementsLast30Days: movements,
      consumptionByPeriod: { from, to: new Date(), movements },
      productsMostUsed: mostUsed.map((item) => ({
        product: productMap.get(item.productId) ?? { id: item.productId, name: 'Unknown', sku: '—' },
        quantity: item._sum?.quantity ?? 0,
        occurrences: item._count ?? 0,
      })),
      consumptionByEquipment: byEquipment
        .map((item) => ({ operation: operationMap.get(item.operationId), quantity: item._sum?.quantity ?? 0 }))
        .filter((item) => item.operation?.equipmentId)
        .map((item) => ({ equipment: item.operation?.equipment, quantity: item.quantity })),
      consumptionByCustomer: byCustomer
        .map((item) => ({ operation: operationMap.get(item.operationId), quantity: item._sum?.quantity ?? 0 }))
        .filter((item) => item.operation)
        .map((item) => ({ customer: item.operation?.customer, quantity: item.quantity })),
    };
  }

  async createMovement(
    dto: CreateStockMovementDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    if (dto.operationId) {
      await this.access.assertOperationAccess(actor, dto.operationId, {
        resource: STOCK_MOVEMENT_RESOURCE,
        resourceId: dto.operationId,
        context,
      });
    }
    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const movement = await this.createMovementTx(
          tx,
          {
            inventoryItemId: dto.inventoryItemId,
            quantity: dto.quantity,
            type: dto.type,
            reason: dto.reason,
            operationId: dto.operationId ?? null,
            userId: actor.id,
            occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          },
          actor,
          context,
        );
        return movement;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  createMovementInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      inventoryItemId: string;
      quantity: number;
      type: StockMovementType;
      reason: string;
      operationId: string | null;
      userId: string;
      occurredAt: Date;
    },
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<StockMovementWithRelations> {
    return this.createMovementTx(tx, input, actor, context);
  }

  async ensureInventoryItemInTransaction(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; productId: string; location?: string | null },
  ): Promise<{ id: string }> {
    const existing = await tx.inventoryItem.findFirst({
      where: { organizationId: input.organizationId, productId: input.productId, location: input.location ?? null, isActive: true },
      select: { id: true },
    });
    if (existing) return existing;
    return tx.inventoryItem.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        currentQuantity: 0,
        minimumQuantity: 0,
        idealQuantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
        location: input.location ?? null,
        isActive: true,
      },
      select: { id: true },
    });
  }

  async listMovements(query: ListStockMovementsQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const where: Prisma.StockMovementWhereInput = {
      ...this.access.stockMovementScope(actor),
      ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
      ...(query.operationId ? { operationId: query.operationId } : {}),
      ...(query.productId ? { inventoryItem: { productId: query.productId } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async listSuppliers(query: ListSuppliersQueryDto): Promise<unknown> {
    const where: Prisma.SupplierWhereInput = {
      ...(query.active !== undefined ? { isActive: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { legalName: { contains: query.search, mode: 'insensitive' } },
              { tradeName: { contains: query.search, mode: 'insensitive' } },
              { document: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { legalName: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async createSupplier(
    dto: CreateSupplierDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({ data: this.supplierData(dto) });
        await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.SUPPLIER_CREATED, SUPPLIER_RESOURCE, actor, context, {
          supplierId: supplier.id,
        });
        return supplier;
      });
    } catch (error) {
      this.throwConflict(error, ERROR_CODES.SUPPLIER_CONFLICT, 'Supplier document already exists');
    }
  }

  async updateSupplier(
    id: string,
    dto: UpdateSupplierDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    await this.supplierOrThrow(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.update({ where: { id }, data: this.supplierData(dto) });
        await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.SUPPLIER_UPDATED, SUPPLIER_RESOURCE, actor, context, {
          supplierId: id,
          changedFields: Object.keys(dto),
        });
        return supplier;
      });
    } catch (error) {
      this.throwConflict(error, ERROR_CODES.SUPPLIER_CONFLICT, 'Supplier document already exists');
    }
  }

  async deleteSupplier(
    id: string,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<{ deleted: true }> {
    await this.supplierOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data: { isActive: false, disabledAt: new Date() } });
      await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.SUPPLIER_DELETED, SUPPLIER_RESOURCE, actor, context, {
        supplierId: id,
      });
    });
    return { deleted: true };
  }

  async listOperationMaterials(
    operationId: string,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    await this.access.assertOperationAccess(actor, operationId, {
      resource: OPERATION_PART_RESOURCE,
      resourceId: operationId,
      context,
    });
    await this.operationOrThrow(operationId);
    return this.prisma.operationPart.findMany({
      where: { operationId, deletedAt: null },
      include: OPERATION_PART_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async consumeMaterial(
    operationId: string,
    dto: CreateOperationMaterialDto,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<unknown> {
    await this.access.assertOperationAccess(actor, operationId, {
      resource: OPERATION_PART_RESOURCE,
      resourceId: operationId,
      context,
    });
    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const operation = await this.operationOrThrowTx(tx, operationId);
        const item = await this.inventoryItemOrThrowTx(tx, dto.inventoryItemId);
        if (item.productId !== dto.productId) {
          throw new ApplicationException(
            ERROR_CODES.INVENTORY_PRODUCT_MISMATCH,
            'O item de estoque não pertence ao produto selecionado',
            HttpStatus.BAD_REQUEST,
          );
        }
        await this.assertProductActiveTx(tx, dto.productId);
        const part = await tx.operationPart.create({
          data: {
            operationId,
            productId: dto.productId,
            inventoryItemId: dto.inventoryItemId,
            quantity: dto.quantity,
            notes: dto.notes ?? null,
          },
          include: OPERATION_PART_INCLUDE,
        });
        await this.createMovementTx(
          tx,
          {
            inventoryItemId: dto.inventoryItemId,
            quantity: dto.quantity,
            type: StockMovementType.CONSUMPTION,
            reason: `Consumed in operation #${operation.number}`,
            operationId,
            userId: actor.id,
            occurredAt: new Date(),
          },
          actor,
          context,
        );
        if (operation.equipmentId) {
          await this.lifecycle.publishPartReplacementTx(
            tx,
            {
              equipmentId: operation.equipmentId,
              operationId,
              actorId: actor.id,
              productId: dto.productId,
              inventoryItemId: dto.inventoryItemId,
              operationPartId: part.id,
              quantity: dto.quantity,
              productName: part.product.name,
              occurredAt: operation.completedAt ?? new Date(),
            },
            context,
          );
        }
        await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.MATERIAL_CONSUMED, OPERATION_PART_RESOURCE, actor, context, {
          operationId,
          operationPartId: part.id,
          productId: dto.productId,
          quantity: dto.quantity,
        });
        return part;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  async deleteOperationMaterial(
    operationId: string,
    partId: string,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<{ deleted: true }> {
    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const part = await tx.operationPart.findFirst({
          where: { id: partId, operationId, deletedAt: null },
          include: OPERATION_PART_INCLUDE,
        });
        if (!part) {
          throw new ApplicationException(
            ERROR_CODES.NOT_FOUND,
            'Material do atendimento não encontrado',
            HttpStatus.NOT_FOUND,
          );
        }
        const removed = await tx.operationPart.updateMany({
          where: { id: part.id, operationId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (removed.count !== 1) {
          throw new ApplicationException(
            ERROR_CODES.NOT_FOUND,
            'Este material já foi removido do atendimento',
            HttpStatus.CONFLICT,
          );
        }
        await this.createMovementTx(
          tx,
          {
            inventoryItemId: part.inventoryItemId,
            quantity: Number(part.quantity),
            type: StockMovementType.RETURN,
            reason: `Material removed from operation`,
            operationId,
            userId: actor.id,
            occurredAt: new Date(),
          },
          actor,
          context,
        );
        await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.MATERIAL_RETURNED, OPERATION_PART_RESOURCE, actor, context, {
          operationId,
          operationPartId: part.id,
          productId: part.productId,
        });
        return { deleted: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  private async createMovementTx(
    tx: Prisma.TransactionClient,
    input: {
      inventoryItemId: string;
      quantity: number;
      type: StockMovementType;
      reason: string;
      operationId: string | null;
      userId: string;
      occurredAt: Date;
    },
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
  ): Promise<StockMovementWithRelations> {
    await this.inventoryItemOrThrowTx(tx, input.inventoryItemId);
    if (input.operationId) await this.operationOrThrowTx(tx, input.operationId);
    const delta = this.deltaFor(input.type, input.quantity);
    await this.applyInventoryDeltaTx(tx, input.inventoryItemId, delta);
    const movement = await tx.stockMovement.create({
      data: {
        inventoryItemId: input.inventoryItemId,
        quantity: input.quantity,
        type: input.type,
        reason: this.clean(input.reason).slice(0, 255),
        operationId: input.operationId,
        userId: input.userId,
        occurredAt: input.occurredAt,
      },
      include: MOVEMENT_INCLUDE,
    });
    await this.auditTx(tx, INVENTORY_AUDIT_ACTIONS.STOCK_MOVEMENT_CREATED, STOCK_MOVEMENT_RESOURCE, actor, context, {
      movementId: movement.id,
      inventoryItemId: input.inventoryItemId,
      type: input.type,
      quantity: input.quantity,
      operationId: input.operationId,
    });
    return movement;
  }

  private async applyInventoryDeltaTx(
    tx: Prisma.TransactionClient,
    inventoryItemId: string,
    delta: Prisma.Decimal,
  ): Promise<void> {
    if (delta.isZero()) return;
    const where: Prisma.InventoryItemWhereInput = { id: inventoryItemId, isActive: true };
    const data: Prisma.InventoryItemUpdateManyMutationInput = {
      currentQuantity: { increment: delta },
      availableQuantity: { increment: delta },
    };
    const result = delta.gt(0)
      ? await tx.inventoryItem.updateMany({ where, data })
      : await tx.inventoryItem.updateMany({
          where: {
            ...where,
            currentQuantity: { gte: delta.abs() },
            availableQuantity: { gte: delta.abs() },
          },
          data,
        });
    if (result.count !== 1) {
      throw new ApplicationException(
        ERROR_CODES.INVENTORY_NEGATIVE_STOCK,
        'A movimentação deixaria o estoque negativo',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async recalculateInventoryTx(tx: Prisma.TransactionClient, inventoryItemId: string): Promise<void> {
    const [item, movements] = await Promise.all([
      tx.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } }),
      tx.stockMovement.findMany({ where: { inventoryItemId }, select: { quantity: true, type: true } }),
    ]);
    const current = movements.reduce(
      (total, movement) => total.plus(this.deltaFor(movement.type, Number(movement.quantity))),
      new Prisma.Decimal(0),
    );
    const available = current.minus(item.reservedQuantity);
    if (available.lt(0)) {
      throw new ApplicationException(
        ERROR_CODES.INVENTORY_NEGATIVE_STOCK,
        'A quantidade reservada é maior que o estoque atual',
        HttpStatus.CONFLICT,
      );
    }
    await tx.inventoryItem.update({
      where: { id: inventoryItemId },
      data: {
        currentQuantity: current,
        availableQuantity: available,
      },
    });
  }

  private deltaFor(type: StockMovementType, quantity: number): Prisma.Decimal {
    const value = new Prisma.Decimal(quantity);
    const decreasing: StockMovementType[] = [
      StockMovementType.OUT,
      StockMovementType.CONSUMPTION,
      StockMovementType.TRANSFER,
    ];
    return decreasing.includes(type)
      ? value.negated()
      : value;
  }

  private productData(dto: Partial<CreateProductDto>): Prisma.ProductUncheckedCreateInput {
    return {
      ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
      ...(dto.internalCode !== undefined ? { internalCode: dto.internalCode || null } : {}),
      ...(dto.manufacturerCode !== undefined ? { manufacturerCode: dto.manufacturerCode || null } : {}),
      ...(dto.name !== undefined ? { name: this.clean(dto.name) } : {}),
      ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
      ...(dto.brand !== undefined ? { brand: dto.brand || null } : {}),
      ...(dto.model !== undefined ? { model: dto.model || null } : {}),
      ...(dto.category !== undefined ? { category: dto.category || null } : {}),
      ...(dto.technicalDescription !== undefined
        ? { technicalDescription: dto.technicalDescription || null }
        : {}),
      ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
      ...(dto.dimensions !== undefined ? { dimensions: dto.dimensions || null } : {}),
      ...(dto.isPurchasable !== undefined ? { isPurchasable: dto.isPurchasable } : {}),
      ...(dto.isSellable !== undefined ? { isSellable: dto.isSellable } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive, disabledAt: dto.isActive ? null : new Date() } : {}),
    } as Prisma.ProductUncheckedCreateInput;
  }

  private assertCommercialClassification(
    isPurchasable: boolean | undefined,
    isSellable: boolean | undefined,
  ): void {
    if (isPurchasable === false && isSellable === false) {
      throw new ApplicationException(
        ERROR_CODES.PRODUCT_COMMERCIAL_CLASSIFICATION_REQUIRED,
        'O produto precisa estar disponível para compra, venda ou ambos',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private supplierData(dto: Partial<CreateSupplierDto>): Prisma.SupplierUncheckedCreateInput {
    return {
      ...(dto.legalName !== undefined ? { legalName: this.clean(dto.legalName) } : {}),
      ...(dto.tradeName !== undefined ? { tradeName: dto.tradeName || null } : {}),
      ...(dto.document !== undefined ? { document: dto.document || null } : {}),
      ...(dto.contacts !== undefined ? { contacts: dto.contacts as Prisma.InputJsonValue } : {}),
      ...(dto.address !== undefined ? { address: dto.address as Prisma.InputJsonValue } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive, disabledAt: dto.isActive ? null : new Date() } : {}),
    } as Prisma.SupplierUncheckedCreateInput;
  }

  private async syncPrimarySupplierTx(
    tx: Prisma.TransactionClient,
    productId: string,
    supplierId: string | null | undefined,
  ): Promise<void> {
    if (supplierId === undefined) return;
    if (!supplierId) {
      await tx.productSupplier.deleteMany({ where: { productId } });
      return;
    }
    await this.assertSupplierActiveTx(tx, supplierId);
    await tx.productSupplier.updateMany({
      where: { productId },
      data: { isPrimary: false },
    });
    await tx.productSupplier.upsert({
      where: { productId_supplierId: { productId, supplierId } },
      create: { productId, supplierId, isPrimary: true },
      update: { isPrimary: true },
    });
  }

  private async productOrThrow(id: string): Promise<ProductWithInventory> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    if (!product) {
      throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto não encontrado', HttpStatus.NOT_FOUND);
    }
    return product;
  }

  private async supplierOrThrow(id: string): Promise<Prisma.SupplierGetPayload<object>> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new ApplicationException(ERROR_CODES.SUPPLIER_NOT_FOUND, 'Fornecedor não encontrado', HttpStatus.NOT_FOUND);
    }
    return supplier;
  }

  private async assertSupplierActiveTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const supplier = await tx.supplier.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!supplier) {
      throw new ApplicationException(ERROR_CODES.SUPPLIER_NOT_FOUND, 'Fornecedor não encontrado', HttpStatus.NOT_FOUND);
    }
    if (!supplier.isActive) {
      throw new ApplicationException(ERROR_CODES.SUPPLIER_NOT_FOUND, 'Fornecedor inativo', HttpStatus.CONFLICT);
    }
  }

  private async inventoryItemOrThrow(id: string): Promise<InventoryItemWithProduct> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id }, include: INVENTORY_INCLUDE });
    if (!item) {
      throw new ApplicationException(ERROR_CODES.INVENTORY_ITEM_NOT_FOUND, 'Item de estoque não encontrado', HttpStatus.NOT_FOUND);
    }
    return item;
  }

  private async inventoryItemOrThrowTx(tx: Prisma.TransactionClient, id: string): Promise<Prisma.InventoryItemGetPayload<object>> {
    const item = await tx.inventoryItem.findUnique({ where: { id } });
    if (!item) {
      throw new ApplicationException(ERROR_CODES.INVENTORY_ITEM_NOT_FOUND, 'Item de estoque não encontrado', HttpStatus.NOT_FOUND);
    }
    return item;
  }

  private async operationOrThrow(id: string): Promise<BasicOperation> {
    const operation = await this.prisma.operation.findUnique({ where: { id }, select: { id: true } });
    if (!operation) {
      throw new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, 'Atendimento não encontrado', HttpStatus.NOT_FOUND);
    }
    return operation;
  }

  private async operationOrThrowTx(tx: Prisma.TransactionClient, id: string): Promise<OperationForInventory> {
    const operation = await tx.operation.findUnique({
      where: { id },
      select: { id: true, number: true, equipmentId: true, completedAt: true },
    });
    if (!operation) {
      throw new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, 'Atendimento não encontrado', HttpStatus.NOT_FOUND);
    }
    return operation;
  }

  private async assertProductActiveTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const product = await tx.product.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!product) {
      throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto não encontrado', HttpStatus.NOT_FOUND);
    }
    if (!product.isActive) {
      throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto inativo', HttpStatus.CONFLICT);
    }
  }

  private page<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
    return buildPaginatedResponse(items, total, page, limit);
  }

  private throwConflict(error: unknown, code: string, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApplicationException(code, message, HttpStatus.CONFLICT);
    }
    throw error;
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

  private async auditTx(
    tx: Prisma.TransactionClient,
    action: string,
    resource: string,
    actor: AuthenticatedUser,
    context: InventoryAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action,
        resource,
        actor: actor.id,
        metadata: {
          requestId: context.requestId,
          ip: context.ip,
          userAgent: context.userAgent,
          ...metadata,
        },
      },
    });
  }

  private clean(input: string): string {
    return input
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
