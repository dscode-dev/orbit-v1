import 'reflect-metadata';

import { OperationStatus, OperationType, Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';

describe('Operation management', () => {
  const actor = { id: '11111111-1111-4111-8111-111111111111', role: Role.OWNER };
  const context = { requestId: 'operation-management', ip: null, userAgent: null };

  function service(prisma: Record<string, unknown>): OperationsService {
    return new OperationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertOperationAccess: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );
  }

  it('keeps completed operations immutable', async () => {
    const operations = service({
      operation: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-4222-8222-222222222222',
          customerId: '33333333-3333-4333-8333-333333333333',
          addressId: null,
          equipmentId: null,
          operatorId: actor.id,
          status: OperationStatus.COMPLETED,
          startedAt: new Date(),
          completedAt: new Date(),
          type: OperationType.PREVENTIVA,
          serviceTypes: [OperationType.PREVENTIVA],
          referenceMonth: null,
          referenceYear: null,
          inspectedEquipments: [],
          maintenanceExecution: null,
          rvtExecution: null,
          _count: { photos: 0 },
        }),
      },
    });

    await expect(
      operations.update(
        '22222222-2222-4222-8222-222222222222',
        { observations: 'Alteração posterior à conclusão' },
        actor as never,
        context,
      ),
    ).rejects.toThrow('Operações concluídas não podem ser editadas');
  });

  it('hard-deletes an eligible operation and its assignments', async () => {
    const tx = {
      assignment: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      operation: {
        findFirst: jest.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      assignmentHistory: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      operation: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-4222-8222-222222222222',
          number: 41,
          status: OperationStatus.PENDING,
          maintenanceExecution: null,
          pmocExecutionRequest: null,
          generatedPmocExecutionRequest: null,
          rvtExecution: null,
          customerServiceTicket: null,
          documents: [],
          _count: { parts: 0, budgets: 0, stockMovements: 0 },
        }),
      },
      operationPhoto: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) =>
        callback(tx),
      ),
    };

    await expect(
      service(prisma).remove(
        '22222222-2222-4222-8222-222222222222',
        actor as never,
        context,
      ),
    ).resolves.toEqual({ deleted: true });
    expect(tx.assignmentHistory.deleteMany).toHaveBeenCalledWith({ where: { operationId: '22222222-2222-4222-8222-222222222222' } });
    expect(tx.assignment.deleteMany).toHaveBeenCalledWith({ where: { operationId: '22222222-2222-4222-8222-222222222222' } });
    expect(tx.operation.delete).toHaveBeenCalledWith({ where: { id: '22222222-2222-4222-8222-222222222222' } });
    const deleteAudit = (tx.auditLog.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { action: string };
    };
    expect(deleteAudit.data.action).toBe('OPERATION_DELETED');
  });

  it('cancels active assignments and removes operator visibility', async () => {
    const tx = {
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: '44444444-4444-4444-8444-444444444444', status: 'ASSIGNED' },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      operation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      assignmentHistory: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      operationDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const operation = {
      id: '22222222-2222-4222-8222-222222222222',
      number: 41,
      status: OperationStatus.PENDING,
    };
    const prisma = {
      operation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(operation)
          .mockResolvedValueOnce({ ...operation, status: OperationStatus.CANCELED, signatureData: null, assignments: [] }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    await service(prisma).cancel(operation.id, actor as never, context);

    const assignmentUpdate = (tx.assignment.update.mock.calls as unknown[][])[0]?.[0] as {
      where: { id: string };
      data: { status: string; operatorVisible: boolean };
    };
    expect(assignmentUpdate).toMatchObject({
      where: { id: '44444444-4444-4444-8444-444444444444' },
      data: { status: 'CANCELED', operatorVisible: false },
    });
    const historyCreate = (tx.assignmentHistory.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { event: string; previousStatus: string };
    };
    expect(historyCreate.data).toMatchObject({ event: 'CANCELED', previousStatus: 'ASSIGNED' });
    const cancelAudit = (tx.auditLog.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { action: string };
    };
    expect(cancelAudit.data.action).toBe('OPERATION_CANCELED');
  });

  it('reactivates as draft without restoring a canceled assignment', async () => {
    const tx = {
      operation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      operationDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const operation = {
      id: '22222222-2222-4222-8222-222222222222',
      number: 41,
      status: OperationStatus.CANCELED,
    };
    const prisma = {
      operation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(operation)
          .mockResolvedValueOnce({ ...operation, status: OperationStatus.DRAFT, signatureData: null, assignments: [] }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    await service(prisma).reactivate(operation.id, actor as never, context);

    expect(tx.operation.updateMany).toHaveBeenCalledWith({
      where: { id: operation.id, status: OperationStatus.CANCELED },
      data: { status: OperationStatus.DRAFT, startedAt: null, completedAt: null },
    });
    expect(tx).not.toHaveProperty('assignment');
    const audit = (tx.auditLog.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { action: string; metadata: { requiresReassignment: boolean } };
    };
    expect(audit.data.action).toBe('OPERATION_REACTIVATED');
    expect(audit.data.metadata.requiresReassignment).toBe(true);
  });
});
