import 'reflect-metadata';

import { OperationStatus, Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';

describe('Operation field equipment collection', () => {
  const actor = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'operator@orbit.test',
    username: 'operator',
    name: 'Operator',
    role: Role.OPERATOR,
    isActive: true,
    mustChangePassword: false,
  };
  const context = { requestId: 'field-equipment-test', ip: null, userAgent: null };

  it('creates and links field equipment atomically to an unscoped in-progress operation', async () => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const catalogId = '22222222-2222-4222-8222-222222222222';
    const equipmentId = '44444444-4444-4444-8444-444444444444';
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      operation: {
        findUnique: jest.fn().mockResolvedValue({
          id: operationId,
          customerId: '55555555-5555-4555-8555-555555555555',
          addressId: '66666666-6666-4666-8666-666666666666',
          equipmentId: null,
          status: OperationStatus.IN_PROGRESS,
          inspectedEquipments: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      equipment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: equipmentId,
          sector: 'Sala técnica',
          manufacturer: 'Carrier',
          model: '42X',
          capacity: '18.000 BTU/h',
          tag: null,
          serialNumber: null,
          type: 'SPLIT',
        }),
      },
      technicalCatalog: {
        findMany: jest.fn().mockResolvedValue([{ id: catalogId, title: 'Split', tags: ['legacy-split'] }]),
      },
      operationInspectedEquipment: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      operationDocument: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
      operation: { findUnique: jest.fn().mockResolvedValue({ id: operationId }) },
    };
    const access = { assertOperationAccess: jest.fn().mockResolvedValue(undefined) };
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

    await service.addFieldEquipments(
      operationId,
      {
        newEquipments: [{
          equipmentTypeCatalogId: catalogId,
          sector: 'Sala técnica',
          manufacturer: 'Carrier',
          model: '42X',
          capacity: '18.000 BTU/h',
        }],
      },
      actor,
      context,
    );

    expect(access.assertOperationAccess).toHaveBeenCalled();
    const equipmentCreateArgument = (tx.equipment.create.mock.calls as unknown[][])[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(equipmentCreateArgument.data).toMatchObject({
        customerId: '55555555-5555-4555-8555-555555555555',
        addressId: '66666666-6666-4666-8666-666666666666',
        equipmentTypeCatalogId: catalogId,
        manufacturer: 'Carrier',
        model: '42X',
    });
    expect(tx.operation.update).toHaveBeenCalledWith({
      where: { id: operationId },
      data: { equipmentId },
    });
    expect(tx.operationInspectedEquipment.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ operationId, equipmentId, position: 0 })],
    });
    const auditArguments = (tx.auditLog.create.mock.calls as unknown[][]).map((call) => call[0]) as Array<{
      data: { action: string };
    }>;
    expect(auditArguments.some((item) => item.data.action === 'OPERATION_FIELD_EQUIPMENTS_ATTACHED')).toBe(true);
  });
});
