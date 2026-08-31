import { HttpStatus, Injectable } from '@nestjs/common';
import { AssetLifecycleEventType, BudgetHistoryAction, BudgetItemSource, BudgetItemType, BudgetStatus, DocumentTemplateType, NotificationType, OperationStatus, Prisma } from '@prisma/client';
import { BUDGET_AUDIT_ACTIONS, BUDGET_RESOURCE } from '../../shared/constants/budgets.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { BudgetDecisionDto, BudgetItemInputDto, CreateBudgetDto, ListBudgetsQueryDto, UpdateBudgetDto } from './dto/budget.dto';

export interface BudgetAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const BUDGET_INCLUDE = {
  organization: { select: { id: true, tradeName: true, legalName: true } },
  operation: { select: { id: true, number: true, type: true, status: true, equipmentId: true, customerId: true } },
  customer: { select: { id: true, name: true, tradeName: true, email: true, phone: true } },
  customerAddress: true,
  equipment: { select: { id: true, name: true, tag: true, type: true, status: true } },
  equipments: {
    include: { equipment: { select: { id: true, name: true, tag: true, type: true, status: true } } },
    orderBy: { position: 'asc' as const },
  },
  creator: { select: { id: true, name: true, email: true, username: true, role: true } },
  items: { include: { product: true }, orderBy: [{ type: 'asc' as const }, { sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  document: {
    select: {
      id: true,
      budgetId: true,
      operationId: true,
      type: true,
      number: true,
      status: true,
      mimeType: true,
      fileSize: true,
      renderedAt: true,
      renderMetadata: true,
      editorialStatus: true,
      revision: true,
      technicalSignatureId: true,
      customerSignatureSnapshot: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  approvals: {
    include: { actor: { select: { id: true, name: true, email: true, username: true } } },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.BudgetInclude;

type BudgetWithRelations = Prisma.BudgetGetPayload<{ include: typeof BUDGET_INCLUDE }>;

type BudgetRelations = {
  organizationId: string;
  customerId: string;
  customerAddressId: string | null;
  equipmentId: string | null;
  operationId: string | null;
};

type SnapshotItem = {
  productId: string | null;
  type: BudgetItemType;
  source: BudgetItemSource;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  sortOrder: number;
  snapshotCost: string;
  snapshotSalePrice: string;
  snapshotMargin: string;
  total: string;
};

const DEFAULT_BUDGET_INTRODUCTION =
  'Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento conforme solicitado.';
const DEFAULT_SERVICE_DISCOUNT_DESCRIPTION = 'Desconto especial aplicado aos serviços';
const DEFAULT_MATERIAL_DISCOUNT_DESCRIPTION =
  'Desconto especial aplicado aos materiais e fornecimentos';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: LifecyclePublisher,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListBudgetsQueryDto): Promise<unknown> {
    const where = this.listWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.budget.findMany({
        where,
        include: BUDGET_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.budget.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<BudgetWithRelations> {
    return this.budgetOrThrow(id);
  }

  async listByOperation(operationId: string, query: ListBudgetsQueryDto): Promise<unknown> {
    await this.operationOrThrow(operationId);
    return this.list({ ...query, operationId });
  }

  async create(dto: CreateBudgetDto, actor: AuthenticatedUser, context: BudgetAuditContext): Promise<BudgetWithRelations> {
    this.assertCreateStatus(dto.status);
    const relations = await this.resolveRelations(dto);
    const equipmentIds = await this.resolveBudgetEquipmentIds(dto, relations.equipmentId);
    const equipmentRows = await this.resolveEquipmentRows(relations.customerId, equipmentIds);
    const primaryEquipmentId = equipmentIds[0] ?? relations.equipmentId ?? null;
    const items = await this.resolveSnapshotItems(dto.items);
    const totals = this.calculateTotals(items, {
      discount: dto.discount,
      serviceDiscount: dto.serviceDiscount,
      materialDiscount: dto.materialDiscount,
      additional: dto.additional,
    });
    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : new Date();
    const validityDays = dto.validityDays ?? 30;
    const expirationDate = dto.expirationDate
      ? new Date(dto.expirationDate)
      : new Date(issuedAt.getTime() + validityDays * 86_400_000);
    this.assertDates(issuedAt, expirationDate);
    const technicalSignatureId = await this.defaultTechnicalSignatureId();

    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.create({
        data: {
          ...relations,
          equipmentId: primaryEquipmentId,
          equipments: { createMany: { data: equipmentRows } },
          status: dto.status ?? BudgetStatus.DRAFT,
          title: this.clean(dto.title),
          description: this.optionalClean(dto.description),
          issuedAt,
          introduction: this.clean(dto.introduction || DEFAULT_BUDGET_INTRODUCTION),
          serviceSubtotal: totals.serviceSubtotal,
          materialSubtotal: totals.materialSubtotal,
          serviceDiscount: totals.serviceDiscount,
          materialDiscount: totals.materialDiscount,
          serviceDiscountDescription:
            Number(totals.serviceDiscount) > 0
              ? this.clean(dto.serviceDiscountDescription || DEFAULT_SERVICE_DISCOUNT_DESCRIPTION)
              : null,
          materialDiscountDescription:
            Number(totals.materialDiscount) > 0
              ? this.clean(dto.materialDiscountDescription || DEFAULT_MATERIAL_DISCOUNT_DESCRIPTION)
              : null,
          subtotal: totals.subtotal,
          discount: totals.discount,
          additional: totals.additional,
          total: totals.total,
          amountInWords: this.clean(dto.amountInWords || this.amountInWords(Number(totals.total))),
          validityDays,
          paymentMethods: dto.paymentMethods,
          commercialNotes: this.optionalClean(dto.commercialNotes),
          expirationDate,
          observations: this.optionalClean(dto.observations),
          createdBy: actor.id,
          items: { createMany: { data: items } },
        },
        include: BUDGET_INCLUDE,
      });
      await tx.operationDocument.create({
        data: {
          budgetId: budget.id,
          operationId: null,
          type: DocumentTemplateType.BUDGET,
          number: `ORC-${String(budget.number).padStart(6, '0')}`,
          status: 'DRAFT',
          handoffOrigin: 'PLATFORM',
          collectedById: actor.id,
          technicalSignatureId,
        },
      });
      await this.createHistoryTx(tx, budget.id, actor.id, BudgetHistoryAction.CREATED, null, budget.status, {
        documentTemplateType: DocumentTemplateType.BUDGET,
        items: items.length,
      });
      await this.auditTx(tx, BUDGET_AUDIT_ACTIONS.BUDGET_CREATED, actor, context, {
        budgetId: budget.id,
        number: budget.number,
        status: budget.status,
        total: budget.total.toString(),
      });
      return tx.budget.findUniqueOrThrow({ where: { id: budget.id }, include: BUDGET_INCLUDE });
    });
  }

  async update(id: string, dto: UpdateBudgetDto, actor: AuthenticatedUser, context: BudgetAuditContext): Promise<BudgetWithRelations> {
    const current = await this.budgetOrThrow(id);
    this.assertWritable(current);
    this.assertUpdateStatus(dto.status);

    const relations =
      dto.customerId || dto.customerAddressId !== undefined || dto.equipmentId !== undefined || dto.equipmentIds !== undefined || dto.operationId !== undefined
        ? await this.resolveRelations({
            operationId: dto.operationId ?? current.operationId ?? undefined,
            customerId: dto.customerId ?? current.customerId,
            customerAddressId: dto.customerAddressId ?? current.customerAddressId ?? undefined,
            equipmentId: dto.equipmentId ?? current.equipmentId ?? undefined,
          })
        : undefined;
    // Substitui a lista de equipamentos quando explicitamente informada.
    const customerId = dto.customerId ?? current.customerId;
    let equipmentRows: Prisma.BudgetEquipmentCreateManyBudgetInput[] | undefined;
    let primaryEquipmentId: string | null | undefined;
    if (dto.equipmentIds !== undefined) {
      const equipmentIds = [...new Set(dto.equipmentIds)];
      equipmentRows = await this.resolveEquipmentRows(customerId, equipmentIds);
      primaryEquipmentId = equipmentIds[0] ?? null;
    }
    const items = dto.items ? await this.resolveSnapshotItems(dto.items) : undefined;
    const totalItems =
      items ??
      current.items.map((item) => ({
        productId: item.productId,
        type: item.type,
        source: item.source,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        sortOrder: item.sortOrder,
        snapshotCost: item.snapshotCost.toString(),
        snapshotSalePrice: item.snapshotSalePrice.toString(),
        snapshotMargin: item.snapshotMargin.toString(),
        total: item.total.toString(),
      }));
    const hasScopedDiscountUpdate =
      dto.serviceDiscount !== undefined || dto.materialDiscount !== undefined;
    const totals = this.calculateTotals(totalItems, {
      ...(hasScopedDiscountUpdate
        ? {
            discount: dto.discount,
            serviceDiscount: dto.serviceDiscount ?? Number(current.serviceDiscount),
            materialDiscount: dto.materialDiscount ?? Number(current.materialDiscount),
          }
        : dto.discount !== undefined
          ? { discount: dto.discount }
          : {
              serviceDiscount: Number(current.serviceDiscount),
              materialDiscount: Number(current.materialDiscount),
            }),
      additional: dto.additional ?? Number(current.additional),
    });
    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : current.issuedAt;
    const validityDays = dto.validityDays ?? current.validityDays;
    const expirationDate = dto.expirationDate
      ? new Date(dto.expirationDate)
      : dto.issuedAt !== undefined || dto.validityDays !== undefined
        ? new Date(issuedAt.getTime() + validityDays * 86_400_000)
        : current.expirationDate;
    this.assertDates(issuedAt, expirationDate);

    return this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.budgetItem.deleteMany({ where: { budgetId: id } });
      }
      if (equipmentRows) {
        await tx.budgetEquipment.deleteMany({ where: { budgetId: id } });
      }
      const nextStatus = dto.status ?? current.status;
      const budget = await tx.budget.update({
        where: { id },
        data: {
          ...(relations ?? {}),
          ...(primaryEquipmentId !== undefined ? { equipmentId: primaryEquipmentId } : {}),
          ...(equipmentRows ? { equipments: { createMany: { data: equipmentRows } } } : {}),
          ...(dto.title !== undefined ? { title: this.clean(dto.title) } : {}),
          ...(dto.description !== undefined ? { description: this.optionalClean(dto.description) } : {}),
          ...(dto.issuedAt !== undefined ? { issuedAt } : {}),
          ...(dto.introduction !== undefined ? { introduction: this.clean(dto.introduction) } : {}),
          ...(dto.expirationDate !== undefined || dto.issuedAt !== undefined || dto.validityDays !== undefined
            ? { expirationDate }
            : {}),
          ...(dto.validityDays !== undefined ? { validityDays: dto.validityDays } : {}),
          ...(dto.paymentMethods !== undefined ? { paymentMethods: dto.paymentMethods } : {}),
          ...(dto.commercialNotes !== undefined ? { commercialNotes: this.optionalClean(dto.commercialNotes) } : {}),
          ...(dto.observations !== undefined ? { observations: this.optionalClean(dto.observations) } : {}),
          status: nextStatus,
          serviceSubtotal: totals.serviceSubtotal,
          materialSubtotal: totals.materialSubtotal,
          serviceDiscount: totals.serviceDiscount,
          materialDiscount: totals.materialDiscount,
          serviceDiscountDescription:
            Number(totals.serviceDiscount) > 0
              ? this.clean(
                  dto.serviceDiscountDescription ||
                    current.serviceDiscountDescription ||
                    DEFAULT_SERVICE_DISCOUNT_DESCRIPTION,
                )
              : null,
          materialDiscountDescription:
            Number(totals.materialDiscount) > 0
              ? this.clean(
                  dto.materialDiscountDescription ||
                    current.materialDiscountDescription ||
                    DEFAULT_MATERIAL_DISCOUNT_DESCRIPTION,
                )
              : null,
          subtotal: totals.subtotal,
          discount: totals.discount,
          additional: totals.additional,
          total: totals.total,
          amountInWords: this.clean(dto.amountInWords || this.amountInWords(Number(totals.total))),
          ...(items ? { items: { createMany: { data: items } } } : {}),
        },
        include: BUDGET_INCLUDE,
      });
      if (current.document?.renderedAt) {
        await tx.operationDocument.update({
          where: { id: current.document.id },
          data: { editorialStatus: 'STALE' },
        });
      }
      await this.createHistoryTx(
        tx,
        id,
        actor.id,
        current.status !== nextStatus ? BudgetHistoryAction.SUBMITTED : BudgetHistoryAction.UPDATED,
        current.status,
        budget.status,
        { changedFields: Object.keys(dto), itemsReplaced: Boolean(items) },
      );
      await this.auditTx(tx, BUDGET_AUDIT_ACTIONS.BUDGET_UPDATED, actor, context, {
        budgetId: id,
        number: budget.number,
        changedFields: Object.keys(dto),
      });
      return budget;
    });
  }

  async approve(id: string, dto: BudgetDecisionDto, actor: AuthenticatedUser, context: BudgetAuditContext): Promise<BudgetWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.budget.findUnique({ where: { id }, include: BUDGET_INCLUDE });
      if (!current) {
        throw new ApplicationException(ERROR_CODES.BUDGET_NOT_FOUND, 'Budget was not found', HttpStatus.NOT_FOUND);
      }
      this.assertApprovalCandidate(current);
      if (current.expirationDate < new Date()) {
        throw new ApplicationException(ERROR_CODES.BUDGET_EXPIRED, 'Expired budgets cannot be approved', HttpStatus.CONFLICT);
      }
      if (current.operationId) {
        const approved = await tx.budget.findFirst({
          where: { operationId: current.operationId, status: BudgetStatus.APPROVED, id: { not: id } },
          select: { id: true, number: true },
        });
        if (approved) {
          throw new ApplicationException(
            ERROR_CODES.BUDGET_MULTIPLE_APPROVAL,
            'Another budget is already approved for this operation',
            HttpStatus.CONFLICT,
            { approvedBudgetId: approved.id, approvedBudgetNumber: approved.number },
          );
        }
      }
      await tx.budgetApproval.create({
        data: { budgetId: id, actorId: actor.id, status: BudgetStatus.APPROVED, observation: this.optionalClean(dto.observation) },
      });
      const transition = await tx.budget.updateMany({
        where: { id, status: current.status },
        data: { status: BudgetStatus.APPROVED, approvedAt: new Date(), rejectedAt: null, canceledAt: null },
      });
      if (transition.count !== 1) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Budget decision conflicted with another transition', HttpStatus.CONFLICT);
      }
      const budget = await tx.budget.findUniqueOrThrow({ where: { id }, include: BUDGET_INCLUDE });
      await this.createHistoryTx(tx, id, actor.id, BudgetHistoryAction.APPROVED, current.status, BudgetStatus.APPROVED, {
        observation: this.optionalClean(dto.observation),
      });
      await this.auditTx(tx, BUDGET_AUDIT_ACTIONS.BUDGET_APPROVED, actor, context, {
        budgetId: id,
        number: budget.number,
        total: budget.total.toString(),
      });
      await this.lifecycle.publishBudgetEventTx(
        tx,
        {
          budgetId: id,
          actorId: actor.id,
          type: AssetLifecycleEventType.BUDGET_APPROVED,
          description: `Budget #${budget.number} approved`,
          metadata: { total: budget.total.toString(), customerId: budget.customerId },
        },
        context,
      );
      await this.notifications.notifyBudgetDecisionTx(tx, id, NotificationType.BUDGET_APPROVED);
      return budget;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reject(id: string, dto: BudgetDecisionDto, actor: AuthenticatedUser, context: BudgetAuditContext): Promise<BudgetWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.budget.findUnique({ where: { id }, include: BUDGET_INCLUDE });
      if (!current) {
        throw new ApplicationException(ERROR_CODES.BUDGET_NOT_FOUND, 'Budget was not found', HttpStatus.NOT_FOUND);
      }
      this.assertApprovalCandidate(current);
      await tx.budgetApproval.create({
        data: { budgetId: id, actorId: actor.id, status: BudgetStatus.REJECTED, observation: this.optionalClean(dto.observation) },
      });
      const transition = await tx.budget.updateMany({
        where: { id, status: current.status },
        data: { status: BudgetStatus.REJECTED, rejectedAt: new Date() },
      });
      if (transition.count !== 1) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Budget decision conflicted with another transition', HttpStatus.CONFLICT);
      }
      const budget = await tx.budget.findUniqueOrThrow({ where: { id }, include: BUDGET_INCLUDE });
      await this.createHistoryTx(tx, id, actor.id, BudgetHistoryAction.REJECTED, current.status, BudgetStatus.REJECTED, {
        observation: this.optionalClean(dto.observation),
      });
      await this.auditTx(tx, BUDGET_AUDIT_ACTIONS.BUDGET_REJECTED, actor, context, {
        budgetId: id,
        number: budget.number,
      });
      await this.lifecycle.publishBudgetEventTx(
        tx,
        {
          budgetId: id,
          actorId: actor.id,
          type: AssetLifecycleEventType.BUDGET_REJECTED,
          description: `Budget #${budget.number} rejected`,
          metadata: { customerId: budget.customerId },
        },
        context,
      );
      await this.notifications.notifyBudgetDecisionTx(tx, id, NotificationType.BUDGET_REJECTED);
      return budget;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async cancel(id: string, actor: AuthenticatedUser, context: BudgetAuditContext): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.budget.findUnique({ where: { id }, include: BUDGET_INCLUDE });
      if (!current) {
        throw new ApplicationException(ERROR_CODES.BUDGET_NOT_FOUND, 'Budget was not found', HttpStatus.NOT_FOUND);
      }
      this.assertWritable(current);
      const transition = await tx.budget.updateMany({
        where: { id, status: current.status },
        data: { status: BudgetStatus.CANCELED, canceledAt: new Date() },
      });
      if (transition.count !== 1) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Budget cancellation conflicted with another transition', HttpStatus.CONFLICT);
      }
      await this.createHistoryTx(tx, id, actor.id, BudgetHistoryAction.CANCELED, current.status, BudgetStatus.CANCELED, {});
      await this.auditTx(tx, BUDGET_AUDIT_ACTIONS.BUDGET_CANCELED, actor, context, {
        budgetId: id,
        number: current.number,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { deleted: true };
  }

  async stats(query: ListBudgetsQueryDto): Promise<unknown> {
    const where = this.listWhere(query);
    const [total, approved, rejected, pending, potential, approvedTotal] = await this.prisma.$transaction([
      this.prisma.budget.count({ where }),
      this.prisma.budget.count({ where: { ...where, status: BudgetStatus.APPROVED } }),
      this.prisma.budget.count({ where: { ...where, status: BudgetStatus.REJECTED } }),
      this.prisma.budget.count({ where: { ...where, status: BudgetStatus.PENDING } }),
      this.prisma.budget.aggregate({
        where: { ...where, status: { in: [BudgetStatus.DRAFT, BudgetStatus.PENDING] } },
        _sum: { total: true },
      }),
      this.prisma.budget.aggregate({ where: { ...where, status: BudgetStatus.APPROVED }, _avg: { total: true } }),
    ]);
    return {
      total,
      approved,
      rejected,
      pending,
      potentialRevenue: potential._sum.total?.toString() ?? '0',
      averageTicket: approvedTotal._avg.total?.toString() ?? '0',
    };
  }

  async history(id: string, query: ListBudgetsQueryDto): Promise<unknown> {
    await this.budgetOrThrow(id);
    const where: Prisma.BudgetHistoryWhereInput = { budgetId: id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.budgetHistory.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.budgetHistory.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  private async resolveRelations(dto: {
    customerId: string;
    customerAddressId?: string;
    equipmentId?: string;
    operationId?: string;
  }): Promise<BudgetRelations> {
    const [organization, customer] = await Promise.all([
      this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
      this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { id: true, isActive: true } }),
    ]);
    if (!organization) {
      throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organization was not found', HttpStatus.NOT_FOUND);
    }
    if (!customer?.isActive) {
      throw new ApplicationException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer was not found or is inactive', HttpStatus.NOT_FOUND);
    }

    let operationId = dto.operationId ?? null;
    let customerAddressId = dto.customerAddressId ?? null;
    let equipmentId = dto.equipmentId ?? null;
    if (dto.operationId) {
      const operation = await this.prisma.operation.findUnique({
        where: { id: dto.operationId },
        select: { id: true, customerId: true, addressId: true, equipmentId: true, status: true },
      });
      if (!operation) throw new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, 'Operation was not found', HttpStatus.NOT_FOUND);
      if (operation.status !== OperationStatus.COMPLETED) {
        throw new ApplicationException(
          ERROR_CODES.BUDGET_OPERATION_NOT_COMPLETED,
          'Budget origin must be a completed Work Order',
          HttpStatus.CONFLICT,
        );
      }
      if (operation.customerId !== dto.customerId) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_RELATIONSHIP, 'Operation belongs to another customer', HttpStatus.BAD_REQUEST);
      }
      if (equipmentId && operation.equipmentId && operation.equipmentId !== equipmentId) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_RELATIONSHIP, 'Operation belongs to another equipment', HttpStatus.BAD_REQUEST);
      }
      customerAddressId = customerAddressId ?? operation.addressId;
      equipmentId = equipmentId ?? operation.equipmentId;
      operationId = operation.id;
    }
    if (customerAddressId) {
      const address = await this.prisma.customerAddress.findUnique({
        where: { id: customerAddressId },
        select: { customerId: true },
      });
      if (!address || address.customerId !== dto.customerId) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_RELATIONSHIP, 'Address belongs to another customer', HttpStatus.BAD_REQUEST);
      }
    }
    if (equipmentId) {
      const equipment = await this.prisma.equipment.findUnique({
        where: { id: equipmentId },
        select: { customerId: true, isActive: true },
      });
      if (!equipment?.isActive || equipment.customerId !== dto.customerId) {
        throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_RELATIONSHIP, 'Equipment belongs to another customer', HttpStatus.BAD_REQUEST);
      }
    }
    return { organizationId: organization.id, customerId: dto.customerId, customerAddressId, equipmentId, operationId };
  }

  /**
   * Resolve a lista de equipamentos do orçamento (um ou vários). Ordem de
   * prioridade: `equipmentIds` explícitos → equipamentos inspecionados da OS de
   * origem → `equipmentId` único (retrocompatibilidade).
   */
  private async resolveBudgetEquipmentIds(
    dto: { equipmentIds?: string[]; equipmentId?: string; operationId?: string },
    fallbackEquipmentId: string | null,
  ): Promise<string[]> {
    if (dto.equipmentIds !== undefined) return [...new Set(dto.equipmentIds)];
    if (dto.operationId) {
      const inspected = await this.prisma.operationInspectedEquipment.findMany({
        where: { operationId: dto.operationId },
        orderBy: { position: 'asc' },
        select: { equipmentId: true },
      });
      if (inspected.length) return [...new Set(inspected.map((item) => item.equipmentId))];
    }
    return fallbackEquipmentId ? [fallbackEquipmentId] : [];
  }

  /** Valida a posse dos equipamentos e monta as linhas com snapshots (setor/marca/modelo/capacidade). */
  private async resolveEquipmentRows(
    customerId: string,
    equipmentIds: string[],
  ): Promise<Prisma.BudgetEquipmentCreateManyBudgetInput[]> {
    if (equipmentIds.length === 0) return [];
    const equipments = await this.prisma.equipment.findMany({
      where: { id: { in: equipmentIds } },
      select: {
        id: true,
        name: true,
        sector: true,
        tag: true,
        manufacturer: true,
        model: true,
        capacity: true,
        serialNumber: true,
        isActive: true,
        customerId: true,
        address: { select: { name: true } },
      },
    });
    const byId = new Map(equipments.map((equipment) => [equipment.id, equipment]));
    return equipmentIds.map((id, index) => {
      const equipment = byId.get(id);
      if (!equipment?.isActive || equipment.customerId !== customerId) {
        throw new ApplicationException(
          ERROR_CODES.BUDGET_INVALID_RELATIONSHIP,
          'Equipment belongs to another customer',
          HttpStatus.BAD_REQUEST,
        );
      }
      return {
        equipmentId: id,
        position: index,
        sector: (equipment.sector ?? equipment.address?.name ?? equipment.name).slice(0, 160),
        brandSnapshot: equipment.manufacturer ?? null,
        modelSnapshot: equipment.model ?? null,
        capacitySnapshot: equipment.capacity ?? null,
        tagSnapshot: equipment.tag ?? null,
        serialSnapshot: equipment.serialNumber ?? null,
      };
    });
  }

  private async resolveSnapshotItems(dtoItems: BudgetItemInputDto[]): Promise<SnapshotItem[]> {
    if (!dtoItems.length) {
      throw new ApplicationException(ERROR_CODES.BUDGET_ITEM_REQUIRED, 'Budget must have at least one item', HttpStatus.BAD_REQUEST);
    }
    const items: SnapshotItem[] = [];
    for (const [index, item] of dtoItems.entries()) {
      const source = item.source ?? BudgetItemSource.MANUAL;
      if (source === BudgetItemSource.CATALOG && item.type !== BudgetItemType.MATERIAL) {
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Itens sugeridos pelo catálogo devem pertencer à seção de materiais',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (item.productId) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          select: { id: true, isActive: true },
        });
        if (!product?.isActive) {
          throw new ApplicationException(
            ERROR_CODES.PRODUCT_NOT_FOUND,
            'Product was not found or is inactive',
            HttpStatus.NOT_FOUND,
          );
        }
      }
      const quantity = Number(item.quantity);
      const unitPrice =
        source === BudgetItemSource.CATALOG ? 0 : Number(item.unitPrice);
      items.push({
        productId: item.productId ?? null,
        type: item.type,
        source,
        description: this.clean(item.description),
        quantity,
        unit: this.clean(item.unit).toUpperCase(),
        unitPrice: this.money(unitPrice),
        sortOrder: item.sortOrder ?? index,
        snapshotCost: '0.00',
        snapshotSalePrice: this.money(unitPrice),
        snapshotMargin: '0.00',
        total: this.money(quantity * unitPrice),
      });
    }
    return items;
  }

  private calculateTotals(
    items: SnapshotItem[],
    input: {
      discount?: number;
      serviceDiscount?: number;
      materialDiscount?: number;
      additional?: number;
    } = {},
  ): {
    serviceSubtotal: string;
    materialSubtotal: string;
    serviceDiscount: string;
    materialDiscount: string;
    subtotal: string;
    discount: string;
    additional: string;
    total: string;
  } {
    const serviceSubtotal = items
      .filter((item) => item.type === BudgetItemType.SERVICE)
      .reduce((sum, item) => sum + Number(item.total), 0);
    const materialSubtotal = items
      .filter((item) => item.type === BudgetItemType.MATERIAL)
      .reduce((sum, item) => sum + Number(item.total), 0);
    const subtotal = serviceSubtotal + materialSubtotal;
    const hasScopedDiscount =
      input.serviceDiscount !== undefined || input.materialDiscount !== undefined;
    const legacyDiscount = input.discount ?? 0;
    const serviceDiscount = hasScopedDiscount
      ? input.serviceDiscount ?? 0
      : Math.min(legacyDiscount, serviceSubtotal);
    const materialDiscount = hasScopedDiscount
      ? input.materialDiscount ?? 0
      : Math.max(legacyDiscount - serviceDiscount, 0);
    const discount = serviceDiscount + materialDiscount;
    const additional = input.additional ?? 0;
    if (hasScopedDiscount && input.discount !== undefined && Math.abs(input.discount - discount) > 0.005) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'O desconto total deve corresponder à soma dos descontos de serviços e materiais',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (serviceDiscount > serviceSubtotal) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'O desconto dos serviços não pode superar o subtotal dos serviços',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (materialDiscount > materialSubtotal) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'O desconto dos materiais não pode superar o subtotal dos materiais',
        HttpStatus.BAD_REQUEST,
      );
    }
    const total = subtotal - discount + additional;
    if (total < 0) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'O valor total do orçamento não pode ser negativo',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      serviceSubtotal: this.money(serviceSubtotal),
      materialSubtotal: this.money(materialSubtotal),
      serviceDiscount: this.money(serviceDiscount),
      materialDiscount: this.money(materialDiscount),
      subtotal: this.money(subtotal),
      discount: this.money(discount),
      additional: this.money(additional),
      total: this.money(total),
    };
  }

  private async defaultTechnicalSignatureId(): Promise<string | null> {
    const signature = await this.prisma.signature.findFirst({
      where: { active: true, deletedAt: null, imageStorageKey: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { name: 'asc' }],
      select: { id: true },
    });
    return signature?.id ?? null;
  }

  private assertDates(issuedAt: Date, expirationDate: Date): void {
    if (
      Number.isNaN(issuedAt.getTime()) ||
      Number.isNaN(expirationDate.getTime()) ||
      expirationDate < issuedAt
    ) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'Budget issue and expiration dates are inconsistent',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private amountInWords(value: number): string {
    const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
    const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    const group = (input: number): string => {
      if (input === 100) return 'cem';
      const parts: string[] = [];
      const hundred = Math.floor(input / 100);
      const rest = input % 100;
      if (hundred) parts.push(hundreds[hundred]);
      if (rest >= 10 && rest < 20) parts.push(teens[rest - 10]);
      else {
        if (Math.floor(rest / 10)) parts.push(tens[Math.floor(rest / 10)]);
        if (rest % 10) parts.push(units[rest % 10]);
      }
      return parts.join(' e ');
    };
    const integer = (input: number): string => {
      if (!input) return 'zero';
      const parts: string[] = [];
      const millions = Math.floor(input / 1_000_000);
      const thousands = Math.floor((input % 1_000_000) / 1_000);
      const remainder = input % 1_000;
      if (millions) parts.push(`${group(millions)} ${millions === 1 ? 'milhão' : 'milhões'}`);
      if (thousands) parts.push(thousands === 1 ? 'mil' : `${group(thousands)} mil`);
      if (remainder) parts.push(group(remainder));
      return parts.join(' e ');
    };
    const centsTotal = Math.round(value * 100);
    const reais = Math.floor(centsTotal / 100);
    const cents = centsTotal % 100;
    return [
      reais || !cents ? `${integer(reais)} ${reais === 1 ? 'real' : 'reais'}` : '',
      cents ? `${integer(cents)} ${cents === 1 ? 'centavo' : 'centavos'}` : '',
    ]
      .filter(Boolean)
      .join(' e ');
  }

  private async budgetOrThrow(id: string): Promise<BudgetWithRelations> {
    const budget = await this.prisma.budget.findUnique({ where: { id }, include: BUDGET_INCLUDE });
    if (!budget) {
      throw new ApplicationException(ERROR_CODES.BUDGET_NOT_FOUND, 'Budget was not found', HttpStatus.NOT_FOUND);
    }
    return budget;
  }

  private async operationOrThrow(id: string): Promise<void> {
    const operation = await this.prisma.operation.findUnique({ where: { id }, select: { id: true } });
    if (!operation) throw new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, 'Operation was not found', HttpStatus.NOT_FOUND);
  }

  private listWhere(query: ListBudgetsQueryDto): Prisma.BudgetWhereInput {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
      ...(query.operationId ? { operationId: query.operationId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(query.expired ? { expirationDate: { lt: new Date() }, status: { in: [BudgetStatus.DRAFT, BudgetStatus.PENDING] } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
              { customer: { tradeName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private assertCreateStatus(status?: BudgetStatus): void {
    const allowed: BudgetStatus[] = [BudgetStatus.DRAFT, BudgetStatus.PENDING];
    if (status && !allowed.includes(status)) {
      throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Budget can only be created as DRAFT or PENDING', HttpStatus.BAD_REQUEST);
    }
  }

  private assertUpdateStatus(status?: BudgetStatus): void {
    const allowed: BudgetStatus[] = [BudgetStatus.DRAFT, BudgetStatus.PENDING, BudgetStatus.CANCELED];
    if (status && !allowed.includes(status)) {
      throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Use approval endpoints for final budget decisions', HttpStatus.BAD_REQUEST);
    }
  }

  private assertWritable(budget: BudgetWithRelations): void {
    if (budget.status === BudgetStatus.APPROVED) {
      throw new ApplicationException(ERROR_CODES.BUDGET_APPROVED_IMMUTABLE, 'Approved budgets cannot be changed', HttpStatus.CONFLICT);
    }
    const finalStatuses: BudgetStatus[] = [BudgetStatus.REJECTED, BudgetStatus.EXPIRED, BudgetStatus.CANCELED];
    if (finalStatuses.includes(budget.status)) {
      throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Final budgets cannot be changed', HttpStatus.CONFLICT);
    }
  }

  private assertApprovalCandidate(budget: BudgetWithRelations): void {
    const allowed: BudgetStatus[] = [BudgetStatus.DRAFT, BudgetStatus.PENDING];
    if (!allowed.includes(budget.status)) {
      throw new ApplicationException(ERROR_CODES.BUDGET_INVALID_STATUS, 'Budget cannot receive this decision in its current status', HttpStatus.CONFLICT);
    }
  }

  private async createHistoryTx(
    tx: Prisma.TransactionClient,
    budgetId: string,
    actorId: string,
    action: BudgetHistoryAction,
    previousStatus: BudgetStatus | null,
    newStatus: BudgetStatus,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.budgetHistory.create({
      data: { budgetId, actorId, action, previousStatus, newStatus, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  private async auditTx(
    tx: Prisma.TransactionClient,
    action: string,
    actor: AuthenticatedUser,
    context: BudgetAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action,
        resource: BUDGET_RESOURCE,
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

  private page<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
    return buildPaginatedResponse(items, total, page, limit);
  }

  private money(value: number): string {
    return value.toFixed(2);
  }

  private clean(value: string): string {
    return value
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private optionalClean(value?: string | null): string | null {
    return value ? this.clean(value) : null;
  }
}
