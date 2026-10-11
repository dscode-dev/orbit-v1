import 'reflect-metadata';
import { OperationStatus, Prisma, Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';
import { DocumentEngineService } from '../src/modules/document-engine/document-engine.service';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

const OPERATION = '22222222-2222-4222-8222-222222222222';
const actor = { id: 'owner-1', role: Role.OWNER } as never;
const context = { requestId: 'r', ip: null, userAgent: null };

/** Primeiro argumento da primeira chamada de um mock. */
function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(
  opts: {
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
      findUnique: jest.fn().mockResolvedValue({ id: OPERATION }),
      delete: track('operation.delete'),
    },
    assignment: { deleteMany: track('assignment.deleteMany') },
    assignmentHistory: { deleteMany: track('assignmentHistory.deleteMany') },
    maintenanceReminder: { deleteMany: track('maintenanceReminder.deleteMany') },
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
  const prisma = {
    operation: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: OPERATION, number: 41, status: OperationStatus.COMPLETED }),
    },
    operationPhoto: {
      findMany: jest.fn().mockResolvedValue([{ storageKey: 'operations/foto-1.jpg' }]),
    },
    operationDocument: {
      findMany: jest.fn().mockResolvedValue([{ storageKey: 'documents/os-41.pdf' }]),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => {
      await callback(tx);
      calls.push('commit');
    }),
  };
  const storage = {
    delete: jest.fn(() => {
      calls.push('storage.delete');
      return Promise.resolve();
    }),
  };
  const financial = {
    cancelOperationEntriesTx: jest.fn(() => {
      calls.push('financial.cancel');
      return Promise.resolve(2);
    }),
  };
  const inventory = {
    returnOperationMaterialsTx: jest.fn(() => {
      calls.push('inventory.return');
      return Promise.resolve(3);
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
  return { service, tx, prisma, storage, financial, inventory, calls };
}

describe('Operation removal (definitiva, inclusive concluída)', () => {
  it('estorna estoque e financeiro, ajusta a comissão paga e apaga a operação', async () => {
    const { service, tx, storage, financial, inventory, calls } = setup({
      commissionEntries: [{ paymentId: 'pay-com-outras' }, { paymentId: 'pay-so-esta' }],
      remaining: {
        'pay-com-outras': [{ amount: '120.50' }, { amount: '79.50' }],
        'pay-so-esta': [],
      },
    });

    await expect(service.remove(OPERATION, actor, context)).resolves.toEqual({ deleted: true });

    expect(inventory.returnOperationMaterialsTx).toHaveBeenCalledWith(
      tx,
      { id: OPERATION, number: 41, status: OperationStatus.COMPLETED },
      actor,
      context,
    );
    expect(financial.cancelOperationEntriesTx).toHaveBeenCalledWith(
      tx,
      OPERATION,
      'owner-1',
      context,
    );
    expect(tx.commissionEntry.deleteMany).toHaveBeenCalledWith({
      where: { operationId: OPERATION },
    });
    // Pagamento que ainda tem outras operações: recalculado.
    expect(tx.commissionPayment.update).toHaveBeenCalledWith({
      where: { id: 'pay-com-outras' },
      data: { amount: new Prisma.Decimal('200'), operationCount: 2 },
    });
    // Pagamento que só tinha esta operação: removido.
    expect(tx.commissionPayment.delete).toHaveBeenCalledWith({ where: { id: 'pay-so-esta' } });
    expect(tx.operation.delete).toHaveBeenCalledWith({ where: { id: OPERATION } });

    // Estornos ANTES de apagar a operação; arquivos só DEPOIS do commit.
    expect(calls.indexOf('inventory.return')).toBeLessThan(calls.indexOf('operation.delete'));
    expect(calls.indexOf('financial.cancel')).toBeLessThan(calls.indexOf('operation.delete'));
    expect(calls.indexOf('commit')).toBeLessThan(calls.indexOf('storage.delete'));
    expect(
      (storage.delete.mock.calls as unknown as Array<[string]>).map(([key]) => key).sort(),
    ).toEqual(['documents/os-41.pdf', 'operations/foto-1.jpg']);

    const audit = firstArg<{ data: { action: string; metadata: Record<string, unknown> } }>(
      tx.auditLog.create,
    );
    expect(audit.data.action).toBe('OPERATION_DELETED');
    expect(audit.data.metadata).toMatchObject({
      previousStatus: OperationStatus.COMPLETED,
      permanent: true,
      materialsReturned: 3,
      financialEntriesCanceled: 2,
      documentsDeleted: 1,
      photosDeleted: 1,
    });
  });

  it('responde "não encontrado" para operação inexistente', async () => {
    const { service, prisma, tx } = setup();
    prisma.operation.findUnique.mockResolvedValue(null);

    const error = await service.remove(OPERATION, actor, context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApplicationException);
    expect((error as ApplicationException).code).toBe('OPERATION_NOT_FOUND');
    expect(tx.operation.delete).not.toHaveBeenCalled();
  });
});

describe('Document removal (definitiva)', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function docSetup(document: Record<string, unknown> | null) {
    const calls: string[] = [];
    const tx = {
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      operationDocument: {
        delete: jest.fn(() => {
          calls.push('delete');
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      operationDocument: { findUnique: jest.fn().mockResolvedValue(document) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => {
        await callback(tx);
        calls.push('commit');
      }),
    };
    const assets = {
      deleteDocumentPdf: jest.fn(() => {
        calls.push('pdf.delete');
        return Promise.resolve();
      }),
    };
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
    return { service, tx, assets, calls };
  }

  it('apaga um documento emitido e, depois do commit, o PDF', async () => {
    const { service, tx, assets, calls } = docSetup({
      id: 'doc-1',
      type: 'WORK_ORDER',
      operationId: OPERATION,
      budgetId: null,
      storageKey: 'documents/os-41.pdf',
      revision: 3,
      renderedAt: new Date(),
    });

    await expect(service.deleteDocument('doc-1', actor, context)).resolves.toEqual({
      deleted: true,
    });

    expect(tx.operationDocument.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
    expect(assets.deleteDocumentPdf).toHaveBeenCalledWith('documents/os-41.pdf');
    expect(calls).toEqual(['delete', 'commit', 'pdf.delete']);
    const audit = firstArg<{ data: { action: string; metadata: Record<string, unknown> } }>(
      tx.auditLog.create,
    );
    expect(audit.data.action).toBe('DOCUMENT_DELETED');
    expect(audit.data.metadata).toMatchObject({
      type: 'WORK_ORDER',
      wasRendered: true,
      permanent: true,
    });
  });

  it('responde "não encontrado" para documento inexistente', async () => {
    const { service, tx } = docSetup(null);

    const error = await service
      .deleteDocument('x', actor, context)
      .catch((cause: unknown) => cause);

    expect((error as ApplicationException).code).toBe('DOCUMENT_NOT_FOUND');
    expect(tx.operationDocument.delete).not.toHaveBeenCalled();
  });
});
