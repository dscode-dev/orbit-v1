import { OperationStatus } from '@prisma/client';
import { OperationType } from '../src/shared/constants/service-types.constants';
import { PdfEngineService } from '../src/modules/document-engine/pdf/pdf-engine.service';
import { ListExportService } from '../src/modules/list-exports/list-export.service';

describe('ListExportService', () => {
  const actor = { id: 'owner', role: 'OWNER' } as never;
  const access = {
    operationScope: jest.fn().mockReturnValue({}),
    documentScope: jest.fn().mockReturnValue({}),
  };
  it('generates a real PDF for operations using active filters', async () => {
    const prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      operation: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            number: 42,
            type: OperationType.CORRETIVA,
            status: OperationStatus.COMPLETED,
            scheduledFor: new Date('2026-07-10T10:00:00Z'),
            completedAt: new Date('2026-07-10T12:00:00Z'),
            createdAt: new Date('2026-07-10T09:00:00Z'),
            customer: { name: 'Hospital Santa Clara', tradeName: null },
            equipment: { name: 'Split 12.000 BTU', tag: 'HVAC-01' },
            operator: { name: 'João' },
          },
        ]),
      },
    };
    const service = new ListExportService(prisma as never, new PdfEngineService(), access as never);

    const result = await service.operations({ status: OperationStatus.COMPLETED, type: OperationType.CORRETIVA }, actor);

    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.filename).toMatch(/^orbit-operacoes-\d{4}-\d{2}-\d{2}\.pdf$/);
    const operationFindManyCalls = prisma.operation.findMany.mock.calls as Array<[unknown]>;
    const call = operationFindManyCalls[0]?.[0] as {
      where: { AND: Array<{ status?: OperationStatus; type?: OperationType }> };
      take: number;
    };
    expect(call.where.AND[0]?.status).toBe(OperationStatus.COMPLETED);
    expect(call.where.AND[0]?.type).toBe(OperationType.CORRETIVA);
    expect(call.take).toBe(500);
  });

  it('rejects exports above the safe V1 limit', async () => {
    const prisma = {
      organization: {
        findFirst: jest.fn(),
      },
      equipment: {
        count: jest.fn().mockResolvedValue(501),
        findMany: jest.fn(),
      },
    };
    const service = new ListExportService(prisma as never, new PdfEngineService(), access as never);

    await expect(service.equipments({})).rejects.toThrow('Export exceeds the 500 record limit');
    expect(prisma.equipment.findMany).not.toHaveBeenCalled();
  });

  it('does not leak document storage fields in document export queries', async () => {
    const prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      operationDocument: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ListExportService(prisma as never, new PdfEngineService(), access as never);

    await service.documents({}, actor);

    const documentFindManyCalls = prisma.operationDocument.findMany.mock.calls as Array<[unknown]>;
    const call = documentFindManyCalls[0]?.[0] as {
      select?: Record<string, unknown>;
    };
    expect(call.select?.storageKey).toBeUndefined();
  });
});
