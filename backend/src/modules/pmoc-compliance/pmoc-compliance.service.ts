import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AssetLifecycleEventType,
  DocumentTemplateType,
  MaintenanceExecutionStatus,
  MaintenancePlanType,
  NotificationType,
  OperationStatus,
  PmocComplianceStatus,
  PmocExecutionOrigin,
  PmocExecutionRequestStatus,
  PmocGenerationMode,
  PmocHistoryAction,
  PmocOperationalStatus,
  PmocPeriodicity,
  Prisma,
  Role,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import {
  PMOC_AUDIT_ACTIONS,
  PMOC_ENVIRONMENT_RESOURCE,
  PMOC_EXECUTION_REQUEST_RESOURCE,
  PMOC_RESOURCE,
} from '../../shared/constants/pmoc.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import {
  SYSTEM_SERVICE_TYPE_KEYS,
  type OperationType,
} from '../../shared/constants/service-types.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { DocumentConfigurationService } from '../document-engine/configuration/document-configuration.service';
import {
  RecurrenceFrequency,
  RecurrenceRuleDto,
} from '../maintenance-planning/dto/maintenance-planning.dto';
import { RecurringEngine } from '../maintenance-planning/recurring-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  ComplianceEvaluationResult,
  ComplianceEvaluator,
} from './compliance/compliance.types';
import {
  CreatePmocEnvironmentDto,
  CreatePmocPlanDto,
  ListPmocQueryDto,
  PmocDashboardQueryDto,
  UpdatePmocEnvironmentDto,
  UpdatePmocPlanDto,
} from './dto/pmoc-compliance.dto';
import { PmocExecutionRequestsService } from './pmoc-execution-requests.service';

export interface PmocAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

type PmocPayload = Prisma.PmocPlanGetPayload<{ include: typeof PMOC_INCLUDE }>;

const ACTIVE_COVERAGE_SELECT = {
  id: true,
  number: true,
  coverage: true,
  startDate: true,
  endDate: true,
  operationalStatus: true,
  maintenancePlan: { select: { name: true } },
  _count: { select: { equipments: true } },
} satisfies Prisma.PmocPlanSelect;

type ActiveCoveragePlan = Prisma.PmocPlanGetPayload<{ select: typeof ACTIVE_COVERAGE_SELECT }>;
type ActiveCoverageProjection = {
  id: string;
  number: number;
  name: string;
  coverage: string | null;
  startDate: Date;
  endDate: Date;
  operationalStatus: PmocOperationalStatus;
  equipmentCount: number;
};

