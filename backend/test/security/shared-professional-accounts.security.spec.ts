import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import type { AuthenticatedUser } from '../../src/shared/types/authenticated-user.type';
import { createOrganization, prisma } from '../integration/helpers';
import {
  authGet, authPatch, authPost, closeSecurityApp, createSecurityActor, createSecurityApp,
  dataOf, errorCode, registerSecurityHttpServer, resetSecurityState,
  type SecurityActor, type SecurityApp,
} from './security-app';

type CreatedUser = { user: AuthenticatedUser; temporaryPassword: string };
type SignatureData = { id: string; userId: string; name: string; professionalCouncil: string; registrationNumber: string };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
const sharedUser = {
  name: 'José da Silva', phone: '+5581999999999', jobTitle: 'Técnico de Refrigeração', notes: 'Dados da mesma pessoa em contas independentes',
};
const sharedProfessional = {
  title: sharedUser.jobTitle, profession: 'Técnico em Climatização', professionalCouncil: 'CFT',
  registrationNumber: '123456789', department: 'Operações',
};

describe('Independent accounts with shared personal and professional data', () => {
  let security: SecurityApp;
  let owner: SecurityActor;

  beforeAll(async () => {
    security = await createSecurityApp();
    await security.app.listen(0, '127.0.0.1');
    registerSecurityHttpServer(security.http);
  });
  beforeEach(async () => {
    await resetSecurityState();
    await createOrganization();
    owner = await createSecurityActor(Role.OWNER, 'shared-owner');
    await authPatch(owner, `/api/v1/users/${owner.user.id}`).send(sharedUser).expect(200);
  });
  afterAll(async () => { await closeSecurityApp(security.app); await prisma.$disconnect(); });

  function operatorInput(): typeof sharedUser & { email: string; username: string; role: Role; permissions: { canReports: boolean; canSchedules: boolean } } {
    const suffix = randomUUID().slice(0, 8);
    return { ...sharedUser, email: `operator-${suffix}@example.test`, username: `operator-${suffix}`, role: Role.OPERATOR, permissions: { canReports: true, canSchedules: true } };
  }

  async function login(user: AuthenticatedUser, password: string): Promise<SecurityActor> {
    const response = await request(security.http).post('/api/v1/auth/login').send({ email: user.email, password, channel: 'OPERATOR' }).expect(200);
    return { user, password, ...dataOf<{ accessToken: string; refreshToken: string }>(response) };
  }

  it('allows an owner and operator with the same personal data, council, registration and signature image through first access', async () => {
    const ownerSaved = await authPost(owner, '/api/v1/signatures/me')
      .field(sharedProfessional).attach('file', png, { filename: 'assinatura.png', contentType: 'image/png' }).expect(201);
    await prisma.signature.update({ where: { userId: owner.user.id }, data: { isDefault: true } });
    const originalOwnerSignature = await prisma.signature.findUniqueOrThrow({ where: { userId: owner.user.id } });
    const created = dataOf<CreatedUser>(await authPost(owner, '/api/v1/users').send(operatorInput()).expect(201));
    const operator = await login(created.user, created.temporaryPassword);
    const definitive = `Definitive!${randomUUID()}`;
    await authPost(operator, '/api/v1/users/complete-first-access')
      .field('currentPassword', created.temporaryPassword).field('newPassword', definitive)
      .field('signatureTitle', sharedProfessional.title).field('profession', sharedProfessional.profession)
      .field('professionalCouncil', sharedProfessional.professionalCouncil).field('registrationNumber', sharedProfessional.registrationNumber)
      .field('department', sharedProfessional.department)
      .attach('file', png, { filename: 'assinatura.png', contentType: 'image/png' }).expect(201);
    const signedIn = await login(created.user, definitive);
    const operatorSignature = dataOf<SignatureData>(await authGet(signedIn, '/api/v1/signatures/me').expect(200));
    expect(operatorSignature).toMatchObject({ userId: created.user.id, name: sharedUser.name, professionalCouncil: sharedProfessional.professionalCouncil, registrationNumber: sharedProfessional.registrationNumber });
    expect(operatorSignature.id).not.toBe(dataOf<SignatureData>(ownerSaved).id);
    expect(await prisma.signature.count({ where: { professionalCouncil: sharedProfessional.professionalCouncil, registrationNumber: sharedProfessional.registrationNumber } })).toBe(2);
    const currentOwnerSignature = await prisma.signature.findUniqueOrThrow({ where: { userId: owner.user.id } });
    expect(currentOwnerSignature).toEqual(originalOwnerSignature);
    const storedOperator = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
    expect(storedOperator).toMatchObject({ ...sharedUser, role: Role.OPERATOR, mustChangePassword: false });
    expect(storedOperator.email).not.toBe(owner.user.email);
    expect(storedOperator.username).not.toBe(owner.user.username);
    expect((await prisma.signature.findUniqueOrThrow({ where: { userId: created.user.id } })).imageStorageKey).not.toBe(currentOwnerSignature.imageStorageKey);
  });

  it('can save matching professional data again without redrawing or changing the other account signature', async () => {
    const operator = await createSecurityActor(Role.OPERATOR, 'shared-operator');
    await authPatch(owner, `/api/v1/users/${operator.user.id}`).send(sharedUser).expect(200);
    for (const actor of [owner, operator]) {
      await authPost(actor, '/api/v1/signatures/me').field(sharedProfessional)
        .attach('file', png, { filename: 'assinatura.png', contentType: 'image/png' }).expect(201);
    }
    const beforeOwner = await prisma.signature.findUniqueOrThrow({ where: { userId: owner.user.id } });
    const beforeOperator = await prisma.signature.findUniqueOrThrow({ where: { userId: operator.user.id } });
    const result = await authPost(operator, '/api/v1/signatures/me').field(sharedProfessional);
    expect(result.status).toBe(201);
    expect(dataOf<SignatureData>(result)).toMatchObject({ id: beforeOperator.id, userId: operator.user.id, professionalCouncil: sharedProfessional.professionalCouncil, registrationNumber: sharedProfessional.registrationNumber });
    expect((await prisma.signature.findUniqueOrThrow({ where: { userId: operator.user.id } })).imageStorageKey).toBe(beforeOperator.imageStorageKey);
    expect(await prisma.signature.findUniqueOrThrow({ where: { userId: owner.user.id } })).toEqual(beforeOwner);
  });

  it.each(['email', 'username'] as const)('still rejects a duplicate %s on creation, including case variants', async field => {
    const payload = { ...operatorInput(), [field]: owner.user[field].toUpperCase() };
    const conflict = await authPost(owner, '/api/v1/users').send(payload);
    expect(conflict.status).toBe(409);
    expect(errorCode(conflict)).toBe('USER_CONFLICT');
    expect(await prisma.user.count()).toBe(1);
  });

  it.each(['email', 'username'] as const)('still rejects a duplicate %s when updating an independent account', async field => {
    const created = dataOf<CreatedUser>(await authPost(owner, '/api/v1/users').send(operatorInput()).expect(201));
    const conflict = await authPatch(owner, `/api/v1/users/${created.user.id}`).send({ [field]: owner.user[field].toUpperCase() });
    expect(conflict.status).toBe(409);
    expect(errorCode(conflict)).toBe('USER_CONFLICT');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } }))[field]).toBe(created.user[field]);
  });
});
