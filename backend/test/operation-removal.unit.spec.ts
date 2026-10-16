import 'reflect-metadata';
import { AssignmentStatus, FinancialEntryStatus, OperationStatus, Prisma, Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';
import { DocumentEngineService } from '../src/modules/document-engine/document-engine.service';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

const OPERATION = '22222222-2222-4222-8222-222222222222';
const actor = { id: 'owner-1', role: Role.OWNER } as never;
const context = { requestId: 'r', ip: null, userAgent: null };

type Write = { where: Record<string, unknown>; data: Record<string, unknown> };

/** Primeiro argumento da primeira chamada de um mock. */
function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

/** Argumentos de todas as chamadas de um mock. */
function args<T>(mock: jest.Mock): T[] {
  return (mock.mock.calls as unknown[][]).map((call) => call[0] as T);
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((cause: unknown) => cause);
  return error instanceof ApplicationException ? error.code : undefined;
}

const SNAPSHOT = {
  version: 1,
  previousStatus: OperationStatus.COMPLETED,
  parts: ['part-1', 'part-2'],
  financialEntries: [{ id: 'fin-1', previousStatus: FinancialEntryStatus.PAID }],
  commissionPayments: [{ paymentId: 'pay-so-esta', previousAmount: '300', amount: null }],
  assignments: [{ id: 'asg-1', status: AssignmentStatus.COMPLETED, operatorVisible: true }],
  reminder: { id: 'rem-1', status: 'PENDING' },
  documents: ['doc-os', 'doc-recibo'],
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(
  opts: {
    operation?: Record<string, unknown> | null;
    commissionEntries?: Array<{ paymentId: string }>;
    remaining?: Record<string, Array<{ amount: string }>>;
  } = {},
) {
  const calls: string[] = [];
  const track = (name: string, value: unknown = {}): jest.Mock =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });
  const tx = {
    operation: {
      findUnique: jest.fn().mockResolvedValue({ deletedAt: null }),
      update: track('operation.update'),
      updateMany: track('operation.updateMany', { count: 1 }),
      delete: track('operation.delete'),
    },
    assignment: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'asg-1', status: AssignmentStatus.COMPLETED, operatorVisible: true },
      ]),
      update: track('assignment.update'),
      updateMany: track('assignment.updateMany', { count: 1 }),
      deleteMany: track('assignment.deleteMany'),
    },
    assignmentHistory: { create: track('assignmentHistory.create'), deleteMany: track('assignmentHistory.deleteMany') },
    maintenanceReminder: {
      findFirst: jest.fn().mockResolvedValue({ id: 'rem-1', status: 'PENDING' }),
      update: track('maintenanceReminder.update'),
      updateMany: track('maintenanceReminder.updateMany', { count: 1 }),
      deleteMany: track('maintenanceReminder.deleteMany'),
    },
    operationDocument: {
      findMany: jest.fn().mockResolvedValue([{ id: 'doc-os' }, { id: 'doc-recibo' }]),
      updateMany: track('operationDocument.updateMany', { count: 2 }),
    },
    auditLog: { create: track('auditLog.create') },
    commissionEntry: {
      findMany: jest.fn().mockResolvedValue(opts.commissionEntries ?? []),
      deleteMany: track('commissionEntry.deleteMany'),
    },
    commissionPayment: {
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          amount: new Prisma.Decimal('300'),
          entries: (opts.remaining?.[where.id] ?? []).map((entry) => ({
            amount: new Prisma.Decimal(entry.amount),
          })),
        }),
      ),
      update: track('commissionPayment.update'),
      delete: track('commissionPayment.delete'),
    },
  };
  const operation =
    opts.operation === undefined
      ? { id: OPERATION, number: 41, status: OperationStatus.COMPLETED, deletedAt: null }
      : opts.operation;
  const prisma = {
    operation: { findUnique: jest.fn().mockResolvedValue(operation) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => {
      await callback(tx);
      calls.push('commit');
    }),
  };
  const storage = { delete: track('storage.delete') };
  const financial = {
    cancelOperationEntriesTx: jest.fn(() => {
      calls.push('financial.cancel');
      return Promise.resolve([{ id: 'fin-1', previousStatus: FinancialEntryStatus.PAID }]);
    }),
    restoreOperationEntriesTx: jest.fn(() => {
      calls.push('financial.restore');
      return Promise.resolve(1);
    }),
  };
  const inventory = {
    returnOperationMaterialsTx: jest.fn(() => {
      calls.push('inventory.return');
      return Promise.resolve(['part-1', 'part-2']);
    }),
    reconsumeOperationMaterialsTx: jest.fn(() => {
      calls.push('inventory.reconsume');
      return Promise.resolve(2);
    }),
  };
  const service = new OperationsService(
    prisma as never,
    storage as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    financial as never,
    {} as never,
    inventory as never,
  );
  // Depois da restauração o serviço devolve a operação atualizada.
  jest.spyOn(service as unknown as { operationOrThrow: () => Promise<unknown> }, 'operationOrThrow').mockResolvedValue({ id: OPERATION });
  return { service, tx, prisma, storage, financial, inventory, calls };
}

