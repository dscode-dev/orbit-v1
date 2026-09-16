import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DocumentTemplateType,
  MaintenanceExecutionStatus,
  MaintenancePlanType,
  OperationMaintenanceType,
  Prisma,
  Role,
  RvtExecutionStatus,
  RvtPlanStatus,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import { SYSTEM_SERVICE_TYPE_KEYS } from '../../shared/constants/service-types.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { AssignmentsService } from '../assignments/assignments.service';
import { PrismaService } from '../database/prisma.service';
import { RecurringEngine } from '../maintenance-planning/recurring-engine.service';
import { RecurrenceFrequency, type RecurrenceRuleDto } from '../maintenance-planning/dto/maintenance-planning.dto';
import { OperationsService, type OperationAuditContext } from '../operations/operations.service';
import type {
  CreateRvtPlanDto,
  ListRvtExecutionsQueryDto,
  ListRvtPlansQueryDto,
  PrepareRvtExecutionDto,
  UpdateRvtPlanDto,
} from './dto/rvt-planning.dto';

const PLAN_INCLUDE = {
  customer: { select: { id: true, name: true, tradeName: true } },
  address: true,
  responsibleTechnician: { select: { id: true, name: true, jobTitle: true } },
  defaultOperator: { select: { id: true, name: true, role: true } },
  equipments: { orderBy: { position: 'asc' as const }, include: { equipment: true } },
  checklists: { orderBy: { position: 'asc' as const }, include: { technicalCatalog: true } },
  executions: { orderBy: { executionNumber: 'asc' as const }, include: { operation: { select: { id: true, number: true, status: true, documents: { select: { id: true, type: true, number: true, status: true, editorialStatus: true, revision: true, fileSize: true, renderedAt: true, createdAt: true, updatedAt: true } } } }, assignedOperator: { select: { id: true, name: true } } } },
  maintenancePlan: true,
} satisfies Prisma.RvtPlanInclude;

const PLAN_LIST_INCLUDE = {
  customer: { select: { id: true, name: true, tradeName: true } },
  address: true,
  responsibleTechnician: { select: { id: true, name: true, jobTitle: true } },
  defaultOperator: { select: { id: true, name: true, role: true } },
  equipments: { orderBy: { position: 'asc' as const }, include: { equipment: true } },
  _count: { select: { executions: true, checklists: true } },
} satisfies Prisma.RvtPlanInclude;

const EXECUTION_INCLUDE = {
  rvtPlan: {
    include: {
      equipments: { orderBy: { position: 'asc' as const }, include: { equipment: true } },
      checklists: { orderBy: { position: 'asc' as const }, include: { technicalCatalog: true } },
      responsibleTechnician: { select: { id: true, name: true, jobTitle: true } },
    },
  },
} satisfies Prisma.RvtExecutionInclude;

type RvtExecutionWithPlan = Prisma.RvtExecutionGetPayload<{ include: typeof EXECUTION_INCLUDE }>;

