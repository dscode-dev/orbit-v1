import { HttpStatus, Injectable } from '@nestjs/common';
import { MaintenanceExecutionStatus, PmocHistoryAction, Prisma } from '@prisma/client';
import {
  MAINTENANCE_AUDIT_ACTIONS,
  MAINTENANCE_EXECUTION_RESOURCE,
  MAINTENANCE_PLAN_RESOURCE,
} from '../../shared/constants/maintenance-planning.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import {
  CreateMaintenanceExecutionDto,
  CreateMaintenancePlanDto,
  ListMaintenanceExecutionsQueryDto,
  ListMaintenancePlansQueryDto,
  RecurrenceRuleDto,
  UpdateMaintenanceExecutionDto,
  UpdateMaintenancePlanDto,
} from './dto/maintenance-planning.dto';
import { RecurringEngine } from './recurring-engine.service';

export interface MaintenanceAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const PLAN_INCLUDE = {
  equipment: {
    select: {
      id: true,
      name: true,
      tag: true,
      type: true,
      status: true,
      customer: { select: { id: true, name: true } },
    },
  },
  creator: { select: { id: true, name: true, username: true } },
  _count: { select: { executions: true } },
} satisfies Prisma.MaintenancePlanInclude;

const EXECUTION_INCLUDE = {
  plan: { include: PLAN_INCLUDE },
  operation: { select: { id: true, number: true, type: true, status: true, completedAt: true } },
} satisfies Prisma.MaintenanceExecutionInclude;