describe('Operation removal (lógica: fica na base e pode ser restaurada)', () => {
  it('estorna estoque, financeiro e comissão, mas NÃO apaga nada e guarda o snapshot', async () => {
    const { service, tx, storage, financial, inventory, calls } = setup({
      commissionEntries: [{ paymentId: 'pay-com-outras' }, { paymentId: 'pay-so-esta' }],
      remaining: {
        'pay-com-outras': [{ amount: '120.50' }, { amount: '79.50' }],
        'pay-so-esta': [],
      },
    });

    await expect(service.remove(OPERATION, actor, context)).resolves.toEqual({ deleted: true });

    expect(inventory.returnOperationMaterialsTx).toHaveBeenCalled();
    expect(financial.cancelOperationEntriesTx).toHaveBeenCalledWith(tx, OPERATION, 'owner-1', context);
    expect(tx.commissionPayment.update).toHaveBeenCalledWith({
      where: { id: 'pay-com-outras' },
      data: { amount: new Prisma.Decimal('200'), operationCount: 2 },
    });

    // Nada é apagado: nem a operação, nem arquivos.
    expect(tx.operation.delete).not.toHaveBeenCalled();
    expect(tx.assignment.deleteMany).not.toHaveBeenCalled();
    expect(tx.maintenanceReminder.deleteMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();

    // O técnico perde o acesso; o lembrete é dispensado; documentos marcados.
    expect(firstArg<Write>(tx.assignment.update).data).toMatchObject({
      status: AssignmentStatus.CANCELED,
      operatorVisible: false,
    });
    expect(firstArg<Write>(tx.maintenanceReminder.update).data).toEqual({ status: 'DISMISSED' });
    expect(firstArg<Write>(tx.operationDocument.updateMany)).toMatchObject({
      where: { id: { in: ['doc-os', 'doc-recibo'] } },
      data: { deletedById: 'owner-1' },
    });

    // A marca de excluída entra por último, com o que foi estornado.
    const mark = firstArg<Write>(tx.operation.update);
    expect(mark.data.deletedById).toBe('owner-1');
    expect(mark.data.deletedAt).toBeInstanceOf(Date);
    expect(mark.data.deletionSnapshot).toMatchObject({
      parts: ['part-1', 'part-2'],
      financialEntries: [{ id: 'fin-1', previousStatus: FinancialEntryStatus.PAID }],
      assignments: [{ id: 'asg-1', status: AssignmentStatus.COMPLETED, operatorVisible: true }],
      reminder: { id: 'rem-1', status: 'PENDING' },
      documents: ['doc-os', 'doc-recibo'],
    });
    expect(calls.indexOf('inventory.return')).toBeLessThan(calls.indexOf('operation.update'));

    const audit = firstArg<{ data: { action: string; metadata: Record<string, unknown> } }>(tx.auditLog.create);
    expect(audit.data.action).toBe('OPERATION_DELETED');
    expect(audit.data.metadata).toMatchObject({
      permanent: false,
      materialsReturned: 2,
      financialEntriesCanceled: 1,
      assignmentsCanceled: 1,
      reminderDismissed: true,
      documentsDeleted: 2,
    });
  });

  it('não estorna duas vezes uma operação já excluída', async () => {
    const { service, inventory, prisma } = setup({
      operation: { id: OPERATION, number: 41, status: OperationStatus.COMPLETED, deletedAt: new Date() },
    });

    await expect(service.remove(OPERATION, actor, context)).resolves.toEqual({ deleted: true });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventory.returnOperationMaterialsTx).not.toHaveBeenCalled();
  });

  it('responde "não encontrado" para operação inexistente', async () => {
    const { service } = setup({ operation: null });

    expect(await errorCode(service.remove(OPERATION, actor, context))).toBe('OPERATION_NOT_FOUND');
  });
});

