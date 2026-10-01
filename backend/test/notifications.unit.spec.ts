import { NotificationEntityType, NotificationSeverity, NotificationType } from '@prisma/client';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@orbit.test',
  username: 'owner',
  name: 'Owner',
  role: 'OWNER',
  isActive: true,
  mustChangePassword: false,
} as const;

describe('NotificationsService', () => {
  it('creates budget decision notifications with idempotent event keys', async () => {
    const tx = {
      budget: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-4222-8222-222222222222',
          number: 15,
          organizationId: '33333333-3333-4333-8333-333333333333',
          total: { toString: () => '1500.00' },
          customer: { name: 'Hospital Santa Clara', tradeName: null },
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: actor.id },
          { id: '44444444-4444-4444-8444-444444444444' },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const service = new NotificationsService({} as never);

    await service.notifyBudgetDecisionTx(tx as never, '22222222-2222-4222-8222-222222222222', NotificationType.BUDGET_APPROVED);

    const createManyCalls = tx.notification.createMany.mock.calls as Array<[unknown]>;
    const call = createManyCalls[0]?.[0] as {
      skipDuplicates: boolean;
      data: Array<{ eventKey: string; type: NotificationType; entityType: NotificationEntityType; severity: NotificationSeverity }>;
    };
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(2);
    expect(call.data[0].eventKey).toBe('budget:22222222-2222-4222-8222-222222222222:approved');
    expect(call.data[0].type).toBe(NotificationType.BUDGET_APPROVED);
    expect(call.data[0].entityType).toBe(NotificationEntityType.BUDGET);
    expect(call.data[0].severity).toBe(NotificationSeverity.SUCCESS);
  });

  it('denies marking another user notification as read', async () => {
    const prisma = {
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new NotificationsService(prisma as never);

    await expect(service.markRead('55555555-5555-4555-8555-555555555555', actor as never)).rejects.toThrow(
      'Notificação não encontrada',
    );
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('lists only notifications for the authenticated recipient', async () => {
    const prisma = {
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'notification-1', readAt: null }], 1]),
      notification: {
        findMany: jest.fn((args: unknown) => ({ operation: 'findMany', args })),
        count: jest.fn((args: unknown) => ({ operation: 'count', args })),
      },
    };
    const service = new NotificationsService(prisma as never);

    await service.list({ page: 1, limit: 20 }, actor);

    const findManyCalls = prisma.notification.findMany.mock.calls as Array<[unknown]>;
    const call = findManyCalls[0]?.[0] as { where: { recipientUserId: string; deletedAt: null } };
    expect(call.where.recipientUserId).toBe(actor.id);
    expect(call.where.deletedAt).toBeNull();
  });
});
