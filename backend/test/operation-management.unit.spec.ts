import 'reflect-metadata';

import { OperationStatus, OperationType, Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';

describe('Operation management', () => {
  const actor = { id: '11111111-1111-4111-8111-111111111111', role: Role.OWNER };
  const context = { requestId: 'operation-management', ip: null, userAgent: null };

  function service(
    prisma: Record<string, unknown>,
    dependencies: {
      lifecycle?: Record<string, jest.Mock>;
      maintenance?: Record<string, jest.Mock>;
    } = {},
  ): OperationsService {
    const reminders = { syncFromOperationTx: jest.fn().mockResolvedValue(undefined) };
    return new OperationsService(
      prisma as never,
      {} as never,
      (dependencies.lifecycle ?? {}) as never,
      (dependencies.maintenance ?? {}) as never,
      reminders as never,
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

  it('ignores administrative fields and allows an operator to submit execution data', async () => {
    const operator = { ...actor, role: Role.OPERATOR };
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      customerId: '33333333-3333-4333-8333-333333333333',
      addressId: null,
      equipmentId: null,
      operatorId: operator.id,
      status: OperationStatus.IN_PROGRESS,
      startedAt: new Date(),
      completedAt: null,
      type: OperationType.PREVENTIVA,
      requestedDocumentType: 'WORK_ORDER',
      serviceTypes: [OperationType.PREVENTIVA],
      serviceValue: null,
      maintenanceReminderIntervalMonths: null,
      referenceMonth: null,
      referenceYear: null,
      inspectedEquipments: [],
      maintenanceExecution: null,
      rvtExecution: null,
      _count: { photos: 0 },
    };
    const tx = {
      operation: { update: jest.fn().mockResolvedValue({}) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
      operationDocument: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      operation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce({ ...existing, signatureData: null, assignments: [] }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    await expect(
      service(prisma, {
        lifecycle: { publishOperationCompletedTx: jest.fn().mockResolvedValue(undefined) },
        maintenance: { syncOperationCompletedTx: jest.fn().mockResolvedValue(undefined) },
      }).update(
        existing.id,
        {
          customerId: '44444444-4444-4444-8444-444444444444',
          type: OperationType.INSTALACAO,
          scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
          serviceValue: 999,
          maintenanceReminderIntervalMonths: 12,
          status: OperationStatus.COMPLETED,
          checklist: [{ label: 'Inspeção visual', done: true }],
        },
        operator as never,
        context,
      ),
    ).resolves.toMatchObject({ id: existing.id });
    const update = (tx.operation.update.mock.calls as unknown[][])[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(update.data).toMatchObject({ status: OperationStatus.COMPLETED });
    expect(update.data).not.toHaveProperty('customerId');
    expect(update.data).not.toHaveProperty('type');
    expect(update.data).not.toHaveProperty('scheduledFor');
    expect(update.data).not.toHaveProperty('serviceValue');
    expect(update.data).not.toHaveProperty('maintenanceReminderIntervalMonths');
  });

  it('hard-deletes an eligible operation and its assignments', async () => {
    const tx = {
      maintenanceReminder: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

  it('reactivates as pending and restores the primary assignment to the operator queue', async () => {
    const tx = {
      operation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      assignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: '44444444-4444-4444-8444-444444444444',
          assignedTo: '55555555-5555-4555-8555-555555555555',
          status: 'CANCELED',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      assignmentHistory: { create: jest.fn().mockResolvedValue({}) },
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
          .mockResolvedValueOnce({
            ...operation,
            status: OperationStatus.PENDING,
            signatureData: null,
            assignments: [{
              id: '44444444-4444-4444-8444-444444444444',
              status: 'ASSIGNED',
              operatorVisible: true,
              isPrimary: true,
            }],
          }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    await service(prisma).reactivate(operation.id, actor as never, context);

    expect(tx.operation.updateMany).toHaveBeenCalledWith({
      where: { id: operation.id, status: OperationStatus.CANCELED },
      data: { status: OperationStatus.PENDING, startedAt: null, completedAt: null },
    });
    const restoredAssignment = (tx.assignment.updateMany.mock.calls as unknown[][])[0]?.[0] as {
      where: { id: string; status: string };
      data: { status: string; operatorVisible: boolean; canceledAt: Date | null };
    };
    expect(restoredAssignment).toMatchObject({
      where: {
        id: '44444444-4444-4444-8444-444444444444',
        status: 'CANCELED',
      },
      data: {
        status: 'ASSIGNED',
        operatorVisible: true,
        canceledAt: null,
      },
    });
    const restoredHistory = (tx.assignmentHistory.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { event: string; previousStatus: string; newStatus: string };
    };
    expect(restoredHistory).toMatchObject({
      data: {
        event: 'ASSIGNED',
        previousStatus: 'CANCELED',
        newStatus: 'ASSIGNED',
      },
    });
    const audit = (tx.auditLog.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { action: string; metadata: { assignmentRestored: boolean; assignedTo: string } };
    };
    expect(audit.data.action).toBe('OPERATION_REACTIVATED');
    expect(audit.data.metadata.assignmentRestored).toBe(true);
    expect(audit.data.metadata.assignedTo).toBe('55555555-5555-4555-8555-555555555555');
  });
});
