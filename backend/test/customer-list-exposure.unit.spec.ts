import { Role } from '@prisma/client';
import { CustomersService } from '../src/modules/customers/customers.service';

/**
 * A listagem de clientes era `include` sem `select`: devolvia CPF, CNPJ,
 * e-mail, telefones e anotações para qualquer autenticado, e um técnico podia
 * paginar a base inteira. Documento e contato ficam só para quem tem a tela de
 * Clientes (owner/gestor); o detalhe segue completo, porque o operador precisa
 * dos endereços no atendimento avulso.
 */
describe('exposição de dados na listagem de clientes', () => {
  const PESSOAIS = ['cpf', 'cnpj', 'email', 'phone', 'secondaryPhone', 'notes'];

  function serviceFor() {
    const prisma = {
      customer: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $transaction: (ops: unknown[]) => Promise.all(ops),
    };
    return { service: new CustomersService(prisma as never, {} as never), prisma };
  }

  const query = { page: 1, limit: 20 } as never;
  const actor = (role: Role) => ({ id: 'u1', role }) as never;

  it('operador não recebe dado pessoal na lista', async () => {
    const { service, prisma } = serviceFor();
    await service.list(query, actor(Role.OPERATOR));
    const select = prisma.customer.findMany.mock.calls[0][0].select;
    expect(select.name).toBe(true);
    for (const campo of PESSOAIS) expect(select[campo]).toBeUndefined();
  });

  it('viewer também não recebe', async () => {
    const { service, prisma } = serviceFor();
    await service.list(query, actor(Role.VIEWER));
    const select = prisma.customer.findMany.mock.calls[0][0].select;
    for (const campo of PESSOAIS) expect(select[campo]).toBeUndefined();
  });

  it('owner e gestor mantêm documento e contato (a tabela de Clientes usa)', async () => {
    for (const role of [Role.OWNER, Role.MANAGER]) {
      const { service, prisma } = serviceFor();
      await service.list(query, actor(role));
      const select = prisma.customer.findMany.mock.calls[0][0].select;
      expect(select.cnpj).toBe(true);
      expect(select.cpf).toBe(true);
      expect(select.phone).toBe(true);
      expect(select.email).toBe(true);
      // anotações internas não aparecem em lista para ninguém
      expect(select.notes).toBeUndefined();
    }
  });
});