describe('Operation restore', () => {
  const deleted = {
    id: OPERATION,
    number: 41,
    deletedAt: new Date('2026-10-10T10:00:00Z'),
    deletionSnapshot: SNAPSHOT,
  };

  it('desfaz os estornos da exclusão e restaura os documentos excluídos junto', async () => {
    const { service, tx, financial, inventory, calls } = setup({ operation: deleted });

    await expect(service.restore(OPERATION, actor, context)).resolves.toEqual({ id: OPERATION });

    expect(firstArg<Write>(tx.operation.updateMany)).toMatchObject({
      where: { id: OPERATION, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null },
    });
    // A marca sai ANTES da nova baixa de estoque (que recusa operação excluída).
    expect(calls.indexOf('operation.updateMany')).toBeLessThan(calls.indexOf('inventory.reconsume'));
    expect(inventory.reconsumeOperationMaterialsTx).toHaveBeenCalledWith(
      tx,
      deleted,
      ['part-1', 'part-2'],
      actor,
      context,
    );
    expect(financial.restoreOperationEntriesTx).toHaveBeenCalledWith(
      tx,
      OPERATION,
      SNAPSHOT.financialEntries,
      'owner-1',
      context,
    );
    expect(firstArg<Write>(tx.assignment.updateMany)).toEqual({
      where: { id: 'asg-1', status: AssignmentStatus.CANCELED },
      data: { status: AssignmentStatus.COMPLETED, operatorVisible: true, canceledAt: null },
    });
    expect(firstArg<Write>(tx.maintenanceReminder.updateMany).data).toEqual({ status: 'PENDING' });
    expect(firstArg<Write>(tx.operationDocument.updateMany)).toMatchObject({
      where: { id: { in: ['doc-os', 'doc-recibo'] }, operationId: OPERATION },
      data: { deletedAt: null, deletedById: null },
    });
    // A comissão não volta ao pagamento antigo.
    expect(tx.commissionPayment.update).not.toHaveBeenCalled();

    const audit = firstArg<{ data: { action: string; metadata: Record<string, unknown> } }>(tx.auditLog.create);
    expect(audit.data.action).toBe('OPERATION_RESTORED');
    expect(audit.data.metadata).toMatchObject({ materialsConsumed: 2, financialEntriesRestored: 1, documentsRestored: 2 });
  });

  it('explica a falta de estoque ao restaurar', async () => {
    const { service, inventory } = setup({ operation: deleted });
    inventory.reconsumeOperationMaterialsTx.mockRejectedValue(
      new ApplicationException('INVENTORY_NEGATIVE_STOCK', 'A movimentação deixaria o estoque negativo', 409),
    );

    const error = await service.restore(OPERATION, actor, context).catch((cause: unknown) => cause);

    expect((error as ApplicationException).code).toBe('INVENTORY_NEGATIVE_STOCK');
    expect((error as ApplicationException).message).toMatch(/Não há estoque suficiente/);
  });

  it('recusa restaurar uma operação que não está excluída', async () => {
    const { service } = setup({ operation: { ...deleted, deletedAt: null } });

    expect(await errorCode(service.restore(OPERATION, actor, context))).toBe('OPERATION_NOT_DELETED');
  });
});

describe('Document removal (lógica) e restauração', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function docSetup(document: Record<string, unknown> | null) {
    const tx = {
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      operationDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      operationDocument: { findUnique: jest.fn().mockResolvedValue(document) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };
    const assets = { deleteDocumentPdf: jest.fn().mockResolvedValue(undefined) };
    const service = new DocumentEngineService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      assets as never,
      {} as never,
      {} as never,
    );
    return { service, tx, assets };
  }

  const issued = {
    id: 'doc-1',
    type: 'WORK_ORDER',
    number: 'OS-000041',
    operationId: OPERATION,
    budgetId: null,
    revision: 3,
    renderedAt: new Date(),
    deletedAt: null,
  };

  it('marca um documento emitido como excluído, mantendo registro e PDF', async () => {
    const { service, tx, assets } = docSetup(issued);

    await expect(service.deleteDocument('doc-1', actor, context)).resolves.toEqual({ deleted: true });

    expect(tx.operationDocument.delete).not.toHaveBeenCalled();
    expect(assets.deleteDocumentPdf).not.toHaveBeenCalled();
    const write = firstArg<Write>(tx.operationDocument.updateMany);
    expect(write.where).toEqual({ id: 'doc-1', deletedAt: null });
    expect(write.data).toMatchObject({ deletedById: 'owner-1' });
    const audit = firstArg<{ data: { action: string; metadata: Record<string, unknown> } }>(tx.auditLog.create);
    expect(audit.data.action).toBe('DOCUMENT_DELETED');
    expect(audit.data.metadata).toMatchObject({ type: 'WORK_ORDER', wasRendered: true, permanent: false });
  });

  it('responde "não encontrado" para documento inexistente', async () => {
    const { service, tx } = docSetup(null);

    expect(await errorCode(service.deleteDocument('x', actor, context))).toBe('DOCUMENT_NOT_FOUND');
    expect(tx.operationDocument.updateMany).not.toHaveBeenCalled();
  });

  it('restaura um documento excluído e registra na auditoria', async () => {
    const { service, tx } = docSetup({ ...issued, deletedAt: new Date(), operation: { deletedAt: null } });

    await service.restoreDocument('doc-1', actor, context);

    expect(firstArg<Write>(tx.operationDocument.update)).toEqual({
      where: { id: 'doc-1' },
      data: { deletedAt: null, deletedById: null },
    });
    expect(args<{ data: { action: string } }>(tx.auditLog.create)[0].data.action).toBe('DOCUMENT_RESTORED');
  });

  it('pede para restaurar o atendimento quando ele também foi excluído', async () => {
    const { service, tx } = docSetup({ ...issued, deletedAt: new Date(), operation: { deletedAt: new Date() } });

    expect(await errorCode(service.restoreDocument('doc-1', actor, context))).toBe('OPERATION_DELETED');
    expect(tx.operationDocument.update).not.toHaveBeenCalled();
  });
});
