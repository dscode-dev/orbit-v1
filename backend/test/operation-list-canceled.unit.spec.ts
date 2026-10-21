import 'reflect-metadata';

import { OperationStatus, Prisma, Role } from '@prisma/client';
import { OperationsService } from '../src/modules/operations/operations.service';
import { OperationAccessService } from '../src/modules/operation-access/operation-access.service';
import type { ListOperationsQueryDto } from '../src/modules/operations/dto/operation.dto';
import type { AuthenticatedUser } from '../src/shared/types/authenticated-user.type';

/**
 * Operação cancelada sai da listagem padrão da tela de Operações e volta só
 * pelo filtro "Canceladas". O recorte é opt-in (`excludeCanceled`) para não
 * mudar o que os outros consumidores da mesma rota já recebem.
 */
describe('listagem de operações e cancelados', () => {
  const owner: AuthenticatedUser = { id: 'owner-1', role: Role.OWNER } as AuthenticatedUser;

  function whereFor(query: Partial<ListOperationsQueryDto>): Prisma.OperationWhereInput {
    const findMany = jest.fn().mockReturnValue([]);
    const prisma = {
      operation: { findMany, count: jest.fn().mockReturnValue(0) },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    const service = new OperationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new OperationAccessService(prisma as never),
      {} as never,
      {} as never,
    );
    void service.list({ page: 1, limit: 20, ...query } as ListOperationsQueryDto, owner);
    return findMany.mock.calls[0][0].where as Prisma.OperationWhereInput;
  }

  function andFilters(where: Prisma.OperationWhereInput): Prisma.OperationWhereInput[] {
    return (where.AND as Prisma.OperationWhereInput[] | undefined) ?? [];
  }

  it('sem a flag, mantém o comportamento anterior e não exclui cancelados', () => {
    const where = whereFor({});
    expect(andFilters(where)).not.toContainEqual({ status: { not: OperationStatus.CANCELED } });
  });

  it('com excludeCanceled, exclui os cancelados', () => {
    const where = whereFor({ excludeCanceled: true });
    expect(andFilters(where)).toContainEqual({ status: { not: OperationStatus.CANCELED } });
  });

  it('o filtro "Canceladas" prevalece sobre a exclusão', () => {
    const where = whereFor({ excludeCanceled: true, status: OperationStatus.CANCELED });
    expect(andFilters(where)).not.toContainEqual({ status: { not: OperationStatus.CANCELED } });
    expect(andFilters(where)).toContainEqual({
      OR: [{ status: 'CANCELED' }, { cancellations: { some: { status: 'REQUESTED' } } }],
    });
  });

  it('cancelamento apenas solicitado continua na listagem padrão', () => {
    // A exclusão olha só o status final; um pedido REQUESTED não é filtrado,
    // porque o owner ainda precisa aprovar ou recusar.
    const where = whereFor({ excludeCanceled: true });
    const serialized = JSON.stringify(andFilters(where));
    expect(serialized).not.toContain('REQUESTED');
  });
});
