import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AssetLifecycleEventType,
  AssignmentEventType,
  AssignmentStatus,
  DocumentTemplateType,
  OperationStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { ASSIGNMENT_AUDIT_ACTIONS, ASSIGNMENT_RESOURCE } from '../../shared/constants/assignments.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES, OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES } from '../../shared/constants/document-engine.constants';
import { PMOC_MIN_PROCEDURE_IMAGES } from '../../shared/constants/pmoc.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { MaintenancePlanningService } from '../maintenance-planning/maintenance-planning.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AssignmentNotesDto,
  AuthorizeDemandsDto,
  CreateAssignmentDto,
  ListAssignmentsQueryDto,
  ReassignAssignmentDto,
  RejectAssignmentDto,
} from './dto/assignment.dto';

export interface AssignmentAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const ASSIGNMENT_INCLUDE = {
  assigner: { select: { id: true, name: true, username: true, role: true } },
  assignee: { select: { id: true, name: true, username: true, role: true } },
  operation: {
    include: {
      customer: { select: { id: true, name: true, tradeName: true, phone: true, secondaryPhone: true } },
      address: true,
      equipment: { select: { id: true, name: true, tag: true, type: true } },
      operator: { select: { id: true, name: true } },
      documents: { orderBy: { createdAt: 'asc' as const } },
      maintenanceExecution: {
        include: {
          pmocExecutionRequest: {
            select: { id: true, executionNumber: true, executionYear: true, status: true, origin: true },
          },
          plan: {
            include: {
              pmocPlan: {
                select: {
                  id: true,
                  number: true,
                  periodicity: true,
                  generationMode: true,
                  serviceTypes: true,
                  responsibleTechnician: true,
                  contractNumber: true,
                  artNumber: true,
                  equipments: {
                    select: { equipment: { select: { id: true, name: true, tag: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.AssignmentInclude;

const ASSIGNMENT_HISTORY_INCLUDE = {
  actor: { select: { id: true, name: true, username: true, role: true } },
} satisfies Prisma.AssignmentHistoryInclude;

type AssignmentPayload = Prisma.AssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;
type AssignmentHistoryPayload = Prisma.AssignmentHistoryGetPayload<{
  include: typeof ASSIGNMENT_HISTORY_INCLUDE;
}>;
type AssignmentLifecycleType =
  | typeof AssetLifecycleEventType.ASSIGNMENT_CREATED
  | typeof AssetLifecycleEventType.ASSIGNMENT_REASSIGNED
  | typeof AssetLifecycleEventType.ASSIGNMENT_ACCEPTED
  | typeof AssetLifecycleEventType.ASSIGNMENT_STARTED
  | typeof AssetLifecycleEventType.ASSIGNMENT_COMPLETED;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: LifecyclePublisher,
    private readonly maintenance: MaintenancePlanningService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListAssignmentsQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const isOperator = actor.role === Role.OPERATOR;
    const where = this.listWhere(query, isOperator ? actor.id : undefined, isOperator);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        include: ASSIGNMENT_INCLUDE,
      }),
      this.prisma.assignment.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async my(query: ListAssignmentsQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const where = this.listWhere(query, actor.id, actor.role === Role.OPERATOR);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [
          { operation: { number: 'desc' } },
          { operation: { scheduledFor: 'desc' } },
          { assignedAt: 'desc' },
          { id: 'desc' },
        ],
        include: ASSIGNMENT_INCLUDE,
      }),
      this.prisma.assignment.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  /** Demandas (ASSIGNED) ainda não autorizadas, agrupadas por técnico. */
  async pendingAuthorization(): Promise<unknown> {
    const pending = await this.prisma.assignment.findMany({
      where: {
        status: AssignmentStatus.ASSIGNED,
        operatorVisible: false,
      },
      orderBy: [{ assignedTo: 'asc' }, { operation: { scheduledFor: 'asc' } }],
      select: {
        id: true,
        assignedTo: true,
        assignee: { select: { id: true, name: true, username: true } },
        operation: {
          select: {
            id: true,
            number: true,
            type: true,
            scheduledFor: true,
            customer: { select: { name: true, tradeName: true } },
          },
        },
      },
    });
    const groups = new Map<
      string,
      {
        operator: { id: string; name: string; username: string };
        total: number;
        items: Array<{
          assignmentId: string;
          operationId: string;
          number: number;
          type: string;
          scheduledFor: string | null;
          customerName: string | null;
        }>;
      }
    >();
    for (const item of pending) {
      let group = groups.get(item.assignedTo);
      if (!group) {
        group = { operator: item.assignee, total: 0, items: [] };
        groups.set(item.assignedTo, group);
      }
      group.total += 1;
      group.items.push({
        assignmentId: item.id,
        operationId: item.operation.id,
        number: item.operation.number,
        type: item.operation.type,
        scheduledFor: item.operation.scheduledFor ? item.operation.scheduledFor.toISOString() : null,
        customerName: item.operation.customer?.tradeName ?? item.operation.customer?.name ?? null,
      });
    }
    return [...groups.values()];
  }

  /** Libera a exibição no app do operador (por técnico, por dia e/ou ids). */
  async authorize(dto: AuthorizeDemandsDto, actor: AuthenticatedUser): Promise<{ authorized: number }> {
    const where: Prisma.AssignmentWhereInput = {
      status: AssignmentStatus.ASSIGNED,
      operatorVisible: false,
      ...(dto.assignmentIds?.length ? { id: { in: dto.assignmentIds } } : {}),
      ...(dto.operatorId ? { assignedTo: dto.operatorId } : {}),
    };
    if (dto.date) {
      const day = dto.date.slice(0, 10);
      where.operation = {
        scheduledFor: {
          gte: new Date(`${day}T00:00:00.000Z`),
          lte: new Date(`${day}T23:59:59.999Z`),
        },
      };
    }
    const result = await this.prisma.assignment.updateMany({
      where,
      data: { operatorVisible: true, authorizedAt: new Date(), authorizedBy: actor.id },
    });
    return { authorized: result.count };
  }

  async get(id: string, actor: AuthenticatedUser): Promise<AssignmentPayload> {
    const assignment = await this.assignmentOrThrow(id);
    this.assertCanRead(assignment, actor);
    return assignment;
  }

  async history(operationId: string, actor: AuthenticatedUser): Promise<AssignmentHistoryPayload[]> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { operationId, isPrimary: true },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!assignment) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_NOT_FOUND,
        'Assignment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    this.assertCanRead(assignment, actor);
    return this.prisma.assignmentHistory.findMany({
      where: { operationId },
      orderBy: { createdAt: 'asc' },
      include: ASSIGNMENT_HISTORY_INCLUDE,
    });
  }

  async create(
    dto: CreateAssignmentDto,
    actor: AuthenticatedUser,
    context: AssignmentAuditContext,
  ): Promise<AssignmentPayload> {
    return this.prisma.$transaction(async (tx) => {
      await this.operationOrThrowTx(tx, dto.operationId);
      const existing = await tx.assignment.findFirst({
        where: { operationId: dto.operationId, isPrimary: true },
        select: { id: true },
      });
      if (existing) {
        throw new ApplicationException(
          ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION,
          'Operation already has a primary assignment',
          HttpStatus.CONFLICT,
        );
      }
      await this.operationalUserOrThrowTx(tx, dto.assignedTo);
      const assignment = await this.createForOperationTx(
        tx,
        {
          operationId: dto.operationId,
          assignedBy: actor.id,
          assignedTo: dto.assignedTo,
          notes: dto.notes ?? null,
        },
        actor.id,
        context,
      );
      return tx.assignment.findUniqueOrThrow({ where: { id: assignment.id }, include: ASSIGNMENT_INCLUDE });
    });
  }

  async reassign(
    id: string,
    dto: ReassignAssignmentDto,
    actor: AuthenticatedUser,
    context: AssignmentAuditContext,
  ): Promise<AssignmentPayload> {
    return this.prisma.$transaction(async (tx) => {
      await this.operationalUserOrThrowTx(tx, dto.assignedTo);
      const current = await this.assignmentOrThrowTx(tx, id);
      this.assertReassignable(current);
      const previousStatus = current.status;
      const now = new Date();
      const transition = await tx.assignment.updateMany({
        where: { id, status: current.status, assignedTo: current.assignedTo },
        data: {
          assignedBy: actor.id,
          assignedTo: dto.assignedTo,
          assignedAt: now,
          status: AssignmentStatus.ASSIGNED,
          // Reatribuição volta a exigir autorização, salvo auto-atribuição.
          operatorVisible: actor.id === dto.assignedTo,
          authorizedAt: actor.id === dto.assignedTo ? now : null,
          authorizedBy: actor.id === dto.assignedTo ? actor.id : null,
          acceptedAt: null,
          startedAt: null,
          completedAt: null,
          canceledAt: null,
          rejectedAt: null,
          rejectionReason: null,
          notes: dto.notes ?? current.notes,
        },
      });
      if (transition.count !== 1) {
        throw new ApplicationException(
          ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION,
          'Assignment changed while reassignment was being processed',
          HttpStatus.CONFLICT,
        );
      }
      const assignment = await tx.assignment.findUniqueOrThrow({ where: { id } });
      await tx.operation.update({ where: { id: assignment.operationId }, data: { operatorId: dto.assignedTo } });
      if (dto.auxiliaryOperatorIds !== undefined) {
        await this.syncAuxiliaryAssignmentsTx(
          tx,
          assignment.operationId,
          dto.assignedTo,
          dto.auxiliaryOperatorIds,
          actor.id,
          context,
        );
      }
      // Reassignment restarts the field flow: the operation waits for the new
      // operator again (never resurrects COMPLETED/CANCELED operations).
      await tx.operation.updateMany({
        where: {
          id: assignment.operationId,
          status: { in: [OperationStatus.DRAFT, OperationStatus.IN_PROGRESS, OperationStatus.REVIEW] },
        },
        data: { status: OperationStatus.PENDING },
      });
      await this.historyTx(tx, assignment, AssignmentEventType.REASSIGNED, actor.id, previousStatus, dto.notes);
      await this.auditTx(tx, ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_REASSIGNED, actor.id, context, {
        assignmentId: assignment.id,
        operationId: assignment.operationId,
        assignedTo: assignment.assignedTo,
        previousStatus,
        newStatus: assignment.status,
      });
      await this.lifecycle.publishAssignmentEventTx(
        tx,
        {
          assignmentId: assignment.id,
          operationId: assignment.operationId,
          actorId: actor.id,
          type: AssetLifecycleEventType.ASSIGNMENT_REASSIGNED,
          description: 'Assignment reassigned',
          metadata: { assignedTo: assignment.assignedTo, previousStatus, newStatus: assignment.status },
        },
        context,
      );
      return tx.assignment.findUniqueOrThrow({ where: { id }, include: ASSIGNMENT_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async accept(id: string, actor: AuthenticatedUser, context: AssignmentAuditContext): Promise<AssignmentPayload> {
    return this.transition(id, actor, context, {
      event: AssignmentEventType.ACCEPTED,
      action: ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_ACCEPTED,
      status: AssignmentStatus.ACCEPTED,
      lifecycleType: AssetLifecycleEventType.ASSIGNMENT_ACCEPTED,
      field: 'acceptedAt',
      allowedFrom: [AssignmentStatus.ASSIGNED],
      description: 'Assignment accepted',
    });
  }

  async start(id: string, actor: AuthenticatedUser, context: AssignmentAuditContext): Promise<AssignmentPayload> {
    return this.transition(id, actor, context, {
      event: AssignmentEventType.STARTED,
      action: ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_STARTED,
      status: AssignmentStatus.STARTED,
      lifecycleType: AssetLifecycleEventType.ASSIGNMENT_STARTED,
      field: 'startedAt',
      allowedFrom: [AssignmentStatus.ACCEPTED],
      description: 'Assignment started',
      operationStatus: 'IN_PROGRESS',
    });
  }

  async complete(
    id: string,
    dto: AssignmentNotesDto,
    actor: AuthenticatedUser,
    context: AssignmentAuditContext,
  ): Promise<AssignmentPayload> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      select: {
        operation: {
          select: {
            requestedDocumentType: true,
            signatureData: true,
            customerSignerName: true,
            signedAt: true,
            _count: { select: { photos: true } },
            maintenanceExecution: {
              select: { plan: { select: { pmocPlan: { select: { id: true } } } } },
            },
          },
        },
      },
    });
    if (
      assignment?.operation.maintenanceExecution?.plan.pmocPlan &&
      assignment.operation._count.photos < PMOC_MIN_PROCEDURE_IMAGES
    ) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EVIDENCE_REQUIRED,
        `Registre pelo menos ${PMOC_MIN_PROCEDURE_IMAGES} imagens do procedimento antes de concluir`,
        HttpStatus.CONFLICT,
        {
          required: PMOC_MIN_PROCEDURE_IMAGES,
          current: assignment.operation._count.photos,
        },
      );
    }
    const directCompletion = OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES.includes(
      (assignment?.operation.requestedDocumentType ?? DocumentTemplateType.WORK_ORDER) as
        (typeof OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES)[number],
    );
    const customerSignatureRequired = CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES.includes(
      (assignment?.operation.requestedDocumentType ?? DocumentTemplateType.WORK_ORDER) as
        (typeof CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES)[number],
    );
    if (
      customerSignatureRequired &&
      (!assignment?.operation.signatureData ||
        !assignment.operation.customerSignerName?.trim() ||
        !assignment.operation.signedAt)
    ) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED,
        'Colete a assinatura e identifique o cliente/responsável antes de concluir',
        HttpStatus.CONFLICT,
      );
    }
    return this.transition(id, actor, context, {
      event: AssignmentEventType.COMPLETED,
      action: ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_COMPLETED,
      status: AssignmentStatus.COMPLETED,
      lifecycleType: AssetLifecycleEventType.ASSIGNMENT_COMPLETED,
      field: 'completedAt',
      allowedFrom: [AssignmentStatus.STARTED],
      description: 'Assignment completed',
      notes: dto.notes,
      // OS e Visita Técnica são concluídas em campo. Os demais tipos atribuídos
      // preservam o workflow editorial de revisão da gestão.
      operationStatus: directCompletion ? 'COMPLETED' : 'REVIEW',
      syncOperationCompletion: directCompletion,
    });
  }

  async reject(
    id: string,
    dto: RejectAssignmentDto,
    actor: AuthenticatedUser,
    context: AssignmentAuditContext,
  ): Promise<AssignmentPayload> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.assignmentOrThrowTx(tx, id);
      this.assertRvtPrimaryExecutor(current);
      this.assertAssignee(current, actor);
      this.assertAllowed(current.status, [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED]);
      const now = new Date();
      const transition = await tx.assignment.updateMany({
        where: { id, assignedTo: actor.id, status: current.status },
        data: {
          status: AssignmentStatus.REJECTED,
          rejectedAt: now,
          rejectionReason: dto.rejectionReason,
        },
      });
      if (transition.count !== 1) {
        throw new ApplicationException(
          ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION,
          'Assignment transition conflicted with another update',
          HttpStatus.CONFLICT,
        );
      }
      const assignment = await tx.assignment.findUniqueOrThrow({ where: { id } });
      await this.historyTx(
        tx,
        assignment,
        AssignmentEventType.REJECTED,
        actor.id,
        current.status,
        dto.rejectionReason,
      );
      await this.auditTx(tx, ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_REJECTED, actor.id, context, {
        assignmentId: assignment.id,
        operationId: assignment.operationId,
        reason: dto.rejectionReason,
      });
      await this.notifications.notifyAssignmentRejectedTx(tx, assignment.id, dto.rejectionReason ?? null);
      return tx.assignment.findUniqueOrThrow({ where: { id }, include: ASSIGNMENT_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createForOperationTx(
    tx: Prisma.TransactionClient,
    input: {
      operationId: string;
      assignedBy: string;
      assignedTo: string;
      notes?: string | null;
      /** false para técnicos auxiliares (recebem/visualizam, não executam). */
      isPrimary?: boolean;
      /** Seleção explícita no fluxo de execução já autoriza a visualização. */
      operatorVisible?: boolean;
    },
    actorId: string,
    context?: Partial<AssignmentAuditContext>,
  ): Promise<{ id: string }> {
    await this.operationalUserOrThrowTx(tx, input.assignedTo);
    const isPrimary = input.isPrimary ?? true;
    // Auto-atribuição (o operador iniciou o próprio atendimento) já nasce visível;
    // demanda criada pela gestão fica oculta até o owner autorizar a exibição.
    const selfAssigned = input.assignedBy === input.assignedTo;
    const operatorVisible = selfAssigned || input.operatorVisible === true;
    const assignment = await tx.assignment.create({
      data: {
        operationId: input.operationId,
        assignedBy: input.assignedBy,
        assignedTo: input.assignedTo,
        isPrimary,
        notes: input.notes ?? null,
        operatorVisible,
        authorizedAt: operatorVisible ? new Date() : null,
        authorizedBy: operatorVisible ? input.assignedBy : null,
      },
    });
    // Só o executor primário move a operação para PENDING; auxiliares apenas
    // recebem/visualizam a mesma demanda.
    if (isPrimary) {
      await tx.operation.updateMany({
        where: { id: input.operationId, status: OperationStatus.DRAFT },
        data: { status: OperationStatus.PENDING },
      });
    }
    await this.historyTx(tx, assignment, AssignmentEventType.ASSIGNED, actorId, null, input.notes ?? null);
    await this.auditTx(tx, ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_CREATED, actorId, this.safeContext(context), {
      assignmentId: assignment.id,
      operationId: assignment.operationId,
      assignedBy: assignment.assignedBy,
      assignedTo: assignment.assignedTo,
      status: assignment.status,
    });
    await this.lifecycle.publishAssignmentEventTx(
      tx,
      {
        assignmentId: assignment.id,
        operationId: assignment.operationId,
        actorId,
        type: AssetLifecycleEventType.ASSIGNMENT_CREATED,
        description: 'Assignment created',
        metadata: { assignedBy: assignment.assignedBy, assignedTo: assignment.assignedTo },
      },
      context,
    );
    await this.notifications.notifyAssignmentAssignedTx(tx, assignment.id);
    return { id: assignment.id };
  }

  async syncAuxiliaryAssignmentsTx(
    tx: Prisma.TransactionClient,
    operationId: string,
    primaryOperatorId: string,
    requestedIds: string[],
    actorId: string,
    context?: Partial<AssignmentAuditContext>,
  ): Promise<void> {
    const desiredIds = [...new Set(requestedIds)].filter((id) => id !== primaryOperatorId);
    for (const id of desiredIds) await this.operationalUserOrThrowTx(tx, id);

    const current = await tx.assignment.findMany({
      where: { operationId, isPrimary: false },
      orderBy: { assignedAt: 'asc' },
    });
    const desired = new Set(desiredIds);
    const now = new Date();

    for (const assignment of current) {
      if (desired.has(assignment.assignedTo)) continue;
      if (assignment.status === AssignmentStatus.CANCELED) continue;
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { status: AssignmentStatus.CANCELED, canceledAt: now },
      });
      await this.historyTx(
        tx,
        { ...assignment, status: AssignmentStatus.CANCELED },
        AssignmentEventType.CANCELED,
        actorId,
        assignment.status,
        'Auxiliar técnico removido da execução',
      );
      await this.auditTx(
        tx,
        ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_CANCELED,
        actorId,
        this.safeContext(context),
        { assignmentId: assignment.id, operationId, assignedTo: assignment.assignedTo, isPrimary: false },
      );
    }

    for (const assignedTo of desiredIds) {
      const existing = current.find((item) => item.assignedTo === assignedTo);
      if (!existing) {
        await this.createForOperationTx(
          tx,
          { operationId, assignedBy: actorId, assignedTo, isPrimary: false, operatorVisible: true },
          actorId,
          context,
        );
        continue;
      }
      if (existing.status !== AssignmentStatus.CANCELED && existing.status !== AssignmentStatus.REJECTED) {
        if (!existing.operatorVisible) {
          await tx.assignment.update({
            where: { id: existing.id },
            data: { operatorVisible: true, authorizedAt: now, authorizedBy: actorId },
          });
        }
        continue;
      }
      const restored = await tx.assignment.update({
        where: { id: existing.id },
        data: {
          assignedBy: actorId,
          status: AssignmentStatus.ASSIGNED,
          assignedAt: now,
          operatorVisible: true,
          authorizedAt: now,
          authorizedBy: actorId,
          acceptedAt: null,
          startedAt: null,
          completedAt: null,
          canceledAt: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      await this.historyTx(tx, restored, AssignmentEventType.ASSIGNED, actorId, existing.status, 'Auxiliar técnico incluído novamente');
      await this.auditTx(
        tx,
        ASSIGNMENT_AUDIT_ACTIONS.ASSIGNMENT_CREATED,
        actorId,
        this.safeContext(context),
        { assignmentId: restored.id, operationId, assignedTo, isPrimary: false, restored: true },
      );
    }
  }

  private async transition(
    id: string,
    actor: AuthenticatedUser,
    context: AssignmentAuditContext,
    config: {
      event: AssignmentEventType;
      action: string;
      status: AssignmentStatus;
      lifecycleType: AssignmentLifecycleType;
      field: 'acceptedAt' | 'startedAt' | 'completedAt';
      allowedFrom: AssignmentStatus[];
      description: string;
      notes?: string;
      operationStatus?: 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED';
      syncOperationCompletion?: boolean;
    },
  ): Promise<AssignmentPayload> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.assignmentOrThrowTx(tx, id);
      this.assertRvtPrimaryExecutor(current);
      this.assertAssignee(current, actor);
      this.assertAllowed(current.status, config.allowedFrom);
      const now = new Date();
      const transition = await tx.assignment.updateMany({
        where: { id, assignedTo: actor.id, status: current.status },
        data: {
          status: config.status,
          [config.field]: now,
          ...(config.notes !== undefined ? { notes: config.notes } : {}),
        },
      });
      if (transition.count !== 1) {
        throw new ApplicationException(
          ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION,
          'Assignment transition conflicted with another update',
          HttpStatus.CONFLICT,
        );
      }
      const assignment = await tx.assignment.findUniqueOrThrow({ where: { id } });
      if (config.operationStatus) {
        const operationTransition = await tx.operation.updateMany({
          where: { id: assignment.operationId },
          data: {
            status: config.operationStatus,
            // REVIEW also stamps completedAt: the field work is done; what
            // remains is the technical responsible's administrative approval.
            ...(config.operationStatus === 'COMPLETED' || config.operationStatus === 'REVIEW'
              ? { completedAt: now }
              : {}),
            ...(config.operationStatus === 'IN_PROGRESS' ? { startedAt: now } : {}),
          },
        });
        if (operationTransition.count !== 1) {
          throw new ApplicationException(
            ERROR_CODES.OPERATION_NOT_FOUND,
            'Operation could not be synchronized with assignment',
            HttpStatus.CONFLICT,
          );
        }
        if (config.operationStatus === 'IN_PROGRESS') {
          await tx.rvtExecution.updateMany({
            where: { operationId: assignment.operationId, status: { in: ['PENDING', 'ASSIGNED'] } },
            data: { status: 'IN_PROGRESS', startedAt: now },
          });
        }
      }
      await this.historyTx(tx, assignment, config.event, actor.id, current.status, config.notes);
      await this.auditTx(tx, config.action, actor.id, context, {
        assignmentId: assignment.id,
        operationId: assignment.operationId,
        previousStatus: current.status,
        newStatus: assignment.status,
      });
      await this.lifecycle.publishAssignmentEventTx(
        tx,
        {
          assignmentId: assignment.id,
          operationId: assignment.operationId,
          actorId: actor.id,
          type: config.lifecycleType,
          description: config.description,
          metadata: { previousStatus: current.status, newStatus: assignment.status },
        },
        context,
      );
      if (config.syncOperationCompletion) {
        await this.lifecycle.publishOperationCompletedTx(tx, assignment.operationId, actor.id, context);
        await this.maintenance.syncOperationCompletedTx(tx, assignment.operationId, actor.id, context);
      }
      // Notificação apenas no evento completo (conclusão de campo). Passos
      // intermediários (aceite/início) ficam visíveis na tela de Operações.
      if (config.status === AssignmentStatus.COMPLETED) {
        await this.notifications.notifyAssignmentCompletedTx(tx, assignment.id);
      }
      return tx.assignment.findUniqueOrThrow({ where: { id }, include: ASSIGNMENT_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private listWhere(
    query: ListAssignmentsQueryDto,
    forcedAssignee?: string,
    gateVisibility = false,
  ): Prisma.AssignmentWhereInput {
    return {
      ...(query.operationId ? { operationId: query.operationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(forcedAssignee ? { assignedTo: forcedAssignee } : query.assignedTo ? { assignedTo: query.assignedTo } : {}),
      ...(query.customerId ? { operation: { customerId: query.customerId } } : {}),
      ...(query.equipmentId ? { operation: { equipmentId: query.equipmentId } } : {}),
      // App do operador: só demandas autorizadas pela gestão. Itens já aceitos/
      // em andamento/concluídos permanecem visíveis (histórico e execução).
      ...(gateVisibility
        ? {
            AND: [
              { status: { notIn: [AssignmentStatus.CANCELED, AssignmentStatus.REJECTED] } },
              { OR: [{ operatorVisible: true }, { status: { not: AssignmentStatus.ASSIGNED } }] },
            ],
          }
        : {}),
    };
  }

  private async assignmentOrThrow(id: string): Promise<AssignmentPayload> {
    const assignment = await this.prisma.assignment.findUnique({ where: { id }, include: ASSIGNMENT_INCLUDE });
    if (!assignment) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_NOT_FOUND,
        'Assignment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return assignment;
  }

  private async assignmentOrThrowTx(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Prisma.AssignmentGetPayload<{ include: { operation: true } }>> {
    const assignment = await tx.assignment.findUnique({ where: { id }, include: { operation: true } });
    if (!assignment) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_NOT_FOUND,
        'Assignment was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return assignment;
  }

  private async operationOrThrowTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const operation = await tx.operation.findUnique({ where: { id }, select: { id: true } });
    if (!operation) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_NOT_FOUND,
        'Operation was not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async operationalUserOrThrowTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true, disabledAt: true },
    });
    if (!user || !user.isActive || user.disabledAt || user.role === Role.VIEWER) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_OPERATOR_INVALID,
        'Assigned operator must exist, be active and have an operational role',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertCanRead(assignment: Pick<AssignmentPayload, 'assignedTo'>, actor: AuthenticatedUser): void {
    if (actor.role === Role.OPERATOR && assignment.assignedTo !== actor.id) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_OPERATOR_FORBIDDEN,
        'Operators can only access their own assignments',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertAssignee(assignment: { assignedTo: string }, actor: AuthenticatedUser): void {
    if (assignment.assignedTo !== actor.id) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_OPERATOR_FORBIDDEN,
        'Only the assigned operator can execute this transition',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertRvtPrimaryExecutor(assignment: { isPrimary: boolean; operation: { requestedDocumentType: DocumentTemplateType } }): void {
    if (!assignment.isPrimary && assignment.operation.requestedDocumentType === DocumentTemplateType.TECHNICAL_REPORT) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_OPERATOR_FORBIDDEN,
        'Auxiliares técnicos podem acompanhar o RVT, mas somente o responsável principal pode executá-lo',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertReassignable(assignment: {
    status: AssignmentStatus;
    operation: { status: OperationStatus };
  }): void {
    const reactivatedCancellation =
      assignment.status === AssignmentStatus.CANCELED &&
      assignment.operation.status === OperationStatus.PENDING;
    if (
      assignment.status === AssignmentStatus.COMPLETED ||
      (assignment.status === AssignmentStatus.CANCELED && !reactivatedCancellation)
    ) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION,
        'A atribuição finalizada não pode ser alterada',
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertAllowed(current: AssignmentStatus, allowed: AssignmentStatus[]): void {
    if (!allowed.includes(current)) {
      throw new ApplicationException(
        ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION,
        'Assignment transition is not allowed from the current status',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async historyTx(
    tx: Prisma.TransactionClient,
    assignment: { id: string; operationId: string; status: AssignmentStatus },
    event: AssignmentEventType,
    actorId: string,
    previousStatus: AssignmentStatus | null,
    notes?: string | null,
  ): Promise<void> {
    await tx.assignmentHistory.create({
      data: {
        assignmentId: assignment.id,
        operationId: assignment.operationId,
        event,
        actorId,
        previousStatus,
        newStatus: assignment.status,
        notes: notes ?? null,
      },
    });
  }

  private async auditTx(
    tx: Prisma.TransactionClient,
    action: string,
    actorId: string,
    context: AssignmentAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action,
        resource: ASSIGNMENT_RESOURCE,
        actor: actorId,
        metadata: {
          requestId: context.requestId,
          ip: context.ip,
          userAgent: context.userAgent,
          ...metadata,
        },
      },
    });
  }

  private safeContext(context?: Partial<AssignmentAuditContext>): AssignmentAuditContext {
    return {
      requestId: context?.requestId ?? 'system',
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    };
  }
}
