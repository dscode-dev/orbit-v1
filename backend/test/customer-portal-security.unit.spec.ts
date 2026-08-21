import { DocumentTemplateType, OperationType } from '@prisma/client';
import { CustomerPortalService } from '../src/modules/customer-portal/customer-portal.service';

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  email: 'cliente@orbit.test',
  name: 'Cliente',
  isActive: true,
  mustChangePassword: false,
};

function createService(prisma: Record<string, unknown>): CustomerPortalService {
  return new CustomerPortalService(prisma as never, {} as never, {} as never, {} as never, {} as never);
}

describe('CustomerPortalService customer isolation', () => {
  it('always scopes operation detail by the authenticated customer', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'operation-1' });
    const service = createService({ operation: { findFirst } });
    await service.customerOperation('00000000-0000-4000-8000-000000000004', account);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '00000000-0000-4000-8000-000000000004', customerId: account.customerId },
    }));
  });

  it('persists ticket ownership from the token, never from request fields', async () => {
    const create = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'ticket-1', ...input.data }),
    );
    const prisma = {
      customerAddress: { findFirst: jest.fn().mockResolvedValue({ id: 'address-1' }) },
      equipment: { count: jest.fn().mockResolvedValue(1) },
      customerServiceTicket: { create },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = createService(prisma);
    await service.createTicket({
      addressId: '00000000-0000-4000-8000-000000000005',
      equipmentIds: ['00000000-0000-4000-8000-000000000006'],
      documentType: DocumentTemplateType.WORK_ORDER,
      operationType: OperationType.CORRETIVA,
      title: 'Falha no equipamento',
      description: 'O equipamento deixou de refrigerar durante a operação.',
    }, account);
    const persisted = create.mock.calls[0]?.[0].data;
    expect(persisted).toMatchObject({
      organizationId: account.organizationId,
      customerId: account.customerId,
      accountId: account.id,
    });
  });
});
