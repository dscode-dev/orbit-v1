import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AssignmentStatus,
  NotificationEntityType,
  NotificationSeverity,
  NotificationType,
  Prisma,
  Role,
} from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import type { ListNotificationsQueryDto } from './dto/notification.dto';

const SAFE_ACTION_URLS = {
  operations: '/operacoes',
  budgets: '/budgets',
  pmoc: '/reports',
  operatorServices: '/operator/services',
} as const;

/** Deep link que abre o drawer da operação na Platform. */
function operationActionUrl(operationId: string): string {
  return `${SAFE_ACTION_URLS.operations}?operationId=${operationId}`;
}

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  severity: true,
  title: true,
  message: true,
  entityType: true,
  entityId: true,
  actionUrl: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type NotificationInput = {
  organizationId: string;
  recipientUserId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  actionUrl: string;
  eventKey: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListNotificationsQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    await this.syncOverdueAssignments(actor);
    const where = this.userWhere(actor.id, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async unreadCount(actor: AuthenticatedUser): Promise<{ count: number }> {
    await this.syncOverdueAssignments(actor);
    const count = await this.prisma.notification.count({
      where: { recipientUserId: actor.id, readAt: null, deletedAt: null },
    });
    return { count };
  }

  async markRead(id: string, actor: AuthenticatedUser): Promise<unknown> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, recipientUserId: actor.id, deletedAt: null },
      select: { id: true },
    });
    if (!notification) {
      throw new ApplicationException(
        ERROR_CODES.NOTIFICATION_NOT_FOUND,
        'Notificação não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: NOTIFICATION_SELECT,
    });
  }

  async markAllRead(actor: AuthenticatedUser): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientUserId: actor.id, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async notifyAssignmentAssignedTx(
    tx: Prisma.TransactionClient,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.assignmentForNotificationTx(tx, assignmentId);
    await this.createManyIdempotentTx(tx, [
      {
        organizationId: await this.organizationIdTx(tx),
        recipientUserId: assignment.assignedTo,
        type: NotificationType.ASSIGNMENT_ASSIGNED,
        severity: NotificationSeverity.INFO,
        title: 'Nova atividade atribuída',
        message: `Você recebeu a operação #${assignment.operation.number}.`,
        entityType: NotificationEntityType.ASSIGNMENT,
        entityId: assignment.id,
        actionUrl: SAFE_ACTION_URLS.operatorServices,
        eventKey: `assignment:${assignment.id}:assigned`,
      },
    ]);
  }

  /**
   * Evento completo de campo: o atendimento foi concluído pelo operador e a
   * operação aguarda revisão/aprovação. Passos intermediários (aceite, início,
   * envio de documento) não geram notificação — apenas este evento.
   */
  async notifyAssignmentCompletedTx(
    tx: Prisma.TransactionClient,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.assignmentForNotificationTx(tx, assignmentId);
    const completedDirectly = assignment.operation.status === 'COMPLETED';
    const organizationId = await this.organizationIdTx(tx);
    const managers = await this.managementRecipientsTx(tx);
    await this.createManyIdempotentTx(
      tx,
      managers.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        type: NotificationType.OPERATION_COMPLETED,
        severity: NotificationSeverity.SUCCESS,
        title: completedDirectly ? 'Atendimento concluído' : 'Atendimento aguardando revisão',
        message: completedDirectly
          ? `Operação #${assignment.operation.number} foi concluída em campo por ${assignment.assignee.name}.`
          : `Operação #${assignment.operation.number} foi concluída em campo por ${assignment.assignee.name} e aguarda sua revisão e aprovação.`,
        entityType: NotificationEntityType.OPERATION,
        entityId: assignment.operationId,
        actionUrl: operationActionUrl(assignment.operationId),
        eventKey: `operation:${assignment.operationId}:completed`,
      })),
    );
  }

  /** Atendimento recusado pelo operador — a gestão precisa reatribuir. */
  async notifyAssignmentRejectedTx(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    reason: string | null,
  ): Promise<void> {
    const assignment = await this.assignmentForNotificationTx(tx, assignmentId);
    const organizationId = await this.organizationIdTx(tx);
    const managers = await this.managementRecipientsTx(tx);
    await this.createManyIdempotentTx(
      tx,
      managers.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        type: NotificationType.ASSIGNMENT_REJECTED,
        severity: NotificationSeverity.WARNING,
        title: 'Atendimento recusado',
        message: `Operação #${assignment.operation.number} foi recusada por ${assignment.assignee.name}${reason ? `: ${reason}` : '.'}`,
        entityType: NotificationEntityType.ASSIGNMENT,
        entityId: assignment.id,
        actionUrl: operationActionUrl(assignment.operationId),
        eventKey: `assignment:${assignment.id}:rejected`,
      })),
    );
  }

  async notifyBudgetDecisionTx(
    tx: Prisma.TransactionClient,
    budgetId: string,
    type: typeof NotificationType.BUDGET_APPROVED | typeof NotificationType.BUDGET_REJECTED,
  ): Promise<void> {
    const budget = await tx.budget.findUnique({
      where: { id: budgetId },
      select: { id: true, number: true, organizationId: true, total: true, customer: { select: { name: true, tradeName: true } } },
    });
    if (!budget) return;
    const recipients = await this.managementRecipientsTx(tx);
    const approved = type === NotificationType.BUDGET_APPROVED;
    await this.createManyIdempotentTx(
      tx,
      recipients.map((recipientUserId) => ({
        organizationId: budget.organizationId,
        recipientUserId,
        type,
        severity: approved ? NotificationSeverity.SUCCESS : NotificationSeverity.WARNING,
        title: approved ? 'Orçamento aprovado' : 'Orçamento rejeitado',
        message: `Orçamento #${budget.number} ${approved ? 'aprovado' : 'rejeitado'} para ${budget.customer.tradeName || budget.customer.name}.`,
        entityType: NotificationEntityType.BUDGET,
        entityId: budget.id,
        actionUrl: SAFE_ACTION_URLS.budgets,
        eventKey: `budget:${budget.id}:${approved ? 'approved' : 'rejected'}`,
      })),
    );
  }

  async notifyPmocExecutionTx(
    tx: Prisma.TransactionClient,
    executionRequestId: string,
    type:
      | typeof NotificationType.PMOC_OS_GENERATED
      | typeof NotificationType.PMOC_OS_GENERATION_FAILED
      | typeof NotificationType.PMOC_EXECUTION_PENDING_MANUAL,
  ): Promise<void> {
    const request = await tx.pmocExecutionRequest.findUnique({
      where: { id: executionRequestId },
      select: {
        id: true,
        status: true,
        failureReason: true,
        operation: {
          select: {
            id: true,
            number: true,
            assignments: { where: { isPrimary: true }, select: { assignedTo: true } },
          },
        },
        pmocPlan: { select: { id: true, number: true, organizationId: true } },
      },
    });
    if (!request) return;
    const managers = await this.managementRecipientsTx(tx);
    const recipients = new Set(managers);
    if (type === NotificationType.PMOC_OS_GENERATED && request.operation?.assignments?.[0]?.assignedTo) {
      recipients.add(request.operation.assignments[0].assignedTo);
    }
    const pmocNumber = `PMOC-${String(request.pmocPlan.number).padStart(6, '0')}`;
    const generated = type === NotificationType.PMOC_OS_GENERATED;
    const failed = type === NotificationType.PMOC_OS_GENERATION_FAILED;
    await this.createManyIdempotentTx(
      tx,
      [...recipients].map((recipientUserId) => ({
        organizationId: request.pmocPlan.organizationId,
        recipientUserId,
        type,
        severity: generated
          ? NotificationSeverity.SUCCESS
          : failed
            ? NotificationSeverity.DANGER
            : NotificationSeverity.WARNING,
        title: generated
          ? 'PMOC gerou Ordem de Serviço'
          : failed
            ? 'Falha ao gerar OS do PMOC'
            : 'Execução PMOC aguarda geração manual',
        message: generated
          ? `${pmocNumber} gerou a operação #${request.operation?.number ?? '—'}.`
          : failed
            ? `${pmocNumber} não gerou a OS: ${request.failureReason ?? 'falha não detalhada'}.`
            : `${pmocNumber} possui uma execução pendente aguardando geração manual.`,
        entityType: NotificationEntityType.PMOC,
        entityId: request.pmocPlan.id,
        actionUrl: generated ? SAFE_ACTION_URLS.operations : SAFE_ACTION_URLS.pmoc,
        eventKey: `pmoc-request:${request.id}:${type.toLowerCase()}`,
      })),
    );
  }

  private async syncOverdueAssignments(actor: AuthenticatedUser): Promise<void> {
    const now = new Date();
    const assignments = await this.prisma.assignment.findMany({
      where: {
        status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED, AssignmentStatus.STARTED] },
        ...(actor.role === Role.OPERATOR ? { assignedTo: actor.id } : {}),
        operation: {
          scheduledFor: { lt: now },
        },
      },
      select: {
        id: true,
        operationId: true,
        assignedTo: true,
        operation: { select: { number: true, scheduledFor: true } },
      },
      orderBy: { assignedAt: 'asc' },
      take: 50,
    });
    if (!assignments.length) return;
    await this.prisma.$transaction(async (tx) => {
      const organizationId = await this.organizationIdTx(tx);
      const managers = await this.managementRecipientsTx(tx);
      const inputs: NotificationInput[] = [];
      for (const assignment of assignments) {
        const recipients = new Set([...managers, assignment.assignedTo]);
        for (const recipientUserId of recipients) {
          inputs.push({
            organizationId,
            recipientUserId,
            type: NotificationType.ASSIGNMENT_OVERDUE,
            severity: NotificationSeverity.WARNING,
            title: 'Atividade em atraso',
            message: `Operação #${assignment.operation.number} está atrasada.`,
            entityType: NotificationEntityType.ASSIGNMENT,
            entityId: assignment.id,
            // Cada destinatário cai no app certo: gestor abre o drawer da
            // operação; o operador cai na sua fila de campo.
            actionUrl:
              recipientUserId === assignment.assignedTo
                ? SAFE_ACTION_URLS.operatorServices
                : operationActionUrl(assignment.operationId),
            eventKey: `assignment:${assignment.id}:overdue`,
          });
        }
      }
      await this.createManyIdempotentTx(tx, inputs);
    });
  }

  private userWhere(userId: string, query: ListNotificationsQueryDto): Prisma.NotificationWhereInput {
    return {
      recipientUserId: userId,
      deletedAt: null,
      ...(query.unread ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
  }

  private async createManyIdempotentTx(tx: Prisma.TransactionClient, inputs: NotificationInput[]): Promise<void> {
    const data = inputs
      .filter((input) => this.safeActionUrl(input.actionUrl))
      .map((input) => ({
        ...input,
        title: this.clean(input.title, 140),
        message: this.clean(input.message, 300),
      }));
    if (!data.length) return;
    await tx.notification.createMany({ data, skipDuplicates: true });
  }

  private async assignmentForNotificationTx(tx: Prisma.TransactionClient, assignmentId: string): Promise<{
    id: string;
    operationId: string;
    assignedTo: string;
    operation: { number: number; status: string };
    assignee: { name: string };
  }> {
    return tx.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: {
        id: true,
        operationId: true,
        assignedTo: true,
        operation: { select: { number: true, status: true } },
        assignee: { select: { name: true } },
      },
    });
  }

  private async organizationIdTx(tx: Prisma.TransactionClient): Promise<string> {
    const organization = await tx.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!organization) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organização não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization.id;
  }

  private async managementRecipientsTx(tx: Prisma.TransactionClient): Promise<string[]> {
    const users = await tx.user.findMany({
      where: {
        role: { in: [Role.OWNER, Role.MANAGER] },
        isActive: true,
        disabledAt: null,
        OR: [{ preferences: null }, { preferences: { notificationsEnabled: true } }],
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private safeActionUrl(value: string): boolean {
    const bases = Object.values(SAFE_ACTION_URLS) as string[];
    if (bases.includes(value)) return true;
    // Deep link controlado: base conhecida + operationId UUID.
    return /^\/operacoes\?operationId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private clean(value: string, max: number): string {
    return value
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }
}
