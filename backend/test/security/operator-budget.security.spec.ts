import { Role } from '@prisma/client';
import { createCustomerGraph, createOperation, createOrganization, prisma } from '../integration/helpers';
import {
  authGet, authPatch, authPost, closeSecurityApp, createSecurityActor, createSecurityApp,
  registerSecurityHttpServer, resetSecurityState, type SecurityActor, type SecurityApp,
} from './security-app';

type SavedBudget = { id: string; customerId: string; expirationDate: string; customer: { isProvisional: boolean }; status: string; total: string; document: { id: string }; operationId: string | null };
function data(response: { body: unknown }): SavedBudget { return (response.body as { data: SavedBudget }).data; }

describe('Owner mobile budget workflow using the web API', () => {
  let security: SecurityApp;
  let owner: SecurityActor;
  let operator: SecurityActor;
  let manager: SecurityActor;
  let graph: Awaited<ReturnType<typeof createCustomerGraph>>;
  let signatureId: string;

  beforeAll(async () => {
    security = await createSecurityApp();
    registerSecurityHttpServer(security.http);
  });
  beforeEach(async () => {
    await resetSecurityState();
    const organization = await createOrganization();
    owner = await createSecurityActor(Role.OWNER, 'mobile-budget-owner');
    operator = await createSecurityActor(Role.OPERATOR, 'mobile-budget-operator');
    manager = await createSecurityActor(Role.MANAGER, 'web-budget-manager');
    graph = await createCustomerGraph();
    const signature = await prisma.signature.create({ data: {
      organizationId: organization.id, userId: owner.user.id,
      name: 'Responsável técnico', title: 'Engenheiro', active: true, isDefault: true,
    } });
    signatureId = signature.id;
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
    expect((await authPost(owner, `/api/v1/signatures/${signatureId}/upload`).attach('file', image, { filename: 'assinatura.png', contentType: 'image/png' })).status).toBe(201);
  });
  afterAll(async () => { if (security) await closeSecurityApp(security.app); });

  function payload(): Record<string, unknown> { return {
    customerId: graph.customerId, customerAddressId: graph.addressId, equipmentIds: [graph.equipmentId],
    title: 'Orçamento mobile', issuedAt: new Date().toISOString(), validityDays: 30,
    introduction: 'Proposta de manutenção', paymentMethods: ['PIX'],
    serviceDiscount: 50, materialDiscount: 10, status: 'DRAFT',
    items: [
      { type: 'SERVICE', description: 'Manutenção', quantity: 1, unit: 'SERV', unitPrice: 500 },
      { type: 'MATERIAL', description: 'Filtro', quantity: 2, unit: 'UN', unitPrice: 50 },
    ],
  }; }
  async function create(actor = owner, overrides: Record<string, unknown> = {}): Promise<SavedBudget> {
    const response = await authPost(actor, '/api/v1/budgets').send({ ...payload(), ...overrides });
    expect(response.status).toBe(201);
    return data(response);
  }

  it('generates and downloads a pending proposal before customer acceptance', async () => {
    const budget = await create(owner, { status: 'PENDING' });
    expect(Number(budget.total)).toBe(540);
    expect(budget.operationId).toBeNull();
    expect((await authPatch(owner, `/api/v1/documents/${budget.document.id}/handoff/technical-signature`).send({ signatureId })).status).toBe(200);
    const rendered = await authPost(owner, `/api/v1/budgets/${budget.id}/render`).send({});
    expect(rendered.status).toBe(201);
    const pdf = await authGet(owner, `/api/v1/budgets/${budget.id}/download`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })).status).toBe('PENDING');
    expect(await prisma.budgetApproval.count({ where: { budgetId: budget.id } })).toBe(0);
    const approved = await authPatch(owner, `/api/v1/budgets/${budget.id}/approve`).send({});
    expect(approved.status).toBe(200);
    expect(data(approved).status).toBe('APPROVED');
    expect((await prisma.operationDocument.findUniqueOrThrow({ where: { id: budget.document.id } })).editorialStatus).toBe('STALE');
    expect((await authPost(owner, `/api/v1/budgets/${budget.id}/render`).send({})).status).toBe(201);

  });

  it('preserves the completed work order origin', async () => {
    const operation = await createOperation(owner.user);
    await prisma.operation.update({ where: { id: operation.id }, data: { status: 'COMPLETED' } });
    const budget = await create(owner, { operationId: operation.id, customerId: operation.customerId, customerAddressId: operation.addressId, equipmentIds: operation.equipmentId ? [operation.equipmentId] : [] });
    expect(budget.operationId).toBe(operation.id);
  });

  it('blocks operators from creating, approving, rendering and downloading budgets', async () => {
    const budget = await create();
    expect((await authPost(operator, '/api/v1/budgets').send(payload())).status).toBe(403);
    expect((await authGet(operator, `/api/v1/budgets/${budget.id}`)).status).toBe(403);
    expect((await authPatch(operator, `/api/v1/budgets/${budget.id}/approve`).send({})).status).toBe(403);
    expect((await authPost(operator, `/api/v1/budgets/${budget.id}/render`).send({})).status).toBe(403);
    expect((await authGet(operator, `/api/v1/budgets/${budget.id}/download`)).status).toBe(403);
  });

  it('preserves the existing manager workflow on the web', async () => {
    const budget = await create(manager);
    expect((await authPatch(manager, `/api/v1/budgets/${budget.id}/approve`).send({})).status).toBe(200);
  });

  it('keeps server validation of discounts and expired approvals', async () => {
    const invalid = await authPost(owner, '/api/v1/budgets').send({ ...payload(), serviceDiscount: 501 });
    expect(invalid.status).toBe(400);
    const issuedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const budget = await create(owner, { issuedAt, validityDays: 1 });
    expect((await authPatch(owner, `/api/v1/budgets/${budget.id}/approve`).send({})).status).toBe(409);
  });
  function guestPayload(name = 'Empresa avulsa'): Record<string, unknown> {
    return { ...payload(), customerId: undefined, customerAddressId: undefined, equipmentIds: [], status: 'PENDING', guestCustomer: {
      type: 'COMPANY', name, email: 'avulso@example.test', phone: '81999999999',
      address: { name: 'Principal', street: 'Rua do cliente', number: '10', district: 'Centro', city: 'Recife', state: 'PE' },
    } };
  }

  it('keeps a provisional customer hidden until explicit acceptance, including after issuing the PDF', async () => {
    const created = await authPost(owner, '/api/v1/budgets').send(guestPayload());
    expect(created.status).toBe(201);
    const budget = data(created);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: budget.customerId } });
    expect(customer.isProvisional).toBe(true);
    expect(customer.isActive).toBe(false);
    expect(customer.provisionalExpiresAt?.toISOString()).toBe(budget.expirationDate);
    for (const actor of [owner, manager, operator]) {
      const list = await authGet(actor, '/api/v1/customers').query({ search: 'Empresa avulsa' });
      expect((list.body as { data: { items: unknown[] } }).data.items).toHaveLength(0);
      expect((await authGet(actor, `/api/v1/customers/${budget.customerId}`)).status).toBe(404);
    }
    const stats = await authGet(owner, '/api/v1/customers/stats');
    expect((stats.body as { data: { total: number } }).data.total).toBe(1);
    expect((await authPost(owner, `/api/v1/budgets/${budget.id}/render`).send({})).status).toBe(201);
    expect((await authGet(owner, `/api/v1/budgets/${budget.id}/download`)).status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: budget.customerId } })).isProvisional).toBe(true);
    const approved = await authPatch(owner, `/api/v1/budgets/${budget.id}/approve`).send({});
    expect(approved.status).toBe(200);
    const registered = await prisma.customer.findUniqueOrThrow({ where: { id: budget.customerId } });
    expect(registered).toMatchObject({ isProvisional: false, isActive: true, provisionalExpiresAt: null });
    expect((await authGet(owner, `/api/v1/customers/${registered.id}`)).status).toBe(200);
    const list = await authGet(owner, '/api/v1/customers').query({ search: 'Empresa avulsa' });
    expect((list.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
    expect((await authPatch(owner, `/api/v1/budgets/${budget.id}/approve`).send({})).status).toBe(409);
    expect(await prisma.customer.count({ where: { name: 'Empresa avulsa' } })).toBe(1);
  });

  it('ties provisional validity to the budget and keeps expired or rejected prospects hidden', async () => {
    const created = await authPost(owner, '/api/v1/budgets').send({ ...guestPayload('Cliente vencido'), issuedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(), validityDays: 1 });
    expect(created.status).toBe(201);
    const budget = data(created);
    expect((await authPatch(owner, `/api/v1/budgets/${budget.id}/approve`).send({})).status).toBe(409);
    const guest = (guestPayload('Cliente vencido revisado').guestCustomer) as Record<string, unknown>;
    const updated = await authPatch(owner, `/api/v1/budgets/${budget.id}`).send({ guestCustomer: guest, validityDays: 60 });
    expect(updated.status).toBe(200);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: budget.customerId } });
    expect(customer.provisionalExpiresAt?.toISOString()).toBe(data(updated).expirationDate);
    expect(customer.name).toBe('Cliente vencido revisado');
    expect((await authPatch(owner, `/api/v1/budgets/${budget.id}/reject`).send({})).status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: budget.customerId } })).isProvisional).toBe(true);
    expect((await authGet(owner, `/api/v1/customers/${budget.customerId}`)).status).toBe(404);
  });

  it('creates no orphan prospect on invalid budgets and rejects bypasses of registration', async () => {
    const before = await prisma.customer.count();
    expect((await authPost(owner, '/api/v1/budgets').send({ ...guestPayload(), serviceDiscount: 501 })).status).toBe(400);
    expect(await prisma.customer.count()).toBe(before);
    expect((await authPost(owner, '/api/v1/budgets').send({ ...guestPayload(), customerId: graph.customerId })).status).toBe(400);
    expect((await authPost(owner, '/api/v1/budgets').send({ ...guestPayload(), status: 'APPROVED' })).status).toBe(400);
    const created = await authPost(owner, '/api/v1/budgets').send(guestPayload());
    expect(created.status).toBe(201);
    const budget = data(created);
    expect((await authPatch(owner, `/api/v1/customers/${budget.customerId}/enable`).send({})).status).toBe(404);
    expect((await authPatch(owner, `/api/v1/budgets/${budget.id}`).send({ status: 'APPROVED' })).status).toBe(400);
    expect((await authPost(owner, '/api/v1/budgets').send({ ...payload(), customerId: budget.customerId })).status).toBe(404);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: budget.customerId } })).isProvisional).toBe(true);
  });

  it('validates guest details and avoids duplicate documents in the customer base', async () => {
    const invalid = { ...guestPayload(), guestCustomer: { type: 'COMPANY', name: 'Avulso', email: 'inválido' } };
    expect((await authPost(owner, '/api/v1/budgets').send(invalid)).status).toBe(400);
    const regular = await prisma.customer.findUniqueOrThrow({ where: { id: graph.customerId } });
    if (!regular.cnpj) throw new Error('Fixture must have CNPJ');
    const duplicate = { ...guestPayload(), guestCustomer: { type: 'COMPANY', name: 'Duplicado', cnpj: regular.cnpj } };
    expect((await authPost(owner, '/api/v1/budgets').send(duplicate)).status).toBe(409);
    expect(await prisma.customer.count({ where: { isProvisional: true } })).toBe(0);
  });

});
