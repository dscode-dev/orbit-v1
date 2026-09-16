import { Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';

describe('Operations customer stats', () => {
  it('applies customer scope to every aggregate without bypassing actor ownership', async () => {
    const count = jest
      .fn()
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    const prisma = {
      operation: { count },
      $transaction: jest.fn((queries: Array<Promise<number>>) => Promise.all(queries)),
    };
    const access = {
      operationScope: jest.fn().mockReturnValue({
        assignment: { assignedTo: '11111111-1111-4111-8111-111111111111' },
      }),
    };
    const service = new OperationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      access as never,
      {} as never,
      { assertValidTypeKeys: async () => undefined, getReminderConfigByKey: async () => null } as never,
    );
    const customerId = '22222222-2222-4222-8222-222222222222';

    const result = await service.stats(
      { customerId },
      {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'operator@orbit.test',
        username: 'operator',
        name: 'Operador',
        role: Role.OPERATOR,
        isActive: true,
        mustChangePassword: false,
      },
    );

    expect(result).toEqual({
      total: 12,
      byStatus: {
        DRAFT: 1,
        PENDING: 2,
        IN_PROGRESS: 3,
        REVIEW: 1,
        COMPLETED: 5,
        CANCELED: 0,
      },
    });
    expect(access.operationScope).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(7);
    const countCalls = count.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    for (const [{ where }] of countCalls)
      expect(where).toMatchObject({
        customerId,
        assignment: { assignedTo: '11111111-1111-4111-8111-111111111111' },
      });
  });
});
