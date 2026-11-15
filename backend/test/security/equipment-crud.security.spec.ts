import { Role } from '@prisma/client';
import {
  createCustomerGraph,
  createOperation,
  createOrganization,
  prisma,
} from '../integration/helpers';
import {
  authDelete,
  authGet,
  authPatch,
  authPost,
  closeSecurityApp,
  createSecurityActor,
  createSecurityApp,
  dataOf,
  registerSecurityHttpServer,
  resetSecurityState,
  type SecurityActor,
  type SecurityApp,
} from './security-app';

describe('Customer equipment CRUD', () => {
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
    owner = await createSecurityActor(Role.OWNER, 'equipment-owner');
  });
  afterAll(async () => {
    if (security) await closeSecurityApp(security.app);
    await prisma.$disconnect();
  });

  it('creates and updates equipment in the customer list while retaining its identity', async () => {
    const graph = await createCustomerGraph();
    const created = await authPost(owner, '/api/v1/equipments').send({
      customerId: graph.customerId,
      addressId: graph.addressId,
      type: 'SPLIT',
      manufacturer: 'Marca',
      model: 'Modelo A',
      serialNumber: 'SERIAL-1',
    });
    expect(created.status).toBe(201);
    const initial = dataOf<{ id: string; qrToken: string }>(created);
    const updated = await authPatch(owner, `/api/v1/equipments/${initial.id}`).send({
      manufacturer: 'Marca editada',
      model: 'Modelo B',
      capacity: '18000 BTU',
      sector: 'Recepção',
      observations: 'Cadastro atualizado',
      status: 'MAINTENANCE',
    });
    expect(updated.status).toBe(200);
    expect(dataOf(updated)).toMatchObject({
      id: initial.id,
      qrToken: initial.qrToken,
      customerId: graph.customerId,
      addressId: graph.addressId,
      manufacturer: 'Marca editada',
      model: 'Modelo B',
      capacity: '18000 BTU',
      sector: 'Recepção',
      status: 'MAINTENANCE',
    });
    const listing = await authGet(owner, `/api/v1/equipments?customerId=${graph.customerId}`);
    expect(listing.status).toBe(200);
    expect(dataOf<{ items: unknown[] }>(listing).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: initial.id, name: 'Marca editada Modelo B' }),
      ]),
    );
  });

  it('removes linked equipment from lists and stats without erasing operation history', async () => {
    const operation = await createOperation(owner.user);
    const original = await prisma.equipment.findUniqueOrThrow({
      where: { id: operation.equipmentId },
    });
    const removed = await authDelete(owner, `/api/v1/equipments/${original.id}`);
    expect(removed.status).toBe(200);
    expect(dataOf(removed)).toEqual({ deleted: true });
    const deleted = await prisma.equipment.findUniqueOrThrow({ where: { id: original.id } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted).toMatchObject({
      isActive: false,
      status: 'INACTIVE',
    });
    for (const query of [
      '',
      `?customerId=${operation.customerId}`,
      '?status=INACTIVE',
      `?search=${encodeURIComponent(original.name)}`,
    ]) {
      const result = await authGet(owner, `/api/v1/equipments${query}`);
      expect(result.status).toBe(200);
      expect(dataOf(result)).toMatchObject({ items: [], pagination: { total: 0 } });
    }
    const stats = await authGet(owner, '/api/v1/equipments/stats');
    expect(dataOf(stats)).toMatchObject({ total: 0, active: 0, inactive: 0 });
    const history = await authGet(owner, `/api/v1/equipments/${original.id}`);
    expect(history.status).toBe(200);
    expect(dataOf(history)).toMatchObject({ id: original.id, qrToken: original.qrToken });
    expect(await prisma.operation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject(
      { equipmentId: original.id },
    );
    const audit = await prisma.auditLog.findFirst({ where: { action: 'EQUIPMENT_DELETED' } });
    expect(audit?.actor).toBe(owner.user.id);
    expect(audit?.metadata).toMatchObject({ equipmentId: original.id, softDelete: true });
    expect(
      (await authPatch(owner, `/api/v1/equipments/${original.id}`).send({ model: 'Resurrect' }))
        .status,
    ).toBe(404);
    expect(
      (await authPatch(owner, `/api/v1/equipments/${original.id}/enable`).send({})).status,
    ).toBe(404);
    expect(
      (await authGet(owner, `/api/v1/equipments/lookup/${encodeURIComponent(original.qrCode)}`))
        .status,
    ).toBe(404);
  });

  it('keeps disabled equipment listed and permits enabling it without treating it as removed', async () => {
    const { equipmentId, customerId } = await createCustomerGraph();
    expect(
      (await authPatch(owner, `/api/v1/equipments/${equipmentId}/disable`).send({})).status,
    ).toBe(200);
    const inactive = await authGet(
      owner,
      `/api/v1/equipments?customerId=${customerId}&status=INACTIVE`,
    );
    expect(dataOf<{ items: { id: string }[] }>(inactive).items.map((item) => item.id)).toEqual([
      equipmentId,
    ]);
    expect(
      (await authPatch(owner, `/api/v1/equipments/${equipmentId}/enable`).send({})).status,
    ).toBe(200);
    expect(await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).toMatchObject({
      deletedAt: null,
      isActive: true,
    });
  });

  it('allows managers to edit and reserves removal for the owner', async () => {
    const { equipmentId } = await createCustomerGraph();
    const manager = await createSecurityActor(Role.MANAGER, 'equipment-manager');
    const operator = await createSecurityActor(Role.OPERATOR, 'equipment-operator');
    expect(
      (
        await authPatch(manager, `/api/v1/equipments/${equipmentId}`).send({
          model: 'Manager edit',
        })
      ).status,
    ).toBe(200);
    expect((await authDelete(manager, `/api/v1/equipments/${equipmentId}`)).status).toBe(403);
    expect(
      (await authPatch(operator, `/api/v1/equipments/${equipmentId}`).send({ model: 'Forbidden' }))
        .status,
    ).toBe(403);
    expect((await authDelete(operator, `/api/v1/equipments/${equipmentId}`)).status).toBe(403);
    expect(await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).toMatchObject({
      model: 'Manager edit',
      deletedAt: null,
    });
  });
});
