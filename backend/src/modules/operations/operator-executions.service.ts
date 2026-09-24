import { HttpStatus, Injectable } from '@nestjs/common';
import { AssignmentStatus, Prisma, Role } from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import {
  ListOperatorExecutionOperationsQueryDto,
  ListOperatorExecutionsQueryDto,
  OperatorExecutionPeriodDto,
  OperatorExecutionView,
} from './dto/operator-execution.dto';

type Period = { month: string; start: Date; end: Date; timezone: string };
type CountByOperator = Map<string, number>;

const OPEN_ASSIGNMENTS = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.ACCEPTED,
  AssignmentStatus.STARTED,
  AssignmentStatus.PAUSED,
] as const;

const OPERATOR_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  jobTitle: true,
  isActive: true,
  disabledAt: true,
  avatarAssetId: true,
  permission: { select: { canReports: true, canSchedules: true } },
} satisfies Prisma.UserSelect;

type OperatorRecord = Prisma.UserGetPayload<{ select: typeof OPERATOR_SELECT }>;

/**
 * Técnico auxiliar: operador que só acompanha a demanda (permissão de
 * agendamentos, sem relatórios). Ele não constrói nem conclui o atendimento
 * pelo app, então é listado com esse papel em vez do cargo cadastrado.
 */
function isAssistantTechnician(operator: OperatorRecord): boolean {
  return Boolean(operator.permission && !operator.permission.canReports);
}

