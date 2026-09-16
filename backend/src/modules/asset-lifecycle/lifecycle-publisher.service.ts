import { HttpStatus, Injectable } from '@nestjs/common';
import { AssetLifecycleEventType, FinancialEntryOrigin, Prisma } from '@prisma/client';
import type { OperationType } from '../../shared/constants/service-types.constants';
import {
  ASSET_LIFECYCLE_AUDIT_ACTIONS,
  ASSET_LIFECYCLE_RESOURCE,
} from '../../shared/constants/asset-lifecycle.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { PrismaService } from '../database/prisma.service';
import type { CreateAssetLifecycleEventDto } from './dto/asset-lifecycle.dto';
import {
  ASSET_LIFECYCLE_EVENT_INCLUDE,
  type AssetLifecycleAuditContext,
  type AssetLifecycleEventPayload,
} from './asset-lifecycle.types';

@Injectable()
export class LifecyclePublisher {
  constructor(private readonly prisma: PrismaService) {}

  async publishManual(
    dto: CreateAssetLifecycleEventDto,
    actorId: string,
    context: AssetLifecycleAuditContext,
  ): Promise<AssetLifecycleEventPayload> {
    await this.validateReferences(dto);
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.assetLifecycleEvent.create({
        data: {
          equipmentId: dto.equipmentId,
          operationId: dto.operationId ?? null,
          documentId: dto.documentId ?? null,
          type: dto.type,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          performedBy: dto.performedBy ?? actorId,
          description: this.clean(dto.description),
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
        include: ASSET_LIFECYCLE_EVENT_INCLUDE,
      });
      await tx.auditLog.create({
        data: this.auditInput(
          ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_CREATED,
          ASSET_LIFECYCLE_RESOURCE,
          actorId,
          context,
          { eventId: event.id, equipmentId: event.equipmentId, type: event.type },
        ),
      });
      return event;
    });
  }

  async publishOperationCompletedTx(
    tx: Prisma.TransactionClient,
    operationId: string,
    actorId: string,
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        equipmentId: true,
        operatorId: true,
        completedAt: true,
      },
    });
    if (!operation || operation.status !== 'COMPLETED' || !operation.equipmentId) return;

    const existing = await tx.assetLifecycleEvent.findFirst({
      where: { operationId: operation.id, type: { not: AssetLifecycleEventType.DOCUMENT } },
      select: { id: true },
    });
    if (existing) return;

    const type = this.lifecycleTypeForOperation(operation.type);
    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId: operation.equipmentId,
        operationId: operation.id,
        type,
        occurredAt: operation.completedAt ?? new Date(),
        performedBy: operation.operatorId,
        description: `Operation #${operation.number} completed`,
        metadata: {
          operationId: operation.id,
          operationNumber: operation.number,
          operationType: operation.type,
          operationStatus: operation.status,
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        actorId,
        this.safeContext(context),
        { eventId: event.id, equipmentId: event.equipmentId, operationId: operation.id, type },
      ),
    });
  }

  async publishDocumentRenderedTx(
    tx: Prisma.TransactionClient,
    documentId: string,
    actorId: string,
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const document = await tx.operationDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        operationId: true,
        budgetId: true,
        operation: { select: { equipmentId: true } },
        budget: {
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            customerId: true,
            equipmentId: true,
            operationId: true,
          },
        },
        renderedAt: true,
      },
    });
    const equipmentId = document?.operation?.equipmentId ?? document?.budget?.equipmentId ?? null;
    if (!document || !equipmentId) return;
    const eventType = document.budgetId ? AssetLifecycleEventType.DOCUMENT_RENDERED : AssetLifecycleEventType.DOCUMENT;

    const existing = await tx.assetLifecycleEvent.findFirst({
      where: { documentId: document.id, type: eventType },
      select: { id: true },
    });
    if (existing) return;

    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId,
        operationId: document.operationId,
        documentId: document.id,
        type: eventType,
        occurredAt: document.renderedAt ?? new Date(),
        performedBy: actorId,
        description: `Document ${document.number} rendered`,
        metadata: {
          documentId: document.id,
          documentType: document.type,
          documentNumber: document.number,
          renderStatus: document.status,
          renderedAt: document.renderedAt,
          budgetId: document.budgetId,
          budgetNumber: document.budget?.number ?? null,
          budgetStatus: document.budget?.status ?? null,
          budgetTotal: document.budget?.total?.toString() ?? null,
          customerId: document.budget?.customerId ?? null,
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId: event.equipmentId,
          operationId: document.operationId,
          documentId: document.id,
          budgetId: document.budgetId,
          type: eventType,
        },
      ),
    });
  }

  async publishPmocEventTx(
    tx: Prisma.TransactionClient,
    input: {
      pmocPlanId: string;
      equipmentId: string;
      actorId: string;
      type:
        | typeof AssetLifecycleEventType.PMOC_CREATED
        | typeof AssetLifecycleEventType.PMOC_UPDATED
        | typeof AssetLifecycleEventType.PMOC_COMPLETED
        | typeof AssetLifecycleEventType.PMOC_EXPIRED;
      occurredAt?: Date;
      description: string;
      metadata?: Record<string, unknown>;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    if (
      input.type === AssetLifecycleEventType.PMOC_CREATED ||
      input.type === AssetLifecycleEventType.PMOC_EXPIRED
    ) {
      const existing = await tx.assetLifecycleEvent.findFirst({
        where: {
          equipmentId: input.equipmentId,
          type: input.type,
          metadata: { path: ['pmocPlanId'], equals: input.pmocPlanId },
        },
        select: { id: true },
      });
      if (existing) return;
    }

    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId: input.equipmentId,
        type: input.type,
        occurredAt: input.occurredAt ?? new Date(),
        performedBy: input.actorId,
        description: this.clean(input.description),
        metadata: {
          pmocPlanId: input.pmocPlanId,
          ...(input.metadata ?? {}),
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId: input.equipmentId,
          pmocPlanId: input.pmocPlanId,
          type: input.type,
        },
      ),
    });
  }

  async publishMaintenanceCompletedTx(
    tx: Prisma.TransactionClient,
    input: {
      equipmentId: string;
      operationId?: string | null;
      actorId: string;
      occurredAt: Date;
      maintenancePlanId: string;
      maintenanceExecutionId: string;
      planName: string;
      notes?: string | null;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    if (input.operationId) {
      const existing = await tx.assetLifecycleEvent.findFirst({
        where: { operationId: input.operationId, type: AssetLifecycleEventType.MAINTENANCE },
        select: { id: true },
      });
      if (existing) return;
    }
    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId: input.equipmentId,
        operationId: input.operationId ?? null,
        type: AssetLifecycleEventType.MAINTENANCE,
        occurredAt: input.occurredAt,
        performedBy: input.actorId,
        description: `Maintenance execution completed: ${input.planName}`,
        metadata: {
          maintenancePlanId: input.maintenancePlanId,
          maintenanceExecutionId: input.maintenanceExecutionId,
          planName: input.planName,
          notes: input.notes ?? null,
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId: input.equipmentId,
          operationId: input.operationId ?? null,
          maintenancePlanId: input.maintenancePlanId,
          maintenanceExecutionId: input.maintenanceExecutionId,
          type: AssetLifecycleEventType.MAINTENANCE,
        },
      ),
    });

    const pmoc = await tx.pmocPlan.findUnique({
      where: { maintenancePlanId: input.maintenancePlanId },
      select: { id: true },
    });
    if (pmoc) {
      await this.publishPmocEventTx(
        tx,
        {
          pmocPlanId: pmoc.id,
          equipmentId: input.equipmentId,
          actorId: input.actorId,
          type: AssetLifecycleEventType.PMOC_COMPLETED,
          occurredAt: input.occurredAt,
          description: `PMOC maintenance execution completed: ${input.planName}`,
          metadata: {
            maintenancePlanId: input.maintenancePlanId,
            maintenanceExecutionId: input.maintenanceExecutionId,
            operationId: input.operationId ?? null,
          },
        },
        context,
      );
    }
  }

  async publishPartReplacementTx(
    tx: Prisma.TransactionClient,
    input: {
      equipmentId: string;
      operationId: string;
      actorId: string;
      productId: string;
      inventoryItemId: string;
      operationPartId: string;
      quantity: number;
      productName: string;
      occurredAt: Date;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const existing = await tx.assetLifecycleEvent.findFirst({
      where: {
        operationId: input.operationId,
        type: AssetLifecycleEventType.PART_REPLACEMENT,
        metadata: { path: ['operationPartId'], equals: input.operationPartId },
      },
      select: { id: true },
    });
    if (existing) return;

    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId: input.equipmentId,
        operationId: input.operationId,
        type: AssetLifecycleEventType.PART_REPLACEMENT,
        occurredAt: input.occurredAt,
        performedBy: input.actorId,
        description: this.clean(`Part/material consumed: ${input.productName}`),
        metadata: {
          productId: input.productId,
          inventoryItemId: input.inventoryItemId,
          operationPartId: input.operationPartId,
          quantity: input.quantity,
          productName: input.productName,
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId: input.equipmentId,
          operationId: input.operationId,
          operationPartId: input.operationPartId,
          type: AssetLifecycleEventType.PART_REPLACEMENT,
        },
      ),
    });
  }

  async publishAssignmentEventTx(
    tx: Prisma.TransactionClient,
    input: {
      assignmentId: string;
      operationId: string;
      actorId: string;
      type:
        | typeof AssetLifecycleEventType.ASSIGNMENT_CREATED
        | typeof AssetLifecycleEventType.ASSIGNMENT_REASSIGNED
        | typeof AssetLifecycleEventType.ASSIGNMENT_ACCEPTED
        | typeof AssetLifecycleEventType.ASSIGNMENT_STARTED
        | typeof AssetLifecycleEventType.ASSIGNMENT_COMPLETED;
      occurredAt?: Date;
      description: string;
      metadata?: Record<string, unknown>;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const operation = await tx.operation.findUnique({
      where: { id: input.operationId },
      select: { id: true, number: true, equipmentId: true, operatorId: true },
    });
    if (!operation?.equipmentId) return;

    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId: operation.equipmentId,
        operationId: operation.id,
        type: input.type,
        occurredAt: input.occurredAt ?? new Date(),
        performedBy: input.actorId,
        description: this.clean(input.description),
        metadata: {
          assignmentId: input.assignmentId,
          operationId: operation.id,
          operationNumber: operation.number,
          assignedOperatorId: operation.operatorId,
          ...(input.metadata ?? {}),
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId: operation.equipmentId,
          operationId: operation.id,
          assignmentId: input.assignmentId,
          type: input.type,
        },
      ),
    });
  }

  async publishBudgetEventTx(
    tx: Prisma.TransactionClient,
    input: {
      budgetId: string;
      actorId: string;
      type: typeof AssetLifecycleEventType.BUDGET_APPROVED | typeof AssetLifecycleEventType.BUDGET_REJECTED;
      occurredAt?: Date;
      description: string;
      metadata?: Record<string, unknown>;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const budget = await tx.budget.findUnique({
      where: { id: input.budgetId },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        operationId: true,
        customerId: true,
        equipmentId: true,
        operation: { select: { id: true, number: true, type: true, status: true, equipmentId: true } },
      },
    });
    const equipmentId = budget?.equipmentId ?? budget?.operation?.equipmentId ?? null;
    if (!budget || !equipmentId) return;

    const existing = await tx.assetLifecycleEvent.findFirst({
      where: {
        equipmentId,
        type: input.type,
        metadata: { path: ['budgetId'], equals: budget.id },
      },
      select: { id: true },
    });
    if (existing) return;

    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId,
        operationId: budget.operationId ?? null,
        type: input.type,
        occurredAt: input.occurredAt ?? new Date(),
        performedBy: input.actorId,
        description: this.clean(input.description),
        metadata: {
          budgetId: budget.id,
          budgetNumber: budget.number,
          budgetStatus: budget.status,
          total: budget.total.toString(),
          customerId: budget.customerId,
          operationId: budget.operationId ?? null,
          operationNumber: budget.operation?.number ?? null,
          operationType: budget.operation?.type ?? null,
          operationStatus: budget.operation?.status ?? null,
          ...(input.metadata ?? {}),
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId,
          operationId: budget.operationId ?? null,
          budgetId: budget.id,
          type: input.type,
        },
      ),
    });
  }

  async publishFinancialEntryEventTx(
    tx: Prisma.TransactionClient,
    input: {
      entryId: string;
      actorId: string;
      type:
        | typeof AssetLifecycleEventType.FINANCIAL_ENTRY_CREATED
        | typeof AssetLifecycleEventType.FINANCIAL_ENTRY_PAID
        | typeof AssetLifecycleEventType.FINANCIAL_ENTRY_CANCELED;
      occurredAt?: Date;
      description: string;
      metadata?: Record<string, unknown>;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const entry = await tx.financialEntry.findUnique({
      where: { id: input.entryId },
      select: {
        id: true,
        type: true,
        origin: true,
        originId: true,
        status: true,
        amount: true,
        description: true,
      },
    });
    if (!entry) return;

    const equipmentId = await this.resolveFinancialEquipmentId(tx, entry.origin, entry.originId);
    if (!equipmentId) return;

    const existing = await tx.assetLifecycleEvent.findFirst({
      where: {
        equipmentId,
        type: input.type,
        metadata: { path: ['financialEntryId'], equals: entry.id },
      },
      select: { id: true },
    });
    if (existing) return;

    const event = await tx.assetLifecycleEvent.create({
      data: {
        equipmentId,
        type: input.type,
        occurredAt: input.occurredAt ?? new Date(),
        performedBy: input.actorId,
        description: this.clean(input.description),
        metadata: {
          financialEntryId: entry.id,
          financialType: entry.type,
          financialOrigin: entry.origin,
          financialOriginId: entry.originId,
          financialStatus: entry.status,
          amount: entry.amount.toString(),
          ...(input.metadata ?? {}),
        },
      },
    });
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          eventId: event.id,
          equipmentId,
          financialEntryId: entry.id,
          type: input.type,
        },
      ),
    });
  }

  async publishPurchaseEventTx(
    tx: Prisma.TransactionClient,
    input: {
      purchaseOrderId: string;
      actorId: string;
      type:
        | typeof AssetLifecycleEventType.PURCHASE_CREATED
        | typeof AssetLifecycleEventType.PURCHASE_RECEIVED
        | typeof AssetLifecycleEventType.PURCHASE_CANCELED;
      occurredAt?: Date;
      description: string;
      metadata?: Record<string, unknown>;
    },
    context?: Partial<AssetLifecycleAuditContext>,
  ): Promise<void> {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: { id: true, number: true, status: true, supplierId: true },
    });
    if (!order) return;
    await tx.auditLog.create({
      data: this.auditInput(
        ASSET_LIFECYCLE_AUDIT_ACTIONS.EVENT_AUTO_CREATED,
        ASSET_LIFECYCLE_RESOURCE,
        input.actorId,
        this.safeContext(context),
        {
          purchaseOrderId: order.id,
          purchaseOrderNumber: order.number,
          purchaseStatus: order.status,
          supplierId: order.supplierId,
          type: input.type,
          lifecycleSkipped: true,
          reason: 'Purchase order is not linked to an equipment in Orbit V1',
          ...(input.metadata ?? {}),
        },
      ),
    });
  }

  private async validateReferences(dto: CreateAssetLifecycleEventDto): Promise<void> {
    const equipment = await this.prisma.equipment.findUnique({
      where: { id: dto.equipmentId },
      select: { id: true },
    });
    if (!equipment) {
      throw new ApplicationException(
        ERROR_CODES.EQUIPMENT_NOT_FOUND,
        'Equipment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (dto.operationId) {
      const operation = await this.prisma.operation.findUnique({
        where: { id: dto.operationId },
        select: { equipmentId: true },
      });
      if (!operation) {
        throw new ApplicationException(
          ERROR_CODES.OPERATION_NOT_FOUND,
          'Operation was not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (operation.equipmentId && operation.equipmentId !== dto.equipmentId) {
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Operation belongs to another equipment',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (dto.documentId) {
      const document = await this.prisma.operationDocument.findUnique({
        where: { id: dto.documentId },
        select: { operation: { select: { equipmentId: true } } },
      });
      if (!document) {
        throw new ApplicationException(
          ERROR_CODES.DOCUMENT_NOT_FOUND,
          'Document was not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const documentEquipmentId = document.operation?.equipmentId;
      if (documentEquipmentId && documentEquipmentId !== dto.equipmentId) {
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Document belongs to another equipment',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private lifecycleTypeForOperation(type: OperationType): AssetLifecycleEventType {
    const mapping: Record<string, AssetLifecycleEventType> = {
      PREVENTIVA: AssetLifecycleEventType.PREVENTIVE,
      CORRETIVA: AssetLifecycleEventType.CORRECTIVE,
      INSTALACAO: AssetLifecycleEventType.INSTALLATION,
      PROJETO: AssetLifecycleEventType.CUSTOM,
    };
    // Tipos de serviço customizados (fora dos 4 originais) caem em CUSTOM.
    return mapping[type] ?? AssetLifecycleEventType.CUSTOM;
  }

  private async resolveFinancialEquipmentId(
    tx: Prisma.TransactionClient,
    origin: FinancialEntryOrigin,
    originId: string | null,
  ): Promise<string | null> {
    if (!originId) return null;
    if (origin === FinancialEntryOrigin.OPERATION) {
      const operation = await tx.operation.findUnique({
        where: { id: originId },
        select: { equipmentId: true },
      });
      return operation?.equipmentId ?? null;
    }
    if (origin === FinancialEntryOrigin.BUDGET) {
      const budget = await tx.budget.findUnique({
        where: { id: originId },
        select: {
          equipmentId: true,
          operation: { select: { equipmentId: true } },
        },
      });
      return budget?.equipmentId ?? budget?.operation?.equipmentId ?? null;
    }
    if (origin === FinancialEntryOrigin.PMOC) {
      const pmoc = await tx.pmocPlan.findUnique({
        where: { id: originId },
        select: { equipmentId: true },
      });
      return pmoc?.equipmentId ?? null;
    }
    return null;
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

  private safeContext(context?: Partial<AssetLifecycleAuditContext>): AssetLifecycleAuditContext {
    return {
      requestId: context?.requestId ?? 'system',
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    };
  }

  private auditInput(
    action: string,
    resource: string,
    actor: string,
    context: AssetLifecycleAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource,
      actor,
      metadata: {
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
        ...metadata,
      },
    };
  }
}
