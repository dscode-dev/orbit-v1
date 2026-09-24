import { HttpStatus, Injectable } from '@nestjs/common';
import { CommissionPeriod, OperationStatus, Prisma } from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { PrismaService } from '../database/prisma.service';
import type { CommissionQueryDto, PayCommissionDto } from './dto/commission.dto';

/** Item de comissão de uma operação concluída do técnico. */
interface CommissionItem {
  operationId: string;
  number: number;
  completedAt: Date | null;
  typeKey: string;
  typeLabel: string;
  serviceValue: number;
  percent: number;
  commission: number;
  paid: boolean;
  /** Operação cancelada: permanece listada para auditoria, mas não soma. */
  canceled: boolean;
  paymentId: string | null;
}

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Intervalo padrão de apuração conforme a janela configurada (semanal,
   * quinzenal ou mensal), ancorado na data de referência.
   */
  static defaultRange(period: CommissionPeriod, reference = new Date()): { from: Date; to: Date } {
    const end = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 23, 59, 59, 999),
    );
    const start = new Date(end);
    if (period === CommissionPeriod.WEEKLY) start.setUTCDate(start.getUTCDate() - 6);
    else if (period === CommissionPeriod.BIWEEKLY) start.setUTCDate(start.getUTCDate() - 14);
    else start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    return { from: start, to: end };
  }

  async period(): Promise<CommissionPeriod> {
    const settings = await this.prisma.organizationSettings.findFirst({
      select: { commissionPeriod: true },
    });
    return settings?.commissionPeriod ?? CommissionPeriod.MONTHLY;
  }

  /** Apuração do técnico no intervalo, separando pendente de já pago. */
  async detail(operatorId: string, query: CommissionQueryDto): Promise<unknown> {
    const period = await this.period();
    const { from, to } = this.resolveRange(period, query);
    const items = await this.items(operatorId, from, to, query.serviceType);
    // Canceladas continuam na lista (auditoria), mas ficam fora dos totais.
    const canceled = items.filter((item) => item.canceled);
    const pending = items.filter((item) => !item.paid && !item.canceled);
    const paid = items.filter((item) => item.paid && !item.canceled);
    return {
      period,
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        pendingAmount: round(pending.reduce((sum, item) => sum + item.commission, 0)),
        pendingCount: pending.length,
        paidAmount: round(paid.reduce((sum, item) => sum + item.commission, 0)),
        paidCount: paid.length,
        canceledAmount: round(canceled.reduce((sum, item) => sum + item.commission, 0)),
        canceledCount: canceled.length,
      },
      items,
    };
  }

  /**
   * Fecha a comissão: grava o pagamento (auditoria) e vincula as operações,
   * que passam a não contar mais no valor a pagar. Sem `operationIds`, fecha
   * todos os pendentes do período/filtro; com eles, apenas os escolhidos
   * (pagamento individual ou de uma seleção).
   */
  async pay(operatorId: string, dto: PayCommissionDto, actor: AuthenticatedUser): Promise<unknown> {
    const period = await this.period();
    const { from, to } = this.resolveRange(period, dto);
    const items = await this.items(operatorId, from, to, dto.serviceType);
    // Canceladas nunca entram num fechamento.
    const payable = items.filter((item) => !item.paid && !item.canceled);
    const selection = this.selectPayable(payable, dto.operationIds);
    if (selection.length === 0) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'Não há comissão pendente neste período para registrar como paga',
        HttpStatus.BAD_REQUEST,
      );
    }
    const organizationId = await this.organizationId();
    const amount = round(selection.reduce((sum, item) => sum + item.commission, 0));
    // Numa seleção o registro guarda o intervalo real do que foi pago, não o do filtro.
    const bounds = dto.operationIds?.length ? boundsOf(selection) : null;
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.commissionPayment.create({
        data: {
          organizationId,
          operatorId,
          periodStart: startOfDay(bounds?.from ?? from),
          periodEnd: startOfDay(bounds?.to ?? to),
          amount,
          operationCount: selection.length,
          notes: dto.notes?.trim() || null,
          paidById: actor.id,
        },
        select: { id: true, amount: true, operationCount: true, paidAt: true },
      });
      // Congela o valor por operação: o % do tipo pode mudar depois.
      for (const item of selection) {
        await tx.operation.update({
          where: { id: item.operationId },
          data: { commissionPaymentId: payment.id, commissionAmount: item.commission },
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'COMMISSION_PAID',
          resource: 'COMMISSION',
          actor: actor.id,
          metadata: {
            operatorId,
            paymentId: payment.id,
            amount,
            operationCount: selection.length,
            operationIds: selection.map((item) => item.operationId),
            partial: Boolean(dto.operationIds?.length),
            from: from.toISOString(),
            to: to.toISOString(),
          },
        },
      });
      return payment;
    });
  }

  /** Histórico de fechamentos do técnico (auditoria). */
  async payments(operatorId: string): Promise<unknown> {
    const rows = await this.prisma.commissionPayment.findMany({
      where: { operatorId },
      orderBy: { paidAt: 'desc' },
      take: 50,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        amount: true,
        operationCount: true,
        notes: true,
        paidAt: true,
        paidBy: { select: { id: true, name: true } },
      },
    });
    return { items: rows.map((row) => ({ ...row, amount: Number(row.amount) })) };
  }

  /* ---------- internos ---------- */

  /**
   * Restringe o fechamento aos atendimentos escolhidos. Recusa a operação
   * inteira se algum id não estiver mais pagável (já pago, cancelado ou fora
   * do filtro) — é dinheiro: melhor o owner reconferir a lista do que pagar
   * em silêncio um subconjunto diferente do que ele marcou.
   */
  private selectPayable(payable: CommissionItem[], operationIds?: string[]): CommissionItem[] {
    if (!operationIds?.length) return payable;
    const wanted = new Set(operationIds);
    const selection = payable.filter((item) => wanted.has(item.operationId));
    if (selection.length !== wanted.size) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'Alguns atendimentos selecionados não estão mais disponíveis para pagamento (já pagos ou cancelados). Atualize a lista e tente novamente.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return selection;
  }

  private resolveRange(
    period: CommissionPeriod,
    query: { from?: string; to?: string },
  ): { from: Date; to: Date } {
    if (query.from && query.to) {
      const from = new Date(query.from);
      const to = new Date(query.to);
      from.setUTCHours(0, 0, 0, 0);
      to.setUTCHours(23, 59, 59, 999);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Intervalo de datas inválido',
          HttpStatus.BAD_REQUEST,
        );
      }
      return { from, to };
    }
    return CommissionsService.defaultRange(period);
  }

  private async items(
    operatorId: string,
    from: Date,
    to: Date,
    serviceType?: string,
  ): Promise<CommissionItem[]> {
    const where: Prisma.OperationWhereInput = {
      operatorId,
      // Canceladas entram para ficarem visíveis como estorno — a aprovação do
      // cancelamento preenche `completedAt`, então elas caem no mesmo intervalo.
      status: { in: [OperationStatus.COMPLETED, OperationStatus.CANCELED] },
      completedAt: { gte: from, lte: to },
      serviceValue: { not: null },
      ...(serviceType ? { type: serviceType } : {}),
    };
    const [types, operations] = await Promise.all([
      this.prisma.serviceType.findMany({
        select: { key: true, label: true, commissionEligible: true, commissionPercent: true },
      }),
      this.prisma.operation.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        take: 500,
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          completedAt: true,
          serviceValue: true,
          commissionPaymentId: true,
          commissionAmount: true,
        },
      }),
    ]);
    const config = new Map(types.map((type) => [type.key, type]));
    const items: CommissionItem[] = [];
    for (const operation of operations) {
      const cfg = config.get(operation.type);
      const eligible = cfg?.commissionEligible ?? false;
      const percent = Number(cfg?.commissionPercent ?? 0);
      const serviceValue = Number(operation.serviceValue ?? 0);
      // Já pagas entram no histórico mesmo que o tipo tenha mudado de regra.
      const alreadyPaid = Boolean(operation.commissionPaymentId);
      if (!alreadyPaid && (!eligible || percent <= 0 || serviceValue <= 0)) continue;
      const commission = alreadyPaid
        ? Number(operation.commissionAmount ?? 0)
        : round(serviceValue * (percent / 100));
      items.push({
        operationId: operation.id,
        number: operation.number,
        completedAt: operation.completedAt,
        typeKey: operation.type,
        typeLabel: cfg?.label ?? operation.type,
        serviceValue,
        percent,
        commission,
        paid: alreadyPaid,
        canceled: operation.status === OperationStatus.CANCELED,
        paymentId: operation.commissionPaymentId,
      });
    }
    return items;
  }

  private async organizationId(): Promise<string> {
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
    return organization.id;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Menor e maior conclusão da seleção, para o período registrado no histórico. */
function boundsOf(items: CommissionItem[]): { from: Date; to: Date } | null {
  const dates = items
    .map((item) => item.completedAt)
    .filter((date): date is Date => date instanceof Date);
  if (dates.length === 0) return null;
  const times = dates.map((date) => date.getTime());
  return { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) };
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