@Injectable()
export class OperatorExecutionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListOperatorExecutionsQueryDto): Promise<unknown> {
    const period = await this.period(query);
    const userWhere: Prisma.UserWhereInput = {
      role: Role.OPERATOR,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { jobTitle: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [operators, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: userWhere,
        select: OPERATOR_SELECT,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where: userWhere }),
    ]);
    const [rows, kpis] = await Promise.all([
      this.metricsForOperators(operators.map((operator) => operator.id), period),
      this.globalMetrics(period),
    ]);
    const metrics = new Map(rows.map((row) => [row.operatorId, row]));
    return {
      period: this.periodPayload(period),
      kpis,
      ...buildPaginatedResponse(
        operators.map(({ permission, ...operator }) => ({
          ...operator,
          isAssistant: isAssistantTechnician({ ...operator, permission }),
          metrics: metrics.get(operator.id) ?? this.emptyMetrics(operator.id),
        })),
        total,
        query.page,
        query.limit,
      ),
    };
  }

  async get(operatorId: string, query: OperatorExecutionPeriodDto): Promise<unknown> {
    const period = await this.period(query);
    const { permission, ...operator } = await this.operatorOrThrow(operatorId);
    const [metrics] = await this.metricsForOperators([operatorId], period);
    return {
      operator: { ...operator, isAssistant: isAssistantTechnician({ ...operator, permission }) },
      period: this.periodPayload(period),
      metrics: metrics ?? this.emptyMetrics(operatorId),
    };
  }

  async operations(operatorId: string, query: ListOperatorExecutionOperationsQueryDto): Promise<unknown> {
    const period = await this.period(query);
    await this.operatorOrThrow(operatorId);
    const rangeWhere: Prisma.OperationWhereInput =
      query.view === OperatorExecutionView.AGENDA
        ? { scheduledFor: { gte: period.start, lt: period.end } }
        : {
            OR: [
              { scheduledFor: { gte: period.start, lt: period.end } },
              { completedAt: { gte: period.start, lt: period.end } },
              { assignments: { some: { assignedAt: { gte: period.start, lt: period.end } } } },
            ],
          };
    const where: Prisma.OperationWhereInput = {
      assignments: { some: { assignedTo: operatorId } },
      ...rangeWhere,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operation.findMany({
        where,
        select: {
          id: true,
          number: true,
          type: true,
          requestedDocumentType: true,
          status: true,
          scheduledFor: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          customer: { select: { id: true, name: true, tradeName: true } },
          equipment: { select: { id: true, name: true, tag: true } },
          assignments: {
            where: { isPrimary: true },
            select: {
              id: true,
              status: true,
              assignedAt: true,
              acceptedAt: true,
              startedAt: true,
              completedAt: true,
            },
          },
        },
        orderBy:
          query.view === OperatorExecutionView.AGENDA
            ? [{ scheduledFor: 'asc' }, { number: 'asc' }]
            : [{ completedAt: 'desc' }, { scheduledFor: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.operation.count({ where }),
    ]);
    return {
      period: this.periodPayload(period),
      view: query.view,
      ...buildPaginatedResponse(items, total, query.page, query.limit),
    };
  }

  private async metricsForOperators(operatorIds: string[], period: Period): Promise<OperatorMetric[]> {
    if (operatorIds.length === 0) return [];
    const scheduledRange = { gte: period.start, lt: period.end };
    const [total, completed, pending, inProgress, overdue, canceled, durations, lastCompleted] =
      await this.prisma.$transaction([
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: {
            assignedTo: { in: operatorIds },
            OR: [
              { completedAt: scheduledRange },
              { assignedAt: scheduledRange },
              { operation: { scheduledFor: scheduledRange } },
            ],
          },
          _count: { _all: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: { assignedTo: { in: operatorIds }, status: AssignmentStatus.COMPLETED, completedAt: scheduledRange },
          _count: { _all: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: {
            assignedTo: { in: operatorIds },
            status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
            operation: { scheduledFor: scheduledRange },
          },
          _count: { _all: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: {
            assignedTo: { in: operatorIds },
            status: { in: [AssignmentStatus.STARTED, AssignmentStatus.PAUSED] },
            operation: { scheduledFor: scheduledRange },
          },
          _count: { _all: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: {
            assignedTo: { in: operatorIds },
            status: { in: [...OPEN_ASSIGNMENTS] },
            operation: { scheduledFor: { gte: period.start, lt: new Date(Math.min(period.end.getTime(), Date.now())) } },
          },
          _count: { _all: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: {
            assignedTo: { in: operatorIds },
            OR: [{ canceledAt: scheduledRange }, { rejectedAt: scheduledRange }],
          },
          _count: { _all: true },
        }),
        this.prisma.assignment.findMany({
          where: {
            assignedTo: { in: operatorIds },
            status: AssignmentStatus.COMPLETED,
            completedAt: scheduledRange,
            startedAt: { not: null },
          },
          select: { assignedTo: true, startedAt: true, completedAt: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['assignedTo'],
          orderBy: { assignedTo: 'asc' },
          where: { assignedTo: { in: operatorIds }, status: AssignmentStatus.COMPLETED },
          _max: { completedAt: true },
        }),
      ]);
    const maps = [total, completed, pending, inProgress, overdue, canceled].map((groups) =>
      this.countMap(groups),
    );
    const durationMap = new Map<string, number[]>();
    for (const item of durations) {
      if (!item.startedAt || !item.completedAt) continue;
      const values = durationMap.get(item.assignedTo) ?? [];
      values.push(Math.max(0, (item.completedAt.getTime() - item.startedAt.getTime()) / 60_000));
      durationMap.set(item.assignedTo, values);
    }
    const lastMap = new Map(
      lastCompleted.map((item) => [item.assignedTo, item._max?.completedAt ?? null]),
    );
    const commissionMap = await this.commissionForOperators(operatorIds, period);
    return operatorIds.map((operatorId) => {
      const completedCount = maps[1].get(operatorId) ?? 0;
      const pendingCount = maps[2].get(operatorId) ?? 0;
      const inProgressCount = maps[3].get(operatorId) ?? 0;
      const denominator = completedCount + pendingCount + inProgressCount;
      const values = durationMap.get(operatorId) ?? [];
      return {
        operatorId,
        total: maps[0].get(operatorId) ?? 0,
        completed: completedCount,
        pending: pendingCount,
        inProgress: inProgressCount,
        overdue: maps[4].get(operatorId) ?? 0,
        canceled: maps[5].get(operatorId) ?? 0,
        completionRate: denominator === 0 ? 0 : Math.round((completedCount / denominator) * 1000) / 10,
        averageDurationMinutes:
          values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
        lastCompletedAt: lastMap.get(operatorId) ?? null,
        commission: commissionMap.get(operatorId) ?? 0,
      };
    });
  }

  private async globalMetrics(period: Period): Promise<Record<string, number | null>> {
    const range = { gte: period.start, lt: period.end };
    const nowLimit = new Date(Math.min(period.end.getTime(), Date.now()));
    const [operators, activeOperators, total, completed, pending, inProgress, overdue, durations] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { role: Role.OPERATOR } }),
        this.prisma.user.count({ where: { role: Role.OPERATOR, isActive: true, disabledAt: null } }),
        this.prisma.assignment.count({
          where: {
            assignee: { role: Role.OPERATOR },
            OR: [{ completedAt: range }, { assignedAt: range }, { operation: { scheduledFor: range } }],
          },
        }),
        this.prisma.assignment.count({
          where: { assignee: { role: Role.OPERATOR }, status: AssignmentStatus.COMPLETED, completedAt: range },
        }),
        this.prisma.assignment.count({
          where: {
            assignee: { role: Role.OPERATOR },
            status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
            operation: { scheduledFor: range },
          },
        }),
        this.prisma.assignment.count({
          where: {
            assignee: { role: Role.OPERATOR },
            status: { in: [AssignmentStatus.STARTED, AssignmentStatus.PAUSED] },
            operation: { scheduledFor: range },
          },
        }),
        this.prisma.assignment.count({
          where: {
            assignee: { role: Role.OPERATOR },
            status: { in: [...OPEN_ASSIGNMENTS] },
            operation: { scheduledFor: { gte: period.start, lt: nowLimit } },
          },
        }),
        this.prisma.assignment.findMany({
          where: {
            assignee: { role: Role.OPERATOR },
            status: AssignmentStatus.COMPLETED,
            completedAt: range,
            startedAt: { not: null },
          },
          select: { startedAt: true, completedAt: true },
        }),
      ]);
    const durationValues = durations.flatMap((item) =>
      item.startedAt && item.completedAt
        ? [Math.max(0, (item.completedAt.getTime() - item.startedAt.getTime()) / 60_000)]
        : [],
    );
    const denominator = completed + pending + inProgress;
    return {
      operators,
      activeOperators,
      total,
      completed,
      pending,
      inProgress,
      overdue,
      completionRate: denominator === 0 ? 0 : Math.round((completed / denominator) * 1000) / 10,
      averageDurationMinutes:
        durationValues.length === 0
          ? null
          : Math.round(durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length),
    };
  }

  private countMap(
    groups: Array<{ assignedTo: string; _count?: true | { _all?: number } }>,
  ): CountByOperator {
    return new Map(
      groups.map((item) => [
        item.assignedTo,
        typeof item._count === 'object' ? (item._count._all ?? 0) : 0,
      ]),
    );
  }

  private async operatorOrThrow(operatorId: string): Promise<Prisma.UserGetPayload<{ select: typeof OPERATOR_SELECT }>> {
    const operator = await this.prisma.user.findFirst({
      where: { id: operatorId, role: Role.OPERATOR },
      select: OPERATOR_SELECT,
    });
    if (!operator) {
      throw new ApplicationException(
        ERROR_CODES.USER_NOT_FOUND,
        'Operator was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return operator;
  }

  private async period(query: OperatorExecutionPeriodDto): Promise<Period> {
    const settings = await this.prisma.organizationSettings.findFirst({ select: { timezone: true } });
    const timezone = settings?.timezone ?? 'America/Recife';
    const month = query.month ?? this.currentMonth(timezone);
    const [year, monthNumber] = month.split('-').map(Number);
    return {
      month,
      timezone,
      start: this.wallTimeToUtc(year, monthNumber, 1, timezone),
      end:
        monthNumber === 12
          ? this.wallTimeToUtc(year + 1, 1, 1, timezone)
          : this.wallTimeToUtc(year, monthNumber + 1, 1, timezone),
    };
  }

  private currentMonth(timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    return `${year}-${month}`;
  }

  private wallTimeToUtc(year: number, month: number, day: number, timezone: string): Date {
    const desired = Date.UTC(year, month - 1, day);
    let result = desired;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(result));
      const value = (type: Intl.DateTimeFormatPartTypes): number =>
        Number(parts.find((part) => part.type === type)?.value ?? 0);
      const represented = Date.UTC(
        value('year'),
        value('month') - 1,
        value('day'),
        value('hour'),
        value('minute'),
        value('second'),
      );
      result += desired - represented;
    }
    return new Date(result);
  }

  private periodPayload(period: Period): Record<string, string> {
    return {
      month: period.month,
      timezone: period.timezone,
      from: period.start.toISOString(),
      to: period.end.toISOString(),
    };
  }

  private emptyMetrics(operatorId: string): OperatorMetric {
    return {
      operatorId,
      total: 0,
      completed: 0,
      pending: 0,
      inProgress: 0,
      overdue: 0,
      canceled: 0,
      completionRate: 0,
      averageDurationMinutes: null,
      lastCompletedAt: null,
      commission: 0,
    };
  }

  /**
   * Comissão PENDENTE por técnico no período: soma, das operações CONCLUÍDAS em
   * que ele participou, de `valor do serviço × (% do tipo)`, quando o tipo é
   * elegível. Conta tanto quem executou (primário, `%` do técnico) quanto quem
   * entrou como auxiliar (assignment não primário, `%` do auxiliar). O que já
   * tem lançamento de comissão fica de fora — pago não se recalcula.
   */
  private async commissionForOperators(
    operatorIds: string[],
    period: Period,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (operatorIds.length === 0) return result;
    const [types, operations] = await Promise.all([
      this.prisma.serviceType.findMany({
        select: {
          key: true,
          commissionEligible: true,
          commissionPercent: true,
          commissionPercentAssistant: true,
        },
      }),
      this.prisma.operation.findMany({
        where: {
          OR: [
            { operatorId: { in: operatorIds } },
            {
              assignments: {
                some: {
                  assignedTo: { in: operatorIds },
                  isPrimary: false,
                  status: { notIn: [AssignmentStatus.REJECTED, AssignmentStatus.CANCELED] },
                },
              },
            },
          ],
          status: 'COMPLETED',
          completedAt: { gte: period.start, lt: period.end },
          serviceValue: { not: null },
        },
        select: {
          operatorId: true,
          serviceValue: true,
          type: true,
          assignments: {
            where: {
              assignedTo: { in: operatorIds },
              isPrimary: false,
              status: { notIn: [AssignmentStatus.REJECTED, AssignmentStatus.CANCELED] },
            },
            select: { assignedTo: true },
          },
          // Quem já recebeu por esta operação não entra de novo no pendente.
          commissionEntries: { select: { userId: true } },
        },
      }),
    ]);
    const config = new Map(
      types.map((type) => [
        type.key,
        {
          eligible: type.commissionEligible,
          percent: Number(type.commissionPercent),
          assistantPercent: Number(type.commissionPercentAssistant),
        },
      ]),
    );
    const targets = new Set(operatorIds);
    for (const operation of operations) {
      const cfg = config.get(operation.type);
      if (!cfg || !cfg.eligible) continue;
      const value = Number(operation.serviceValue ?? 0);
      if (value <= 0) continue;
      const paidUsers = new Set(operation.commissionEntries.map((entry) => entry.userId));
      const beneficiaries: Array<{ userId: string; percent: number }> = [
        { userId: operation.operatorId, percent: cfg.percent },
        ...operation.assignments.map((assignment) => ({
          userId: assignment.assignedTo,
          percent: cfg.assistantPercent,
        })),
      ];
      for (const { userId, percent } of beneficiaries) {
        if (!targets.has(userId) || paidUsers.has(userId) || percent <= 0) continue;
        result.set(userId, (result.get(userId) ?? 0) + value * (percent / 100));
      }
    }
    for (const [operatorId, value] of result) {
      result.set(operatorId, Math.round(value * 100) / 100);
    }
    return result;
  }
}

type OperatorMetric = {
  operatorId: string;
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  overdue: number;
  canceled: number;
  completionRate: number;
  averageDurationMinutes: number | null;
  lastCompletedAt: Date | null;
  /** Comissão do período: Σ (valor do serviço × % do tipo elegível) das operações concluídas. */
  commission: number;
};
