import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DocumentTemplateType,
  MaintenanceReminderStatus,
  OperationStatus,
  PmocExecutionRequestStatus,
  Prisma,
} from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import {
  DEFAULT_MAINTENANCE_REMINDER_INTERVAL_MONTHS,
  MAINTENANCE_REMINDER_OPERATION_TYPES,
} from '../../shared/constants/maintenance-reminders.constants';
import { PrismaService } from '../database/prisma.service';
import type {
  ListMaintenanceRemindersQueryDto,
  UpdateMaintenanceReminderDto,
} from './dto/maintenance-reminder.dto';

/** Tipos de OS que geram lembrete de manutenção (previsão de próxima execução). */
const REMINDER_INCLUDE = {
  customer: { select: { id: true, name: true, tradeName: true } },
  equipment: { select: { id: true, name: true, tag: true } },
  operation: { select: { id: true, number: true, type: true, status: true } },
} satisfies Prisma.MaintenanceReminderInclude;

function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  const originalDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
}

@Injectable()
export class MaintenanceRemindersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria/atualiza o lembrete derivado de uma OS. Idempotente por `operationId`.
   * Só registra para OS Preventiva/Instalação que NÃO tenham origem em PMOC
   * (PMOC tem agenda própria). Recalcula a previsão (+intervalo) a partir da
   * data de execução, exceto quando o owner já ajustou a data manualmente.
   */
  async syncFromOperationTx(tx: Prisma.TransactionClient, operationId: string): Promise<void> {
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        type: true,
        requestedDocumentType: true,
        status: true,
        scheduledFor: true,
        completedAt: true,
        createdAt: true,
        customerId: true,
        equipmentId: true,
        maintenanceReminderIntervalMonths: true,
      },
    });
    if (!operation) return;

    const qualifies =
      MAINTENANCE_REMINDER_OPERATION_TYPES.includes(operation.type) &&
      operation.requestedDocumentType !== DocumentTemplateType.PMOC &&
      operation.status !== OperationStatus.CANCELED;

    const existing = await tx.maintenanceReminder.findUnique({
      where: { operationId },
      select: { id: true, intervalMonths: true, dateOverridden: true, dueDate: true },
    });

    if (!qualifies) {
      // Deixou de qualificar (ex.: OS cancelada): remove lembrete auto-gerado.
      if (existing) await tx.maintenanceReminder.delete({ where: { operationId } });
      return;
    }

    const base = operation.completedAt ?? operation.scheduledFor ?? operation.createdAt;
    const intervalMonths =
      operation.maintenanceReminderIntervalMonths ??
      existing?.intervalMonths ??
      DEFAULT_MAINTENANCE_REMINDER_INTERVAL_MONTHS;
    const dueDate = existing?.dateOverridden ? existing.dueDate : addMonths(base, intervalMonths);
    const organizationId = await this.organizationIdTx(tx);

    await tx.maintenanceReminder.upsert({
      where: { operationId },
      create: {
        organizationId,
        customerId: operation.customerId,
        equipmentId: operation.equipmentId,
        operationId: operation.id,
        operationType: operation.type,
        baseDate: base,
        dueDate,
        intervalMonths,
      },
      update: {
        baseDate: base,
        operationType: operation.type,
        equipmentId: operation.equipmentId,
        intervalMonths,
        ...(existing?.dateOverridden ? {} : { dueDate }),
      },
    });
  }

  async list(query: ListMaintenanceRemindersQueryDto, _actor: AuthenticatedUser): Promise<unknown> {
    void _actor;
    const organizationId = await this.organizationId();
    const where: Prisma.MaintenanceReminderWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.maintenanceReminder.findMany({
        where,
        include: REMINDER_INCLUDE,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.maintenanceReminder.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  /** KPIs do topo da aba Lembretes. */
  async stats(_actor: AuthenticatedUser): Promise<{
    pending: number;
    overdue: number;
    dueSoon: number;
    done: number;
  }> {
    void _actor;
    const organizationId = await this.organizationId();
    const now = new Date();
    const soon = addMonths(now, 1);
    const [pending, overdue, dueSoon, done] = await this.prisma.$transaction([
      this.prisma.maintenanceReminder.count({
        where: { organizationId, status: MaintenanceReminderStatus.PENDING },
      }),
      this.prisma.maintenanceReminder.count({
        where: { organizationId, status: MaintenanceReminderStatus.PENDING, dueDate: { lt: now } },
      }),
      this.prisma.maintenanceReminder.count({
        where: {
          organizationId,
          status: MaintenanceReminderStatus.PENDING,
          dueDate: { gte: now, lte: soon },
        },
      }),
      this.prisma.maintenanceReminder.count({
        where: { organizationId, status: MaintenanceReminderStatus.DONE },
      }),
    ]);
    return { pending, overdue, dueSoon, done };
  }

  async update(
    id: string,
    dto: UpdateMaintenanceReminderDto,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    const existing = await this.prisma.maintenanceReminder.findFirst({
      where: { id, organizationId },
      select: { id: true, operationId: true, baseDate: true, intervalMonths: true },
    });
    if (!existing) {
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_REMINDER_NOT_FOUND,
        'Lembrete de manutenção não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const reminder = await tx.maintenanceReminder.update({
        where: { id },
        data: {
          ...(dto.intervalMonths !== undefined
            ? {
                intervalMonths: dto.intervalMonths,
                ...(!dto.dueDate
                  ? { dueDate: addMonths(existing.baseDate, dto.intervalMonths), dateOverridden: false }
                  : {}),
              }
            : {}),
          ...(dto.dueDate ? { dueDate: new Date(dto.dueDate), dateOverridden: true } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        },
        include: REMINDER_INCLUDE,
      });
      if (dto.intervalMonths !== undefined && existing.operationId) {
        await tx.operation.update({
          where: { id: existing.operationId },
          data: { maintenanceReminderIntervalMonths: dto.intervalMonths },
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'MAINTENANCE_REMINDER_UPDATED',
          resource: 'MAINTENANCE_REMINDER',
          actor: actor.id,
          metadata: {
            reminderId: id,
            operationId: existing.operationId,
            changedFields: Object.keys(dto),
            previousIntervalMonths: existing.intervalMonths,
            intervalMonths: dto.intervalMonths ?? existing.intervalMonths,
          },
        },
      });
      return reminder;
    });
  }

  /**
   * Próximas execuções previstas de PMOCs ativos (somente leitura). Sem cliente,
   * lista de todos; com `customerId`, filtra o cliente. Ordenadas por data.
   */
  async pmocUpcoming(customerId: string | undefined, _actor: AuthenticatedUser): Promise<unknown> {
    void _actor;
    const requests = await this.prisma.pmocExecutionRequest.findMany({
      where: {
        status: PmocExecutionRequestStatus.PENDING,
        scheduledFor: { gte: new Date() },
        pmocPlan: { active: true, ...(customerId ? { customerId } : {}) },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 100,
      select: {
        id: true,
        executionNumber: true,
        scheduledFor: true,
        pmocPlan: {
          select: {
            id: true,
            number: true,
            periodicity: true,
            maintenancePlan: { select: { name: true } },
            customer: { select: { name: true, tradeName: true } },
            equipment: { select: { id: true, name: true, tag: true } },
          },
        },
      },
    });
    return requests.map((request) => ({
      id: request.id,
      executionNumber: request.executionNumber,
      scheduledFor: request.scheduledFor,
      pmocId: request.pmocPlan.id,
      pmocNumber: request.pmocPlan.number,
      periodicity: request.pmocPlan.periodicity,
      planName: request.pmocPlan.maintenancePlan?.name ?? null,
      customerName: request.pmocPlan.customer?.tradeName ?? request.pmocPlan.customer?.name ?? null,
      equipment: request.pmocPlan.equipment
        ? { name: request.pmocPlan.equipment.name, tag: request.pmocPlan.equipment.tag }
        : null,
    }));
  }

  private organizationId(): Promise<string> {
    return this.organizationIdTx(this.prisma);
  }

  private async organizationIdTx(
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const organization = await client.organization.findFirst({
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
    return organization.id;
  }
}
