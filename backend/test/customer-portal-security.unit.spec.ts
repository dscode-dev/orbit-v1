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
  it('lists portal accounts as a paginated directory without credential fields', async () => {
    const capturedQueries: Array<{ where: unknown; skip: number; take: number }> = [];
    const findMany = jest.fn((query: { where: unknown; skip: number; take: number }) => {
      capturedQueries.push(query);
      return Promise.resolve([{ id: account.id, customerId: account.customerId, email: account.email,
        name: account.name, phone: null, mustChangePassword: false, isActive: true, disabledAt: null,
        lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), customer: {
          id: account.customerId, name: 'Cliente Orbit', tradeName: null, cpf: null,
          cnpj: '00.000.000/0001-00', isActive: true,
        } }]);
    });
    const prisma = {
      organization: { findFirst: jest.fn().mockResolvedValue({ id: account.organizationId }) },
      customerPortalAccount: { findMany, count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const service = createService(prisma);
    const result = await service.listAccountDirectory({
      page: 1, limit: 20, search: 'cliente', status: 'ACTIVE',
    }) as { items: Array<Record<string, unknown>>; pagination: { total: number } };

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(capturedQueries[0]).toMatchObject({
      where: { organizationId: account.organizationId, isActive: true }, skip: 0, take: 20,
    });
    expect(result.pagination.total).toBe(1);
    expect(result.items[0]).not.toHaveProperty('passwordHash');
  });

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
