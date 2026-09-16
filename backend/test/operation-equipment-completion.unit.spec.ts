import 'reflect-metadata';

import { Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';

describe('Operation equipment profile completion', () => {
  it('fills only informed missing technical fields and audits the completion', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const service = new OperationsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    {} as never,
      { assertValidTypeKeys: async () => undefined, getReminderConfigByKey: async () => null } as never,
    );

    await (
      service as unknown as {
        completeMissingEquipmentProfilesTx: (
          tx: unknown,
          operationId: string,
          items: unknown[],
          actor: unknown,
          context: unknown,
        ) => Promise<void>;
      }
    ).completeMissingEquipmentProfilesTx(
      {
        equipment: { updateMany },
        auditLog: { create: auditCreate },
      },
      '11111111-1111-4111-8111-111111111111',
      [
        {
          equipmentId: '22222222-2222-4222-8222-222222222222',
          manufacturer: '  Carrier ',
          model: '  42X ',
          capacity: '',
        },
      ],
      {
        id: '33333333-3333-4333-8333-333333333333',
        role: Role.OPERATOR,
      },
      { requestId: 'request-id', ip: null, userAgent: null },
    );

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { manufacturer: 'Carrier' } }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { model: '42X' } }),
    );
    const auditCalls = auditCreate.mock.calls as unknown[][];
    const auditArgument = auditCalls[0]?.[0] as {
      data: {
        action: string;
        resource: string;
        metadata: {
          operationId: string;
          equipmentId: string;
          changedFields: string[];
        };
      };
    };
    expect(auditArgument.data).toMatchObject({
      action: 'EQUIPMENT_PROFILE_COMPLETED_FROM_OPERATION',
      resource: 'equipment',
      metadata: {
        operationId: '11111111-1111-4111-8111-111111111111',
        equipmentId: '22222222-2222-4222-8222-222222222222',
        changedFields: ['manufacturer', 'model'],
      },
    });
  });
});
