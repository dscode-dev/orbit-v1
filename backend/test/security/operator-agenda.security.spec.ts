import { Role } from '@prisma/client';
import { AssignmentsService } from '../../src/modules/assignments/assignments.service';
import { createOperation, createOrganization, prisma } from '../integration/helpers';
import {
  authGet,
  authPost,
  closeSecurityApp,
  createSecurityActor,
  createSecurityApp,
  registerSecurityHttpServer,
  resetSecurityState,
  type SecurityActor,
  type SecurityApp,
} from './security-app';

type AgendaData = {
  items: Array<{ operationId: string; assignedTo: string; isPrimary: boolean }>;
  pagination: { total: number; totalPages: number };
};

function agendaData(response: { body: unknown }): AgendaData {
  return (response.body as { data: AgendaData }).data;
}

describe('Mobile agenda access', () => {
  let security: SecurityApp;
  let owner: SecurityActor;
  let operatorA: SecurityActor;
  let operatorB: SecurityActor;
  let manager: SecurityActor;
  let operationIds: string[];

  beforeAll(async () => {
    security = await createSecurityApp();
    registerSecurityHttpServer(security.http);
  });

  beforeEach(async () => {
    await resetSecurityState();
    await createOrganization();
    owner = await createSecurityActor(Role.OWNER, 'agenda-owner');
    operatorA = await createSecurityActor(Role.OPERATOR, 'agenda-operator-a');
    operatorB = await createSecurityActor(Role.OPERATOR, 'agenda-operator-b');
    manager = await createSecurityActor(Role.MANAGER, 'agenda-manager');
    operationIds = [];
    for (const actor of [owner, operatorA, operatorB, manager]) {
      const operation = await createOperation(actor.user);
      operationIds.push(operation.id);
      await prisma.operation.update({
        where: { id: operation.id },
        data: {
          scheduledFor: new Date('2026-10-21T13:00:00Z'),
          status: actor === owner ? 'COMPLETED' : actor === manager ? 'CANCELED' : 'PENDING',
        },
      });
      await prisma.assignment.create({
        data: {
          operationId: operation.id,
          assignedBy: owner.user.id,
          assignedTo: actor.user.id,
          // The owner must also see schedules that have not been released to technicians.
          operatorVisible: actor !== operatorB,
          status: actor === owner ? 'COMPLETED' : actor === manager ? 'CANCELED' : 'ASSIGNED',
        },
      });
    }
    await prisma.assignment.create({
      data: {
        operationId: operationIds[1],
        assignedBy: owner.user.id,
        assignedTo: operatorB.user.id,
        isPrimary: false,
        operatorVisible: true,
      },
    });
  });

  afterAll(async () => {
    if (security) await closeSecurityApp(security.app);
  });

  it('lets OWNER view all technicians, including unreleased schedules, without duplicating auxiliary assignments', async () => {
    const response = await authGet(owner, '/api/v1/assignments/agenda').query({
      limit: 100,
      assignedTo: owner.user.id,
    });
    expect(response.status).toBe(200);
    expect(agendaData(response).pagination.total).toBe(4);
    expect(
      agendaData(response)
        .items.map((item: { operationId: string }) => item.operationId)
        .sort(),
    ).toEqual([...operationIds].sort());
    expect(agendaData(response).items.every((item: { isPrimary: boolean }) => item.isPrimary)).toBe(
      true,
    );
  });

  it('paginates the global calendar without losing appointments', async () => {
    const ids: string[] = [];
    for (const page of [1, 2]) {
      const response = await authGet(owner, '/api/v1/assignments/agenda').query({ page, limit: 2 });
      expect(response.status).toBe(200);
      expect(agendaData(response).pagination.totalPages).toBe(2);
      ids.push(
        ...agendaData(response).items.map((item: { operationId: string }) => item.operationId),
      );
    }
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps the existing personal queries scoped even if an operator supplies another assignee', async () => {
    for (const path of ['/api/v1/assignments/my', '/api/v1/assignments']) {
      const response = await authGet(operatorA, path).query({ assignedTo: operatorB.user.id });
      expect(response.status).toBe(200);
      expect(agendaData(response).items).toHaveLength(1);
      expect(agendaData(response).items[0].assignedTo).toBe(operatorA.user.id);
    }
    const personal = await authGet(operatorB, '/api/v1/assignments/my');
    expect(personal.status).toBe(200);
    // Operator B sees only the released auxiliary assignment, not the unreleased primary one.
    expect(agendaData(personal).items).toHaveLength(1);
    expect(agendaData(personal).items[0].operationId).toBe(operationIds[1]);
  });

  it('keeps pending demands visible to OWNER and hidden from the assigned operator until authorization', async () => {
    const pending = await prisma.assignment.findFirstOrThrow({
      where: { operationId: operationIds[2], isPrimary: true },
    });
    const before = await authGet(operatorB, '/api/v1/assignments/my');
    expect(agendaData(before).items.some((item) => item.operationId === pending.operationId)).toBe(false);
    const ownerBefore = await authGet(owner, '/api/v1/assignments/agenda');
    expect(agendaData(ownerBefore).items.some((item) => item.operationId === pending.operationId)).toBe(true);

    const authorized = await authPost(owner, '/api/v1/assignments/authorize').send({
      assignmentIds: [pending.id],
    });
    expect(authorized.status).toBe(201);
    expect((authorized.body as { data: { authorized: number } }).data.authorized).toBe(1);

    const after = await authGet(operatorB, '/api/v1/assignments/my');
    expect(agendaData(after).items.some((item) => item.operationId === pending.operationId)).toBe(true);
    const ownerAfter = await authGet(owner, '/api/v1/assignments/agenda');
    expect(agendaData(ownerAfter).pagination.total).toBe(4);
  });

  it('keeps OWNER and MANAGER personal endpoints scoped to themselves', async () => {
    for (const actor of [owner, manager]) {
      const response = await authGet(actor, '/api/v1/assignments/my');
      expect(response.status).toBe(200);
      expect(agendaData(response).items).toHaveLength(1);
      expect(agendaData(response).items[0].assignedTo).toBe(actor.user.id);
    }
  });

  it('rejects global calendar access by OPERATOR, MANAGER and VIEWER at the HTTP boundary', async () => {
    const viewer = await createSecurityActor(Role.VIEWER, 'agenda-viewer');
    for (const actor of [operatorA, manager, viewer]) {
      expect((await authGet(actor, '/api/v1/assignments/agenda')).status).toBe(403);
    }
  });

  it('also enforces OWNER access inside the service', async () => {
    const service = security.app.get(AssignmentsService);
    for (const actor of [operatorA, manager]) {
      await expect(service.agenda({ page: 1, limit: 100 }, actor.user)).rejects.toThrow(
        'Somente o proprietário',
      );
    }
  });
});