const PMOC_INCLUDE = {
  organization: { select: { id: true, legalName: true, tradeName: true } },
  customer: { select: { id: true, name: true, tradeName: true } },
  equipment: {
    select: {
      id: true,
      name: true,
      tag: true,
      type: true,
      status: true,
      sector: true,
      manufacturer: true,
      model: true,
      capacity: true,
      address: true,
    },
  },
  maintenancePlan: {
    include: {
      executions: {
        orderBy: [{ scheduledAt: 'asc' as const }, { id: 'asc' as const }],
        take: 20,
        include: {
          operation: {
            select: { id: true, number: true, type: true, status: true, completedAt: true },
          },
        },
      },
    },
  },
  defaultOperator: { select: { id: true, name: true, username: true, role: true } },
  defaultTechnician: { select: { id: true, name: true, username: true, role: true } },
  defaultAddress: true,
  signatureOverride: {
    select: {
      id: true,
      name: true,
      title: true,
      professionalCouncil: true,
      department: true,
      active: true,
    },
  },
  executionRequests: {
    orderBy: [{ scheduledFor: 'desc' as const }, { id: 'desc' as const }],
    take: 20,
    include: {
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
          address: true,
        },
      },
      operation: {
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          completedAt: true,
          signedAt: true,
          operator: { select: { id: true, name: true, username: true, role: true } },
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
      plannedOperator: { select: { id: true, name: true, username: true, role: true } },
      plannedTechnician: { select: { id: true, name: true, username: true, role: true } },
      maintenanceExecution: {
        select: { id: true, status: true, scheduledAt: true, executedAt: true },
      },
    },
  },
  equipments: {
    include: {
      equipment: {
        select: {
          id: true,
          name: true,
          tag: true,
          type: true,
          status: true,
          customerId: true,
          sector: true,
          manufacturer: true,
          model: true,
          capacity: true,
          address: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  scopes: {
    include: {
      technicalCatalog: {
        select: { id: true, type: true, title: true, description: true, active: true },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  checklists: {
    include: {
      technicalCatalog: {
        select: {
          id: true,
          type: true,
          title: true,
          description: true,
          maintenanceType: true,
          pmocUnit: true,
          active: true,
        },
      },
    },
    orderBy: { position: 'asc' as const },
  },
  environments: {
    include: {
      equipments: {
        include: {
          equipment: {
            select: { id: true, name: true, tag: true, type: true, status: true, customerId: true },
          },
        },
      },
    },
    orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.PmocPlanInclude;

const PMOC_ANALYTICS_REQUEST_SELECT = {
  id: true,
  pmocPlanId: true,
  equipmentId: true,
  executionNumber: true,
  equipmentExecutionNumber: true,
  status: true,
  origin: true,
  scheduledFor: true,
  generatedAt: true,
  cancelledAt: true,
  maintenanceExecution: {
    select: { status: true, executedAt: true },
  },
  operation: {
    select: {
      id: true,
      number: true,
      status: true,
      completedAt: true,
      signedAt: true,
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
} satisfies Prisma.PmocExecutionRequestSelect;

const PMOC_DASHBOARD_REQUEST_INCLUDE = {
  equipment: { select: { id: true, name: true, tag: true } },
  pmocPlan: {
    select: {
      id: true,
      number: true,
      periodicity: true,
      maintenancePlan: { select: { name: true } },
      customer: { select: { id: true, name: true, tradeName: true } },
      equipment: { select: { id: true, name: true, tag: true } },
      equipments: {
        select: { equipment: { select: { id: true, name: true, tag: true } } },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
  operation: {
    select: {
      id: true,
      number: true,
      status: true,
      completedAt: true,
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
  maintenanceExecution: { select: { status: true, executedAt: true } },
  plannedOperator: { select: { id: true, name: true } },
  plannedTechnician: { select: { id: true, name: true } },
} satisfies Prisma.PmocExecutionRequestInclude;

type PmocAnalyticsRequest = Prisma.PmocExecutionRequestGetPayload<{
  select: typeof PMOC_ANALYTICS_REQUEST_SELECT;
}>;
type PmocDashboardRequest = Prisma.PmocExecutionRequestGetPayload<{
  include: typeof PMOC_DASHBOARD_REQUEST_INCLUDE;
}>;

@Injectable()
export class PmocComplianceService implements ComplianceEvaluator<{
  resourceId: string;
  evaluatedAt: Date;
}> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurrence: RecurringEngine,
    private readonly lifecycle: LifecyclePublisher,
    private readonly documentConfiguration: DocumentConfigurationService,
    private readonly notifications: NotificationsService,
    private readonly executionRequestsService: PmocExecutionRequestsService,
  ) {}

  async list(query: ListPmocQueryDto): Promise<unknown> {
    await this.executionRequestsService.reconcileCoverageStatuses();
    const where: Prisma.PmocPlanWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.equipmentId
        ? {
            OR: [
              { equipmentId: query.equipmentId },
              { equipments: { some: { equipmentId: query.equipmentId } } },
            ],
          }
        : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pmocPlan.findMany({
        where,
        include: PMOC_INCLUDE,
        orderBy: [{ active: 'desc' }, { endDate: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.pmocPlan.count({ where }),
    ]);
    const analytics = await this.analyticsForPlans(items);
    return this.page(
      items.map((item) => this.withOverview(item, analytics.get(item.id))),
      query.page,
      query.limit,
      total,
    );
  }

  async get(id: string): Promise<unknown> {
    await this.executionRequestsService.reconcileCoverageStatuses();
    const pmoc = await this.pmocOrThrow(id);
    const analytics = await this.analyticsForPlans([pmoc]);
    return this.withOverview(pmoc, analytics.get(pmoc.id));
  }

  async nameSuggestion(
    customerId: string,
  ): Promise<{ name: string; provisionalNumber: number }> {
    const customer = await this.customerForPmocOrThrow(customerId);
    const aggregate = await this.prisma.pmocPlan.aggregate({ _max: { number: true } });
    const provisionalNumber = (aggregate._max.number ?? 0) + 1;
    return {
      name: this.pmocPlanName(customer.tradeName ?? customer.name, provisionalNumber),
      provisionalNumber,
    };
  }

  async activeCoverage(customerId: string): Promise<{
    hasActiveCoverage: boolean;
    checkedAt: string;
    conflicts: ActiveCoverageProjection[];
  }> {
    await this.customerForPmocOrThrow(customerId);
    const checkedAt = new Date();
    const plans = await this.activeCoveragePlans(customerId, checkedAt);
    return {
      hasActiveCoverage: plans.length > 0,
      checkedAt: checkedAt.toISOString(),
      conflicts: plans.map((plan) => this.activeCoverageProjection(plan)),
    };
  }

  async create(
    dto: CreatePmocPlanDto,
    actor: AuthenticatedUser,
    context: PmocAuditContext,
  ): Promise<unknown> {
    const periodicity = dto.periodicity ?? this.periodicityFromRule(dto.recurrenceRule);
    const configurationOnly = dto.configurationOnly === true;
    const generationMode = configurationOnly
      ? dto.generationMode === PmocGenerationMode.PAUSED
        ? PmocGenerationMode.PAUSED
        : PmocGenerationMode.MANUAL
      : dto.generationMode ?? PmocGenerationMode.MANUAL;
    const recurrenceRule = dto.recurrenceRule ?? this.ruleForPeriodicity(periodicity);
    this.recurrence.validate(recurrenceRule);
    const startDate = this.dateOnly(dto.startDate);
    const endDate = this.dateOnly(dto.endDate);
    this.assertDateRange(startDate, endDate);
    const plannedExecutionCount = Math.max(
      1,
      this.recurrence.countBefore(recurrenceRule, startDate, endDate),
    );
    const organization = await this.organizationOrThrow();
    const customer = await this.customerForPmocOrThrow(dto.customerId);
    const activeCoveragePlans = await this.activeCoveragePlans(dto.customerId, new Date());
    if (activeCoveragePlans.length && !dto.confirmActiveCoverage) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_ACTIVE_COVERAGE_CONFIRMATION_REQUIRED,
        'Este cliente já possui cobertura PMOC ativa. Confirme se deseja criar outro plano.',
        HttpStatus.CONFLICT,
        {
          customerId: dto.customerId,
          conflicts: activeCoveragePlans.map((plan) => this.activeCoverageProjection(plan)),
        },
      );
    }
    const activeCoverageConfirmed = activeCoveragePlans.length > 0 && dto.confirmActiveCoverage === true;
    const equipment = await this.equipmentForCustomerOrThrow(dto.equipmentId, dto.customerId);
    const equipmentIds = this.unique([dto.equipmentId, ...(dto.equipmentIds ?? [])]);
    await this.equipmentsForCustomerOrThrow(equipmentIds, dto.customerId);
    const serviceTypes = this.operationTypes(
      dto.defaultOperationType ?? SYSTEM_SERVICE_TYPE_KEYS.PREVENTIVA,
      dto.serviceTypes,
    );
    const scopes = await this.planScopesOrThrow(dto.scopeCatalogIds, organization.id);
    const checklists = await this.planChecklistsOrThrow(
      dto.checklistCatalogIds,
      organization.id,
    );
    await this.validateDefaults(
      configurationOnly ? undefined : dto.defaultOperatorId,
      dto.defaultTechnicianId,
      dto.signatureOverrideId,
    );
    if (configurationOnly) {
      if (!dto.defaultAddressId || scopes.length === 0 || !dto.serviceTypes?.length) {
        throw new ApplicationException(
          ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
          'Informe endereço, escopo e tipos de serviço para configurar o plano PMOC',
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.validateConfigurationTechnician(
        dto.defaultTechnicianId,
        dto.signatureOverrideId,
      );
    }
    await this.validateAddress(dto.defaultAddressId, dto.customerId);

    return this.prisma.$transaction(async (tx) => {
      const maintenancePlan = await tx.maintenancePlan.create({
        data: {
          equipmentId: dto.equipmentId,
          name: (dto.name ? this.clean(dto.name) : `PMOC · ${customer.tradeName ?? customer.name}`).slice(0, 140),
          description: dto.observations ? this.clean(dto.observations) : 'Plano PMOC operacional',
          type: MaintenancePlanType.PREVENTIVE,
          active: dto.active ?? true,
          priority: dto.priority ?? 'HIGH',
          recurrenceRule: recurrenceRule as unknown as Prisma.InputJsonValue,
          firstExecution: startDate,
          nextExecution: startDate,
          createdBy: actor.id,
        },
      });
      const maintenanceExecution = configurationOnly
        ? null
        : await tx.maintenanceExecution.create({
            data: {
              maintenancePlanId: maintenancePlan.id,
              scheduledAt: startDate,
              notes: 'Execução inicial planejada gerada pelo PMOC.',
            },
          });
      const created = await tx.pmocPlan.create({
        data: {
          organizationId: organization.id,
          customerId: dto.customerId,
          equipmentId: dto.equipmentId,
          maintenancePlanId: maintenancePlan.id,
          coverage: scopes.length
            ? scopes.map((scope) => scope.title).join(', ')
            : dto.coverage
              ? this.clean(dto.coverage)
              : null,
          periodicity,
          generationMode,
          defaultOperatorId: configurationOnly ? null : dto.defaultOperatorId ?? null,
          defaultTechnicianId: dto.defaultTechnicianId ?? null,
          defaultAddressId: dto.defaultAddressId ?? null,
          defaultOperationType: dto.defaultOperationType ?? SYSTEM_SERVICE_TYPE_KEYS.PREVENTIVA,
          serviceTypes,
          defaultEstimatedDurationMinutes: configurationOnly
            ? null
            : dto.defaultEstimatedDurationMinutes ?? null,
          defaultOperationObservations: !configurationOnly && dto.defaultOperationObservations
            ? this.clean(dto.defaultOperationObservations)
            : null,
          includeChecklistInOperations: dto.includeChecklistInOperations ?? true,
          signatureOverrideId: dto.signatureOverrideId ?? null,
          operationalStatus:
            generationMode === PmocGenerationMode.PAUSED || dto.active === false
              ? PmocOperationalStatus.PAUSED
              : PmocOperationalStatus.PENDING,
          plannedExecutionCount,
          lastReservedExecutionNumber: configurationOnly ? 0 : 1,
          nextExecutionDate: startDate,
          nextGenerationDate: configurationOnly ? null : startDate,
          responsibleTechnician: this.clean(dto.responsibleTechnician),
          artNumber: dto.artNumber ? this.clean(dto.artNumber) : null,
          contractNumber: dto.contractNumber ? this.clean(dto.contractNumber) : null,
          startDate,
          endDate,
          active: dto.active ?? true,
          observations: dto.observations ? this.clean(dto.observations) : null,
          equipments: {
            create: equipmentIds.map((equipmentId) => ({
              equipmentId,
              lastReservedExecutionNumber:
                !configurationOnly && equipmentId === dto.equipmentId ? 1 : 0,
            })),
          },
          ...(scopes.length
            ? {
                scopes: {
                  create: scopes.map((scope) => ({ technicalCatalogId: scope.id })),
                },
              }
            : {}),
          ...(checklists.length
            ? {
                checklists: {
                  create: checklists.map((item, position) => ({
                    technicalCatalogId: item.id,
                    position,
                  })),
                },
              }
            : {}),
        },
        select: { id: true, number: true },
      });
      const executionRequest =
        configurationOnly || !maintenanceExecution
          ? null
          : await tx.pmocExecutionRequest.create({
              data: {
                pmocPlanId: created.id,
                equipmentId: dto.equipmentId,
                maintenanceExecutionId: maintenanceExecution.id,
                executionNumber: 1,
                equipmentExecutionNumber: 1,
                executionYear: startDate.getUTCFullYear(),
                scheduledFor: startDate,
                requestedBy: actor.id,
                plannedOperatorId: dto.defaultOperatorId ?? null,
                plannedTechnicianId: dto.defaultTechnicianId ?? null,
                origin:
                  generationMode === PmocGenerationMode.AUTO
                    ? PmocExecutionOrigin.AUTO
                    : PmocExecutionOrigin.MANUAL,
              },
            });
      await tx.pmocHistory.createMany({
        data: [
          {
            pmocPlanId: created.id,
            actorId: actor.id,
            action: PmocHistoryAction.CREATED,
            newStatus:
              generationMode === PmocGenerationMode.PAUSED || dto.active === false
                ? PmocOperationalStatus.PAUSED
                : PmocOperationalStatus.PENDING,
            metadata: {
              periodicity,
              generationMode,
              configurationOnly,
            },
          },
          ...(executionRequest
            ? [{
                pmocPlanId: created.id,
                executionRequestId: executionRequest.id,
                actorId: actor.id,
                action:
                  generationMode === PmocGenerationMode.AUTO
                    ? PmocHistoryAction.REQUEST_CREATED_AUTO
                    : PmocHistoryAction.REQUEST_CREATED_MANUAL,
                newStatus: PmocExecutionRequestStatus.PENDING,
                metadata: { executionNumber: 1, scheduledFor: startDate.toISOString() },
              }]
            : []),
        ],
      });
      await tx.maintenancePlan.update({
        where: { id: maintenancePlan.id },
        data: {
          name: dto.name
            ? this.clean(dto.name).slice(0, 140)
            : this.pmocPlanName(customer.tradeName ?? customer.name, created.number),
        },
      });
      const pmoc = await tx.pmocPlan.findUniqueOrThrow({
        where: { id: created.id },
        include: PMOC_INCLUDE,
      });
      await this.lifecycle.publishPmocEventTx(
        tx,
        {
          pmocPlanId: pmoc.id,
          equipmentId: pmoc.equipmentId,
          actorId: actor.id,
          type: AssetLifecycleEventType.PMOC_CREATED,
          description: `PMOC created for ${equipment.name}`,
          metadata: {
            customerId: dto.customerId,
            maintenancePlanId: maintenancePlan.id,
            pmocNumber: pmoc.number,
          },
        },
        context,
      );
      await tx.auditLog.create({
        data: this.audit(PMOC_AUDIT_ACTIONS.CREATED, PMOC_RESOURCE, actor.id, context, {
          pmocPlanId: pmoc.id,
          customerId: dto.customerId,
          equipmentId: dto.equipmentId,
          maintenancePlanId: maintenancePlan.id,
          pmocNumber: pmoc.number,
          configurationOnly,
          activeCoverageConfirmed,
          existingActivePmocIds: activeCoveragePlans.map((plan) => plan.id),
        }),
      });
      if (activeCoverageConfirmed) {
        await tx.auditLog.create({
          data: this.audit(
            PMOC_AUDIT_ACTIONS.ACTIVE_COVERAGE_CONFIRMED,
            PMOC_RESOURCE,
            actor.id,
            context,
            {
              pmocPlanId: pmoc.id,
              customerId: dto.customerId,
              existingActivePmocIds: activeCoveragePlans.map((plan) => plan.id),
            },
          ),
        });
      }
      if (executionRequest) {
        await tx.auditLog.create({
          data: this.audit(
            generationMode === PmocGenerationMode.AUTO
              ? PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CREATED_AUTO
              : PMOC_AUDIT_ACTIONS.EXECUTION_REQUEST_CREATED_MANUAL,
            PMOC_EXECUTION_REQUEST_RESOURCE,
            actor.id,
            context,
            {
              pmocPlanId: pmoc.id,
              executionRequestId: executionRequest.id,
              executionNumber: 1,
              scheduledFor: startDate.toISOString(),
            },
          ),
        });
      }
      if (
        executionRequest &&
        generationMode === PmocGenerationMode.MANUAL &&
        startDate.getTime() <= Date.now()
      ) {
        await this.notifications.notifyPmocExecutionTx(
          tx,
          executionRequest.id,
          NotificationType.PMOC_EXECUTION_PENDING_MANUAL,
        );
      }
      return this.withCompliance(pmoc);
    });
  }

  async update(
    id: string,
    dto: UpdatePmocPlanDto,
    actor: AuthenticatedUser,
    context: PmocAuditContext,
  ): Promise<unknown> {
    const existing = await this.pmocOrThrow(id);
    const configurationOnly = dto.configurationOnly === true;
    const startDate = dto.startDate ? this.dateOnly(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? this.dateOnly(dto.endDate) : existing.endDate;
    this.assertDateRange(startDate, endDate);
    const periodicity = dto.periodicity ?? existing.periodicity;
    const recurrenceRule =
      dto.recurrenceRule ??
      (dto.periodicity
        ? this.ruleForPeriodicity(periodicity)
        : (existing.maintenancePlan.recurrenceRule as unknown as RecurrenceRuleDto));
    this.recurrence.validate(recurrenceRule);
    const plannedExecutionCount = Math.max(
      1,
      this.recurrence.countBefore(recurrenceRule, startDate, endDate),
    );
    const highestReservedExecution = existing.equipments.reduce(
      (highest, item) => Math.max(highest, item.lastReservedExecutionNumber),
      0,
    );
    if (plannedExecutionCount < highestReservedExecution) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EXECUTION_REQUEST_INVALID_STATE,
        'A nova cobertura não pode excluir execuções já reservadas para os equipamentos',
        HttpStatus.CONFLICT,
        { plannedExecutionCount, highestReservedExecution },
      );
    }
    const equipmentIds =
      dto.equipmentIds !== undefined
        ? this.unique(dto.equipmentIds)
        : null;
    if (equipmentIds) await this.equipmentsForCustomerOrThrow(equipmentIds, existing.customerId);
    await this.validateDefaults(
      configurationOnly ? undefined : dto.defaultOperatorId ?? undefined,
      dto.defaultTechnicianId ?? undefined,
      dto.signatureOverrideId ?? undefined,
    );
    if (configurationOnly) {
      await this.validateConfigurationTechnician(
        dto.defaultTechnicianId ?? existing.defaultTechnicianId ?? undefined,
        dto.signatureOverrideId ?? existing.signatureOverrideId ?? undefined,
      );
    }
    await this.validateAddress(dto.defaultAddressId ?? undefined, existing.customerId);
    const serviceTypes =
      dto.serviceTypes !== undefined || dto.defaultOperationType !== undefined
        ? this.operationTypes(
            dto.defaultOperationType ?? existing.defaultOperationType,
            dto.serviceTypes ?? existing.serviceTypes,
          )
        : null;
    const scopes =
      dto.scopeCatalogIds !== undefined
        ? await this.planScopesOrThrow(dto.scopeCatalogIds, existing.organizationId)
        : null;
    const checklists =
      dto.checklistCatalogIds !== undefined
        ? await this.planChecklistsOrThrow(dto.checklistCatalogIds, existing.organizationId)
        : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.maintenancePlan.update({
        where: { id: existing.maintenancePlanId },
        data: {
          ...(dto.name ? { name: this.clean(dto.name).slice(0, 140) } : {}),
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.recurrenceRule || dto.periodicity
            ? { recurrenceRule: recurrenceRule as unknown as Prisma.InputJsonValue }
            : {}),
          ...(dto.startDate ? { firstExecution: startDate, nextExecution: startDate } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(equipmentIds ? { equipmentId: equipmentIds[0] } : {}),
        },
      });
      if (equipmentIds) {
        const reserved = await tx.pmocExecutionRequest.groupBy({
          by: ['equipmentId'],
          where: { pmocPlanId: id, equipmentId: { in: equipmentIds } },
          _max: { equipmentExecutionNumber: true },
        });
        const reservedByEquipment = new Map(
          reserved.map((item) => [
            item.equipmentId,
            item._max.equipmentExecutionNumber ?? 0,
          ]),
        );
        await tx.pmocPlanEquipment.deleteMany({ where: { pmocPlanId: id } });
        await tx.pmocPlanEquipment.createMany({
          data: equipmentIds.map((equipmentId) => ({
            pmocPlanId: id,
            equipmentId,
            lastReservedExecutionNumber: reservedByEquipment.get(equipmentId) ?? 0,
          })),
          skipDuplicates: true,
        });
      }
      if (scopes) {
        await tx.pmocPlanScope.deleteMany({ where: { pmocPlanId: id } });
        await tx.pmocPlanScope.createMany({
          data: scopes.map((scope) => ({ pmocPlanId: id, technicalCatalogId: scope.id })),
          skipDuplicates: true,
        });
      }
      if (checklists) {
        await tx.pmocPlanChecklist.deleteMany({ where: { pmocPlanId: id } });
        if (checklists.length > 0) {
          await tx.pmocPlanChecklist.createMany({
            data: checklists.map((item, position) => ({
              pmocPlanId: id,
              technicalCatalogId: item.id,
              position,
            })),
            skipDuplicates: true,
          });
        }
      }
      const pmoc = await tx.pmocPlan.update({
        where: { id },
        data: {
          ...(scopes
            ? { coverage: scopes.map((scope) => scope.title).join(', ') }
            : dto.coverage !== undefined
              ? { coverage: dto.coverage ? this.clean(dto.coverage) : null }
              : {}),
          ...(dto.periodicity ? { periodicity: dto.periodicity } : {}),
          plannedExecutionCount,
          ...(dto.generationMode
            ? {
                generationMode:
                  configurationOnly && dto.generationMode === PmocGenerationMode.AUTO
                    ? PmocGenerationMode.MANUAL
                    : dto.generationMode,
              }
            : {}),
          ...(configurationOnly
            ? { defaultOperatorId: null }
            : dto.defaultOperatorId !== undefined
              ? { defaultOperatorId: dto.defaultOperatorId }
              : {}),
          ...(dto.defaultTechnicianId !== undefined
            ? { defaultTechnicianId: dto.defaultTechnicianId }
            : {}),
          ...(dto.defaultAddressId !== undefined ? { defaultAddressId: dto.defaultAddressId } : {}),
          ...(dto.defaultOperationType !== undefined
            ? { defaultOperationType: dto.defaultOperationType }
            : {}),
          ...(serviceTypes ? { serviceTypes } : {}),
          ...(equipmentIds ? { equipmentId: equipmentIds[0] } : {}),
          ...(configurationOnly
            ? { defaultEstimatedDurationMinutes: null }
            : dto.defaultEstimatedDurationMinutes !== undefined
              ? { defaultEstimatedDurationMinutes: dto.defaultEstimatedDurationMinutes }
              : {}),
          ...(configurationOnly
            ? { defaultOperationObservations: null }
            : dto.defaultOperationObservations !== undefined
              ? {
                  defaultOperationObservations: dto.defaultOperationObservations
                    ? this.clean(dto.defaultOperationObservations)
                    : null,
                }
              : {}),
          ...(dto.includeChecklistInOperations !== undefined
            ? { includeChecklistInOperations: dto.includeChecklistInOperations }
            : {}),
          ...(dto.signatureOverrideId !== undefined
            ? { signatureOverrideId: dto.signatureOverrideId }
            : {}),
          ...(dto.generationMode === PmocGenerationMode.PAUSED || dto.active === false
            ? { operationalStatus: PmocOperationalStatus.PAUSED }
            : dto.generationMode === PmocGenerationMode.AUTO ||
                dto.generationMode === PmocGenerationMode.MANUAL ||
                dto.active === true
              ? { operationalStatus: PmocOperationalStatus.ACTIVE }
              : {}),
          ...(dto.responsibleTechnician !== undefined
            ? { responsibleTechnician: this.clean(dto.responsibleTechnician) }
            : {}),
          ...(dto.artNumber !== undefined
            ? { artNumber: dto.artNumber ? this.clean(dto.artNumber) : null }
            : {}),
          ...(dto.contractNumber !== undefined
            ? { contractNumber: dto.contractNumber ? this.clean(dto.contractNumber) : null }
            : {}),
          ...(dto.startDate ? { startDate } : {}),
          ...(dto.endDate ? { endDate } : {}),
          ...(dto.observations !== undefined
            ? { observations: dto.observations ? this.clean(dto.observations) : null }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        include: PMOC_INCLUDE,
      });
      if (
        dto.applyDefaultsToPendingExecutions &&
        (dto.defaultOperatorId !== undefined || dto.defaultTechnicianId !== undefined)
      ) {
        await tx.pmocExecutionRequest.updateMany({
          where: {
            pmocPlanId: id,
            status: { in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED] },
          },
          data: {
            ...(dto.defaultOperatorId !== undefined
              ? { plannedOperatorId: dto.defaultOperatorId }
              : {}),
            ...(dto.defaultTechnicianId !== undefined
              ? { plannedTechnicianId: dto.defaultTechnicianId }
              : {}),
          },
        });
      }
      const historyActions: PmocHistoryAction[] = [PmocHistoryAction.UPDATED];
      if (dto.periodicity || dto.recurrenceRule) {
        historyActions.push(PmocHistoryAction.PERIODICITY_CHANGED);
      }
      if (dto.defaultOperatorId !== undefined) {
        historyActions.push(PmocHistoryAction.OPERATOR_CHANGED);
      }
      if (dto.defaultTechnicianId !== undefined) {
        historyActions.push(PmocHistoryAction.TECHNICIAN_CHANGED);
      }
      if (dto.applyDefaultsToPendingExecutions) {
        historyActions.push(PmocHistoryAction.DEFAULTS_PROPAGATED);
      }
      if (
        dto.coverage !== undefined ||
        dto.equipmentIds !== undefined ||
        dto.scopeCatalogIds !== undefined ||
        dto.checklistCatalogIds !== undefined ||
        dto.includeChecklistInOperations !== undefined
      ) {
        historyActions.push(PmocHistoryAction.COVERAGE_CHANGED);
      }
      await tx.pmocHistory.createMany({
        data: historyActions.map((action) => ({
          pmocPlanId: id,
          actorId: actor.id,
          action,
          previousStatus: existing.operationalStatus,
          newStatus: pmoc.operationalStatus,
          metadata: { changedFields: Object.keys(dto) },
        })),
      });
      await this.lifecycle.publishPmocEventTx(
        tx,
        {
          pmocPlanId: pmoc.id,
          equipmentId: pmoc.equipmentId,
          actorId: actor.id,
          type:
            this.withCompliance(pmoc).compliance.status === PmocComplianceStatus.OVERDUE
              ? AssetLifecycleEventType.PMOC_EXPIRED
              : AssetLifecycleEventType.PMOC_UPDATED,
          description: `PMOC updated for ${pmoc.equipment.name}`,
          metadata: { changedFields: Object.keys(dto), maintenancePlanId: pmoc.maintenancePlanId },
        },
        context,
      );
      await tx.auditLog.create({
        data: this.audit(PMOC_AUDIT_ACTIONS.UPDATED, PMOC_RESOURCE, actor.id, context, {
          pmocPlanId: id,
          changedFields: Object.keys(dto),
        }),
      });
      if (dto.applyDefaultsToPendingExecutions) {
        await tx.auditLog.create({
          data: this.audit(
            PMOC_AUDIT_ACTIONS.DEFAULTS_PROPAGATED,
            PMOC_RESOURCE,
            actor.id,
            context,
            {
              pmocPlanId: id,
              defaultOperatorId: dto.defaultOperatorId,
              defaultTechnicianId: dto.defaultTechnicianId,
              targetStatuses: [
                PmocExecutionRequestStatus.PENDING,
                PmocExecutionRequestStatus.FAILED,
              ],
            },
          ),
        });
      }
      return this.withCompliance(pmoc);
    });
  }

  async delete(
    id: string,
    actor: AuthenticatedUser,
    context: PmocAuditContext,
  ): Promise<{ deleted: true }> {
    const pmoc = await this.pmocOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      const cancelledAt = new Date();
      const cancellable = await tx.pmocExecutionRequest.findMany({
        where: {
          pmocPlanId: id,
          status: {
            in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.FAILED],
          },
        },
        select: { id: true, executionNumber: true },
      });
      await tx.pmocExecutionRequest.updateMany({
        where: { id: { in: cancellable.map((item) => item.id) } },
        data: { status: PmocExecutionRequestStatus.CANCELLED, cancelledAt },
      });
      await tx.pmocPlan.update({
        where: { id },
        data: {
          active: false,
          generationMode: PmocGenerationMode.PAUSED,
          operationalStatus: PmocOperationalStatus.PAUSED,
          nextExecutionDate: null,
          nextGenerationDate: null,
        },
      });
      await tx.maintenancePlan.update({
        where: { id: pmoc.maintenancePlanId },
        data: { active: false },
      });
      if (cancellable.length) {
        await tx.pmocHistory.createMany({
          data: cancellable.map((request) => ({
            pmocPlanId: id,
            executionRequestId: request.id,
            actorId: actor.id,
            action: PmocHistoryAction.REQUEST_CANCELLED,
            newStatus: PmocExecutionRequestStatus.CANCELLED,
            notes: 'Solicitação cancelada pela desativação do PMOC.',
            metadata: { executionNumber: request.executionNumber },
          })),
        });
      }
      await tx.auditLog.create({
        data: this.audit(PMOC_AUDIT_ACTIONS.DELETED, PMOC_RESOURCE, actor.id, context, {
          pmocPlanId: id,
          maintenancePlanId: pmoc.maintenancePlanId,
        }),
      });
    });
    return { deleted: true };
  }

  async listEnvironments(pmocPlanId: string): Promise<unknown> {
    await this.pmocOrThrow(pmocPlanId);
    return this.prisma.pmocEnvironment.findMany({
      where: { pmocPlanId },
      include: { equipments: { include: { equipment: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async createEnvironment(
    pmocPlanId: string,
    dto: CreatePmocEnvironmentDto,
    actor: AuthenticatedUser,
    context: PmocAuditContext,
  ): Promise<unknown> {
    const pmoc = await this.pmocOrThrow(pmocPlanId);
    const equipmentIds = dto.equipmentIds ? this.unique(dto.equipmentIds) : [];
    this.assertPmocEquipments(pmoc, equipmentIds);
    return this.prisma.$transaction(async (tx) => {
      const environment = await tx.pmocEnvironment.create({
        data: {
          pmocPlanId,
          name: this.clean(dto.name),
          area: dto.area ? this.clean(dto.area) : null,
          occupancy: dto.occupancy ?? null,
          observations: dto.observations ? this.clean(dto.observations) : null,
          equipments: {
            create: equipmentIds.map((equipmentId) => ({ equipmentId })),
          },
        },
        include: { equipments: { include: { equipment: true } } },
      });
      await tx.auditLog.create({
        data: this.audit(
          PMOC_AUDIT_ACTIONS.ENVIRONMENT_CREATED,
          PMOC_ENVIRONMENT_RESOURCE,
          actor.id,
          context,
          { pmocPlanId, environmentId: environment.id },
        ),
      });
      return environment;
    });
  }

  async updateEnvironment(
    id: string,
    dto: UpdatePmocEnvironmentDto,
    actor: AuthenticatedUser,
    context: PmocAuditContext,
  ): Promise<unknown> {
    const existing = await this.environmentOrThrow(id);
    const pmoc = await this.pmocOrThrow(existing.pmocPlanId);
    const equipmentIds = dto.equipmentIds ? this.unique(dto.equipmentIds) : null;
    if (equipmentIds) this.assertPmocEquipments(pmoc, equipmentIds);
    return this.prisma.$transaction(async (tx) => {
      if (equipmentIds) {
        await tx.pmocEnvironmentEquipment.deleteMany({ where: { environmentId: id } });
        await tx.pmocEnvironmentEquipment.createMany({
          data: equipmentIds.map((equipmentId) => ({ environmentId: id, equipmentId })),
          skipDuplicates: true,
        });
      }
      const environment = await tx.pmocEnvironment.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: this.clean(dto.name) } : {}),
          ...(dto.area !== undefined ? { area: dto.area ? this.clean(dto.area) : null } : {}),
          ...(dto.occupancy !== undefined ? { occupancy: dto.occupancy } : {}),
          ...(dto.observations !== undefined
            ? { observations: dto.observations ? this.clean(dto.observations) : null }
            : {}),
        },
        include: { equipments: { include: { equipment: true } } },
      });
      await tx.auditLog.create({
        data: this.audit(
          PMOC_AUDIT_ACTIONS.ENVIRONMENT_UPDATED,
          PMOC_ENVIRONMENT_RESOURCE,
          actor.id,
          context,
          { pmocPlanId: existing.pmocPlanId, environmentId: id, changedFields: Object.keys(dto) },
        ),
      });
      return environment;
    });
  }

  async deleteEnvironment(
    id: string,
    actor: AuthenticatedUser,
    context: PmocAuditContext,
  ): Promise<{ deleted: true }> {
    const existing = await this.environmentOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.pmocEnvironment.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: this.audit(
          PMOC_AUDIT_ACTIONS.ENVIRONMENT_DELETED,
          PMOC_ENVIRONMENT_RESOURCE,
          actor.id,
          context,
          { pmocPlanId: existing.pmocPlanId, environmentId: id },
        ),
      }),
    ]);
    return { deleted: true };
  }

  async compliance(id: string): Promise<unknown> {
    const pmoc = await this.pmocOrThrow(id);
    const documentConfiguration = await this.documentConfiguration.getConfigurationForType(
      DocumentTemplateType.PMOC,
    );
    return {
      pmocPlanId: id,
      ...this.evaluatePayload(pmoc),
      document: {
        type: DocumentTemplateType.PMOC,
        engine: 'DocumentEngine',
        defaultTemplate: documentConfiguration.defaultTemplate,
        ready: Boolean(documentConfiguration.defaultTemplate),
      },
    };
  }

  async evaluate(context: {
    resourceId: string;
    evaluatedAt: Date;
  }): Promise<ComplianceEvaluationResult> {
    const pmoc = await this.pmocOrThrow(context.resourceId);
    return this.evaluatePayload(pmoc, context.evaluatedAt);
  }

  async equipmentPmoc(equipmentId: string, query: ListPmocQueryDto): Promise<unknown> {
    await this.equipmentExistsOrThrow(equipmentId);
    return this.list({ ...query, equipmentId });
  }

  async stats(query: PmocDashboardQueryDto): Promise<unknown> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const { from, to } = this.dashboardRange(query, now);
    const nextSevenDays = new Date(now);
    nextSevenDays.setUTCDate(nextSevenDays.getUTCDate() + 7);
    const requestGroups = await this.prisma.pmocExecutionRequest.groupBy({
      by: ['status'],
      orderBy: { status: 'asc' },
      _count: { status: true },
    });
    const [
      plans,
      completedExecutions,
      executionsThisMonth,
      environments,
      monitored,
      calendar,
      upcoming,
      recent,
      overduePlans,
      warningPlans,
    ] = await this.prisma.$transaction([
      this.prisma.pmocPlan.findMany({
        select: { id: true, active: true, generationMode: true, endDate: true },
      }),
      this.prisma.pmocExecutionRequest.count({
        where: { maintenanceExecution: { status: MaintenanceExecutionStatus.COMPLETED } },
      }),
      this.prisma.pmocExecutionRequest.count({
        where: { scheduledFor: { gte: monthStart, lt: monthEnd } },
      }),
      this.prisma.pmocEnvironment.count(),
      this.prisma.pmocPlanEquipment.count(),
      this.prisma.pmocExecutionRequest.findMany({
        where: { scheduledFor: { gte: from, lte: to } },
        include: PMOC_DASHBOARD_REQUEST_INCLUDE,
        orderBy: [{ scheduledFor: 'asc' }, { executionNumber: 'asc' }],
        take: 500,
      }),
      this.prisma.pmocExecutionRequest.findMany({
        where: {
          scheduledFor: { gte: now },
          status: { in: [PmocExecutionRequestStatus.PENDING, PmocExecutionRequestStatus.GENERATED] },
        },
        include: PMOC_DASHBOARD_REQUEST_INCLUDE,
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
        take: 8,
      }),
      this.prisma.pmocExecutionRequest.findMany({
        where: {
          OR: [
            { generatedAt: { not: null } },
            { cancelledAt: { not: null } },
            { status: PmocExecutionRequestStatus.FAILED },
          ],
        },
        include: PMOC_DASHBOARD_REQUEST_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
      this.prisma.pmocExecutionRequest.findMany({
        where: {
          status: PmocExecutionRequestStatus.PENDING,
          scheduledFor: { lt: now },
        },
        select: { pmocPlanId: true },
        distinct: ['pmocPlanId'],
      }),
      this.prisma.pmocExecutionRequest.findMany({
        where: {
          status: PmocExecutionRequestStatus.PENDING,
          scheduledFor: { gte: now, lte: nextSevenDays },
        },
        select: { pmocPlanId: true },
        distinct: ['pmocPlanId'],
      }),
    ]);
    const statusCount = new Map<PmocExecutionRequestStatus, number>(
      requestGroups.map((group) => [group.status, group._count.status]),
    );
    const overdueIds = new Set(overduePlans.map((plan) => plan.pmocPlanId));
    const warningIds = new Set(warningPlans.map((plan) => plan.pmocPlanId));
    const activePlans = plans.filter(
      (plan) =>
        plan.active && plan.generationMode !== PmocGenerationMode.PAUSED && plan.endDate >= today,
    );
    const pausedPmocs = plans.filter(
      (plan) => !plan.active || plan.generationMode === PmocGenerationMode.PAUSED,
    ).length;
    const expiredPmocs = plans.filter((plan) => plan.endDate < today).length;
    const compliantPmocs = activePlans.filter(
      (plan) => !overdueIds.has(plan.id) && !warningIds.has(plan.id),
    ).length;
    const pendingPmocs = new Set([...overdueIds, ...warningIds]).size;
    return {
      activePmocs: activePlans.length,
      pausedPmocs,
      expiredPmocs,
      compliantPmocs,
      pendingPmocs,
      environments,
      monitoredEquipments: monitored,
      executionsThisMonth,
      completedExecutions,
      pendingExecutions:
        (statusCount.get(PmocExecutionRequestStatus.PENDING) ?? 0) +
        (statusCount.get(PmocExecutionRequestStatus.GENERATING_OS) ?? 0),
      cancelledExecutions: statusCount.get(PmocExecutionRequestStatus.CANCELLED) ?? 0,
      failedExecutions: statusCount.get(PmocExecutionRequestStatus.FAILED) ?? 0,
      upcomingExecutions: upcoming.length,
      calendar: {
        from: from.toISOString(),
        to: to.toISOString(),
        items: calendar.map((request) => this.dashboardExecution(request, now)),
      },
      upcoming: upcoming.map((request) => this.dashboardExecution(request, now)),
      recent: recent.map((request) => this.dashboardExecution(request, now)),
    };
  }

  private async analyticsForPlans(plans: PmocPayload[]): Promise<Map<string, unknown>> {
    if (!plans.length) return new Map();
    const requests = await this.prisma.pmocExecutionRequest.findMany({
      where: { pmocPlanId: { in: plans.map((plan) => plan.id) } },
      select: PMOC_ANALYTICS_REQUEST_SELECT,
      orderBy: [{ scheduledFor: 'asc' }, { executionNumber: 'asc' }],
    });
    const grouped = new Map<string, PmocAnalyticsRequest[]>();
    for (const request of requests) {
      const current = grouped.get(request.pmocPlanId) ?? [];
      current.push(request);
      grouped.set(request.pmocPlanId, current);
    }
    return new Map(
      plans.map((plan) => [plan.id, this.planOverview(plan, grouped.get(plan.id) ?? [])]),
    );
  }

  private planOverview(plan: PmocPayload, requests: PmocAnalyticsRequest[]): unknown {
    const now = new Date();
    const expectedExecutions = plan.plannedExecutionCount;
    const isCompleted = (request: PmocAnalyticsRequest): boolean =>
      request.maintenanceExecution?.status === MaintenanceExecutionStatus.COMPLETED ||
      request.operation?.status === OperationStatus.COMPLETED;
    const completed = requests.filter(isCompleted);
    const cancelled = requests.filter(
      (request) => request.status === PmocExecutionRequestStatus.CANCELLED,
    );
    const failed = requests.filter(
      (request) => request.status === PmocExecutionRequestStatus.FAILED,
    );
    const overdue = requests.filter(
      (request) =>
        request.status === PmocExecutionRequestStatus.PENDING && request.scheduledFor < now,
    );
    const delayDays = completed
      .map((request) => {
        const executedAt =
          request.maintenanceExecution?.executedAt ?? request.operation?.completedAt;
        if (!executedAt) return 0;
        return Math.max(0, (executedAt.getTime() - request.scheduledFor.getTime()) / 86_400_000);
      });
    const averageDelayDays = delayDays.length
      ? Number((delayDays.reduce((sum, value) => sum + value, 0) / delayDays.length).toFixed(1))
      : 0;
    const expectedEquipmentExecutions =
      expectedExecutions * Math.max(plan.equipments.length, 1);
    const completionPercentage = Number(
      ((completed.length / Math.max(expectedEquipmentExecutions, 1)) * 100).toFixed(1),
    );
    const denominator = Math.max(requests.length, 1);
    const score = Math.max(
      0,
      Math.round(
        100 -
          (100 - completionPercentage) * 0.25 -
          (overdue.length / denominator) * 35 -
          (failed.length / denominator) * 25 -
          (cancelled.length / denominator) * 15 -
          Math.min(averageDelayDays * 2, 25),
      ),
    );
    const health =
      score >= 90
        ? { code: 'EXCELLENT', label: 'Excelente', tone: 'success' }
        : score >= 75
          ? { code: 'GOOD', label: 'Boa', tone: 'success' }
          : score >= 50
            ? { code: 'ATTENTION', label: 'Atenção', tone: 'warning' }
            : { code: 'CRITICAL', label: 'Crítica', tone: 'danger' };
    const lastOperationRequest = [...requests]
      .filter((request) => request.operation)
      .sort((left, right) =>
        (right.generatedAt ?? right.scheduledFor).getTime() -
        (left.generatedAt ?? left.scheduledFor).getTime(),
      )[0];
    const documents = requests
      .flatMap((request) => request.operation?.documents ?? [])
      .filter((document) => document.renderedAt)
      .sort((left, right) =>
        (right.renderedAt?.getTime() ?? 0) - (left.renderedAt?.getTime() ?? 0),
      );
    const lastExecutedAt = completed
      .map(
        (request) =>
          request.maintenanceExecution?.executedAt ?? request.operation?.completedAt,
      )
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const coverageEnded = plan.endDate < today;
    const equipmentExecutions = plan.equipments.map(({ equipment }) => {
      const equipmentRequests = requests.filter(
        (request) => request.equipmentId === equipment.id,
      );
      const completedRequests = equipmentRequests.filter(isCompleted);
      const equipmentCompleted = completedRequests.length;
      const equipmentCancelled = equipmentRequests.filter(
        (request) => request.status === PmocExecutionRequestStatus.CANCELLED,
      ).length;
      const equipmentFailed = equipmentRequests.filter(
        (request) => request.status === PmocExecutionRequestStatus.FAILED,
      ).length;
      const equipmentOverdue = equipmentRequests.filter(
        (request) =>
          request.status === PmocExecutionRequestStatus.PENDING &&
          request.scheduledFor < now,
      ).length;
      const lastCompleted = [...completedRequests].sort(
        (left, right) =>
          right.equipmentExecutionNumber - left.equipmentExecutionNumber ||
          (
            right.maintenanceExecution?.executedAt ??
            right.operation?.completedAt ??
            right.generatedAt ??
            right.scheduledFor
          ).getTime() -
            (
              left.maintenanceExecution?.executedAt ??
              left.operation?.completedAt ??
              left.generatedAt ??
              left.scheduledFor
            ).getTime(),
      )[0];
      const nextRequest = equipmentRequests
        .filter(
          (request) =>
            request.status === PmocExecutionRequestStatus.PENDING ||
            request.status === PmocExecutionRequestStatus.GENERATING_OS,
        )
        .sort(
          (left, right) =>
            left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
            left.equipmentExecutionNumber - right.equipmentExecutionNumber,
        )[0];
      const generatedInProgress = equipmentRequests.some(
        (request) =>
          request.operation &&
          request.operation.status !== OperationStatus.COMPLETED &&
          request.status === PmocExecutionRequestStatus.GENERATED,
      );
      const remaining = Math.max(expectedExecutions - equipmentCompleted, 0);
      const executionStatus =
        remaining === 0
          ? 'COMPLETED'
          : equipmentFailed > 0
            ? 'ATTENTION'
            : equipmentOverdue > 0
              ? 'OVERDUE'
              : generatedInProgress
                ? 'IN_PROGRESS'
                : equipmentCompleted > 0
                  ? 'UP_TO_DATE'
                  : nextRequest
                    ? 'SCHEDULED'
                    : 'NOT_STARTED';
      return {
        equipmentId: equipment.id,
        expectedExecutions,
        completedExecutions: equipmentCompleted,
        remainingExecutions: remaining,
        cancelledExecutions: equipmentCancelled,
        failedExecutions: equipmentFailed,
        overdueExecutions: Math.max(
          equipmentOverdue,
          coverageEnded ? remaining : 0,
        ),
        lastExecutionNumber: lastCompleted?.equipmentExecutionNumber ?? null,
        lastExecutionDate:
          lastCompleted?.maintenanceExecution?.executedAt ??
          lastCompleted?.operation?.completedAt ??
          null,
        nextExecutionDate: nextRequest?.scheduledFor ?? null,
        executionStatus,
        nextExecutionNumber:
          nextRequest?.equipmentExecutionNumber ??
          Math.min(
            (equipmentRequests.reduce(
              (maximum, request) =>
                Math.max(maximum, request.equipmentExecutionNumber),
              0,
            ) || 0) + 1,
            expectedExecutions,
          ),
        hasOpenExecutions: remaining > 0,
        coverageEnded,
      };
    });
    const allEquipmentExecutionsCompleted =
      equipmentExecutions.length > 0 &&
      equipmentExecutions.every((item) => !item.hasOpenExecutions);
    const operationalStatus =
      coverageEnded && allEquipmentExecutionsCompleted
        ? PmocOperationalStatus.COMPLETED
        : coverageEnded
          ? PmocOperationalStatus.OVERDUE
          : this.operationalStatus(plan, now);
    return {
      expectedExecutions,
      expectedEquipmentExecutions,
      completedExecutions: completed.length,
      remainingExecutions: Math.max(expectedEquipmentExecutions - completed.length, 0),
      pendingExecutions: requests.filter(
        (request) =>
          request.status === PmocExecutionRequestStatus.PENDING ||
          request.status === PmocExecutionRequestStatus.GENERATING_OS,
      ).length,
      cancelledExecutions: cancelled.length,
      failedExecutions: failed.length,
      overdueExecutions: overdue.length,
      completionPercentage,
      averageDelayDays,
      lastExecutionDate: lastExecutedAt,
      lastOperation: lastOperationRequest?.operation ?? null,
      lastDocument: documents[0] ?? null,
      coverageEnded,
      hasOpenExecutions: coverageEnded && !allEquipmentExecutionsCompleted,
      operationalStatus,
      equipmentExecutions,
      health: { ...health, score },
    };
  }

  private dashboardRange(
    query: PmocDashboardQueryDto,
    now: Date,
  ): { from: Date; to: Date } {
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = query.to
      ? new Date(query.to)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    if (from > to || to.getTime() - from.getTime() > 370 * 86_400_000) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'PMOC dashboard period must be valid and no longer than 370 days',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { from, to };
  }

  private dashboardExecution(request: PmocDashboardRequest, now: Date): unknown {
    const completed = request.maintenanceExecution?.status === MaintenanceExecutionStatus.COMPLETED;
    const indicator = completed
      ? 'COMPLETED'
      : request.status === PmocExecutionRequestStatus.CANCELLED
        ? 'CANCELLED'
        : request.status === PmocExecutionRequestStatus.FAILED
          ? 'FAILED'
          : request.scheduledFor < now
            ? 'OVERDUE'
            : request.scheduledFor.getTime() - now.getTime() <= 7 * 86_400_000
              ? 'DUE_SOON'
              : 'ON_TIME';
    const equipments = [request.equipment];
    return {
      id: request.id,
      pmocPlanId: request.pmocPlanId,
      pmocNumber: `PMOC-${String(request.pmocPlan.number).padStart(6, '0')}`,
      planName: request.pmocPlan.maintenancePlan.name,
      customer: request.pmocPlan.customer,
      equipments,
      executionNumber: request.executionNumber,
      equipmentExecutionNumber: request.equipmentExecutionNumber,
      origin: request.origin,
      status: request.status,
      indicator,
      scheduledFor: request.scheduledFor,
      generatedAt: request.generatedAt,
      executedAt: request.maintenanceExecution?.executedAt ?? null,
      operator: request.plannedOperator,
      technician: request.plannedTechnician,
      operation: request.operation
        ? {
            id: request.operation.id,
            number: request.operation.number,
            status: request.operation.status,
          }
        : null,
      document: request.operation?.documents[0] ?? null,
    };
  }

  private withCompliance<T extends PmocPayload>(
    pmoc: T,
  ): T & { operationalStatus: PmocOperationalStatus; compliance: ComplianceEvaluationResult } {
    return {
      ...pmoc,
      operationalStatus: this.operationalStatus(pmoc),
      compliance: this.evaluatePayload(pmoc),
    };
  }

  private withOverview<T extends PmocPayload>(pmoc: T, overview: unknown): unknown {
    const base = this.withCompliance(pmoc);
    const status =
      overview &&
      typeof overview === 'object' &&
      'operationalStatus' in overview
        ? (overview as { operationalStatus: PmocOperationalStatus }).operationalStatus
        : base.operationalStatus;
    return { ...base, operationalStatus: status, overview };
  }

  private operationalStatus(pmoc: PmocPayload, now = new Date()): PmocOperationalStatus {
    if (pmoc.operationalStatus === PmocOperationalStatus.COMPLETED) {
      return PmocOperationalStatus.COMPLETED;
    }
    if (!pmoc.active || pmoc.generationMode === PmocGenerationMode.PAUSED) {
      return PmocOperationalStatus.PAUSED;
    }
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    if (pmoc.endDate < today) return PmocOperationalStatus.OVERDUE;
    if (pmoc.executionRequests.some((request) => request.status === PmocExecutionRequestStatus.FAILED)) {
      return PmocOperationalStatus.ERROR;
    }
    if (
      pmoc.executionRequests.some(
        (request) =>
          request.status === PmocExecutionRequestStatus.PENDING && request.scheduledFor < now,
      )
    ) {
      return PmocOperationalStatus.OVERDUE;
    }
    if (pmoc.executionRequests.some((request) => request.status === PmocExecutionRequestStatus.PENDING)) {
      return PmocOperationalStatus.PENDING;
    }
    return PmocOperationalStatus.ACTIVE;
  }

  private evaluatePayload(pmoc: PmocPayload, evaluatedAt = new Date()): ComplianceEvaluationResult {
    const reasons: string[] = [];
    const pending = pmoc.maintenancePlan.executions.filter(
      (execution) =>
        execution.status === MaintenanceExecutionStatus.PLANNED ||
        execution.status === MaintenanceExecutionStatus.LINKED,
    );
    const overdueExecutions = pending.filter((execution) => execution.scheduledAt < evaluatedAt);
    const nextSevenDays = new Date(evaluatedAt);
    nextSevenDays.setUTCDate(nextSevenDays.getUTCDate() + 7);
    const upcomingSoon = pending.filter((execution) => execution.scheduledAt <= nextSevenDays);

    let status: PmocComplianceStatus = PmocComplianceStatus.COMPLIANT;
    if (!pmoc.active || !pmoc.maintenancePlan.active) {
      status = PmocComplianceStatus.NON_COMPLIANT;
      reasons.push('PMOC or maintenance plan is inactive');
    } else if (pmoc.endDate < evaluatedAt) {
      status = PmocComplianceStatus.OVERDUE;
      reasons.push('PMOC validity is expired');
    } else if (overdueExecutions.length > 0) {
      status = PmocComplianceStatus.OVERDUE;
      reasons.push('There are overdue maintenance executions');
    } else if (pmoc.startDate > evaluatedAt) {
      status = PmocComplianceStatus.IN_PROGRESS;
      reasons.push('PMOC validity has not started yet');
    } else if (upcomingSoon.length > 0) {
      status = PmocComplianceStatus.WARNING;
      reasons.push('There are upcoming PMOC executions within seven days');
    }

    return { status, reasons, evaluatedAt };
  }

  private async pmocOrThrow(id: string): Promise<PmocPayload> {
    const pmoc = await this.prisma.pmocPlan.findUnique({ where: { id }, include: PMOC_INCLUDE });
    if (!pmoc) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_PLAN_NOT_FOUND,
        'PMOC plan was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return pmoc;
  }

  private async environmentOrThrow(id: string): Promise<{ id: string; pmocPlanId: string }> {
    const environment = await this.prisma.pmocEnvironment.findUnique({
      where: { id },
      select: { id: true, pmocPlanId: true },
    });
    if (!environment) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_ENVIRONMENT_NOT_FOUND,
        'PMOC environment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return environment;
  }

  private async organizationOrThrow(): Promise<{ id: string }> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organization was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization;
  }

  private async equipmentExistsOrThrow(id: string): Promise<void> {
    const equipment = await this.prisma.equipment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!equipment) {
      throw new ApplicationException(
        ERROR_CODES.EQUIPMENT_NOT_FOUND,
        'Equipment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async equipmentForCustomerOrThrow(
    equipmentId: string,
    customerId: string,
  ): Promise<{ id: string; name: string }> {
    const equipment = await this.prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: { id: true, name: true, customerId: true },
    });
    if (!equipment) {
      throw new ApplicationException(
        ERROR_CODES.EQUIPMENT_NOT_FOUND,
        'Equipment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (equipment.customerId !== customerId) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
        'Equipment does not belong to the PMOC customer',
        HttpStatus.BAD_REQUEST,
      );
    }
    return equipment;
  }

  private async equipmentsForCustomerOrThrow(
    equipmentIds: string[],
    customerId: string,
  ): Promise<void> {
    const equipments = await this.prisma.equipment.findMany({
      where: { id: { in: equipmentIds }, isActive: true, disabledAt: null },
      select: { id: true, customerId: true },
    });
    if (equipments.length !== equipmentIds.length) {
      throw new ApplicationException(
        ERROR_CODES.EQUIPMENT_NOT_FOUND,
        'One or more PMOC equipments were not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (equipments.some((equipment) => equipment.customerId !== customerId)) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
        'All PMOC equipments must belong to the same customer',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async customerForPmocOrThrow(
    customerId: string,
  ): Promise<{ id: string; name: string; tradeName: string | null }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, isActive: true },
      select: { id: true, name: true, tradeName: true },
    });
    if (!customer) {
      throw new ApplicationException(
        ERROR_CODES.CUSTOMER_NOT_FOUND,
        'Active PMOC customer was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return customer;
  }

  private pmocPlanName(customerName: string, pmocNumber: number): string {
    const prefix = 'PMOC · ';
    const suffix = ` · PMOC-${String(pmocNumber).padStart(6, '0')}`;
    const customerLimit = Math.max(1, 140 - prefix.length - suffix.length);
    return `${prefix}${this.clean(customerName).slice(0, customerLimit)}${suffix}`;
  }

  private async planScopesOrThrow(
    ids: string[] | undefined,
    organizationId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    if (!ids?.length) return [];
    const uniqueIds = this.unique(ids);
    const scopes = await this.prisma.technicalCatalog.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId,
        type: TechnicalCatalogType.PLAN_SCOPE,
        active: true,
        deletedAt: null,
      },
      select: { id: true, title: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    if (scopes.length !== uniqueIds.length) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_NOT_FOUND,
        'Every PMOC scope must be an active PLAN_SCOPE catalog item from this organization',
        HttpStatus.BAD_REQUEST,
      );
    }
    return scopes;
  }

  private async planChecklistsOrThrow(
    ids: string[] | undefined,
    organizationId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    if (!ids?.length) return [];
    const uniqueIds = this.unique(ids);
    const checklists = await this.prisma.technicalCatalog.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId,
        type: TechnicalCatalogType.CHECKLIST,
        active: true,
        deletedAt: null,
        // Aceita itens do Checklist PMOC (workflow PMOC, cadastrados por unidade)
        // e, por compatibilidade, os checklists gerais/de OS.
        OR: [
          { workflows: { has: TechnicalCatalogWorkflow.PMOC } },
          { workflows: { has: TechnicalCatalogWorkflow.WORK_ORDER } },
          { workflows: { has: TechnicalCatalogWorkflow.GENERAL } },
        ],
      },
      select: { id: true, title: true },
    });
    if (checklists.length !== uniqueIds.length) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_NOT_FOUND,
        'Every PMOC checklist must be an active checklist from this organization',
        HttpStatus.BAD_REQUEST,
      );
    }
    const byId = new Map(checklists.map((item) => [item.id, item]));
    return uniqueIds.map((id) => byId.get(id)!);
  }

  private periodicityFromRule(rule?: RecurrenceRuleDto): PmocPeriodicity {
    if (!rule) return PmocPeriodicity.MONTHLY;
    const interval = rule.interval ?? 1;
    if (rule.frequency === RecurrenceFrequency.WEEKLY && interval === 1) return PmocPeriodicity.WEEKLY;
    if (rule.frequency === RecurrenceFrequency.WEEKLY && interval === 2) return PmocPeriodicity.BIWEEKLY;
    if (rule.frequency === RecurrenceFrequency.MONTHLY && interval === 1) return PmocPeriodicity.MONTHLY;
    if (rule.frequency === RecurrenceFrequency.MONTHLY && interval === 2) return PmocPeriodicity.BIMONTHLY;
    if (rule.frequency === RecurrenceFrequency.MONTHLY && interval === 3) return PmocPeriodicity.QUARTERLY;
    if (rule.frequency === RecurrenceFrequency.MONTHLY && interval === 4) return PmocPeriodicity.FOUR_MONTHLY;
    if (rule.frequency === RecurrenceFrequency.MONTHLY && interval === 6) return PmocPeriodicity.SEMIANNUAL;
    if (rule.frequency === RecurrenceFrequency.YEARLY && interval === 1) return PmocPeriodicity.YEARLY;
    return PmocPeriodicity.CUSTOM;
  }

  private ruleForPeriodicity(periodicity: PmocPeriodicity): RecurrenceRuleDto {
    const rules: Record<Exclude<PmocPeriodicity, 'CUSTOM'>, RecurrenceRuleDto> = {
      WEEKLY: { frequency: RecurrenceFrequency.WEEKLY, interval: 1 },
      BIWEEKLY: { frequency: RecurrenceFrequency.WEEKLY, interval: 2 },
      MONTHLY: { frequency: RecurrenceFrequency.MONTHLY, interval: 1 },
      BIMONTHLY: { frequency: RecurrenceFrequency.MONTHLY, interval: 2 },
      QUARTERLY: { frequency: RecurrenceFrequency.MONTHLY, interval: 3 },
      FOUR_MONTHLY: { frequency: RecurrenceFrequency.MONTHLY, interval: 4 },
      SEMIANNUAL: { frequency: RecurrenceFrequency.MONTHLY, interval: 6 },
      YEARLY: { frequency: RecurrenceFrequency.YEARLY, interval: 1 },
    };
    if (periodicity === PmocPeriodicity.CUSTOM) {
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_RECURRENCE_INVALID,
        'CUSTOM PMOC periodicity requires recurrenceRule',
        HttpStatus.BAD_REQUEST,
      );
    }
    return rules[periodicity];
  }

  private async validateDefaults(
    operatorId?: string,
    technicianId?: string,
    signatureId?: string,
  ): Promise<void> {
    const userIds = this.unique([operatorId, technicianId].filter((id): id is string => Boolean(id)));
    if (userIds.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true, disabledAt: null },
        select: { id: true, role: true },
      });
      if (users.length !== userIds.length) {
        throw new ApplicationException(
          ERROR_CODES.USER_NOT_FOUND,
          'PMOC default users must exist and be active',
          HttpStatus.NOT_FOUND,
        );
      }
      const operator = operatorId ? users.find((user) => user.id === operatorId) : null;
      if (operator?.role === Role.VIEWER) {
        throw new ApplicationException(
          ERROR_CODES.OPERATION_OPERATOR_INVALID,
          'Viewer cannot be the default PMOC operator',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (signatureId) {
      const signature = await this.prisma.signature.findFirst({
        where: { id: signatureId, active: true, deletedAt: null },
        select: { id: true },
      });
      if (!signature) {
        throw new ApplicationException(
          ERROR_CODES.SIGNATURE_NOT_FOUND,
          'Active PMOC signature override was not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }
  }

  private async validateConfigurationTechnician(
    technicianId?: string,
    signatureId?: string,
  ): Promise<void> {
    if (!technicianId || !signatureId) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
        'Selecione um responsável técnico OWNER com assinatura ativa',
        HttpStatus.BAD_REQUEST,
      );
    }
    const technician = await this.prisma.user.findFirst({
      where: {
        id: technicianId,
        role: Role.OWNER,
        isActive: true,
        disabledAt: null,
        institutionalSignature: {
          is: {
            id: signatureId,
            active: true,
            deletedAt: null,
            imageStorageKey: { not: null },
          },
        },
      },
      select: { id: true },
    });
    if (!technician) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
        'O responsável técnico deve ser um OWNER ativo com assinatura cadastrada',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async validateAddress(addressId: string | undefined, customerId: string): Promise<void> {
    if (!addressId) return;
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
      select: { id: true },
    });
    if (!address) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
        'PMOC default address must belong to the selected customer',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertPmocEquipments(pmoc: PmocPayload, equipmentIds: string[]): void {
    const allowed = new Set(pmoc.equipments.map((item) => item.equipmentId));
    for (const equipmentId of equipmentIds) {
      if (!allowed.has(equipmentId)) {
        throw new ApplicationException(
          ERROR_CODES.PMOC_INVALID_RELATIONSHIP,
          'Environment equipment must be controlled by the PMOC',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private assertDateRange(startDate: Date, endDate: Date): void {
    if (endDate < startDate) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'PMOC endDate must be after startDate',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private dateOnly(value: string): Date {
    // Datas do PMOC são datas-calendário (sem fuso). Fixamos meio-dia UTC para
    // que a exibição em qualquer fuso (ex.: BRT UTC-3) mantenha o mesmo dia —
    // `new Date('2026-07-25')` cairia em meia-noite UTC e voltaria para 24/07.
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  private activeCoveragePlans(customerId: string, reference: Date): Promise<ActiveCoveragePlan[]> {
    const day = new Date(Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
    ));
    return this.prisma.pmocPlan.findMany({
      where: {
        customerId,
        active: true,
        startDate: { lte: day },
        endDate: { gte: day },
        maintenancePlan: { active: true },
      },
      select: ACTIVE_COVERAGE_SELECT,
      orderBy: [{ endDate: 'asc' }, { number: 'asc' }],
      take: 20,
    });
  }

  private activeCoverageProjection(plan: ActiveCoveragePlan): ActiveCoverageProjection {
    return {
      id: plan.id,
      number: plan.number,
      name: plan.maintenancePlan.name,
      coverage: plan.coverage,
      startDate: plan.startDate,
      endDate: plan.endDate,
      operationalStatus: plan.operationalStatus,
      equipmentCount: plan._count.equipments,
    };
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }

  private operationTypes(primary: OperationType, values?: OperationType[]): OperationType[] {
    const normalized = [...new Set([primary, ...(values ?? [])])];
    if (normalized.length > 4) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'A PMOC can use at most four official Operation types',
        HttpStatus.BAD_REQUEST,
      );
    }
    return normalized;
  }

  private page<T>(items: T[], page: number, limit: number, total: number): PaginatedResponse<T> {
    return buildPaginatedResponse(items, total, page, limit);
  }

  private audit(
    action: string,
    resource: string,
    actor: string,
    context: PmocAuditContext,
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
