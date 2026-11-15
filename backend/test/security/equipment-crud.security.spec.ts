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
    const inactive = await authGet(owner, `/api/v1/equipments?customerId=${operation.customerId}&activity=INACTIVE`);
    expect(dataOf<{ items: { id: string }[] }>(inactive).items.map(item => item.id)).toEqual([original.id]);
    expect((await authGet(owner, `/api/v1/equipments/lookup/${encodeURIComponent(original.qrCode)}`)).status).toBe(200);
    expect((await authGet(owner, `/api/v1/equipments/${original.id}/lifecycle`)).status).toBe(200);
    const manager = await createSecurityActor(Role.MANAGER, 'restore-manager');
    const restored = await authPatch(manager, `/api/v1/equipments/${original.id}/enable`).send({});
    expect(restored.status).toBe(200);
    expect(dataOf(restored)).toMatchObject({ id: original.id, isActive: true, deletedAt: null, disabledAt: null, qrToken: original.qrToken, qrCode: original.qrCode });
    expect(await prisma.operation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ equipmentId: original.id });
    expect(dataOf<{ items: { id: string }[] }>(await authGet(owner, `/api/v1/equipments?customerId=${operation.customerId}`)).items.map(item => item.id)).toEqual([original.id]);
    const restoredAudit = await prisma.auditLog.findFirst({ where: { action: 'EQUIPMENT_ENABLED' } });
    expect(restoredAudit?.actor).toBe(manager.user.id);
    expect(restoredAudit?.metadata).toMatchObject({ restoredFromDeletion: true });
  });

  it('hides disabled equipment by default and permits explicitly filtering and enabling it', async () => {
    const { equipmentId, customerId } = await createCustomerGraph();
    expect(
      (await authPatch(owner, `/api/v1/equipments/${equipmentId}/disable`).send({})).status,
    ).toBe(200);
    const inactive = await authGet(
      owner,
      `/api/v1/equipments?customerId=${customerId}&activity=INACTIVE`,
    );
    expect(dataOf<{ items: { id: string }[] }>(inactive).items.map((item) => item.id)).toEqual([
      equipmentId,
    ]);
    expect(dataOf(await authGet(owner, `/api/v1/equipments?customerId=${customerId}`))).toMatchObject({ items: [], pagination: { total: 0 } });
    expect(
      (await authPatch(owner, `/api/v1/equipments/${equipmentId}/enable`).send({})).status,
    ).toBe(200);
    expect(await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).toMatchObject({
      deletedAt: null,
      isActive: true,
    });
  });

  it('restricts inactive lists, QR and direct detail access to management roles', async () => {
    const { equipmentId } = await createCustomerGraph();
    const equipment = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
    await authDelete(owner, `/api/v1/equipments/${equipmentId}`);
    for (const role of [Role.OPERATOR, Role.VIEWER]) {
      const actor = await createSecurityActor(role, `inactive-${role}`);
      for (const activity of ['INACTIVE', 'ALL']) expect((await authGet(actor, `/api/v1/equipments?activity=${activity}`)).status).toBe(403);
      expect(dataOf(await authGet(actor, '/api/v1/equipments'))).toMatchObject({ items: [] });
      expect((await authGet(actor, `/api/v1/equipments/${equipmentId}`)).status).toBe(404);
      expect((await authGet(actor, `/api/v1/equipments/${equipmentId}/metrics`)).status).toBe(404);
      expect((await authGet(actor, `/api/v1/equipments/lookup/${encodeURIComponent(equipment.qrCode)}`)).status).toBe(404);
      expect((await authPatch(actor, `/api/v1/equipments/${equipmentId}/enable`).send({})).status).toBe(403);
    }
    const manager = await createSecurityActor(Role.MANAGER, 'inactive-manager');
    expect(dataOf<{ items: unknown[] }>(await authGet(manager, '/api/v1/equipments?activity=ALL')).items).toHaveLength(1);
    expect((await authGet(manager, `/api/v1/equipments/${equipmentId}`)).status).toBe(200);
  });

  it('keeps customer/search filters, metrics and attachments when archiving equipment', async () => {
    const graph = await createCustomerGraph();
    const other = await createCustomerGraph();
    await prisma.equipment.update({ where: { id: graph.equipmentId }, data: { name: 'Equipamento histórico' } });
    const metric = await prisma.equipmentMetric.create({ data: { equipmentId: graph.equipmentId, key: 'temperature', value: 20, unit: '°C', recordedAt: new Date() } });
    const event = await prisma.assetLifecycleEvent.create({ data: { equipmentId: graph.equipmentId, type: 'NOTE', occurredAt: new Date(), performedBy: owner.user.id, description: 'Histórico preservado', metadata: {} } });
    const attachment = await prisma.equipmentAttachment.create({ data: { equipmentId: graph.equipmentId, category: 'DOCUMENT', fileName: 'manual.pdf', storageKey: 'preserved/manual.pdf', mimeType: 'application/pdf', fileSize: 20 } });
    await authDelete(owner, `/api/v1/equipments/${graph.equipmentId}`);
    await authDelete(owner, `/api/v1/equipments/${other.equipmentId}`);
    const result = await authGet(owner, `/api/v1/equipments?customerId=${graph.customerId}&activity=INACTIVE&search=histórico`);
    expect(dataOf<{ items: { id: string }[] }>(result).items.map(item => item.id)).toEqual([graph.equipmentId]);
    const detail = dataOf<{ metrics: { id: string }[]; attachments: { id: string }[] }>(await authGet(owner, `/api/v1/equipments/${graph.equipmentId}`));
    expect(detail.metrics.map(item => item.id)).toContain(metric.id);
    expect(detail.attachments.map(item => item.id)).toContain(attachment.id);
    expect(dataOf<{ items: { id: string }[] }>(await authGet(owner, `/api/v1/equipments/${graph.equipmentId}/lifecycle`)).items.map(item => item.id)).toContain(event.id);
    expect((await authGet(owner, '/api/v1/equipments?activity=INVALID')).status).toBe(400);
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
