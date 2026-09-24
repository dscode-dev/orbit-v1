import 'reflect-metadata';

import { AssignmentStatus } from '@prisma/client';
import { AssignmentsService } from '../src/modules/assignments/assignments.service';

/**
 * O técnico auxiliar acompanha o atendimento, mas não o conclui pelo app
 * (view-only sem canReports). Se o assignment dele não acompanhar o executor
 * primário, ele fica parado em ASSIGNED e o atendimento nunca aparece como
 * concluído nas métricas de Técnicos de Campo.
 */
describe('sincronização da equipe no andamento da operação', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');

  function serviceWithCrew(crew: Array<{ id: string; status: AssignmentStatus }>) {
    const tx = {
      assignment: { findMany: jest.fn().mockResolvedValue(crew), update: jest.fn().mockResolvedValue({}) },
      assignmentHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new AssignmentsService({} as never, {} as never, {} as never, {} as never);
    const sync = (status: AssignmentStatus) =>
      (service as unknown as {
        syncCrewAssignmentsTx: (
          tx: unknown,
          operationId: string,
          status: AssignmentStatus,
          actorId: string,
          now: Date,
        ) => Promise<void>;
      }).syncCrewAssignmentsTx(tx, 'op-1', status, 'actor-1', now);
    return { tx, sync };
  }

  it('fecha o auxiliar junto com a operação, carimbando a conclusão', async () => {
    const { tx, sync } = serviceWithCrew([{ id: 'aux-1', status: AssignmentStatus.ASSIGNED }]);

    await sync(AssignmentStatus.COMPLETED);

    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: 'aux-1' },
      data: { status: AssignmentStatus.COMPLETED, completedAt: now },
    });
    // Histórico preservado para auditoria do que mudou e por quê.
    expect(tx.assignmentHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentId: 'aux-1',
        operationId: 'op-1',
        event: 'COMPLETED',
        previousStatus: AssignmentStatus.ASSIGNED,
        newStatus: AssignmentStatus.COMPLETED,
      }),
    });
  });

  it('marca início do auxiliar quando a operação entra em execução', async () => {
    const { tx, sync } = serviceWithCrew([{ id: 'aux-1', status: AssignmentStatus.ASSIGNED }]);

    await sync(AssignmentStatus.STARTED);

    expect(tx.assignment.update).toHaveBeenCalledWith({
      where: { id: 'aux-1' },
      data: { status: AssignmentStatus.STARTED, acceptedAt: now, startedAt: now },
    });
  });

  it('não alcança o primário nem quem recusou ou foi cancelado', async () => {
    const { tx, sync } = serviceWithCrew([]);

    await sync(AssignmentStatus.COMPLETED);

    expect(tx.assignment.findMany).toHaveBeenCalledWith({
      where: {
        operationId: 'op-1',
        isPrimary: false,
        status: {
          notIn: [AssignmentStatus.REJECTED, AssignmentStatus.CANCELED, AssignmentStatus.COMPLETED],
        },
      },
      select: { id: true, status: true },
    });
    expect(tx.assignment.update).not.toHaveBeenCalled();
  });
});
