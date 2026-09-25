import { CommissionsService } from '../src/modules/operations/commissions.service';

/**
 * Regra de dinheiro: o valor a pagar soma apenas atendimentos concluídos e ainda
 * não fechados. Já pagos não voltam ao pendente e cancelados saem do total —
 * mas continuam listados, para não quebrar a auditoria.
 *
 * A mesma operação pode pagar duas pessoas: o técnico que executou (primário) e
 * os auxiliares, cada um com o seu percentual e o seu lançamento.
 */
describe('CommissionsService', () => {
  const serviceTypes = [
    {
      key: 'PREVENTIVA',
      label: 'Preventiva',
      commissionEligible: true,
      commissionPercent: 10,
      commissionPercentAssistant: 4,
      commissionFixed: 60,
      commissionFixedAssistant: 25,
    },
    {
      key: 'CORRETIVA',
      label: 'Corretiva',
      commissionEligible: false,
      commissionPercent: 0,
      commissionPercentAssistant: 0,
      commissionFixed: 0,
      commissionFixedAssistant: 0,
    },
    {
      key: 'INSTALACAO',
      label: 'Instalação',
      commissionEligible: true,
      commissionPercent: 8,
      commissionPercentAssistant: 0,
      commissionFixed: 90,
      commissionFixedAssistant: 0,
    },
  ];

  /** Operação como o Prisma devolve para o técnico consultado. */
  const operation = (
    over: Partial<{
      id: string;
      number: number;
      type: string;
      status: string;
      completedAt: Date;
      serviceValue: number | null;
      operatorId: string;
      commissionEntries: Array<{ paymentId: string; amount: number }>;
    }> = {},
  ) => ({
    id: 'op-1',
    number: 1,
    type: 'PREVENTIVA',
    status: 'COMPLETED',
    completedAt: new Date('2026-09-10'),
    serviceValue: 1000,
    operatorId: 'tecnico-1',
    commissionEntries: [],
    ...over,
  });

  /** `mode` é a base de cálculo configurada pelo owner (o padrão do app é FIXED). */
  function serviceFor(operations: unknown[], mode: 'FIXED' | 'PERCENT' = 'PERCENT') {
    const tx = {
      commissionPayment: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 'pay-new', ...data, paidAt: new Date() })),
      },
      commissionEntry: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      operation: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      organizationSettings: {
        findFirst: jest.fn().mockResolvedValue({ commissionPeriod: 'MONTHLY', commissionMode: mode }),
      },
      serviceType: { findMany: jest.fn().mockResolvedValue(serviceTypes) },
      operation: { findMany: jest.fn().mockResolvedValue(operations) },
      organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    return { service: new CommissionsService(prisma as never), prisma, tx };
  }

  const range = { from: '2026-09-01', to: '2026-09-30' };
  const owner = { id: 'owner-1' } as never;

  type Detail = {
    summary: Record<string, number>;
    items: Array<{
      operationId: string;
      role: string;
      percent: number;
      commission: number;
      paid: boolean;
      canceled: boolean;
      paymentId: string | null;
    }>;
  };

  it('separa pendente, pago e cancelado — cancelado não entra no total', async () => {
    const { service } = serviceFor([
      // pendente: 1000 × 10% = 100
      operation({ id: 'op-1', number: 1 }),
      // já paga: usa o valor congelado no fechamento (50), não recalcula
      operation({
        id: 'op-2', number: 2, serviceValue: 900,
        commissionEntries: [{ paymentId: 'pay-1', amount: 50 }],
      }),
      // cancelada: 2000 × 10% = 200, fica listada mas fora dos totais
      operation({ id: 'op-3', number: 3, status: 'CANCELED', serviceValue: 2000 }),
    ]);

    const result = (await service.detail('tecnico-1', range)) as Detail;

    expect(result.summary.pendingAmount).toBe(100);
    expect(result.summary.pendingCount).toBe(1);
    expect(result.summary.paidAmount).toBe(50);
    expect(result.summary.canceledAmount).toBe(200);

    // A cancelada continua na listagem (auditoria), marcada como tal.
    expect(result.items).toHaveLength(3);
    expect(result.items.find((item) => item.operationId === 'op-3')).toMatchObject({
      canceled: true,
      paid: false,
    });
  });

  it('não permite fechar um período em que só há canceladas', async () => {
    const { service } = serviceFor([operation({ status: 'CANCELED' })]);

    await expect(service.pay('tecnico-1', range, owner)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('ignora tipos não elegíveis a comissão', async () => {
    const { service } = serviceFor([operation({ type: 'CORRETIVA' })]);

    const result = (await service.detail('tecnico-1', range)) as Detail;
    expect(result.items).toHaveLength(0);
    expect(result.summary.pendingAmount).toBe(0);
  });

  describe('técnico auxiliar', () => {
    it('recebe pelo percentual de auxiliar quando não é o executor da operação', async () => {
      // A operação é do tecnico-1; quem consulta é o auxiliar.
      const { service, prisma } = serviceFor([operation({ serviceValue: 2000 })]);

      const result = (await service.detail('auxiliar-1', range)) as Detail;

      // 2000 × 4% (percentual de auxiliar), e não os 10% do primário.
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ role: 'ASSISTANT', percent: 4, commission: 80 });
      expect(result.summary.pendingAmount).toBe(80);

      // A busca precisa alcançar as operações em que ele é apenas auxiliar.
      const where = prisma.operation.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { operatorId: 'auxiliar-1' },
        {
          assignments: {
            some: {
              assignedTo: 'auxiliar-1',
              isPrimary: false,
              status: { notIn: ['REJECTED', 'CANCELED'] },
            },
          },
        },
      ]);
    });

    it('fica de fora quando o tipo não paga auxiliar (0%), sem afetar o primário', async () => {
      const { service } = serviceFor([operation({ type: 'INSTALACAO', serviceValue: 5000 })]);

      const assistant = (await service.detail('auxiliar-1', range)) as Detail;
      expect(assistant.items).toHaveLength(0);

      const primary = (await service.detail('tecnico-1', range)) as Detail;
      expect(primary.items[0]).toMatchObject({ role: 'PRIMARY', commission: 400 });
    });

    it('pagar o auxiliar grava lançamento próprio e não mexe na operação do primário', async () => {
      const { service, tx } = serviceFor([operation({ serviceValue: 2000 })]);

      await service.pay('auxiliar-1', range, owner);

      expect(tx.commissionEntry.createMany).toHaveBeenCalledWith({
        data: [
          {
            paymentId: 'pay-new',
            operationId: 'op-1',
            userId: 'auxiliar-1',
            role: 'ASSISTANT',
            amount: 80,
          },
        ],
      });
      // As colunas legadas da operação só valem para o executor primário.
      expect(tx.operation.update).not.toHaveBeenCalled();
    });

    it('o que o auxiliar já recebeu não volta ao pendente do primário', async () => {
      const { service } = serviceFor([
        operation({ commissionEntries: [{ paymentId: 'pay-aux', amount: 80 }] }),
      ]);

      // A consulta traz o lançamento DESTE usuário, então para ele está pago.
      const result = (await service.detail('auxiliar-1', range)) as Detail;
      expect(result.items[0]).toMatchObject({ paid: true, commission: 80, paymentId: 'pay-aux' });
      expect(result.summary.pendingAmount).toBe(0);
    });
  });

  describe('valor fixo por atendimento', () => {
    it('paga o valor fixo do tipo, sem olhar o valor do serviço', async () => {
      const { service } = serviceFor(
        [
          operation({ id: 'op-1', serviceValue: 1000 }),
          operation({ id: 'op-2', serviceValue: 9000 }),
        ],
        'FIXED',
      );

      const result = (await service.detail('tecnico-1', range)) as Detail;

      // 60 por atendimento nos dois, embora os serviços custem 1.000 e 9.000.
      expect(result.items.map((item) => item.commission)).toEqual([60, 60]);
      expect(result.summary.pendingAmount).toBe(120);
      // A coluna de percentual não se aplica nesse modo.
      expect(result.items.every((item) => item.percent === 0)).toBe(true);
    });

    it('usa o valor fixo do auxiliar, que é menor que o do executor', async () => {
      const { service } = serviceFor([operation({ serviceValue: 1000 })], 'FIXED');

      const result = (await service.detail('auxiliar-1', range)) as Detail;

      expect(result.items[0]).toMatchObject({ role: 'ASSISTANT', commission: 25 });
    });

    it('conta atendimento sem valor de serviço informado', async () => {
      const { service, prisma } = serviceFor([operation({ serviceValue: null })], 'FIXED');

      const result = (await service.detail('tecnico-1', range)) as Detail;

      expect(result.summary.pendingAmount).toBe(60);
      // A busca não pode exigir valor de serviço quando a comissão é fixa.
      expect(prisma.operation.findMany.mock.calls[0][0].where.serviceValue).toBeUndefined();
    });

    it('ignora o tipo cujo valor fixo é zero, mesmo sendo elegível', async () => {
      const { service } = serviceFor([operation({ type: 'INSTALACAO' })], 'FIXED');

      const assistant = (await service.detail('auxiliar-1', range)) as Detail;
      expect(assistant.items).toHaveLength(0);

      const primary = (await service.detail('tecnico-1', range)) as Detail;
      expect(primary.items[0]).toMatchObject({ commission: 90 });
    });

    it('congela o valor fixo no fechamento', async () => {
      const { service, tx } = serviceFor([operation({ serviceValue: 1000 })], 'FIXED');

      await service.pay('tecnico-1', range, owner);

      const [{ data }] = tx.commissionEntry.createMany.mock.calls[0];
      expect(data).toEqual([
        { paymentId: 'pay-new', operationId: 'op-1', userId: 'tecnico-1', role: 'PRIMARY', amount: 60 },
      ]);
    });
  });

  describe('pagamento de uma seleção', () => {
    const pendingOperations = [
      operation({ id: 'op-a', number: 10, completedAt: new Date('2026-09-04'), serviceValue: 1000 }),
      operation({ id: 'op-b', number: 11, completedAt: new Date('2026-09-18'), serviceValue: 2000 }),
      operation({ id: 'op-c', number: 12, completedAt: new Date('2026-09-25'), serviceValue: 3000 }),
    ];

    it('fecha só os atendimentos escolhidos, deixando os demais pendentes', async () => {
      const { service, tx } = serviceFor(pendingOperations);

      const payment = (await service.pay(
        'tecnico-1',
        { ...range, operationIds: ['op-a', 'op-c'] },
        owner,
      )) as { amount: number; operationCount: number };

      // 100 + 300; op-b (200) continua fora do fechamento.
      expect(payment.amount).toBe(400);
      expect(payment.operationCount).toBe(2);
      const [{ data }] = tx.commissionEntry.createMany.mock.calls[0];
      expect(data.map((entry: { operationId: string }) => entry.operationId)).toEqual(['op-a', 'op-c']);
      // O período registrado é o do que foi pago, não o do filtro.
      const [{ data: paymentData }] = tx.commissionPayment.create.mock.calls[0];
      expect(paymentData.periodStart.toISOString().slice(0, 10)).toBe('2026-09-04');
      expect(paymentData.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-25');
    });

    it('paga um único atendimento congelando o valor da comissão', async () => {
      const { service, tx } = serviceFor(pendingOperations);

      await service.pay('tecnico-1', { ...range, operationIds: ['op-b'] }, owner);

      const [{ data }] = tx.commissionEntry.createMany.mock.calls[0];
      expect(data).toEqual([
        { paymentId: 'pay-new', operationId: 'op-b', userId: 'tecnico-1', role: 'PRIMARY', amount: 200 },
      ]);
      expect(tx.operation.update).toHaveBeenCalledWith({
        where: { id: 'op-b' },
        data: { commissionPaymentId: 'pay-new', commissionAmount: 200 },
      });
    });

    it('recusa o fechamento inteiro se algum item escolhido já não é pagável', async () => {
      const { service, tx } = serviceFor([
        ...pendingOperations,
        operation({ id: 'op-d', number: 13, status: 'CANCELED', serviceValue: 900 }),
      ]);

      await expect(
        service.pay('tecnico-1', { ...range, operationIds: ['op-a', 'op-d'] }, owner),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      // Nada é gravado: o owner reconfere a lista em vez de pagar um subconjunto.
      expect(tx.commissionEntry.createMany).not.toHaveBeenCalled();
      expect(tx.commissionPayment.create).not.toHaveBeenCalled();
    });
  });
});
