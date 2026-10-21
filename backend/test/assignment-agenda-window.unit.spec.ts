import 'reflect-metadata';

import { AssignmentStatus, Prisma } from '@prisma/client';
import { AssignmentsService } from '../src/modules/assignments/assignments.service';
import type { ListAssignmentsQueryDto } from '../src/modules/assignments/dto/assignment.dto';

/**
 * A Agenda carregava página 1 com limite 100 e filtrava o mês no cliente: com
 * mais de 100 atribuições no sistema, dias do mês apareciam vazios. O recorte
 * passou a ser feito no banco — e como `listWhere` também serve o app do
 * operador, estes testes fixam que nada do gate de visibilidade se perdeu.
 */
describe('janela de agenda na listagem de assignments', () => {
  const service = new AssignmentsService({} as never, {} as never, {} as never, {} as never);

  function listWhere(
    query: Partial<ListAssignmentsQueryDto>,
    forcedAssignee?: string,
    gateVisibility = false,
  ): Prisma.AssignmentWhereInput {
    return (
      service as unknown as {
        listWhere: (
          query: Partial<ListAssignmentsQueryDto>,
          forcedAssignee?: string,
          gateVisibility?: boolean,
        ) => Prisma.AssignmentWhereInput;
      }
    ).listWhere(query, forcedAssignee, gateVisibility);
  }

  it('sem parâmetros de janela, não restringe por data', () => {
    expect(listWhere({})).toEqual({});
  });

  it('filtra por scheduledFor e cai em assignedAt quando não há agendamento', () => {
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-31T23:59:59.999Z';
    const where = listWhere({ scheduledFrom: from, scheduledTo: to });

    expect(where.AND).toEqual([
      {
        OR: [
          { operation: { scheduledFor: { gte: new Date(from), lte: new Date(to) } } },
          {
            operation: { scheduledFor: null },
            assignedAt: { gte: new Date(from), lte: new Date(to) },
          },
        ],
      },
    ]);
  });

  it('combina cliente e equipamento sem um sobrescrever o outro', () => {
    const where = listWhere({
      customerId: '11111111-1111-4111-8111-111111111111',
      equipmentId: '22222222-2222-4222-8222-222222222222',
    });

    expect(where.AND).toEqual([
      { operation: { customerId: '11111111-1111-4111-8111-111111111111' } },
      { operation: { equipmentId: '22222222-2222-4222-8222-222222222222' } },
    ]);
  });

  it('preserva o gate de visibilidade do app do operador junto da janela', () => {
    const where = listWhere(
      { scheduledFrom: '2026-10-01T00:00:00.000Z' },
      'operator-1',
      true,
    );

    expect(where.assignedTo).toBe('operator-1');
    expect(where.AND).toContainEqual({
      status: { notIn: [AssignmentStatus.CANCELED, AssignmentStatus.REJECTED] },
    });
    expect(where.AND).toContainEqual({
      OR: [{ operatorVisible: true }, { status: { not: AssignmentStatus.ASSIGNED } }],
    });
  });
});
