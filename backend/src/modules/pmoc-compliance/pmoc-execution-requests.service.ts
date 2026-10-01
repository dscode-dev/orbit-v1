import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DocumentTemplateType,
  MaintenanceChecklistResult,
  MaintenanceExecutionStatus,
  NotificationType,
  OperationMaintenanceType,
  OperationStatus,
  PmocExecutionOrigin,
  PmocExecutionRequestStatus,
  PmocGenerationMode,
  PmocHistoryAction,
  PmocOperationalStatus,
  PmocChecklistUnit,
  PmocPeriodicity,
  PmocSchedulerStatus,
  Prisma,
  Role,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import {
  PMOC_AUDIT_ACTIONS,
  PMOC_EXECUTION_REQUEST_RESOURCE,
  PMOC_MAX_PROCEDURE_IMAGES,
} from '../../shared/constants/pmoc.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RecurrenceRuleDto } from '../maintenance-planning/dto/maintenance-planning.dto';
import { RecurringEngine } from '../maintenance-planning/recurring-engine.service';
import type { CreateOperationDto } from '../operations/dto/operation.dto';
import { OperationsService, type OperationAuditContext } from '../operations/operations.service';
import type {
  CreatePmocExecutionRequestDto,
  GeneratePmocWorkOrderDto,
  ListPmocExecutionRequestsQueryDto,
  ReschedulePmocExecutionRequestDto,
} from './dto/pmoc-compliance.dto';

/**
 * Gerar uma execução programada mais do que este número de dias antes da data
 * prevista é considerado "adiantamento" e exige confirmação explícita, pois pode
 * quebrar o cronograma contratado do PMOC.
 */
const EARLY_GENERATION_THRESHOLD_DAYS = 10;

const REQUEST_INCLUDE = {
  equipment: {
    select: {
      id: true,
      name: true,
      tag: true,
      sector: true,
      manufacturer: true,
      model: true,
      capacity: true,
      status: true,
      address: { select: { id: true, name: true, street: true, number: true, city: true } },
    },
  },
  requester: { select: { id: true, name: true, username: true, role: true } },
  operation: {
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      scheduledFor: true,
      completedAt: true,
      signedAt: true,
      _count: { select: { photos: true } },
      operator: { select: { id: true, name: true, username: true, role: true, jobTitle: true } },
      documents: {
        where: { type: DocumentTemplateType.PMOC },
        select: {
          id: true,
          number: true,
          status: true,
          renderedAt: true,
          fileSize: true,
          revision: true,
          renderMetadata: true,
        },
        orderBy: [{ renderedAt: 'desc' as const }, { createdAt: 'desc' as const }],
        take: 1,
      },
    },
  },
  maintenanceExecution: {
    select: { id: true, scheduledAt: true, status: true, executedAt: true, operationId: true },
  },
  plannedOperator: { select: { id: true, name: true, username: true, role: true, jobTitle: true, isActive: true, disabledAt: true } },
  plannedTechnician: { select: { id: true, name: true, username: true, role: true, jobTitle: true, isActive: true, disabledAt: true } },
} satisfies Prisma.PmocExecutionRequestInclude;

