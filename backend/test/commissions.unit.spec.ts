import { CommissionsService } from '../src/modules/operations/commissions.service';

/**
 * Regra de dinheiro: o valor a pagar soma apenas atendimentos concluídos e ainda
 * não fechados. Já pagos não voltam ao pendente e cancelados saem do total —
 * mas continuam listados, para não quebrar a auditoria.
 */
describe('CommissionsService', () => {
  const serviceTypes = [
    { key: 'PREVENTIVA', label: 'Preventiva', commissionEligible: true, commissionPercent: 10 },
    { key: 'CORRETIVA', label: 'Corretiva', commissionEligible: false, commissionPercent: 0 },
  ];

  function serviceFor(operations: unknown[]) {
    const tx = {
      commissionPayment: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 'pay-new', ...data, paidAt: new Date() })),
      },
      operation: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      organizationSettings: { findFirst: jest.fn().mockResolvedValue({ commissionPeriod: 'MONTHLY' }) },
      serviceType: { findMany: jest.fn().mockResolvedValue(serviceTypes) },
      operation: { findMany: jest.fn().mockResolvedValue(operations) },
      organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    return { service: new CommissionsService(prisma as never), prisma, tx };
  }

  const owner = { id: 'owner-1' } as never;

  const range = { from: '2026-09-01', to: '2026-09-30' };

  it('separa pendente, pago e cancelado — cancelado não entra no total', async () => {
    const { service } = serviceFor([
      // pendente: 1000 × 10% = 100
      {
        id: 'op-1', number: 1, type: 'PREVENTIVA', status: 'COMPLETED',
        completedAt: new Date('2026-09-10'), serviceValue: 1000,
        commissionPaymentId: null, commissionAmount: null,
      },
      // já paga: usa o valor congelado no fechamento (50), não recalcula
      {
        id: 'op-2', number: 2, type: 'PREVENTIVA', status: 'COMPLETED',
        completedAt: new Date('2026-09-12'), serviceValue: 900,
        commissionPaymentId: 'pay-1', commissionAmount: 50,
      },
      // cancelada: 2000 × 10% = 200, fica listada mas fora dos totais
      {
        id: 'op-3', number: 3, type: 'PREVENTIVA', status: 'CANCELED',
        completedAt: new Date('2026-09-15'), serviceValue: 2000,
        commissionPaymentId: null, commissionAmount: null,
      },
    ]);

    const result = (await service.detail('operator-1', range)) as {
      summary: Record<string, number>;
      items: Array<{ operationId: string; canceled: boolean; paid: boolean; commission: number }>;
    };

    expect(result.summary.pendingAmount).toBe(100);
    expect(result.summary.pendingCount).toBe(1);
    expect(result.summary.paidAmount).toBe(50);
    expect(result.summary.paidCount).toBe(1);
    expect(result.summary.canceledAmount).toBe(200);
    expect(result.summary.canceledCount).toBe(1);

    // A cancelada continua na listagem (auditoria), marcada como tal.
    expect(result.items).toHaveLength(3);
    const canceled = result.items.find((item) => item.operationId === 'op-3');
    expect(canceled?.canceled).toBe(true);
    expect(canceled?.paid).toBe(false);
  });

  it('cancelada que já havia sido paga sai do total pago, preservando o registro', async () => {
    const { service } = serviceFor([
      {
        id: 'op-4', number: 4, type: 'PREVENTIVA', status: 'CANCELED',
        completedAt: new Date('2026-09-20'), serviceValue: 800,
        commissionPaymentId: 'pay-9', commissionAmount: 80,
      },
    ]);

    const result = (await service.detail('operator-1', range)) as {
      summary: Record<string, number>;
      items: Array<{ paid: boolean; canceled: boolean; paymentId: string | null }>;
    };

    expect(result.summary.paidAmount).toBe(0);
    expect(result.summary.pendingAmount).toBe(0);
    expect(result.summary.canceledAmount).toBe(80);
    // O vínculo com o fechamento é preservado para rastrear o que foi pago.
    expect(result.items[0]).toMatchObject({ paid: true, canceled: true, paymentId: 'pay-9' });
  });

  it('não permite fechar um período em que só há canceladas', async () => {
    const { service } = serviceFor([
      {
        id: 'op-5', number: 5, type: 'PREVENTIVA', status: 'CANCELED',
        completedAt: new Date('2026-09-22'), serviceValue: 500,
        commissionPaymentId: null, commissionAmount: null,
      },
    ]);

    await expect(service.pay('operator-1', range, owner)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  /** Pagamento individual e por seleção compartilham o mesmo caminho: operationIds. */
  describe('pagamento de uma seleção', () => {
    const pendingOperations = [
      {
        id: 'op-a', number: 10, type: 'PREVENTIVA', status: 'COMPLETED',
        completedAt: new Date('2026-09-04'), serviceValue: 1000,
        commissionPaymentId: null, commissionAmount: null,
      },
      {
        id: 'op-b', number: 11, type: 'PREVENTIVA', status: 'COMPLETED',
        completedAt: new Date('2026-09-18'), serviceValue: 2000,
        commissionPaymentId: null, commissionAmount: null,
      },
      {
        id: 'op-c', number: 12, type: 'PREVENTIVA', status: 'COMPLETED',
        completedAt: new Date('2026-09-25'), serviceValue: 3000,
        commissionPaymentId: null, commissionAmount: null,
      },
    ];

    it('fecha só os atendimentos escolhidos, deixando os demais pendentes', async () => {
      const { service, tx } = serviceFor(pendingOperations);

      const payment = (await service.pay(
        'operator-1',
        { ...range, operationIds: ['op-a', 'op-c'] },
        owner,
      )) as { amount: number; operationCount: number };

      // 100 + 300; op-b (200) continua fora do fechamento.
      expect(payment.amount).toBe(400);
      expect(payment.operationCount).toBe(2);
      const updated = tx.operation.update.mock.calls.map(([args]) => args.where.id);
      expect(updated).toEqual(['op-a', 'op-c']);
      // O período registrado é o do que foi pago, não o do filtro.
      const [{ data }] = tx.commissionPayment.create.mock.calls[0];
      expect(data.periodStart.toISOString().slice(0, 10)).toBe('2026-09-04');
      expect(data.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-25');
    });

    it('paga um único atendimento congelando o valor da comissão', async () => {
      const { service, tx } = serviceFor(pendingOperations);

      await service.pay('operator-1', { ...range, operationIds: ['op-b'] }, owner);

      expect(tx.operation.update).toHaveBeenCalledTimes(1);
      const [{ where, data }] = tx.operation.update.mock.calls[0];
      expect(where.id).toBe('op-b');
      expect(data.commissionAmount).toBe(200);
      expect(data.commissionPaymentId).toBe('pay-new');
    });

    it('recusa o fechamento inteiro se algum item escolhido já não é pagável', async () => {
      const { service, tx } = serviceFor([
        ...pendingOperations,
        {
          id: 'op-d', number: 13, type: 'PREVENTIVA', status: 'CANCELED',
          completedAt: new Date('2026-09-26'), serviceValue: 900,
          commissionPaymentId: null, commissionAmount: null,
        },
      ]);

      await expect(
        service.pay('operator-1', { ...range, operationIds: ['op-a', 'op-d'] }, owner),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      // Nada é gravado: o owner reconfere a lista em vez de pagar um subconjunto.
      expect(tx.operation.update).not.toHaveBeenCalled();
      expect(tx.commissionPayment.create).not.toHaveBeenCalled();
    });
  });

  it('ignora tipos não elegíveis a comissão', async () => {
    const { service } = serviceFor([
      {
        id: 'op-6', number: 6, type: 'CORRETIVA', status: 'COMPLETED',
        completedAt: new Date('2026-09-05'), serviceValue: 1000,
        commissionPaymentId: null, commissionAmount: null,
      },
    ]);

    const result = (await service.detail('operator-1', range)) as {
      summary: Record<string, number>;
      items: unknown[];
    };
    expect(result.items).toHaveLength(0);
    expect(result.summary.pendingAmount).toBe(0);
  });
});