@Injectable()
export class MaintenancePlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurrence: RecurringEngine,
    private readonly lifecycle: LifecyclePublisher,
    private readonly access: OperationAccessService,
  ) {}

  async listPlans(query: ListMaintenancePlansQueryDto): Promise<unknown> {
    const where: Prisma.MaintenancePlanWhereInput = {
      ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.maintenancePlan.findMany({
        where,
        include: PLAN_INCLUDE,
        orderBy: [{ nextExecution: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.maintenancePlan.count({ where }),
    ]);
    return this.page(items, query.page, query.limit, total);
  }

  async getPlan(id: string): Promise<unknown> {
    return this.planOrThrow(id);
  }

  async createPlan(
    dto: CreateMaintenancePlanDto,
    actor: AuthenticatedUser,
    context: MaintenanceAuditContext,
  ): Promise<unknown> {
    this.recurrence.validate(dto.recurrenceRule);
    await this.equipmentOrThrow(dto.equipmentId);
    const firstExecution = new Date(dto.firstExecution);
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.maintenancePlan.create({
        data: {
          equipmentId: dto.equipmentId,
          name: this.clean(dto.name),
          description: dto.description ? this.clean(dto.description) : null,
          type: dto.type,
          active: dto.active ?? true,
          priority: dto.priority ?? 'MEDIUM',
          recurrenceRule: dto.recurrenceRule as unknown as Prisma.InputJsonValue,
          firstExecution,
          nextExecution: firstExecution,
          createdBy: actor.id,
          executions: {
            create: {
              scheduledAt: firstExecution,
              notes: 'Execução inicial planejada gerada a partir da criação do plano.',
            },
          },
        },
        include: PLAN_INCLUDE,
      });
      await tx.auditLog.create({
        data: this.audit(
          MAINTENANCE_AUDIT_ACTIONS.PLAN_CREATED,
          MAINTENANCE_PLAN_RESOURCE,
          actor.id,
          context,
          {
            maintenancePlanId: plan.id,
            equipmentId: plan.equipmentId,
          },
        ),
      });
      return plan;
    });
  }

  async updatePlan(
    id: string,
    dto: UpdateMaintenancePlanDto,
    actor: AuthenticatedUser,
    context: MaintenanceAuditContext,
  ): Promise<unknown> {
    const existing = await this.planOrThrow(id);
    const recurrenceRule =
      dto.recurrenceRule ?? (existing.recurrenceRule as unknown as RecurrenceRuleDto);
    this.recurrence.validate(recurrenceRule);
    const firstExecution = dto.firstExecution
      ? new Date(dto.firstExecution)
      : existing.firstExecution;
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.maintenancePlan.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: this.clean(dto.name) } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description ? this.clean(dto.description) : null }
            : {}),
          ...(dto.type ? { type: dto.type } : {}),
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.recurrenceRule
            ? { recurrenceRule: dto.recurrenceRule as unknown as Prisma.InputJsonValue }
            : {}),
          ...(dto.firstExecution ? { firstExecution, nextExecution: firstExecution } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        include: PLAN_INCLUDE,
      });
      await tx.auditLog.create({
        data: this.audit(
          MAINTENANCE_AUDIT_ACTIONS.PLAN_UPDATED,
          MAINTENANCE_PLAN_RESOURCE,
          actor.id,
          context,
          {
            maintenancePlanId: id,
            changedFields: Object.keys(dto),
          },
        ),
      });
      return plan;
    });
  }

  async deletePlan(
    id: string,
    actor: AuthenticatedUser,
    context: MaintenanceAuditContext,
  ): Promise<{ deleted: true }> {
    await this.planOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.maintenancePlan.update({ where: { id }, data: { active: false } }),
      this.prisma.auditLog.create({
        data: this.audit(
          MAINTENANCE_AUDIT_ACTIONS.PLAN_DELETED,
          MAINTENANCE_PLAN_RESOURCE,
          actor.id,
          context,
          { maintenancePlanId: id },
        ),
      }),
    ]);
    return { deleted: true };
  }

  async listExecutions(
    planId: string,
    query: ListMaintenanceExecutionsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    await this.planOrThrow(planId);
    const where = {
      ...this.executionWhere({ ...query, planId }),
      ...this.access.maintenanceExecutionScope(actor),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.maintenanceExecution.findMany({
        where,
        include: EXECUTION_INCLUDE,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.maintenanceExecution.count({ where }),
    ]);
    return this.page(items, query.page, query.limit, total);
  }

  async createExecution(
    planId: string,
    dto: CreateMaintenanceExecutionDto,
    actor: AuthenticatedUser,
    context: MaintenanceAuditContext,
  ): Promise<unknown> {
    const plan = await this.planOrThrow(planId);
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : plan.nextExecution;
    return this.prisma.$transaction(async (tx) => {
      const execution = await tx.maintenanceExecution.create({
        data: {
          maintenancePlanId: planId,
          scheduledAt,
          notes: dto.notes ? this.clean(dto.notes) : null,
        },
        include: EXECUTION_INCLUDE,
      });
      await tx.maintenancePlan.update({
        where: { id: planId },
        data: {
          nextExecution: this.recurrence.next(
            plan.recurrenceRule as unknown as RecurrenceRuleDto,
            scheduledAt,
          ),
        },
      });
      await tx.auditLog.create({
        data: this.audit(
          MAINTENANCE_AUDIT_ACTIONS.EXECUTION_CREATED,
          MAINTENANCE_EXECUTION_RESOURCE,
          actor.id,
          context,
          {
            maintenancePlanId: planId,
            maintenanceExecutionId: execution.id,
          },
        ),
      });
      return execution;
    });
  }

  async updateExecution(
    id: string,
    dto: UpdateMaintenanceExecutionDto,
    actor: AuthenticatedUser,
    context: MaintenanceAuditContext,
  ): Promise<unknown> {
    await this.access.assertMaintenanceExecutionAccess(actor, id, {
      resource: MAINTENANCE_EXECUTION_RESOURCE,
      resourceId: id,
      context,
    });
    const existing = await this.executionOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const operation = dto.operationId
        ? await this.operationForPlanOrThrow(dto.operationId, existing.plan.equipmentId)
        : null;
      const shouldComplete =
        dto.status === MaintenanceExecutionStatus.COMPLETED ||
        operation?.status === 'COMPLETED' ||
        (dto.executedAt !== undefined && dto.executedAt !== null);
      const executedAt = shouldComplete
        ? dto.executedAt
          ? new Date(dto.executedAt)
          : (operation?.completedAt ?? new Date())
        : null;
      const nextStatus =
        dto.status ??
        (shouldComplete
          ? MaintenanceExecutionStatus.COMPLETED
          : dto.operationId
            ? MaintenanceExecutionStatus.LINKED
            : existing.status);
      const updated = await tx.maintenanceExecution.update({
        where: { id },
        data: {
          ...(dto.operationId !== undefined ? { operationId: dto.operationId } : {}),
          ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes ? this.clean(dto.notes) : null } : {}),
          status: nextStatus,
          ...(executedAt ? { executedAt } : {}),
        },
        include: EXECUTION_INCLUDE,
      });
      await tx.auditLog.create({
        data: this.audit(
          MAINTENANCE_AUDIT_ACTIONS.EXECUTION_UPDATED,
          MAINTENANCE_EXECUTION_RESOURCE,
          actor.id,
          context,
          {
            maintenanceExecutionId: id,
            changedFields: Object.keys(dto),
          },
        ),
      });
      if (
        nextStatus === MaintenanceExecutionStatus.COMPLETED &&
        existing.status !== MaintenanceExecutionStatus.COMPLETED
      ) {
        await this.completeExecutionTx(tx, updated, actor.id, context);
      }
      return updated;
    });
  }

  async syncOperationCompletedTx(
    tx: Prisma.TransactionClient,
    operationId: string,
    actorId: string,
    context?: Partial<MaintenanceAuditContext>,
  ): Promise<void> {
    const execution = await tx.maintenanceExecution.findUnique({
      where: { operationId },
      include: EXECUTION_INCLUDE,
    });
    if (!execution || execution.status === MaintenanceExecutionStatus.COMPLETED) return;
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      select: { status: true, completedAt: true },
    });
    if (operation?.status !== 'COMPLETED') return;
    const updated = await tx.maintenanceExecution.update({
      where: { id: execution.id },
      data: {
        status: MaintenanceExecutionStatus.COMPLETED,
        executedAt: operation.completedAt ?? new Date(),
      },
      include: EXECUTION_INCLUDE,
    });
    await this.completeExecutionTx(tx, updated, actorId, this.safeContext(context));
  }

  async equipmentMaintenance(
    equipmentId: string,
    query: ListMaintenancePlansQueryDto,
  ): Promise<unknown> {
    await this.equipmentOrThrow(equipmentId);
    return this.listPlans({ ...query, equipmentId });
  }

  async equipmentUpcoming(
    equipmentId: string,
    query: ListMaintenanceExecutionsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    await this.equipmentOrThrow(equipmentId);
    const where = this.executionWhere({
      ...query,
      equipmentId,
      status: query.status ?? MaintenanceExecutionStatus.PLANNED,
    });
    Object.assign(where, this.access.maintenanceExecutionScope(actor));
    const [items, total] = await this.prisma.$transaction([
      this.prisma.maintenanceExecution.findMany({
        where,
        include: EXECUTION_INCLUDE,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.maintenanceExecution.count({ where }),
    ]);
    return this.page(items, query.page, query.limit, total);
  }

  async stats(actor: AuthenticatedUser): Promise<unknown> {
    const now = new Date();
    const executionScope = this.access.maintenanceExecutionScope(actor);
    const planScope: Prisma.MaintenancePlanWhereInput =
      actor.role === 'OPERATOR' ? { executions: { some: executionScope } } : {};
    const [
      activePlans,
      overduePlans,
      upcomingExecutions,
      completedExecutions,
      pendingExecutions,
      completed,
    ] = await this.prisma.$transaction([
      this.prisma.maintenancePlan.count({ where: { ...planScope, active: true } }),
      this.prisma.maintenancePlan.count({ where: { ...planScope, active: true, nextExecution: { lt: now } } }),
      this.prisma.maintenanceExecution.count({
        where: { ...executionScope, status: MaintenanceExecutionStatus.PLANNED, scheduledAt: { gte: now } },
      }),
      this.prisma.maintenanceExecution.count({
        where: { ...executionScope, status: MaintenanceExecutionStatus.COMPLETED },
      }),
      this.prisma.maintenanceExecution.count({
        where: {
          ...executionScope,
          status: { in: [MaintenanceExecutionStatus.PLANNED, MaintenanceExecutionStatus.LINKED] },
        },
      }),
      this.prisma.maintenanceExecution.findMany({
        where: { ...executionScope, status: MaintenanceExecutionStatus.COMPLETED, executedAt: { not: null } },
        select: { executedAt: true, maintenancePlanId: true },
        orderBy: [{ maintenancePlanId: 'asc' }, { executedAt: 'asc' }],
      }),
    ]);
    return {
      activePlans,
      overduePlans,
      upcomingExecutions,
      completedExecutions,
      pendingExecutions,
      meanDaysBetweenExecutions: this.meanDays(completed),
    };
  }

  private async completeExecutionTx(
    tx: Prisma.TransactionClient,
    execution: Prisma.MaintenanceExecutionGetPayload<{ include: typeof EXECUTION_INCLUDE }>,
    actorId: string,
    context: MaintenanceAuditContext,
  ): Promise<void> {
    const executedAt = execution.executedAt ?? new Date();
    await tx.maintenancePlan.update({
      where: { id: execution.maintenancePlanId },
      data: {
        lastExecution: executedAt,
        nextExecution: this.recurrence.next(
          execution.plan.recurrenceRule as unknown as RecurrenceRuleDto,
          executedAt,
        ),
      },
    });
    const rvtExecution = await tx.rvtExecution.findUnique({
      where: { maintenanceExecutionId: execution.id },
      select: { id: true, rvtPlanId: true, operationId: true },
    });
    if (rvtExecution) {
      await tx.rvtExecution.update({
        where: { id: rvtExecution.id },
        data: { status: 'COMPLETED', completedAt: executedAt },
      });
      const remaining = await tx.rvtExecution.count({
        where: { rvtPlanId: rvtExecution.rvtPlanId, status: { notIn: ['COMPLETED', 'CANCELED'] } },
      });
      if (remaining === 0) {
        await tx.rvtPlan.update({
          where: { id: rvtExecution.rvtPlanId },
          data: { status: 'COMPLETED', active: false },
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'RVT_EXECUTION_COMPLETED',
          resource: 'RVT_PLAN',
          actor: actorId,
          metadata: {
            requestId: context.requestId,
            rvtPlanId: rvtExecution.rvtPlanId,
            rvtExecutionId: rvtExecution.id,
            operationId: rvtExecution.operationId,
          },
        },
      });
    }
    const pmocRequest = await tx.pmocExecutionRequest.findUnique({
      where: { maintenanceExecutionId: execution.id },
      select: { id: true, pmocPlanId: true, executionNumber: true, operationId: true },
    });
    if (pmocRequest) {
      await tx.$executeRaw`
        UPDATE "pmoc_plans"
        SET
          "last_execution_date" = GREATEST("last_execution_date", ${executedAt}),
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${pmocRequest.pmocPlanId}::uuid
      `;
      await tx.pmocHistory.createMany({
        data: [{
          pmocPlanId: pmocRequest.pmocPlanId,
          executionRequestId: pmocRequest.id,
          operationId: pmocRequest.operationId,
          actorId,
          action: PmocHistoryAction.EXECUTION_COMPLETED,
          newStatus: MaintenanceExecutionStatus.COMPLETED,
          occurredAt: executedAt,
          metadata: {
            executionNumber: pmocRequest.executionNumber,
            maintenanceExecutionId: execution.id,
          },
        }],
        skipDuplicates: true,
      });
    }
    await this.lifecycle.publishMaintenanceCompletedTx(
      tx,
      {
        equipmentId: execution.plan.equipmentId,
        operationId: execution.operationId,
        actorId,
        occurredAt: executedAt,
        maintenancePlanId: execution.maintenancePlanId,
        maintenanceExecutionId: execution.id,
        planName: execution.plan.name,
        notes: execution.notes,
      },
      context,
    );
    await tx.auditLog.create({
      data: this.audit(
        MAINTENANCE_AUDIT_ACTIONS.EXECUTION_COMPLETED,
        MAINTENANCE_EXECUTION_RESOURCE,
        actorId,
        context,
        {
          maintenanceExecutionId: execution.id,
          maintenancePlanId: execution.maintenancePlanId,
          operationId: execution.operationId,
        },
      ),
    });
  }

  private executionWhere(
    query: ListMaintenanceExecutionsQueryDto & { planId?: string; equipmentId?: string },
  ): Prisma.MaintenanceExecutionWhereInput {
    return {
      ...(query.planId ? { maintenancePlanId: query.planId } : {}),
      ...(query.equipmentId ? { plan: { equipmentId: query.equipmentId } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            scheduledAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }

  private async planOrThrow(
    id: string,
  ): Promise<Prisma.MaintenancePlanGetPayload<{ include: typeof PLAN_INCLUDE }>> {
    const plan = await this.prisma.maintenancePlan.findUnique({
      where: { id },
      include: PLAN_INCLUDE,
    });
    if (!plan)
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_PLAN_NOT_FOUND,
        'Plano de manutenção não encontrado',
        HttpStatus.NOT_FOUND,
      );
    return plan;
  }

  private async executionOrThrow(
    id: string,
  ): Promise<Prisma.MaintenanceExecutionGetPayload<{ include: typeof EXECUTION_INCLUDE }>> {
    const execution = await this.prisma.maintenanceExecution.findUnique({
      where: { id },
      include: EXECUTION_INCLUDE,
    });
    if (!execution)
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_EXECUTION_NOT_FOUND,
        'Execução de manutenção não encontrada',
        HttpStatus.NOT_FOUND,
      );
    return execution;
  }

  private async equipmentOrThrow(id: string): Promise<void> {
    const equipment = await this.prisma.equipment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!equipment)
      throw new ApplicationException(
        ERROR_CODES.EQUIPMENT_NOT_FOUND,
        'Equipamento não encontrado',
        HttpStatus.NOT_FOUND,
      );
  }

  private async operationForPlanOrThrow(
    operationId: string,
    equipmentId: string,
  ): Promise<{ id: string; status: string; completedAt: Date | null }> {
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true, equipmentId: true, status: true, completedAt: true },
    });
    if (!operation)
      throw new ApplicationException(
        ERROR_CODES.OPERATION_NOT_FOUND,
        'Atendimento não encontrado',
        HttpStatus.NOT_FOUND,
      );
    if (operation.equipmentId !== equipmentId) {
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_OPERATION_MISMATCH,
        'O atendimento não pertence ao equipamento da manutenção',
        HttpStatus.BAD_REQUEST,
      );
    }
    return operation;
  }

  private meanDays(
    items: Array<{ maintenancePlanId: string; executedAt: Date | null }>,
  ): number | null {
    const byPlan = new Map<string, Date[]>();
    for (const item of items) {
      if (!item.executedAt) continue;
      byPlan.set(item.maintenancePlanId, [
        ...(byPlan.get(item.maintenancePlanId) ?? []),
        item.executedAt,
      ]);
    }
    const gaps: number[] = [];
    for (const dates of byPlan.values()) {
      dates.slice(1).forEach((date, index) => gaps.push(date.getTime() - dates[index].getTime()));
    }
    return gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length / 86_400_000 : null;
  }

  private page<T>(items: T[], page: number, limit: number, total: number): PaginatedResponse<T> {
    return buildPaginatedResponse(items, total, page, limit);
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private safeContext(context?: Partial<MaintenanceAuditContext>): MaintenanceAuditContext {
    return {
      requestId: context?.requestId ?? 'system',
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    };
  }

  private audit(
    action: string,
    resource: string,
    actor: string,
    context: MaintenanceAuditContext,
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
