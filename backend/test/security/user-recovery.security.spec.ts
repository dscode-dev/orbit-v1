import { AssignmentStatus, Role, type Assignment } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as request from 'supertest';
import { createOperation, createOrganization, prisma } from '../integration/helpers';
import {
  authDelete, authGet, authPatch, authPost, closeSecurityApp, createSecurityActor,
  createSecurityApp, dataOf, errorCode, registerSecurityHttpServer, resetSecurityState,
  type SecurityActor, type SecurityApp,
} from './security-app';

type AssignmentData = { id: string; assignedTo: string; isPrimary: boolean; operatorVisible: boolean; status: string };
type ListData = { items: Array<{ id: string; assignedTo?: string; isActive?: boolean }>; pagination: { total: number } };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');

describe('User recovery: auxiliary promotion, onboarding and deletion', () => {
  let security: SecurityApp;
  let owner: SecurityActor;
  let primary: SecurityActor;
  let auxiliary: SecurityActor;

  beforeAll(async () => {
    security = await createSecurityApp();
    await security.app.listen(0, '127.0.0.1');
    registerSecurityHttpServer(security.http);
  });
  beforeEach(async () => {
    await resetSecurityState();
    await createOrganization();
    owner = await createSecurityActor(Role.OWNER, 'recovery-owner');
    primary = await createSecurityActor(Role.OPERATOR, 'recovery-primary');
    auxiliary = await createSecurityActor(Role.OPERATOR, 'recovery-aux');
  });
  afterAll(async () => { await closeSecurityApp(security.app); await prisma.$disconnect(); });

  async function crew(status: AssignmentStatus = AssignmentStatus.ASSIGNED): Promise<{
    operation: Awaited<ReturnType<typeof createOperation>>; responsible: Assignment; member: Assignment;
  }> {
    const operation = await createOperation(primary.user);
    await prisma.operation.update({ where: { id: operation.id }, data: { status: 'PENDING' } });
    const responsible = await prisma.assignment.create({ data: {
      operationId: operation.id, assignedBy: owner.user.id, assignedTo: primary.user.id, isPrimary: true,
    } });
    const member = await prisma.assignment.create({ data: {
      operationId: operation.id, assignedBy: owner.user.id, assignedTo: auxiliary.user.id,
      isPrimary: false, status, operatorVisible: true,
    } });
    await prisma.assignmentHistory.createMany({ data: [responsible, member].map(item => ({
      assignmentId: item.id, operationId: operation.id, actorId: owner.user.id,
      event: 'ASSIGNED', newStatus: item.status, notes: 'Histórico que precisa ser preservado',
    })) });
    return { operation, responsible, member };
  }

  it.each([AssignmentStatus.ASSIGNED, AssignmentStatus.CANCELED, AssignmentStatus.REJECTED])(
    'promotes an existing %s auxiliary without duplicate assignments or losing history', async status => {
      const { operation, responsible, member } = await crew(status);
      await prisma.userPermission.update({ where: { userId: auxiliary.user.id }, data: { canReports: false } });
      const permissions = await authPatch(owner, `/api/v1/users/${auxiliary.user.id}`).send({
        permissions: { canReports: true, canSchedules: true }, jobTitle: 'Técnico operacional',
      });
      expect(permissions.status).toBe(200);
      const response = await authPatch(owner, `/api/v1/assignments/${responsible.id}/reassign`).send({
        assignedTo: auxiliary.user.id, auxiliaryOperatorIds: [],
      });
      expect(response.status).toBe(200);
      const promoted = dataOf<AssignmentData>(response);
      expect(promoted).toMatchObject({ id: member.id, assignedTo: auxiliary.user.id, isPrimary: true, status: 'ASSIGNED', operatorVisible: false });
      expect(await prisma.assignment.count({ where: { operationId: operation.id } })).toBe(2);
      expect(await prisma.assignment.count({ where: { operationId: operation.id, isPrimary: true } })).toBe(1);
      expect(await prisma.operation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ operatorId: auxiliary.user.id });
      expect(await prisma.assignment.findUniqueOrThrow({ where: { id: responsible.id } })).toMatchObject({ isPrimary: false, status: 'CANCELED' });
      expect(await prisma.assignmentHistory.count({ where: { operationId: operation.id } })).toBe(4);
      expect(dataOf<ListData>(await authGet(auxiliary, '/api/v1/assignments/my')).items).toHaveLength(0);
      await authPost(owner, '/api/v1/assignments/authorize').send({ assignmentIds: [promoted.id] }).expect(201);
      expect(dataOf<ListData>(await authGet(auxiliary, '/api/v1/assignments/my')).items.map(item => item.id)).toEqual([promoted.id]);
    },
  );

  it('can retain the previous responsible as an authorized auxiliary and later promote them back', async () => {
    const { operation, responsible, member } = await crew();
    await authPatch(owner, `/api/v1/assignments/${responsible.id}/reassign`).send({
      assignedTo: auxiliary.user.id, auxiliaryOperatorIds: [primary.user.id],
    }).expect(200);
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: responsible.id } })).toMatchObject({ isPrimary: false, status: 'ASSIGNED', operatorVisible: true });
    const restored = await authPatch(owner, `/api/v1/assignments/${member.id}/reassign`).send({ assignedTo: primary.user.id, auxiliaryOperatorIds: [] });
    expect(restored.status).toBe(200);
    expect(dataOf<AssignmentData>(restored)).toMatchObject({ id: responsible.id, assignedTo: primary.user.id, isPrimary: true });
    expect(await prisma.assignment.count({ where: { operationId: operation.id, isPrimary: true } })).toBe(1);
  });

  it('keeps ordinary reassignments working and forbids inactive targets, auxiliary endpoints and completed work', async () => {
    const { responsible, member } = await crew();
    const forbiddenAux = await authPatch(owner, `/api/v1/assignments/${member.id}/reassign`).send({ assignedTo: primary.user.id });
    expect(forbiddenAux.status).toBe(409);
    await prisma.user.update({ where: { id: auxiliary.user.id }, data: { isActive: false } });
    expect((await authPatch(owner, `/api/v1/assignments/${responsible.id}/reassign`).send({ assignedTo: auxiliary.user.id })).status).toBe(400);
    const ordinary = await authPatch(owner, `/api/v1/assignments/${responsible.id}/reassign`).send({ assignedTo: owner.user.id });
    expect(ordinary.status).toBe(200);
    expect(dataOf<AssignmentData>(ordinary)).toMatchObject({ id: responsible.id, assignedTo: owner.user.id, operatorVisible: true });
    await prisma.assignment.update({ where: { id: responsible.id }, data: { status: 'COMPLETED' } });
    expect((await authPatch(owner, `/api/v1/assignments/${responsible.id}/reassign`).send({ assignedTo: primary.user.id })).status).toBe(409);
  });

  it('deletion hides the account from lists, revokes access, preserves operation history and cannot be enabled again', async () => {
    const { operation, member } = await crew();
    await authDelete(owner, `/api/v1/users/${auxiliary.user.id}`).expect(200);
    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: auxiliary.user.id } });
    expect(deleted).toMatchObject({ isActive: false, deletedAt: expect.any(Date) as unknown });
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ operationId: operation.id, assignedTo: auxiliary.user.id });
    expect(await prisma.assignmentHistory.count({ where: { assignmentId: member.id } })).toBe(1);
    const listed = dataOf<ListData>(await authGet(owner, '/api/v1/users'));
    expect(listed.items.map(item => item.id)).not.toContain(auxiliary.user.id);
    expect(listed.pagination.total).toBe(2);
    const searched = dataOf<ListData>(await authGet(owner, `/api/v1/users?search=${encodeURIComponent(auxiliary.user.email)}`));
    expect(searched.pagination.total).toBe(0);
    await authGet(owner, `/api/v1/users/${auxiliary.user.id}`).expect(404);
    await authPatch(owner, `/api/v1/users/${auxiliary.user.id}/enable`).expect(404);
    await authGet(auxiliary, '/api/v1/users/me').expect(401);
  });

  it('ordinary disable remains reversible and deletion remains restricted to OWNER', async () => {
    await authDelete(primary, `/api/v1/users/${auxiliary.user.id}`).expect(403);
    const self = await authDelete(owner, `/api/v1/users/${owner.user.id}`);
    expect(errorCode(self)).toBe('USER_SELF_ACTION_FORBIDDEN');
    await authPatch(owner, `/api/v1/users/${auxiliary.user.id}/disable`).expect(200);
    const listed = dataOf<ListData>(await authGet(owner, '/api/v1/users'));
    expect(listed.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: auxiliary.user.id, isActive: false })]));
    await authPatch(owner, `/api/v1/users/${auxiliary.user.id}/enable`).expect(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: auxiliary.user.id } })).toMatchObject({ isActive: true, deletedAt: null });
  });

  it('the migration hides previously deleted accounts without hiding disabled or re-enabled accounts', async () => {
    const old = new Date('2026-11-11T12:00:00Z');
    const later = new Date('2026-11-11T13:00:00Z');
    await prisma.user.updateMany({ where: { id: { in: [primary.user.id, auxiliary.user.id] } }, data: { isActive: false, disabledAt: old } });
    await prisma.auditLog.createMany({ data: [
      { resource: 'USER', action: 'USER_DELETED', actor: owner.user.id, createdAt: old, metadata: { targetUserId: primary.user.id } },
      { resource: 'USER', action: 'USER_DISABLED', actor: owner.user.id, createdAt: old, metadata: { targetUserId: auxiliary.user.id } },
      { resource: 'USER', action: 'USER_DELETED', actor: owner.user.id, createdAt: old, metadata: { targetUserId: owner.user.id } },
      { resource: 'USER', action: 'USER_ENABLED', actor: owner.user.id, createdAt: later, metadata: { targetUserId: owner.user.id } },
    ] });
    const migration = readFileSync(join(__dirname, '../../prisma/migrations/20261112230000_user_soft_delete/migration.sql'), 'utf8');
    await prisma.$executeRawUnsafe(migration.slice(migration.indexOf('WITH latest_access_action')));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: primary.user.id } })).deletedAt).toEqual(old);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: auxiliary.user.id } })).deletedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).deletedAt).toBeNull();
  });

  it('completes first access with signature even without report permission, then accepts only the new password', async () => {
    await prisma.user.update({ where: { id: auxiliary.user.id }, data: { mustChangePassword: true } });
    await prisma.userPermission.update({ where: { userId: auxiliary.user.id }, data: { canReports: false, canSchedules: false } });
    const definitive = `Definitive!${randomUUID()}`;
    const result = await authPost(auxiliary, '/api/v1/users/complete-first-access')
      .field('currentPassword', auxiliary.password).field('newPassword', definitive)
      .field('signatureTitle', 'Técnico operacional').attach('file', png, { filename: 'assinatura.png', contentType: 'image/png' });
    expect(result.status).toBe(201);
    const signature = await prisma.signature.findUniqueOrThrow({ where: { userId: auxiliary.user.id } });
    expect(signature.imageStorageKey).toMatch(/^documents\/signatures\/.*\.png$/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: auxiliary.user.id } })).mustChangePassword).toBe(false);
    await authGet(auxiliary, '/api/v1/users/me').expect(401);
    await request(security.http).post('/api/v1/auth/login').send({ email: auxiliary.user.email, password: definitive, channel: 'OPERATOR' }).expect(200);
    await request(security.http).post('/api/v1/auth/login').send({ email: auxiliary.user.email, password: auxiliary.password, channel: 'OPERATOR' }).expect(401);
  });

  it('missing signature does not change the password or finish onboarding', async () => {
    await prisma.user.update({ where: { id: auxiliary.user.id }, data: { mustChangePassword: true } });
    const result = await authPost(auxiliary, '/api/v1/users/complete-first-access')
      .field('currentPassword', auxiliary.password).field('newPassword', 'Definitive-password-123!').field('signatureTitle', 'Técnico');
    expect(result.status).toBe(400);
    expect(errorCode(result)).toBe('SIGNATURE_IMAGE_REQUIRED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: auxiliary.user.id } })).mustChangePassword).toBe(true);
    await authGet(auxiliary, '/api/v1/users/me').expect(200);
    expect(await prisma.signature.count({ where: { userId: auxiliary.user.id } })).toBe(0);
  });
});
