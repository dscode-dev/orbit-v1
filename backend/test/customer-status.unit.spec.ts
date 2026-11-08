import { Prisma, Role } from '@prisma/client';
import { CustomersService } from '../src/modules/customers/customers.service';
import { ListCustomersQueryDto } from '../src/modules/customers/dto/customer.dto';
import type { AuthenticatedUser } from '../src/shared/types/authenticated-user.type';

const actor = { id: 'owner-1', role: Role.OWNER } as AuthenticatedUser;

describe('Customer status listing', () => {
  const findMany = jest
    .fn<Promise<Array<{ id: string }>>, [Prisma.CustomerFindManyArgs]>()
    .mockResolvedValue([{ id: 'customer-1' }]);
  const count = jest.fn<Promise<number>, [Prisma.CustomerCountArgs]>().mockResolvedValue(21);
  const service = new CustomersService(
    {
      customer: { findMany, count },
      $transaction: (queries: Array<Promise<unknown>>): Promise<unknown[]> => Promise.all(queries),
    } as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each(Object.values(Role))('defaults to active customers for %s', async (role) => {
    await service.list(new ListCustomersQueryDto(), { ...actor, role });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
    expect(count).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it.each([Role.OWNER, Role.MANAGER])(
    'combines inactive status with search and pagination for %s',
    async (role) => {
      const query = Object.assign(new ListCustomersQueryDto(), {
        isActive: false,
        search: 'Recife',
        page: 2,
        limit: 20,
      });

      const result = await service.list(query, { ...actor, role });
      const where = {
        isActive: false,
        OR: expect.arrayContaining([
          { name: { contains: 'Recife', mode: 'insensitive' } },
          { cnpj: { contains: 'Recife' } },
        ]) as unknown,
      };
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 20, take: 20 }));
      expect(count).toHaveBeenCalledWith({ where });
      expect(result).toEqual({
        items: [{ id: 'customer-1' }],
        pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
      });
    },
  );
});

describe('Customer status changes', () => {
  it.each([
    { method: 'disable' as const, isActive: false, action: 'CUSTOMER_DISABLED' },
    { method: 'enable' as const, isActive: true, action: 'CUSTOMER_ENABLED' },
  ])(
    '$method preserves the customer and records the change in the audit log',
    async ({ method, isActive, action }) => {
      const customer = { id: 'customer-1', name: 'Clínica Recife', isActive };
      const update = jest.fn().mockResolvedValue(customer);
      const createAudit = jest.fn().mockResolvedValue({});
      const entities = {
        customer: { findUnique: jest.fn().mockResolvedValue(customer), update },
        auditLog: { create: createAudit },
      };
      const service = new CustomersService(
        {
          ...entities,
          $transaction: (callback: (tx: typeof entities) => Promise<unknown>): Promise<unknown> =>
            callback(entities),
        } as never,
        {} as never,
      );

      await expect(
        service[method]('customer-1', actor, {
          requestId: 'request-1',
          ip: null,
          userAgent: null,
        }),
      ).resolves.toEqual(customer);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-1' },
          data: { isActive, disabledAt: isActive ? null : (expect.any(Date) as unknown) },
        }),
      );
      expect(createAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action }) as unknown,
        }),
      );
    },
  );
});