const PLAN_FOR_EXECUTION_INCLUDE = {
  customer: {
    include: {
      addresses: { orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
    },
  },
  equipment: { include: { address: true } },
  equipments: {
    include: { equipment: { include: { address: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  checklists: {
    include: {
      technicalCatalog: {
        select: { id: true, title: true, active: true, maintenanceType: true },
      },
    },
    orderBy: { position: 'asc' as const },
  },
  maintenancePlan: true,
  defaultOperator: { select: { id: true, role: true, isActive: true, disabledAt: true } },
  defaultTechnician: { select: { id: true, role: true, isActive: true, disabledAt: true } },
} satisfies Prisma.PmocPlanInclude;

const REQUEST_WITH_PLAN_INCLUDE = {
  ...REQUEST_INCLUDE,
  pmocPlan: { include: PLAN_FOR_EXECUTION_INCLUDE },
} satisfies Prisma.PmocExecutionRequestInclude;

type PlanForExecution = Prisma.PmocPlanGetPayload<{
  include: typeof PLAN_FOR_EXECUTION_INCLUDE;
}>;
type RequestWithPlan = Prisma.PmocExecutionRequestGetPayload<{
  include: typeof REQUEST_WITH_PLAN_INCLUDE;
}>;
type PmocUnitChecklistItem = {
  id: string;
  title: string;
  pmocUnit: PmocChecklistUnit;
  maintenanceType: OperationMaintenanceType | null;
};

@Injectable()
export class PmocExecutionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsService,
    private readonly notifications: NotificationsService,
    private readonly recurrence: RecurringEngine,
  ) {}

  async list(
    pmocPlanId: string,
    query: ListPmocExecutionRequestsQueryDto,
  ): Promise<unknown> {
    await this.planOrThrow(pmocPlanId);
    const where: Prisma.PmocExecutionRequestWhereInput = {
      pmocPlanId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pmocExecutionRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.pmocExecutionRequest.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<unknown> {
    return this.requestOrThrow(id);
  }

  async history(pmocPlanId: string): Promise<unknown> {
    const plan = await this.planOrThrow(pmocPlanId);
    const requests = await this.prisma.pmocExecutionRequest.findMany({
      where: { pmocPlanId },
      include: {
        operation: {
          select: {
            id: true,
            number: true,
            status: true,
            completedAt: true,
            operator: {
              select: { id: true, name: true, username: true, role: true, jobTitle: true },
            },
          },
        },
        maintenanceExecution: {
          select: { id: true, status: true, scheduledAt: true, executedAt: true },
        },
        plannedTechnician: {
          select: { id: true, name: true, username: true, role: true, jobTitle: true },
        },
      },
      orderBy: { executionNumber: 'asc' },
      take: 500,
    });
    const operationIds = requests
      .map((request) => request.operationId)
      .filter((id): id is string => Boolean(id));
    const [events, assignmentEvents, documents, signatureAudits] = await this.prisma.$transaction([
      this.prisma.pmocHistory.findMany({
        where: { pmocPlanId },
        include: {
          actor: { select: { id: true, name: true, username: true, role: true } },
          operation: { select: { id: true, number: true, type: true, status: true } },
          executionRequest: {
            include: {
              operation: {
                select: {
                  id: true,
                  number: true,
                  status: true,
                  completedAt: true,
                  operator: {
                    select: { id: true, name: true, username: true, role: true, jobTitle: true },
                  },
                },
              },
              maintenanceExecution: {
                select: { id: true, status: true, scheduledAt: true, executedAt: true },
              },
              plannedTechnician: {
                select: { id: true, name: true, username: true, role: true, jobTitle: true },
              },
            },
          },
          pmocPlan: {
            select: {
              defaultTechnician: {
                select: { id: true, name: true, username: true, role: true, jobTitle: true },
              },
              responsibleTechnician: true,
            },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      this.prisma.assignmentHistory.findMany({
        where: { operationId: { in: operationIds } },
        include: {
          actor: { select: { id: true, name: true, username: true, role: true } },
          operation: { select: { id: true, number: true, type: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      this.prisma.operationDocument.findMany({
        where: {
          operationId: { in: operationIds },
          type: DocumentTemplateType.PMOC,
          renderedAt: { not: null },
        },
        select: {
          id: true,
          operationId: true,
          number: true,
          status: true,
          renderedAt: true,
          createdAt: true,
        },
        orderBy: [{ renderedAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      this.prisma.auditLog.findMany({
        where: {
          resource: 'OPERATION',
          action: 'OPERATION_UPDATED',
          ...(operationIds.length
            ? {
                OR: operationIds.map((operationId) => ({
                  metadata: { path: ['operationId'], equals: operationId },
                })),
              }
            : { id: { in: [] } }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
    ]);
    const requestByOperation = new Map(
      requests
        .filter((request) => request.operationId)
        .map((request) => [request.operationId as string, request]),
    );
    const execution = (
      request: (typeof requests)[number] | undefined,
    ): Record<string, unknown> | null =>
      request
        ? {
            executionNumber: request.executionNumber,
            equipmentExecutionNumber: request.equipmentExecutionNumber,
            executionYear: request.executionYear,
            workOrderNumber: request.operation?.number ?? null,
            status: request.status,
            scheduledFor: request.scheduledFor,
            generatedAt: request.generatedAt,
            executedAt: request.maintenanceExecution?.executedAt ?? null,
            operator: request.operation?.operator ?? null,
            responsibleTechnician:
              request.plannedTechnician ??
              plan.defaultTechnician ??
              plan.responsibleTechnician,
          }
        : null;
    const official = events.map((event) => ({
      ...event,
      source: 'PMOC',
      execution: event.executionRequest
          ? {
            executionNumber: event.executionRequest.executionNumber,
            equipmentExecutionNumber: event.executionRequest.equipmentExecutionNumber,
            executionYear: event.executionRequest.executionYear,
            workOrderNumber: event.executionRequest.operation?.number ?? null,
            status: event.executionRequest.status,
            scheduledFor: event.executionRequest.scheduledFor,
            generatedAt: event.executionRequest.generatedAt,
            executedAt: event.executionRequest.maintenanceExecution?.executedAt ?? null,
            operator: event.executionRequest.operation?.operator ?? null,
            responsibleTechnician:
              event.executionRequest.plannedTechnician ??
              event.pmocPlan.defaultTechnician ??
              event.pmocPlan.responsibleTechnician,
          }
        : null,
    }));
    const assignments = assignmentEvents.map((event) => ({
      id: `assignment:${event.id}`,
      pmocPlanId,
      executionRequestId: requestByOperation.get(event.operationId)?.id ?? null,
      operationId: event.operationId,
      actorId: event.actorId,
      actor: event.actor,
      operation: event.operation,
      action: `ASSIGNMENT_${event.event}`,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      notes: event.notes,
      metadata: { assignmentId: event.assignmentId },
      occurredAt: event.createdAt,
      createdAt: event.createdAt,
      source: 'ASSIGNMENT',
      execution: execution(requestByOperation.get(event.operationId)),
    }));
    const rendered = documents.map((document) => ({
      id: `document:${document.id}`,
      pmocPlanId,
      executionRequestId: document.operationId
        ? requestByOperation.get(document.operationId)?.id ?? null
        : null,
      operationId: document.operationId,
      actorId: null,
      actor: null,
      operation: null,
      action: 'DOCUMENT_RENDERED',
      previousStatus: null,
      newStatus: document.status,
      notes: `Documento ${document.number} emitido pelo Document Engine`,
      metadata: { documentId: document.id, documentNumber: document.number },
      occurredAt: document.renderedAt ?? document.createdAt,
      createdAt: document.createdAt,
      source: 'DOCUMENT',
      document: {
        id: document.id,
        number: document.number,
        status: document.status,
        renderedAt: document.renderedAt,
      },
      execution: execution(
        document.operationId ? requestByOperation.get(document.operationId) : undefined,
      ),
    }));
    const signed = signatureAudits
      .filter((audit) => {
        const metadata = audit.metadata as { changedFields?: unknown } | null;
        return Array.isArray(metadata?.changedFields) && metadata.changedFields.includes('signatureData');
      })
      .map((audit) => {
        const metadata = audit.metadata as { operationId?: string } | null;
        const operationId = metadata?.operationId ?? null;
        return {
          id: `signature:${audit.id}`,
          pmocPlanId,
          executionRequestId: operationId
            ? requestByOperation.get(operationId)?.id ?? null
            : null,
          operationId,
          actorId: audit.actor,
          actor: null,
          operation: null,
          action: 'CLIENT_SIGNED',
          previousStatus: null,
          newStatus: 'SIGNED',
          notes: 'Assinatura do cliente registrada na execução',
          metadata: {},
          occurredAt: audit.createdAt,
          createdAt: audit.createdAt,
          source: 'AUDIT',
          execution: execution(
            operationId ? requestByOperation.get(operationId) : undefined,
          ),
        };
      });
    return [...official, ...assignments, ...rendered, ...signed]
      .sort((left, right) => {
        const byDate = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
        return byDate || right.id.localeCompare(left.id);
      })
      .slice(0, 500);
  }

  async create(
    pmocPlanId: string,
    dto: CreatePmocExecutionRequestDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    const plan = await this.planOrThrow(pmocPlanId);
    this.assertPlanIsOperational(plan);
    const scheduledFor = dto.scheduledFor
      ? new Date(dto.scheduledFor)
      : plan.maintenancePlan.nextExecution;
    const equipmentId = dto.equipmentId ?? plan.equipmentId;
    this.assertEquipmentCovered(plan, equipmentId);
    return this.createForSchedule(
      plan,
      scheduledFor,
      actor.id,
      context,
      dto.notes,
      equipmentId,
    );
  }

  async prefill(id: string, actor: AuthenticatedUser): Promise<CreateOperationDto> {
    const request = await this.requestWithPlanOrThrow(id);
    this.assertRequestCanGenerate(request.status);
    this.assertOperatorCanClaim(request, actor);
    const unitChecklist = await this.loadPmocUnitChecklist(request.pmocPlan.organizationId);
    return this.buildOperationPayload(
      request.pmocPlan,
      request.scheduledFor,
      actor,
      unitChecklist,
      undefined,
      request,
    );
  }

  async generate(
    id: string,
    dto: GeneratePmocWorkOrderDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
    origin: PmocExecutionOrigin = PmocExecutionOrigin.MANUAL,
  ): Promise<unknown> {
    const request = await this.requestWithPlanOrThrow(id);
    this.assertRequestCanGenerate(request.status);
    this.assertOperatorCanClaim(request, actor);
    this.assertPlanIsOperational(request.pmocPlan);
    if ((dto.operation?.photos?.length ?? 0) > PMOC_MAX_PROCEDURE_IMAGES) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        `A execução PMOC permite no máximo ${PMOC_MAX_PROCEDURE_IMAGES} evidências fotográficas`,
        HttpStatus.BAD_REQUEST,
        {
          maximum: PMOC_MAX_PROCEDURE_IMAGES,
          current: dto.operation?.photos?.length ?? 0,
        },
      );
    }
    // Adiantamento: bloqueia gerar uma execução muito antes do previsto sem
    // confirmação explícita; quando confirmado, é registrado no histórico do PMOC.
    const daysEarly = this.earlyGenerationDays(request.scheduledFor);
    const isEarly = daysEarly > EARLY_GENERATION_THRESHOLD_DAYS;
    if (isEarly && !dto.allowEarly) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EXECUTION_TOO_EARLY,
        `A execução ${String(request.executionNumber).padStart(3, '0')} está prevista para ${request.scheduledFor.toLocaleDateString('pt-BR')} (${daysEarly} dias no futuro). Adiantar pode quebrar o cronograma contratado do PMOC.`,
        HttpStatus.CONFLICT,
        {
          daysEarly,
          thresholdDays: EARLY_GENERATION_THRESHOLD_DAYS,
          executionNumber: request.executionNumber,
          scheduledFor: request.scheduledFor.toISOString(),
        },
      );
    }
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.pmocExecutionRequest.updateMany({
        where: {
          id,
          status: { in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED] },
        },
        data: {
          status: PmocExecutionRequestStatus.GENERATING_OS,
          origin,
          requestedBy: actor.id,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          failureReason: null,
        },
      });
      if (result.count !== 1) return false;
      await tx.pmocHistory.createMany({
        data: [
          ...(request.status === PmocExecutionRequestStatus.FAILED
            ? [
                {
                  pmocPlanId: request.pmocPlanId,
                  executionRequestId: id,
                  actorId: actor.id,
                  action: PmocHistoryAction.REQUEST_RETRY,
                  previousStatus: request.status,
                  newStatus: PmocExecutionRequestStatus.GENERATING_OS,
                  notes: 'Nova tentativa preservando a identidade da execução.',
                  metadata: { executionNumber: request.executionNumber, origin },
                },
              ]
            : []),
          {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            actorId: actor.id,
            action: PmocHistoryAction.REQUEST_GENERATING_OS,
            previousStatus: request.status,
            newStatus: PmocExecutionRequestStatus.GENERATING_OS,
            notes:
              origin === PmocExecutionOrigin.AUTO
                ? 'Geração automática iniciada.'
                : 'Geração manual confirmada no wizard oficial.',
            metadata: { executionNumber: request.executionNumber, origin },
          },
        ],
      });
      await tx.auditLog.create({
        data: this.audit(
          PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_GENERATING,
          actor.id,
          context,
          {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            executionNumber: request.executionNumber,
            origin,
          },
        ),
      });
      if (request.status === PmocExecutionRequestStatus.FAILED) {
        await tx.auditLog.create({
          data: this.audit(PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_RETRIED, actor.id, context, {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            executionNumber: request.executionNumber,
            origin,
          }),
        });
      }
      return true;
    });
    if (!claimed) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EXECUTION_REQUEST_CONFLICT,
        'Esta execução já está sendo processada',
        HttpStatus.CONFLICT,
      );
    }

    try {
      const unitChecklist = await this.loadPmocUnitChecklist(request.pmocPlan.organizationId);
      const authoritative = this.buildOperationPayload(
        request.pmocPlan,
        request.scheduledFor,
        actor,
        unitChecklist,
        dto.operation,
        request,
      );
      await this.operations.create(authoritative, actor, context, async (tx, operationId) => {
        const now = new Date();
        let executionId = request.maintenanceExecutionId;
        if (!executionId) {
          const execution = await tx.maintenanceExecution.create({
            data: {
              maintenancePlanId: request.pmocPlan.maintenancePlanId,
              scheduledAt: request.scheduledFor,
              status: MaintenanceExecutionStatus.PLANNED,
              notes: 'Execução criada pela solicitação oficial do PMOC.',
            },
            select: { id: true },
          });
          executionId = execution.id;
        }
        await tx.maintenanceExecution.update({
          where: { id: executionId },
          data: { operationId, status: MaintenanceExecutionStatus.LINKED },
        });
        await tx.pmocExecutionRequest.update({
          where: { id },
          data: {
            maintenanceExecutionId: executionId,
            operationId,
            generatedOperationId: operationId,
            status: PmocExecutionRequestStatus.GENERATED,
            generatedAt: now,
            failureReason: null,
          },
        });
        const nextExecution = this.recurrence.next(
          request.pmocPlan.maintenancePlan.recurrenceRule as unknown as RecurrenceRuleDto,
          request.scheduledFor,
        );
        await tx.maintenancePlan.update({
          where: { id: request.pmocPlan.maintenancePlanId },
          data: { nextExecution },
        });
        await tx.$executeRaw`
          UPDATE "pmoc_plans"
          SET
            "last_generated_execution_number" = GREATEST(
              "last_generated_execution_number",
              ${request.executionNumber}
            ),
            "last_successful_generation" = ${now},
            "operational_status" = 'ACTIVE'::"PmocOperationalStatus",
            "updated_at" = ${now}
          WHERE "id" = ${request.pmocPlanId}::uuid
        `;
        await tx.pmocHistory.create({
          data: {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            operationId,
            actorId: actor.id,
            action:
              origin === PmocExecutionOrigin.AUTO
                ? PmocHistoryAction.OS_GENERATED_AUTO
                : PmocHistoryAction.OS_GENERATED_MANUAL,
            previousStatus: PmocExecutionRequestStatus.GENERATING_OS,
            newStatus: PmocExecutionRequestStatus.GENERATED,
            notes: 'Ordem de Serviço criada pelo workflow oficial de Operations.',
            metadata: { executionNumber: request.executionNumber, origin },
          },
        });
        await tx.auditLog.create({
          data: this.audit(PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_GENERATED, actor.id, context, {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            operationId,
            origin,
          }),
        });
        // Registro/controle de adiantamento: fica no histórico do PMOC (visível
        // na plataforma) e na auditoria.
        if (isEarly) {
          await tx.pmocHistory.create({
            data: {
              pmocPlanId: request.pmocPlanId,
              executionRequestId: id,
              operationId,
              actorId: actor.id,
              action: PmocHistoryAction.REQUEST_EARLY_GENERATION,
              previousStatus: PmocExecutionRequestStatus.GENERATING_OS,
              newStatus: PmocExecutionRequestStatus.GENERATED,
              notes: `Execução adiantada em ${daysEarly} dias em relação ao previsto (${request.scheduledFor.toLocaleDateString('pt-BR')}). Confirmada por ${actor.name}.`,
              metadata: {
                executionNumber: request.executionNumber,
                daysEarly,
                thresholdDays: EARLY_GENERATION_THRESHOLD_DAYS,
                scheduledFor: request.scheduledFor.toISOString(),
                origin,
              },
            },
          });
          await tx.auditLog.create({
            data: this.audit(PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_EARLY, actor.id, context, {
              pmocPlanId: request.pmocPlanId,
              executionRequestId: id,
              operationId,
              executionNumber: request.executionNumber,
              daysEarly,
            }),
          });
        }
        await this.notifications.notifyPmocExecutionTx(
          tx,
          id,
          NotificationType.PMOC_OS_GENERATED,
        );
        // Fim da cobertura é exclusivo: não reserva execução que caia exatamente
        // no endDate (evita a 13ª execução num período de 1 ano).
        if (
          request.equipmentExecutionNumber < request.pmocPlan.plannedExecutionCount &&
          nextExecution < request.pmocPlan.endDate
        ) {
          const existingNextRequest = await tx.pmocExecutionRequest.findUnique({
            where: {
              pmocPlanId_equipmentId_scheduledFor: {
                pmocPlanId: request.pmocPlanId,
                equipmentId: request.equipmentId,
                scheduledFor: nextExecution,
              },
            },
            select: { id: true },
          });
          if (!existingNextRequest) {
            const nextEquipmentExecutionNumber = await this.reserveEquipmentExecutionNumberTx(
              tx,
              request.pmocPlanId,
              request.equipmentId,
              request.pmocPlan.plannedExecutionCount,
            );
            const nextExecutionNumber = await this.reserveExecutionNumberTx(
              tx,
              request.pmocPlanId,
            );
            const nextMaintenance = await tx.maintenanceExecution.create({
              data: {
                maintenancePlanId: request.pmocPlan.maintenancePlanId,
                scheduledAt: nextExecution,
                notes: 'Próxima execução planejada automaticamente pelo PMOC.',
              },
              select: { id: true },
            });
            const nextRequest = await tx.pmocExecutionRequest.create({
              data: {
                pmocPlanId: request.pmocPlanId,
                equipmentId: request.equipmentId,
                maintenanceExecutionId: nextMaintenance.id,
                executionNumber: nextExecutionNumber,
                equipmentExecutionNumber: nextEquipmentExecutionNumber,
                executionYear: nextExecution.getUTCFullYear(),
                plannedOperatorId: request.pmocPlan.defaultOperatorId,
                plannedTechnicianId: request.pmocPlan.defaultTechnicianId,
                scheduledFor: nextExecution,
                origin:
                  request.pmocPlan.generationMode === PmocGenerationMode.AUTO
                    ? PmocExecutionOrigin.AUTO
                    : PmocExecutionOrigin.MANUAL,
              },
              select: { id: true },
            });
            await tx.pmocHistory.create({
              data: {
                pmocPlanId: request.pmocPlanId,
                executionRequestId: nextRequest.id,
                action:
                  request.pmocPlan.generationMode === PmocGenerationMode.AUTO
                    ? PmocHistoryAction.REQUEST_CREATED_AUTO
                    : PmocHistoryAction.REQUEST_CREATED_MANUAL,
                newStatus: PmocExecutionRequestStatus.PENDING,
                notes: 'Próxima solicitação calculada pelo RecurringEngine.',
                metadata: {
                  executionNumber: nextExecutionNumber,
                  equipmentExecutionNumber: nextEquipmentExecutionNumber,
                  equipmentId: request.equipmentId,
                  scheduledFor: nextExecution.toISOString(),
                },
              },
            });
            await tx.auditLog.create({
              data: this.audit(
                request.pmocPlan.generationMode === PmocGenerationMode.AUTO
                  ? PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CREATED_AUTO
                  : PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CREATED_MANUAL,
                actor.id,
                context,
                {
                  pmocPlanId: request.pmocPlanId,
                  executionRequestId: nextRequest.id,
                  executionNumber: nextExecutionNumber,
                  equipmentExecutionNumber: nextEquipmentExecutionNumber,
                  equipmentId: request.equipmentId,
                  scheduledFor: nextExecution.toISOString(),
                },
              ),
            });
          }
        }
        await this.syncPlanScheduleTx(tx, request.pmocPlanId);
      });
    } catch (cause) {
      await this.markFailed(id, request.pmocPlanId, actor.id, context, cause);
      throw new ApplicationException(
        ERROR_CODES.PMOC_GENERATION_FAILED,
        'Não foi possível gerar a Ordem de Serviço do PMOC; a solicitação segue registrada',
        HttpStatus.CONFLICT,
      );
    }
    return this.requestOrThrow(id);
  }

  async cancel(
    id: string,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    const request = await this.requestWithPlanOrThrow(id);
    if (
      request.status !== PmocExecutionRequestStatus.PENDING &&
      request.status !== PmocExecutionRequestStatus.FAILED
    ) {
      throw this.invalidState('Only pending or failed requests can be cancelled');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.pmocExecutionRequest.update({
        where: { id },
        data: { status: PmocExecutionRequestStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (request.maintenanceExecutionId) {
        await tx.maintenanceExecution.update({
          where: { id: request.maintenanceExecutionId },
          data: { status: MaintenanceExecutionStatus.CANCELED },
        });
      }
      await tx.pmocHistory.create({
        data: {
          pmocPlanId: request.pmocPlanId,
          executionRequestId: id,
          actorId: actor.id,
          action: PmocHistoryAction.REQUEST_CANCELLED,
          previousStatus: request.status,
          newStatus: PmocExecutionRequestStatus.CANCELLED,
          metadata: { executionNumber: request.executionNumber },
        },
      });
      await tx.auditLog.create({
        data: this.audit(PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CANCELLED, actor.id, context, {
          pmocPlanId: request.pmocPlanId,
          executionRequestId: id,
        }),
      });
      await this.syncPlanScheduleTx(tx, request.pmocPlanId);
    });
    return this.requestOrThrow(id);
  }

  async reschedule(
    id: string,
    dto: ReschedulePmocExecutionRequestDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    const request = await this.requestWithPlanOrThrow(id);
    if (
      request.status !== PmocExecutionRequestStatus.PENDING &&
      request.status !== PmocExecutionRequestStatus.FAILED
    ) {
      throw this.invalidState('Only pending or failed requests can be rescheduled');
    }
    const scheduledFor = new Date(dto.scheduledFor);
    if (scheduledFor < request.pmocPlan.startDate || scheduledFor > request.pmocPlan.endDate) {
      throw this.invalidState('Execution date must remain inside the PMOC coverage period');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.pmocExecutionRequest.update({
          where: { id },
          data: {
            scheduledFor,
            executionYear: scheduledFor.getUTCFullYear(),
            failureReason: null,
          },
        });
        if (request.maintenanceExecutionId) {
          await tx.maintenanceExecution.update({
            where: { id: request.maintenanceExecutionId },
            data: { scheduledAt: scheduledFor },
          });
        }
        await tx.pmocHistory.create({
          data: {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            actorId: actor.id,
            action: PmocHistoryAction.REQUEST_RESCHEDULED,
            previousStatus: request.status,
            newStatus: request.status,
            notes: dto.notes ? this.safeText(dto.notes) : null,
            metadata: {
              executionNumber: request.executionNumber,
              previousScheduledFor: request.scheduledFor.toISOString(),
              scheduledFor: scheduledFor.toISOString(),
            },
          },
        });
        await tx.auditLog.create({
          data: this.audit(PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_RESCHEDULED, actor.id, context, {
            pmocPlanId: request.pmocPlanId,
            executionRequestId: id,
            executionNumber: request.executionNumber,
            previousScheduledFor: request.scheduledFor.toISOString(),
            scheduledFor: scheduledFor.toISOString(),
          }),
        });
        await this.syncPlanScheduleTx(tx, request.pmocPlanId);
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw this.invalidState('Another execution is already scheduled for this date');
      }
      throw cause;
    }
    return this.requestOrThrow(id);
  }

  async createForSchedule(
    plan: PlanForExecution,
    _scheduledFor: Date,
    actorId: string | null,
    context: OperationAuditContext,
    notes?: string,
    equipmentId: string = plan.equipmentId,
  ): Promise<unknown> {
    this.assertEquipmentCovered(plan, equipmentId);
    const existing = await this.prisma.pmocExecutionRequest.findFirst({
      where: {
        pmocPlanId: plan.id,
        equipmentId,
        operationId: null,
        status: {
          in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED],
        },
      },
      include: REQUEST_INCLUDE,
      orderBy: [{ equipmentExecutionNumber: 'asc' }, { scheduledFor: 'asc' }],
    });
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "pmoc_plan_equipments"
          WHERE "pmoc_plan_id" = ${plan.id}::uuid
            AND "equipment_id" = ${equipmentId}::uuid
          FOR UPDATE
        `;
        const concurrentOpenRequest = await tx.pmocExecutionRequest.findFirst({
          where: {
            pmocPlanId: plan.id,
            equipmentId,
            operationId: null,
            status: {
              in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED],
            },
          },
          include: REQUEST_INCLUDE,
          orderBy: [{ equipmentExecutionNumber: 'asc' }, { scheduledFor: 'asc' }],
        });
        if (concurrentOpenRequest) return concurrentOpenRequest;
        const equipmentExecutionNumber = await this.reserveEquipmentExecutionNumberTx(
          tx,
          plan.id,
          equipmentId,
          plan.plannedExecutionCount,
        );
        const officialScheduledFor = this.recurrence.occurrenceAt(
          plan.maintenancePlan.recurrenceRule as unknown as RecurrenceRuleDto,
          plan.startDate,
          equipmentExecutionNumber,
        );
        const executionNumber = await this.reserveExecutionNumberTx(tx, plan.id);
        const execution = await tx.maintenanceExecution.create({
          data: {
            maintenancePlanId: plan.maintenancePlanId,
            scheduledAt: officialScheduledFor,
            notes: notes ?? 'Execução planejada pela fundação PMOC.',
          },
          select: { id: true },
        });
        const request = await tx.pmocExecutionRequest.create({
          data: {
            pmocPlanId: plan.id,
            equipmentId,
            maintenanceExecutionId: execution.id,
            executionNumber,
            equipmentExecutionNumber,
            executionYear: officialScheduledFor.getUTCFullYear(),
            scheduledFor: officialScheduledFor,
            requestedBy: actorId,
            plannedOperatorId: plan.defaultOperatorId,
            plannedTechnicianId: plan.defaultTechnicianId,
            origin:
              plan.generationMode === PmocGenerationMode.AUTO
                ? PmocExecutionOrigin.AUTO
                : PmocExecutionOrigin.MANUAL,
          },
          include: REQUEST_INCLUDE,
        });
        await tx.pmocHistory.create({
          data: {
            pmocPlanId: plan.id,
            executionRequestId: request.id,
            actorId,
            action:
              plan.generationMode === PmocGenerationMode.AUTO
                ? PmocHistoryAction.REQUEST_CREATED_AUTO
                : PmocHistoryAction.REQUEST_CREATED_MANUAL,
            newStatus: PmocExecutionRequestStatus.PENDING,
            notes: notes ?? null,
            metadata: {
              executionNumber,
              equipmentExecutionNumber,
              equipmentId,
              scheduledFor: officialScheduledFor.toISOString(),
              generationMode: plan.generationMode,
            },
          },
        });
        await tx.auditLog.create({
          data: this.audit(
            plan.generationMode === PmocGenerationMode.AUTO
              ? PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CREATED_AUTO
              : PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CREATED_MANUAL,
            actorId,
            context,
            {
              pmocPlanId: plan.id,
              executionRequestId: request.id,
              executionNumber,
              equipmentExecutionNumber,
              equipmentId,
              scheduledFor: officialScheduledFor.toISOString(),
            },
          ),
        });
        if (
          plan.generationMode === PmocGenerationMode.MANUAL &&
          officialScheduledFor.getTime() <= Date.now()
        ) {
          await this.notifications.notifyPmocExecutionTx(
            tx,
            request.id,
            NotificationType.PMOC_EXECUTION_PENDING_MANUAL,
          );
        }
        await this.syncPlanScheduleTx(tx, plan.id);
        return request;
      });
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === 'P2002'
      ) {
        const concurrent = await this.prisma.pmocExecutionRequest.findFirst({
          where: {
            pmocPlanId: plan.id,
            equipmentId,
            operationId: null,
            status: {
              in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED],
            },
          },
          include: REQUEST_INCLUDE,
          orderBy: [{ equipmentExecutionNumber: 'asc' }, { scheduledFor: 'asc' }],
        });
        if (concurrent) return concurrent;
      }
      throw cause;
    }
  }

  async dueAutoRequests(limit: number): Promise<Array<{ id: string; pmocPlanId: string }>> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return this.prisma.pmocExecutionRequest.findMany({
      where: {
        status: PmocExecutionRequestStatus.PENDING,
        scheduledFor: { lte: new Date() },
        pmocPlan: {
          active: true,
          generationMode: PmocGenerationMode.AUTO,
          endDate: { gte: today },
        },
      },
      select: { id: true, pmocPlanId: true },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async reconcileCoverageStatuses(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.$queryRaw<
        Array<{
          id: string;
          maintenancePlanId: string;
          operationalStatus: PmocOperationalStatus;
        }>
      >`
        WITH projection AS (
          SELECT
            plan."id",
            plan."maintenance_plan_id",
            plan."planned_execution_count",
            NOT EXISTS (
              SELECT 1
              FROM "pmoc_plan_equipments" covered
              WHERE covered."pmoc_plan_id" = plan."id"
                AND (
                  SELECT COUNT(*)
                  FROM "pmoc_execution_requests" request
                  JOIN "maintenance_executions" execution
                    ON execution."id" = request."maintenance_execution_id"
                  WHERE request."pmoc_plan_id" = plan."id"
                    AND request."equipment_id" = covered."equipment_id"
                    AND execution."status" = 'COMPLETED'::"MaintenanceExecutionStatus"
                ) < plan."planned_execution_count"
            ) AS "all_completed"
          FROM "pmoc_plans" plan
          WHERE plan."active" = TRUE
            AND plan."end_date" < CURRENT_DATE
        )
        UPDATE "pmoc_plans" plan
        SET
          "operational_status" = CASE
            WHEN projection."all_completed"
              THEN 'COMPLETED'::"PmocOperationalStatus"
            ELSE 'OVERDUE'::"PmocOperationalStatus"
          END,
          "active" = NOT projection."all_completed",
          "next_execution_date" = CASE
            WHEN projection."all_completed" THEN NULL
            ELSE plan."next_execution_date"
          END,
          "next_generation_date" = CASE
            WHEN projection."all_completed" THEN NULL
            ELSE plan."next_generation_date"
          END,
          "updated_at" = CURRENT_TIMESTAMP
        FROM projection
        WHERE plan."id" = projection."id"
          AND (
            plan."operational_status" IS DISTINCT FROM CASE
              WHEN projection."all_completed"
                THEN 'COMPLETED'::"PmocOperationalStatus"
              ELSE 'OVERDUE'::"PmocOperationalStatus"
            END
            OR plan."active" IS DISTINCT FROM NOT projection."all_completed"
          )
        RETURNING
          plan."id",
          plan."maintenance_plan_id" AS "maintenancePlanId",
          plan."operational_status" AS "operationalStatus"
      `;
      const completedMaintenancePlanIds = changed
        .filter((item) => item.operationalStatus === PmocOperationalStatus.COMPLETED)
        .map((item) => item.maintenancePlanId);
      if (completedMaintenancePlanIds.length) {
        await tx.maintenancePlan.updateMany({
          where: { id: { in: completedMaintenancePlanIds } },
          data: { active: false },
        });
      }
      return changed.length;
    });
  }

  async notifyDueManualRequests(limit: number): Promise<number> {
    const due = await this.prisma.pmocExecutionRequest.findMany({
      where: {
        status: PmocExecutionRequestStatus.PENDING,
        scheduledFor: { lte: new Date() },
        pmocPlan: { active: true, generationMode: PmocGenerationMode.MANUAL },
      },
      select: { id: true },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const request of due) {
      await this.prisma.$transaction((tx) =>
        this.notifications.notifyPmocExecutionTx(
          tx,
          request.id,
          NotificationType.PMOC_EXECUTION_PENDING_MANUAL,
        ),
      );
    }
    return due.length;
  }

  async recoverStaleGenerating(cutoff: Date): Promise<number> {
    const stale = await this.prisma.pmocExecutionRequest.findMany({
      where: {
        status: PmocExecutionRequestStatus.GENERATING_OS,
        lastAttemptAt: { lt: cutoff },
        operationId: null,
      },
      select: { id: true, pmocPlanId: true, requestedBy: true },
      take: 100,
    });
    for (const request of stale) {
      await this.markFailed(
        request.id,
        request.pmocPlanId,
        request.requestedBy,
        { requestId: 'pmoc-scheduler-recovery', ip: null, userAgent: null },
        new Error('Generation lease expired before an Operation was committed'),
      );
    }
    return stale.length;
  }

  async planForScheduler(id: string): Promise<PlanForExecution> {
    return this.planOrThrow(id);
  }

  async beginSchedulerRun(runAt: Date): Promise<void> {
    const runDate = new Date(
      Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth(), runAt.getUTCDate()),
    );
    await this.prisma.pmocPlan.updateMany({
      where: {
        active: true,
        generationMode: PmocGenerationMode.AUTO,
        endDate: { gte: runDate },
      },
      data: {
        lastSchedulerRun: runAt,
        lastSchedulerStatus: PmocSchedulerStatus.RUNNING,
        lastSchedulerError: null,
      },
    });
  }

  async completeIdleSchedulerRuns(processedPmocPlanIds: string[], runAt: Date): Promise<void> {
    await this.prisma.pmocPlan.updateMany({
      where: {
        lastSchedulerRun: runAt,
        lastSchedulerStatus: PmocSchedulerStatus.RUNNING,
        ...(processedPmocPlanIds.length
          ? { id: { notIn: [...new Set(processedPmocPlanIds)] } }
          : {}),
      },
      data: { lastSchedulerStatus: PmocSchedulerStatus.SUCCESS },
    });
  }

  async markSchedulerResult(
    pmocPlanId: string,
    status: typeof PmocSchedulerStatus.SUCCESS | typeof PmocSchedulerStatus.PARTIAL_FAILURE | typeof PmocSchedulerStatus.FAILED,
    runAt: Date,
    error?: string,
  ): Promise<void> {
    await this.prisma.pmocPlan.update({
      where: { id: pmocPlanId },
      data: {
        lastSchedulerRun: runAt,
        lastSchedulerStatus: status,
        lastSchedulerError: error ? this.safeText(error) : null,
      },
    });
  }

  /**
   * Itens do "Checklist PMOC" cadastrados no Catálogo Técnico (workflow PMOC),
   * agrupados por unidade fixa (Evaporadora/Condensadora). São globais por
   * organização e alimentam a tabela do Checklist do Procedimento no relatório.
   */
  private async loadPmocUnitChecklist(organizationId: string): Promise<PmocUnitChecklistItem[]> {
    const items = await this.prisma.technicalCatalog.findMany({
      where: {
        organizationId,
        type: TechnicalCatalogType.CHECKLIST,
        active: true,
        deletedAt: null,
        pmocUnit: { not: null },
        workflows: { has: TechnicalCatalogWorkflow.PMOC },
      },
      select: { id: true, title: true, pmocUnit: true, maintenanceType: true },
      orderBy: [{ pmocUnit: 'asc' as const }, { sortOrder: 'asc' as const }, { title: 'asc' as const }],
    });
    return items.filter(
      (item): item is PmocUnitChecklistItem => item.pmocUnit !== null,
    );
  }

  private buildOperationPayload(
    plan: PlanForExecution,
    scheduledFor: Date,
    actor: AuthenticatedUser,
    unitChecklist: PmocUnitChecklistItem[],
    reviewed?: CreateOperationDto,
    responsibility?: Pick<
      RequestWithPlan,
      'equipmentId' | 'plannedOperator' | 'plannedTechnician'
    >,
  ): CreateOperationDto {
    const coveredEquipments = plan.equipments.length
      ? plan.equipments.map((item) => item.equipment)
      : [plan.equipment];
    const equipment =
      coveredEquipments.find((item) => item.id === responsibility?.equipmentId) ??
      plan.equipment;
    const plannedOperator = responsibility?.plannedOperator;
    const activeDefaultOperator =
      plannedOperator?.isActive && !plannedOperator.disabledAt
        ? plannedOperator.id
        : plan.defaultOperator?.isActive && !plan.defaultOperator.disabledAt
          ? plan.defaultOperator.id
        : null;
    const operatorId = reviewed?.operatorId ?? activeDefaultOperator ?? actor.id;
    const addressId =
      reviewed?.addressId ??
      plan.defaultAddressId ??
      equipment.addressId ??
      plan.customer.addresses[0]?.id ??
      undefined;
    const maintenanceType = this.maintenanceType(plan.periodicity);
    const includeChecklist = plan.includeChecklistInOperations;
    // Itens do Checklist PMOC que o owner marcou como executados no plano.
    const executedIds = new Set(plan.checklists.map((item) => item.technicalCatalogId));
    const operationChecklist =
      reviewed?.checklist ??
      (includeChecklist
        ? plan.checklists
            .filter((item) => item.technicalCatalog.active)
            .map((item) => ({ label: item.technicalCatalog.title, done: true }))
        : []);
    // Todos os procedimentos cadastrados por unidade (Evaporadora/Condensadora)
    // entram na tabela do relatório; "Executado" reflete a marcação do owner.
    const unitMaintenanceChecklist = includeChecklist
      ? unitChecklist.map((item) => ({
          pmocUnit: item.pmocUnit,
          maintenanceType: item.maintenanceType ?? maintenanceType,
          description: item.title,
          executed: executedIds.has(item.id),
          result: executedIds.has(item.id)
            ? MaintenanceChecklistResult.YES
            : MaintenanceChecklistResult.NO,
        }))
      : [];
    return {
      ...reviewed,
      customerId: plan.customerId,
      addressId,
      equipmentId: equipment.id,
      operatorId,
      documentType: DocumentTemplateType.PMOC,
      type: plan.defaultOperationType,
      serviceTypes: plan.serviceTypes.length ? plan.serviceTypes : [plan.defaultOperationType],
      status: reviewed?.status ?? OperationStatus.DRAFT,
      scheduledFor: scheduledFor.toISOString(),
      checklist: operationChecklist,
      observations:
        reviewed?.observations ??
        plan.defaultOperationObservations ??
        `Execução preventiva vinculada ao PMOC-${String(plan.number).padStart(6, '0')}.`,
      reportedIssue: reviewed?.reportedIssue ?? `Execução programada do ${plan.maintenancePlan.name}.`,
      serviceDescription: reviewed?.serviceDescription ?? plan.coverage ?? plan.observations ?? undefined,
      maintenanceType,
      maintenanceChecklist: reviewed?.maintenanceChecklist ?? unitMaintenanceChecklist,
      // Cada execução representa exatamente um equipamento coberto. O plano
      // continua agregando toda a cobertura, sem misturar evidências entre ativos.
      inspectedEquipments: [{
        equipmentId: equipment.id,
        sector: equipment.sector ?? equipment.address?.name ?? equipment.name,
      }],
    };
  }

  private assertEquipmentCovered(plan: PlanForExecution, equipmentId: string): void {
    const covered = new Set([
      plan.equipmentId,
      ...plan.equipments.map((item) => item.equipmentId),
    ]);
    if (!covered.has(equipmentId)) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'O equipamento selecionado não pertence à cobertura deste PMOC',
        HttpStatus.BAD_REQUEST,
        { equipmentId, pmocPlanId: plan.id },
      );
    }
  }

  private maintenanceType(periodicity: PmocPeriodicity): OperationMaintenanceType {
    if (periodicity === PmocPeriodicity.WEEKLY || periodicity === PmocPeriodicity.BIWEEKLY) {
      return OperationMaintenanceType.WEEKLY;
    }
    if (periodicity === PmocPeriodicity.QUARTERLY) return OperationMaintenanceType.QUARTERLY;
    if (periodicity === PmocPeriodicity.SEMIANNUAL) return OperationMaintenanceType.SEMIANNUAL;
    if (periodicity === PmocPeriodicity.YEARLY) return OperationMaintenanceType.ANNUAL;
    return OperationMaintenanceType.MONTHLY;
  }

  private async markFailed(
    id: string,
    pmocPlanId: string,
    actorId: string | null,
    context: OperationAuditContext,
    cause: unknown,
  ): Promise<void> {
    const reason = this.failureMessage(cause);
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.pmocExecutionRequest.findUnique({
        where: { id },
        select: { executionNumber: true },
      });
      const failed = await tx.pmocExecutionRequest.updateMany({
        where: {
          id,
          operationId: null,
          status: PmocExecutionRequestStatus.GENERATING_OS,
        },
        data: { status: PmocExecutionRequestStatus.FAILED, failureReason: reason },
      });
      if (failed.count !== 1) return;
      await tx.pmocPlan.update({
        where: { id: pmocPlanId },
        data: { operationalStatus: PmocOperationalStatus.ERROR },
      });
      await tx.pmocHistory.create({
        data: {
          pmocPlanId,
          executionRequestId: id,
          actorId,
          action: PmocHistoryAction.REQUEST_FAILED,
          previousStatus: PmocExecutionRequestStatus.GENERATING_OS,
          newStatus: PmocExecutionRequestStatus.FAILED,
          notes: reason,
          metadata: { executionNumber: request?.executionNumber ?? null },
        },
      });
      await tx.auditLog.create({
        data: this.audit(PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_FAILED, actorId, context, {
          pmocPlanId,
          executionRequestId: id,
          reason,
          executionNumber: request?.executionNumber ?? null,
        }),
      });
      await this.notifications.notifyPmocExecutionTx(
        tx,
        id,
        NotificationType.PMOC_OS_GENERATION_FAILED,
      );
      await this.syncPlanScheduleTx(tx, pmocPlanId);
    });
  }

  private async reserveExecutionNumberTx(
    tx: Prisma.TransactionClient,
    pmocPlanId: string,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ executionNumber: number }>>`
      UPDATE "pmoc_plans"
      SET
        "last_reserved_execution_number" = "last_reserved_execution_number" + 1,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${pmocPlanId}::uuid
      RETURNING "last_reserved_execution_number" AS "executionNumber"
    `;
    const executionNumber = rows[0]?.executionNumber;
    if (!executionNumber) throw this.notFound();
    return executionNumber;
  }

  private async reserveEquipmentExecutionNumberTx(
    tx: Prisma.TransactionClient,
    pmocPlanId: string,
    equipmentId: string,
    plannedExecutionCount: number,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ executionNumber: number }>>`
      UPDATE "pmoc_plan_equipments"
      SET
        "last_reserved_execution_number" = "last_reserved_execution_number" + 1
      WHERE "pmoc_plan_id" = ${pmocPlanId}::uuid
        AND "equipment_id" = ${equipmentId}::uuid
        AND "last_reserved_execution_number" < ${plannedExecutionCount}
      RETURNING "last_reserved_execution_number" AS "executionNumber"
    `;
    const executionNumber = rows[0]?.executionNumber;
    if (!executionNumber) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EXECUTION_LIMIT_REACHED,
        'Todas as execuções previstas para este equipamento já foram reservadas',
        HttpStatus.CONFLICT,
        { pmocPlanId, equipmentId, plannedExecutionCount },
      );
    }
    return executionNumber;
  }

  private async syncPlanScheduleTx(
    tx: Prisma.TransactionClient,
    pmocPlanId: string,
  ): Promise<void> {
    const [execution, generation] = await Promise.all([
      tx.pmocExecutionRequest.aggregate({
        where: {
          pmocPlanId,
          status: {
            in: [
              PmocExecutionRequestStatus.PENDING,
              PmocExecutionRequestStatus.FAILED,
              PmocExecutionRequestStatus.GENERATING_OS,
            ],
          },
        },
        _min: { scheduledFor: true },
      }),
      tx.pmocExecutionRequest.aggregate({
        where: {
          pmocPlanId,
          status: {
            in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED],
          },
        },
        _min: { scheduledFor: true },
      }),
    ]);
    await tx.pmocPlan.update({
      where: { id: pmocPlanId },
      data: {
        nextExecutionDate: execution._min.scheduledFor,
        nextGenerationDate: generation._min.scheduledFor,
      },
    });
  }

  private async requestOrThrow(id: string): Promise<unknown> {
    const request = await this.prisma.pmocExecutionRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!request) throw this.notFound();
    return request;
  }

  private async requestWithPlanOrThrow(id: string): Promise<RequestWithPlan> {
    const request = await this.prisma.pmocExecutionRequest.findUnique({
      where: { id },
      include: REQUEST_WITH_PLAN_INCLUDE,
    });
    if (!request) throw this.notFound();
    return request;
  }

  private async planOrThrow(id: string): Promise<PlanForExecution> {
    const plan = await this.prisma.pmocPlan.findUnique({
      where: { id },
      include: PLAN_FOR_EXECUTION_INCLUDE,
    });
    if (!plan) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_PLAN_NOT_FOUND,
        'Plano PMOC não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return plan;
  }

  private assertPlanIsOperational(plan: PlanForExecution): void {
    if (!plan.active || plan.generationMode === PmocGenerationMode.PAUSED) {
      throw this.invalidState('Paused or inactive PMOC plans cannot generate Work Orders');
    }
  }

  /** Dias entre agora e a data prevista da execução (0 quando já vencida/hoje). */
  private earlyGenerationDays(scheduledFor: Date): number {
    const ms = scheduledFor.getTime() - Date.now();
    return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
  }

  private assertRequestCanGenerate(status: PmocExecutionRequestStatus): void {
    if (
      status !== PmocExecutionRequestStatus.PENDING &&
      status !== PmocExecutionRequestStatus.FAILED
    ) {
      throw this.invalidState('Execution request cannot generate a Work Order in its current state');
    }
  }

  private assertOperatorCanClaim(request: RequestWithPlan, actor: AuthenticatedUser): void {
    if (actor.role !== Role.OPERATOR) return;
    if (request.plannedOperatorId && request.plannedOperatorId !== actor.id) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'Esta execução está reservada para outro operador',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private notFound(): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.PMOC_EXECUTION_REQUEST_NOT_FOUND,
      'Execução de PMOC não encontrada',
      HttpStatus.NOT_FOUND,
    );
  }

  private invalidState(message: string): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.PMOC_EXECUTION_REQUEST_INVALID_STATE,
      message,
      HttpStatus.CONFLICT,
    );
  }

  private failureMessage(cause: unknown): string {
    const message =
      cause instanceof ApplicationException
        ? cause.message
        : 'Internal Work Order generation failure';
    return message
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  private safeText(value: string): string {
    return value
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  private audit(
    action: string,
    actorId: string | null,
    context: OperationAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogCreateInput {
    return {
      action,
      resource: PMOC_EXECUTION_REQUEST_RESOURCE,
      actor: actorId,
      metadata: {
        ...metadata,
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    };
  }
}
