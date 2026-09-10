import 'reflect-metadata';

import { MaintenanceReminderStatus, OperationStatus, OperationType, Role } from '@prisma/client';
import { MaintenanceRemindersService } from '../src/modules/maintenance-reminders/maintenance-reminders.service';

describe('Maintenance reminders', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const operationId = '22222222-2222-4222-8222-222222222222';
  const reminderId = '33333333-3333-4333-8333-333333333333';
  const actor = { id: '44444444-4444-4444-8444-444444444444', role: Role.OWNER };

  it('uses the interval configured by the operation when projecting a reminder', async () => {
    const tx = {
      operation: {
        findUnique: jest.fn().mockResolvedValue({
          id: operationId,
          type: OperationType.PREVENTIVA,
          requestedDocumentType: 'WORK_ORDER',
          status: OperationStatus.COMPLETED,
          scheduledFor: null,
          completedAt: new Date('2026-01-31T12:00:00.000Z'),
          createdAt: new Date('2026-01-10T12:00:00.000Z'),
          customerId: '55555555-5555-4555-8555-555555555555',
          equipmentId: null,
          maintenanceReminderIntervalMonths: 1,
        }),
      },
      maintenanceReminder: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: organizationId }),
      },
    };

    await new MaintenanceRemindersService({} as never).syncFromOperationTx(tx as never, operationId);

    const upsert = (tx.maintenanceReminder.upsert.mock.calls as unknown[][])[0]?.[0] as {
      create: { intervalMonths: number; dueDate: Date };
    };
    expect(upsert.create.intervalMonths).toBe(1);
    expect(upsert.create.dueDate).toEqual(new Date('2026-02-28T12:00:00.000Z'));
  });

  it('changes the period transactionally and recalculates the due date from its base', async () => {
    const tx = {
      maintenanceReminder: {
        update: jest.fn().mockResolvedValue({ id: reminderId, intervalMonths: 12 }),
      },
      operation: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      organization: { findFirst: jest.fn().mockResolvedValue({ id: organizationId }) },
      maintenanceReminder: {
        findFirst: jest.fn().mockResolvedValue({
          id: reminderId,
          operationId,
          baseDate: new Date('2026-03-15T09:00:00.000Z'),
          intervalMonths: 6,
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await new MaintenanceRemindersService(prisma as never).update(
      reminderId,
      { intervalMonths: 12 },
      actor as never,
    );

    const reminderUpdate = (tx.maintenanceReminder.update.mock.calls as unknown[][])[0]?.[0] as {
      where: { id: string };
      data: { intervalMonths: number; dueDate: Date; dateOverridden: boolean };
    };
    expect(reminderUpdate).toMatchObject({
      where: { id: reminderId },
      data: {
        intervalMonths: 12,
        dueDate: new Date('2027-03-15T09:00:00.000Z'),
        dateOverridden: false,
      },
    });
    expect(tx.operation.update).toHaveBeenCalledWith({
      where: { id: operationId },
      data: { maintenanceReminderIntervalMonths: 12 },
    });
    const audit = (tx.auditLog.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { action: string; actor: string };
    };
    expect(audit.data).toMatchObject({ action: 'MAINTENANCE_REMINDER_UPDATED', actor: actor.id });
  });

  it('keeps the established six-month default for existing operations', async () => {
    const tx = {
      operation: {
        findUnique: jest.fn().mockResolvedValue({
          id: operationId,
          type: OperationType.INSTALACAO,
          requestedDocumentType: 'WORK_ORDER',
          status: OperationStatus.PENDING,
          scheduledFor: new Date('2026-09-09T12:00:00.000Z'),
          completedAt: null,
          createdAt: new Date('2026-09-01T12:00:00.000Z'),
          customerId: '55555555-5555-4555-8555-555555555555',
          equipmentId: null,
          maintenanceReminderIntervalMonths: null,
        }),
      },
      maintenanceReminder: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ status: MaintenanceReminderStatus.PENDING }),
      },
      organization: { findFirst: jest.fn().mockResolvedValue({ id: organizationId }) },
    };

    await new MaintenanceRemindersService({} as never).syncFromOperationTx(tx as never, operationId);

    const upsert = (tx.maintenanceReminder.upsert.mock.calls as unknown[][])[0]?.[0] as {
      create: { intervalMonths: number };
    };
    expect(upsert.create.intervalMonths).toBe(6);
  });
});
