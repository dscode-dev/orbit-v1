import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { DocumentBlueprint } from '../../src/modules/document-engine/blueprint/document-blueprint.types';
import { DocumentRendererService } from '../../src/modules/document-engine/renderer/document-renderer.service';
import { PdfEngineService } from '../../src/modules/document-engine/pdf/pdf-engine.service';
import { createCustomerGraph, createOrganization, prisma } from '../integration/helpers';
import {
  authGet, authPatch, authPost, closeSecurityApp, createSecurityActor, createSecurityApp,
  registerSecurityHttpServer, resetSecurityState, type SecurityActor, type SecurityApp,
} from './security-app';

type Operation = {
  id: string; type: string; secondaryServiceType: string | null; secondaryAddressId: string | null;
  address: { id: string; street: string }; secondaryAddress: { id: string; street: string } | null;
  serviceTypes: string[];
};
function data<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}
const newAddress = {
  name: 'Destino da instalação', street: 'Avenida Destino da Instalação', number: '250',
  district: 'Centro', city: 'Olinda', state: 'PE', complement: 'Sala 4', referencePoint: 'Portão azul',
};

describe('OS with primary and optional secondary service', () => {
  let security: SecurityApp;
  let owner: SecurityActor;
  let operator: SecurityActor;
  let graph: Awaited<ReturnType<typeof createCustomerGraph>>;
  let secondaryAddressId: string;
  beforeAll(async () => {
    security = await createSecurityApp();
    await security.app.listen(0, '127.0.0.1');
    registerSecurityHttpServer(security.http);
  });
  beforeEach(async () => {
    await resetSecurityState();
    const org = await createOrganization();
    await prisma.serviceType.createMany({ data: [
      { organizationId: org.id, key: 'DESINSTALACAO', label: 'Desinstalação' },
      { organizationId: org.id, key: 'INSTALACAO', label: 'Instalação' },
      { organizationId: org.id, key: 'CORRETIVA', label: 'Corretiva' },
    ] });
    owner = await createSecurityActor(Role.OWNER, 'os-owner');
    operator = await createSecurityActor(Role.OPERATOR, 'os-technician');
    graph = await createCustomerGraph();
    secondaryAddressId = (await prisma.customerAddress.create({ data: {
      ...newAddress, customerId: graph.customerId, zipCode: '',
    } })).id;
  });
  afterAll(async () => { if (security) await closeSecurityApp(security.app); });

  function payload(): Record<string, unknown> {
    return { customerId: graph.customerId, addressId: graph.addressId, equipmentId: graph.equipmentId,
      type: 'DESINSTALACAO', secondaryServiceType: 'INSTALACAO', secondaryAddressId,
      documentType: 'WORK_ORDER', operatorId: operator.user.id };
  }
  async function create(body: Record<string, unknown> = payload()): Promise<Operation> {
    const response = await authPost(owner, '/api/v1/operations').send(body);
    expect(response.status).toBe(201);
    return data<Operation>(response);
  }
  async function preview(id: string): Promise<DocumentBlueprint> {
    const response = await authGet(owner, `/api/v1/documents/operations/${id}/WORK_ORDER/preview`);
    expect(response.status).toBe(200);
    return data<DocumentBlueprint>(response);
  }

  it('persists two services with their addresses and exposes them to the assigned technician after authorization', async () => {
    const operation = await create();
    expect(operation).toMatchObject({ type: 'DESINSTALACAO', secondaryServiceType: 'INSTALACAO',
      serviceTypes: ['DESINSTALACAO', 'INSTALACAO'], address: { id: graph.addressId }, secondaryAddress: { id: secondaryAddressId } });
    const assignment = await prisma.assignment.findFirstOrThrow({ where: { operationId: operation.id, isPrimary: true } });
    expect((await authPost(owner, '/api/v1/assignments/authorize').send({ assignmentIds: [assignment.id] })).status).toBe(201);
    const received = await authGet(operator, `/api/v1/assignments/${assignment.id}`);
    expect(received.status).toBe(200);
    expect(data<{ operation: Operation }>(received).operation).toMatchObject({
      secondaryServiceType: 'INSTALACAO', secondaryAddress: { id: secondaryAddressId, street: newAddress.street }, address: { id: graph.addressId },
    });
    const accepted = await authPatch(operator, `/api/v1/assignments/${assignment.id}/accept`).send({});
    expect(accepted.status).toBe(200);
    const saved = await authPatch(operator, `/api/v1/operations/${operation.id}`).send({ observations: 'Locais conferidos', secondaryServiceType: null, secondaryAddressId: null });
    expect(saved.status).toBe(200);
    expect(data<Operation>(saved).secondaryServiceType).toBe('INSTALACAO');
    expect(data<Operation>(saved).secondaryAddressId).toBe(secondaryAddressId);
  });

  it('requires an address for each service and rejects addresses from another customer or unknown service types', async () => {
    const other = await createCustomerGraph();
    for (const change of [
      { addressId: null }, { secondaryAddressId: null },
      { secondaryAddressId: other.addressId }, { secondaryServiceType: 'TIPO_INEXISTENTE' },
      { secondaryServiceType: null }, { secondaryAddressId: randomUUID() },
      { secondaryAddress: newAddress },
    ]) {
      const response = await authPost(owner, '/api/v1/operations').send({ ...payload(), ...change });
      expect(response.status).toBe(400);
    }
    expect(await prisma.operation.count()).toBe(0);
  });

  it('limits OS to two services and leaves other document workflows unchanged', async () => {
    const tooMany = await authPost(owner, '/api/v1/operations').send({ ...payload(), serviceTypes: ['DESINSTALACAO', 'INSTALACAO', 'CORRETIVA'] });
    expect(tooMany.status).toBe(400);
    const wrongDocument = await authPost(owner, '/api/v1/operations').send({ ...payload(), documentType: 'TECHNICAL_REPORT' });
    expect(wrongDocument.status).toBe(400);
    const legacy = await authPost(owner, '/api/v1/operations').send({ ...payload(), documentType: 'TECHNICAL_REPORT', secondaryServiceType: null, secondaryAddressId: null, serviceTypes: ['DESINSTALACAO', 'INSTALACAO', 'CORRETIVA'] });
    expect(legacy.status).toBe(201);
    expect(data<Operation>(legacy).serviceTypes).toHaveLength(3);
  });

  it('creates a new secondary location atomically in the selected customer without changing the primary address', async () => {
    const operation = await create({ ...payload(), secondaryAddressId: null, secondaryAddress: newAddress });
    expect(operation.secondaryAddress).toMatchObject({ street: newAddress.street });
    expect(operation.secondaryAddressId).not.toBe(secondaryAddressId);
    const saved = await prisma.customerAddress.findUniqueOrThrow({ where: { id: operation.secondaryAddressId! } });
    expect(saved.customerId).toBe(graph.customerId);
    expect(saved.isPrimary).toBe(false);
    expect(operation.address.id).toBe(graph.addressId);
    const count = await prisma.customerAddress.count();
    const invalid = await authPost(owner, '/api/v1/operations').send({ ...payload(), secondaryAddressId: null, secondaryAddress: { ...newAddress, city: '' } });
    expect(invalid.status).toBe(400);
    expect(await prisma.customerAddress.count()).toBe(count);
  });

  it('renders both service names and complete locations in the official report and PDF layout', async () => {
    const operation = await create();
    const blueprint = await preview(operation.id);
    const secondary = blueprint.sections.find((section) => section.id === 'work-order-secondary-service');
    expect(secondary).toBeDefined();
    expect(JSON.stringify(blueprint.sections)).toContain('Desinstalação');
    expect(JSON.stringify(secondary)).toContain('Instalação');
    for (const expected of [newAddress.street, newAddress.number, newAddress.complement, newAddress.referencePoint, newAddress.city]) {
      expect(JSON.stringify(secondary)).toContain(expected);
    }
    const rendered = security.app.get(DocumentRendererService).render(blueprint);
    const text = rendered.pages.flatMap((page) => page.elements).flatMap((el) => el.type === 'text' ? [el.text] : []).join(' ');
    expect(text).toContain('Desinstalação');
    expect(text).toContain('Serviço secundário');
    expect(text).toContain(newAddress.street);
    const pdf = await security.app.get(PdfEngineService).create(rendered);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.pageCount).toBeGreaterThan(0);
  });

  it('updates or removes the secondary service without stale types or a secondary report section', async () => {
    const operation = await create();
    const before = await preview(operation.id);
    const updated = await authPatch(owner, `/api/v1/operations/${operation.id}`).send({ secondaryServiceType: 'CORRETIVA', secondaryAddressId: null, secondaryAddress: { ...newAddress, street: 'Rua Nova do Serviço Secundário' } });
    expect(updated.status).toBe(200);
    expect(data<Operation>(updated).serviceTypes).toEqual(['DESINSTALACAO', 'CORRETIVA']);
    const after = await preview(operation.id);
    expect(JSON.stringify(after)).not.toEqual(JSON.stringify(before));
    expect(JSON.stringify(after.sections)).toContain('Rua Nova do Serviço Secundário');
    const removed = await authPatch(owner, `/api/v1/operations/${operation.id}`).send({ secondaryServiceType: null });
    expect(removed.status).toBe(200);
    expect(data<Operation>(removed)).toMatchObject({ secondaryServiceType: null, secondaryAddressId: null, secondaryAddress: null, serviceTypes: ['DESINSTALACAO'] });
    expect((await preview(operation.id)).sections.some((section) => section.id === 'work-order-secondary-service')).toBe(false);
  });

  it('preserves the existing single-service creation and omits all secondary information', async () => {
    const operation = await create({ ...payload(), addressId: null, secondaryServiceType: null, secondaryAddressId: null });
    expect(operation.secondaryAddress).toBeNull();
    expect(operation.serviceTypes).toEqual(['DESINSTALACAO']);
    const blueprint = await preview(operation.id);
    expect(blueprint.sections.some((section) => section.id === 'work-order-secondary-service')).toBe(false);
    expect(JSON.stringify(blueprint.sections)).not.toContain('Serviço secundário');
  });

  it('supports a walk-in customer followed by a self-assigned OS with a new secondary address', async () => {
    const walkIn = await authPost(owner, '/api/v1/customers/walk-in').send({
      type: 'COMPANY', name: 'Cliente novo da OS', address: { street: 'Rua Origem Avulsa', number: '10', district: 'Centro', city: 'Recife', state: 'PE' },
      contact: { name: 'Responsável', phone: '81999999999' }, equipment: { name: 'Split', type: 'SPLIT', manufacturer: 'Marca', model: 'Modelo', capacity: '12000' },
    });
    expect(walkIn.status).toBe(201);
    const customer = data<{ customerId: string; addressId: string; equipmentId: string }>(walkIn);
    const operation = await create({ ...payload(), customerId: customer.customerId, addressId: customer.addressId, equipmentId: customer.equipmentId, operatorId: owner.user.id, secondaryAddressId: null, secondaryAddress: newAddress });
    expect(operation.address.street).toBe('Rua Origem Avulsa');
    expect(operation.secondaryAddress?.street).toBe(newAddress.street);
    expect((await prisma.customerAddress.findUniqueOrThrow({ where: { id: operation.secondaryAddressId! } })).customerId).toBe(customer.customerId);
  });
});
