import { Role } from '@prisma/client';
import { createCustomerGraph, createOperation, createOrganization, prisma } from '../integration/helpers';
import {
  authGet, authPatch, authPost, closeSecurityApp, createSecurityActor, createSecurityApp,
  registerSecurityHttpServer, resetSecurityState, type SecurityActor, type SecurityApp,
} from './security-app';

type SavedBudget = { id: string; status: string; total: string; document: { id: string }; operationId: string | null };
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

  it('creates, signs, approves and downloads a manual budget without customer signature', async () => {
    const budget = await create();
    expect(Number(budget.total)).toBe(540);
    expect(budget.operationId).toBeNull();
    expect((await authPatch(owner, `/api/v1/documents/${budget.document.id}/handoff/technical-signature`).send({ signatureId })).status).toBe(200);
    const approved = await authPatch(owner, `/api/v1/budgets/${budget.id}/approve`).send({});
    expect(approved.status).toBe(200);
    expect(data(approved).status).toBe('APPROVED');
    const rendered = await authPost(owner, `/api/v1/budgets/${budget.id}/render`).send({});
    expect(rendered.status).toBe(201);
    const pdf = await authGet(owner, `/api/v1/budgets/${budget.id}/download`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
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
});