@Injectable()
export class RvtPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurrence: RecurringEngine,
    private readonly operations: OperationsService,
    private readonly assignments: AssignmentsService,
  ) {}

  async list(query: ListRvtPlansQueryDto): Promise<unknown> {
    const where: Prisma.RvtPlanWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.equipmentId ? { equipments: { some: { equipmentId: query.equipmentId } } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        ...(Number.isInteger(Number(query.search)) ? [{ number: Number(query.search) }] : []),
      ] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rvtPlan.findMany({ where, include: PLAN_LIST_INCLUDE, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.rvtPlan.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<unknown> {
    const plan = await this.prisma.rvtPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
    if (!plan) throw this.notFound();
    return plan;
  }

  async create(dto: CreateRvtPlanDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    this.assertSupportedType(dto.maintenanceType);
    const start = this.calendarDate(dto.startDate);
    const end = this.calendarDate(dto.endDate);
    if (end < start) throw this.invalid('A data final deve ser igual ou posterior à data inicial');
    const dates = this.occurrences(dto.maintenanceType, start, end);
    if (!dates.length || dates.length > 520) throw this.invalid('A cobertura deve gerar entre 1 e 520 execuções');
    const relations = await this.validateRelations(dto);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:${dto.customerId}`}))`;
      const last = await tx.rvtPlan.aggregate({ where: { customerId: dto.customerId }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const maintenancePlan = await tx.maintenancePlan.create({ data: {
        equipmentId: dto.equipmentIds[0],
        name: dto.name,
        description: dto.observations ?? null,
        type: MaintenancePlanType.INSPECTION,
        recurrenceRule: this.rule(dto.maintenanceType) as unknown as Prisma.InputJsonValue,
        firstExecution: dates[0],
        nextExecution: dates[0],
        createdBy: actor.id,
      } });
      const plan = await tx.rvtPlan.create({ data: {
        organizationId: relations.organizationId,
        customerId: dto.customerId,
        addressId: dto.addressId,
        maintenancePlanId: maintenancePlan.id,
        number,
        name: dto.name,
        maintenanceType: dto.maintenanceType,
        startDate: start,
        endDate: end,
        responsibleTechnicianId: dto.responsibleTechnicianId,
        defaultOperatorId: dto.defaultOperatorId ?? null,
        observations: dto.observations ?? null,
        createdBy: actor.id,
        equipments: { create: dto.equipmentIds.map((equipmentId, position) => ({ equipmentId, position })) },
        checklists: { create: dto.checklistCatalogIds.map((technicalCatalogId, position) => ({ technicalCatalogId, position })) },
      } });
      for (const [index, scheduledAt] of dates.entries()) {
        const maintenanceExecution = await tx.maintenanceExecution.create({ data: { maintenancePlanId: maintenancePlan.id, scheduledAt } });
        await tx.rvtExecution.create({ data: {
          rvtPlanId: plan.id,
          maintenanceExecutionId: maintenanceExecution.id,
          executionNumber: index + 1,
          scheduledAt,
          assignedOperatorId: dto.defaultOperatorId ?? null,
          status: dto.defaultOperatorId ? RvtExecutionStatus.ASSIGNED : RvtExecutionStatus.PENDING,
        } });
      }
      await tx.auditLog.create({ data: this.audit('RVT_PLAN_CREATED', actor, context, { rvtPlanId: plan.id, customerId: dto.customerId, number, executionCount: dates.length }) });
      return tx.rvtPlan.findUniqueOrThrow({ where: { id: plan.id }, include: PLAN_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async update(id: string, dto: UpdateRvtPlanDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    const existing = await this.prisma.rvtPlan.findUnique({ where: { id }, include: { executions: { select: { operationId: true } } } });
    if (!existing) throw this.notFound();
    if ((dto.startDate || dto.endDate || dto.maintenanceType) && existing.executions.some((item) => item.operationId)) {
      throw this.invalid('Cobertura e periodicidade não podem mudar depois do início das execuções');
    }
    const maintenanceType = dto.maintenanceType ?? existing.maintenanceType;
    this.assertSupportedType(maintenanceType);
    const coverageChanged = Boolean(dto.startDate || dto.endDate || dto.maintenanceType);
    const start = dto.startDate ? this.calendarDate(dto.startDate) : existing.startDate;
    const end = dto.endDate ? this.calendarDate(dto.endDate) : existing.endDate;
    if (end < start) throw this.invalid('A data final deve ser igual ou posterior à data inicial');
    const dates = coverageChanged ? this.occurrences(maintenanceType, start, end) : [];
    if (coverageChanged && (!dates.length || dates.length > 520)) throw this.invalid('A cobertura deve gerar entre 1 e 520 execuções');
    await this.validateRelations({
      customerId: existing.customerId,
      addressId: dto.addressId ?? existing.addressId,
      equipmentIds: dto.equipmentIds ?? [],
      checklistCatalogIds: dto.checklistCatalogIds ?? [],
      responsibleTechnicianId: dto.responsibleTechnicianId ?? existing.responsibleTechnicianId,
      defaultOperatorId: dto.defaultOperatorId ?? undefined,
      maintenanceType,
    }, true);
    return this.prisma.$transaction(async (tx) => {
      if (coverageChanged) {
        await tx.rvtExecution.deleteMany({ where: { rvtPlanId: id } });
        await tx.maintenanceExecution.deleteMany({ where: { maintenancePlanId: existing.maintenancePlanId } });
        await tx.maintenancePlan.update({ where: { id: existing.maintenancePlanId }, data: {
          recurrenceRule: this.rule(maintenanceType) as unknown as Prisma.InputJsonValue,
          firstExecution: dates[0],
          nextExecution: dates[0],
          lastExecution: null,
        } });
        for (const [index, scheduledAt] of dates.entries()) {
          const maintenanceExecution = await tx.maintenanceExecution.create({ data: { maintenancePlanId: existing.maintenancePlanId, scheduledAt } });
          await tx.rvtExecution.create({ data: {
            rvtPlanId: id,
            maintenanceExecutionId: maintenanceExecution.id,
            executionNumber: index + 1,
            scheduledAt,
            assignedOperatorId: dto.defaultOperatorId === null ? null : dto.defaultOperatorId ?? existing.defaultOperatorId,
            status: (dto.defaultOperatorId === null ? null : dto.defaultOperatorId ?? existing.defaultOperatorId) ? RvtExecutionStatus.ASSIGNED : RvtExecutionStatus.PENDING,
          } });
        }
      }
      if (dto.equipmentIds) {
        await tx.rvtPlanEquipment.deleteMany({ where: { rvtPlanId: id } });
        await tx.rvtPlanEquipment.createMany({ data: dto.equipmentIds.map((equipmentId, position) => ({ rvtPlanId: id, equipmentId, position })) });
      }
      if (dto.checklistCatalogIds) {
        await tx.rvtPlanChecklist.deleteMany({ where: { rvtPlanId: id } });
        await tx.rvtPlanChecklist.createMany({ data: dto.checklistCatalogIds.map((technicalCatalogId, position) => ({ rvtPlanId: id, technicalCatalogId, position })) });
      }
      if (!coverageChanged && dto.defaultOperatorId !== undefined) {
        await tx.rvtExecution.updateMany({
          where: { rvtPlanId: id, operationId: null, status: { in: [RvtExecutionStatus.PENDING, RvtExecutionStatus.ASSIGNED] } },
          data: {
            assignedOperatorId: dto.defaultOperatorId,
            status: dto.defaultOperatorId ? RvtExecutionStatus.ASSIGNED : RvtExecutionStatus.PENDING,
          },
        });
      }
      await tx.rvtPlan.update({ where: { id }, data: {
        name: dto.name,
        addressId: dto.addressId,
        maintenanceType: dto.maintenanceType,
        startDate: dto.startDate ? start : undefined,
        endDate: dto.endDate ? end : undefined,
        responsibleTechnicianId: dto.responsibleTechnicianId,
        ...(dto.defaultOperatorId !== undefined ? { defaultOperatorId: dto.defaultOperatorId } : {}),
        status: dto.status,
        ...(dto.status ? { active: dto.status === RvtPlanStatus.ACTIVE } : {}),
        observations: dto.observations,
      } });
      await tx.auditLog.create({ data: this.audit('RVT_PLAN_UPDATED', actor, context, { rvtPlanId: id, changedFields: Object.keys(dto) }) });
      return tx.rvtPlan.findUniqueOrThrow({ where: { id }, include: PLAN_INCLUDE });
    });
  }

  async cancel(id: string, actor: AuthenticatedUser, context: OperationAuditContext): Promise<{ deleted: true }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.rvtPlan.findUnique({ where: { id }, select: { id: true } });
      if (!plan) throw this.notFound();
      await tx.rvtPlan.update({ where: { id }, data: { active: false, status: RvtPlanStatus.CANCELED } });
      await tx.rvtExecution.updateMany({ where: { rvtPlanId: id, operationId: null }, data: { status: RvtExecutionStatus.CANCELED } });
      await tx.auditLog.create({ data: this.audit('RVT_PLAN_CANCELED', actor, context, { rvtPlanId: id }) });
      return { deleted: true as const };
    });
    return result;
  }

  async listExecutions(planId: string, query: ListRvtExecutionsQueryDto): Promise<unknown> {
    await this.ensurePlan(planId);
    const where: Prisma.RvtExecutionWhereInput = {
      rvtPlanId: planId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { scheduledAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rvtExecution.findMany({ where, include: { operation: { select: { id: true, number: true, status: true, documents: { select: { id: true, type: true, number: true, status: true, editorialStatus: true, revision: true, fileSize: true, renderedAt: true, createdAt: true, updatedAt: true } } } }, assignedOperator: { select: { id: true, name: true } } }, orderBy: { scheduledAt: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.rvtExecution.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async executionPrefill(id: string, actor: AuthenticatedUser): Promise<Record<string, unknown>> {
    const execution = await this.execution(id);
    if (actor.role === Role.OPERATOR && execution.assignedOperatorId && execution.assignedOperatorId !== actor.id) throw this.forbidden();
    return this.prefill(execution, actor);
  }

  async prepareExecution(id: string, dto: PrepareRvtExecutionDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    const execution = await this.execution(id);
    const operatorId = actor.role === Role.OPERATOR ? actor.id : dto.operatorId ?? execution.assignedOperatorId ?? execution.rvtPlan.defaultOperatorId ?? actor.id;
    if (actor.role === Role.OPERATOR && execution.assignedOperatorId && execution.assignedOperatorId !== actor.id) throw this.forbidden();
    if (execution.operationId) {
      await this.ensureExecutionAssignment(execution, operatorId, actor, context);
      return this.operations.get(execution.operationId, actor, context);
    }
    if (!execution.rvtPlan.active || execution.rvtPlan.status !== RvtPlanStatus.ACTIVE) throw this.invalid('Esta configuração de RVT não está ativa');
    const prefill = this.prefill(execution, actor);
    const selectedChecklist = (prefill.maintenanceChecklist as Array<{
      maintenanceType: OperationMaintenanceType;
      description: string;
      executed: boolean;
      result: 'YES' | 'NO';
      observations?: string | null;
    }>).map((item) => ({
      maintenanceType: item.maintenanceType,
      description: item.description,
      executed: item.executed,
      result: item.result,
      observations: item.observations ?? undefined,
    }));
    const otherType = execution.rvtPlan.maintenanceType === OperationMaintenanceType.WEEKLY
      ? OperationMaintenanceType.SEMIANNUAL
      : OperationMaintenanceType.WEEKLY;
    const complementaryChecklist = await this.prisma.technicalCatalog.findMany({
      where: {
        organizationId: execution.rvtPlan.organizationId,
        type: TechnicalCatalogType.CHECKLIST,
        active: true,
        deletedAt: null,
        maintenanceType: otherType,
        workflows: { has: TechnicalCatalogWorkflow.TECHNICAL_REPORT },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { title: true, description: true, maintenanceType: true },
    });
    const maintenanceChecklist = [
      ...selectedChecklist,
      ...complementaryChecklist.map((item) => ({
        maintenanceType: item.maintenanceType ?? otherType,
        description: item.title,
        executed: false,
        result: 'NO' as const,
        observations: item.description ?? undefined,
      })),
    ];
    return this.operations.create({
      customerId: execution.rvtPlan.customerId,
      addressId: execution.rvtPlan.addressId,
      equipmentId: execution.rvtPlan.equipments[0]?.equipmentId,
      inspectedEquipments: execution.rvtPlan.equipments.map((item) => ({ equipmentId: item.equipmentId })),
      operatorId,
      type: SYSTEM_SERVICE_TYPE_KEYS.PREVENTIVA,
      documentType: DocumentTemplateType.TECHNICAL_REPORT,
      status: 'DRAFT',
      scheduledFor: execution.scheduledAt.toISOString(),
      maintenanceType: execution.rvtPlan.maintenanceType,
      maintenanceChecklist,
      observations: execution.rvtPlan.observations ?? undefined,
    }, actor, context, async (tx, operationId) => {
      // OperationsService is the sole owner of the initial primary Assignment.
      // The RVT hook only links its planning aggregates to the created Operation;
      // creating it again violates Assignment(operationId, assignedTo).
      await tx.rvtExecution.update({ where: { id }, data: { operationId, assignedOperatorId: operatorId, status: RvtExecutionStatus.ASSIGNED } });
      await tx.maintenanceExecution.update({ where: { id: execution.maintenanceExecutionId }, data: { operationId, status: MaintenanceExecutionStatus.LINKED } });
      const signature = await tx.signature.findFirst({ where: { userId: execution.rvtPlan.responsibleTechnicianId, active: true, deletedAt: null, imageStorageKey: { not: null } }, select: { id: true } });
      if (!signature) throw this.invalid('O responsável técnico precisa possuir uma assinatura ativa');
      await tx.operationDocument.updateMany({ where: { operationId, type: DocumentTemplateType.TECHNICAL_REPORT }, data: { technicalSignatureId: signature.id } });
      await tx.auditLog.create({ data: this.audit('RVT_EXECUTION_PREPARED', actor, context, { rvtPlanId: execution.rvtPlanId, rvtExecutionId: id, operationId, operatorId }) });
    });
  }

  private async ensureExecutionAssignment(
    execution: RvtExecutionWithPlan,
    operatorId: string,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<void> {
    if (!execution.operationId) return;
    if (execution.status === RvtExecutionStatus.COMPLETED || execution.status === RvtExecutionStatus.CANCELED) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt-assignment:${execution.id}`}))`;
      const existing = await tx.assignment.findFirst({
        where: { operationId: execution.operationId!, isPrimary: true },
        select: { id: true },
      });
      if (existing) return;
      await this.assignments.createForOperationTx(tx, {
        operationId: execution.operationId!,
        assignedBy: actor.id,
        assignedTo: operatorId,
        notes: execution.rvtPlan.observations ?? null,
        isPrimary: true,
      }, actor.id, context);
      await tx.rvtExecution.update({
        where: { id: execution.id },
        data: { assignedOperatorId: operatorId, status: RvtExecutionStatus.ASSIGNED },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async registerAdHoc(operationId: string, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    const operation = await this.prisma.operation.findFirst({
      where: {
        id: operationId,
        operatorId: actor.id,
        requestedDocumentType: DocumentTemplateType.TECHNICAL_REPORT,
        status: 'COMPLETED',
      },
      include: {
        customer: { select: { name: true } },
        inspectedEquipments: { orderBy: { position: 'asc' }, select: { equipmentId: true } },
      },
    });
    if (!operation) {
      throw this.invalid('Somente um RVT avulso concluído pelo próprio técnico pode ser registrado');
    }
    if (!operation.addressId || !operation.inspectedEquipments.length) {
      throw this.invalid('O RVT precisa possuir endereço e ao menos um equipamento');
    }
    const addressId = operation.addressId;
    const existing = await this.prisma.rvtExecution.findUnique({
      where: { operationId },
      include: { rvtPlan: { include: PLAN_INCLUDE } },
    });
    if (existing) return existing.rvtPlan;

    const signature = await this.prisma.signature.findFirst({
      where: { userId: actor.id, active: true, deletedAt: null, imageStorageKey: { not: null } },
      select: { id: true, organizationId: true },
    });
    if (!signature) throw this.invalid('Cadastre sua assinatura técnica ativa antes de concluir o RVT');
    const occurredAt = operation.completedAt ?? new Date();
    const calendarDate = this.calendarDate(occurredAt.toISOString());
    const maintenanceType = operation.maintenanceType === OperationMaintenanceType.SEMIANNUAL
      ? OperationMaintenanceType.SEMIANNUAL
      : OperationMaintenanceType.WEEKLY;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:${operation.customerId}`}))`;
      const duplicate = await tx.rvtExecution.findUnique({ where: { operationId }, include: { rvtPlan: { include: PLAN_INCLUDE } } });
      if (duplicate) return duplicate.rvtPlan;
      const last = await tx.rvtPlan.aggregate({ where: { customerId: operation.customerId }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const maintenancePlan = await tx.maintenancePlan.create({ data: {
        equipmentId: operation.inspectedEquipments[0].equipmentId,
        name: `RVT ${operation.customer.name} ${String(number).padStart(4, '0')}`,
        description: operation.observations,
        type: MaintenancePlanType.INSPECTION,
        active: false,
        recurrenceRule: this.rule(maintenanceType) as unknown as Prisma.InputJsonValue,
        firstExecution: calendarDate,
        nextExecution: calendarDate,
        lastExecution: occurredAt,
        createdBy: actor.id,
      } });
      const plan = await tx.rvtPlan.create({ data: {
        organizationId: signature.organizationId,
        customerId: operation.customerId,
        addressId,
        maintenancePlanId: maintenancePlan.id,
        number,
        name: maintenancePlan.name,
        maintenanceType,
        startDate: calendarDate,
        endDate: calendarDate,
        responsibleTechnicianId: actor.id,
        defaultOperatorId: actor.id,
        status: RvtPlanStatus.COMPLETED,
        active: false,
        observations: operation.observations,
        createdBy: actor.id,
        equipments: { create: operation.inspectedEquipments.map((item, position) => ({ equipmentId: item.equipmentId, position })) },
      } });
      const maintenanceExecution = await tx.maintenanceExecution.create({ data: {
        maintenancePlanId: maintenancePlan.id,
        operationId,
        scheduledAt: calendarDate,
        executedAt: occurredAt,
        status: MaintenanceExecutionStatus.COMPLETED,
      } });
      await tx.rvtExecution.create({ data: {
        rvtPlanId: plan.id,
        maintenanceExecutionId: maintenanceExecution.id,
        operationId,
        executionNumber: 1,
        scheduledAt: calendarDate,
        assignedOperatorId: actor.id,
        status: RvtExecutionStatus.COMPLETED,
        startedAt: operation.startedAt,
        completedAt: occurredAt,
      } });
      await tx.operationDocument.updateMany({
        where: { operationId, type: DocumentTemplateType.TECHNICAL_REPORT, technicalSignatureId: null },
        data: { technicalSignatureId: signature.id },
      });
      await tx.auditLog.create({ data: this.audit('RVT_AD_HOC_REGISTERED', actor, context, { rvtPlanId: plan.id, operationId, number }) });
      return tx.rvtPlan.findUniqueOrThrow({ where: { id: plan.id }, include: PLAN_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private prefill(execution: Awaited<ReturnType<RvtPlanningService['execution']>>, actor: AuthenticatedUser): Record<string, unknown> {
    return {
      rvtPlanId: execution.rvtPlanId,
      rvtExecutionId: execution.id,
      executionNumber: execution.executionNumber,
      customerId: execution.rvtPlan.customerId,
      addressId: execution.rvtPlan.addressId,
      equipmentIds: execution.rvtPlan.equipments.map((item) => item.equipmentId),
      responsibleTechnician: execution.rvtPlan.responsibleTechnician,
      fieldTechnician: { id: actor.id, name: actor.name },
      maintenanceType: execution.rvtPlan.maintenanceType,
      maintenanceChecklist: execution.rvtPlan.checklists.map((item) => ({ templateId: item.technicalCatalogId, maintenanceType: execution.rvtPlan.maintenanceType, description: item.technicalCatalog.title, executed: true, result: 'YES', observations: item.technicalCatalog.description })),
      observations: execution.rvtPlan.observations,
      scheduledAt: execution.scheduledAt,
    };
  }

  private async execution(id: string): Promise<RvtExecutionWithPlan> {
    const value = await this.prisma.rvtExecution.findUnique({ where: { id }, include: EXECUTION_INCLUDE });
    if (!value) throw this.notFound('Execução RVT não encontrada');
    return value;
  }

  private async validateRelations(dto: Pick<CreateRvtPlanDto, 'customerId' | 'addressId' | 'equipmentIds' | 'checklistCatalogIds' | 'responsibleTechnicianId' | 'defaultOperatorId' | 'maintenanceType'>, partial = false): Promise<{ organizationId: string }> {
    const [organization, address, technician] = await Promise.all([
      this.prisma.organization.findFirst({ where: { isActive: true }, select: { id: true } }),
      this.prisma.customerAddress.findFirst({ where: { id: dto.addressId, customerId: dto.customerId }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { id: dto.responsibleTechnicianId, isActive: true, disabledAt: null, institutionalSignature: { active: true, deletedAt: null, imageStorageKey: { not: null } } }, select: { id: true } }),
    ]);
    if (!organization || !address) throw this.invalid('Cliente ou endereço inválido');
    if (!technician) throw this.invalid('Selecione um responsável técnico ativo com assinatura cadastrada');
    if (dto.defaultOperatorId) {
      const operator = await this.prisma.user.findFirst({ where: { id: dto.defaultOperatorId, isActive: true, disabledAt: null, role: { in: [Role.OWNER, Role.MANAGER, Role.OPERATOR] } }, select: { id: true } });
      if (!operator) throw this.invalid('O operador padrão não está disponível');
    }
    if (dto.equipmentIds.length || !partial) {
      const count = await this.prisma.equipment.count({ where: { id: { in: dto.equipmentIds }, customerId: dto.customerId, isActive: true, disabledAt: null } });
      if (count !== dto.equipmentIds.length) throw this.invalid('Um dos equipamentos não pertence ao cliente ou está inativo');
    }
    if (dto.checklistCatalogIds.length) {
      const count = await this.prisma.technicalCatalog.count({ where: { id: { in: dto.checklistCatalogIds }, type: TechnicalCatalogType.CHECKLIST, active: true, deletedAt: null, maintenanceType: dto.maintenanceType, workflows: { has: TechnicalCatalogWorkflow.TECHNICAL_REPORT } } });
      if (count !== dto.checklistCatalogIds.length) throw this.invalid('Um dos itens de checklist não pertence ao tipo de RVT selecionado');
    }
    return { organizationId: organization.id };
  }

  private occurrences(type: OperationMaintenanceType, start: Date, end: Date): Date[] {
    const result: Date[] = [];
    let cursor = start;
    while (cursor <= end && result.length <= 520) { result.push(cursor); cursor = this.recurrence.next(this.rule(type), cursor); }
    return result;
  }
  private rule(type: OperationMaintenanceType): RecurrenceRuleDto { return type === OperationMaintenanceType.WEEKLY ? { frequency: RecurrenceFrequency.WEEKLY, interval: 1 } : { frequency: RecurrenceFrequency.INTERVAL_MONTHS, interval: 6 }; }
  private calendarDate(value: string): Date { const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`); if (Number.isNaN(date.getTime())) throw this.invalid('Data inválida'); return date; }
  private assertSupportedType(type: OperationMaintenanceType): void { if (type !== OperationMaintenanceType.WEEKLY && type !== OperationMaintenanceType.SEMIANNUAL) throw this.invalid('RVT aceita somente periodicidade semanal ou semestral'); }
  private async ensurePlan(id: string): Promise<void> { if (!await this.prisma.rvtPlan.findUnique({ where: { id }, select: { id: true } })) throw this.notFound(); }
  private audit(action: string, actor: AuthenticatedUser, context: OperationAuditContext, metadata: Record<string, unknown>): Prisma.AuditLogUncheckedCreateInput { return { action, resource: 'RVT_PLAN', actor: actor.id, metadata: { requestId: context.requestId, ip: context.ip, userAgent: context.userAgent, ...metadata } }; }
  private invalid(message: string): ApplicationException { return new ApplicationException(ERROR_CODES.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST); }
  private notFound(message = 'Configuração de RVT não encontrada'): ApplicationException { return new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, message, HttpStatus.NOT_FOUND); }
  private forbidden(): ApplicationException { return new ApplicationException(ERROR_CODES.FORBIDDEN, 'Esta execução pertence a outro operador', HttpStatus.FORBIDDEN); }
}
