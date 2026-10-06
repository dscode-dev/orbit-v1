import {
  DocumentTemplateType,
  type FinancialEntry,
  type OperationDocument,
  Prisma,
  Role,
} from '@prisma/client';
import { FinancialService } from '../../src/modules/financial/financial.service';
import { ReceiptService } from '../../src/modules/document-engine/receipt.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { OperationAccessService } from '../../src/modules/operation-access/operation-access.service';
import type { AuthenticatedUser } from '../../src/shared/types/authenticated-user.type';
import type { CreateOperationDto } from '../../src/modules/operations/dto/operation.dto';
import {
  context,
  createActor,
  createCustomerGraph,
  createDocumentEngine,
  createOperation,
  createOrganization,
  disconnectDatabase,
  prisma,
  resetDatabase,
} from './helpers';

describe('Receipt adjustments and new equipment in field service', () => {
  const financial = new FinancialService(prisma as never, {} as never);
  const receipts = new ReceiptService(prisma as never, financial);
  const engine = createDocumentEngine();

  beforeEach(resetDatabase);
  afterAll(disconnectDatabase);

  async function receiptFixture(): Promise<{
    actor: AuthenticatedUser;
    operation: Awaited<ReturnType<typeof createOperation>>;
    document: OperationDocument;
    entry: FinancialEntry;
  }> {
    await createOrganization();
    const actor = await createActor();
    const operation = await createOperation(actor);
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'COMPLETED',
        receiptAmount: 100,
        receiptNumber: 'REC-TEST',
        receiptAmountInWords: 'cem reais',
        receiptDescription: 'Instalação',
        receiptDeclaration: 'Recebemos cem reais.',
      },
    });
    const document = await prisma.operationDocument.create({
      data: {
        operationId: operation.id,
        type: 'RECEIPT',
        number: 'REC-TEST',
        editorialStatus: 'READY',
        submittedAt: new Date(),
        renderedAt: new Date(),
      },
    });
    await financial.syncReceiptEntry(operation.id, actor.id, context);
    const entry = await prisma.financialEntry.findFirstOrThrow({
      where: { originId: operation.id },
    });
    return { actor, operation, document, entry };
  }

  async function balance(accountId: string): Promise<number> {
    return Number(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .currentBalance,
    );
  }

  it('updates a completed receipt by the difference, regenerates its declaration/PDF, and reverses only its own balance', async () => {
    const { actor, operation, document, entry } = await receiptFixture();
    // Preserve another paid entry in the same account when this receipt is canceled.
    await prisma.financialEntry.create({
      data: {
        organizationId: entry.organizationId,
        accountId: entry.accountId,
        type: 'RECEIVABLE',
        origin: 'MANUAL',
        amount: 50,
        dueDate: new Date(),
        paidAt: new Date(),
        status: 'PAID',
        description: 'Outro recebimento',
        createdBy: actor.id,
      },
    });
    await prisma.financialAccount.update({
      where: { id: entry.accountId },
      data: { currentBalance: { increment: 50 } },
    });
    await engine.documents.renderDocument(document.id, actor, context);
    let revision = (
      await prisma.operationDocument.findUniqueOrThrow({ where: { id: document.id } })
    ).revision;
    for (const amount of [160.25, 80.1]) {
      const updated = (await receipts.update(
        document.id,
        {
          revision,
          receiptAmount: amount,
          receiptAmountInWords: 'valor atualizado',
          receiptDescription: 'Instalação ajustada',
          receiptIssuedAt: '2026-10-01',
          receiptWarrantyDays: null,
        },
        actor,
        context,
      )) as { revision: number; editorialStatus: string };
      revision = updated.revision;
      expect(updated.editorialStatus).toBe('STALE');
      await expect(engine.documents.downloadDocument(document.id, actor, context)).rejects.toThrow(
        'desatualizado',
      );
      expect(await balance(entry.accountId)).toBe(amount + 50);
      expect(
        (await prisma.financialEntry.findUniqueOrThrow({ where: { id: entry.id } })).amount.equals(
          new Prisma.Decimal(amount),
        ),
      ).toBe(true);
    }
    const blueprint = JSON.stringify(
      await engine.documents.previewDocument(document.id, actor, context),
    );
    expect(blueprint).toContain('80,10');
    expect(blueprint).toContain('Instalação ajustada');
    expect(blueprint).not.toContain('Recebemos cem reais.');
    await engine.documents.renderDocument(document.id, actor, context);
    const downloaded = await engine.documents.downloadDocument(document.id, actor, context);
    expect(downloaded.content.subarray(0, 4).toString()).toBe('%PDF');
    revision = (await prisma.operationDocument.findUniqueOrThrow({ where: { id: document.id } }))
      .revision;
    await receipts.cancel(document.id, { revision }, actor, context);
    await receipts.cancel(document.id, { revision }, actor, context);
    expect(await balance(entry.accountId)).toBe(50);
    expect(await prisma.financialEntry.count({ where: { originId: operation.id } })).toBe(1);
    expect(
      (await prisma.financialEntry.findUniqueOrThrow({ where: { id: entry.id } })).status,
    ).toBe('CANCELED');
    expect((await prisma.operation.findUniqueOrThrow({ where: { id: operation.id } })).status).toBe(
      'COMPLETED',
    );
    expect(await financial.syncReceiptEntry(operation.id, actor.id, context)).toBe(false);
    expect(
      await financial.importReceipts({ operationIds: [operation.id] }, actor, context),
    ).toEqual({ imported: 0 });
    expect(await financial.listImportableReceipts()).toEqual([]);
    for (const action of ['previewDocument', 'renderDocument', 'downloadDocument'] as const) {
      await expect(engine.documents[action](document.id, actor, context)).rejects.toThrow(
        'cancelado',
      );
    }
    await expect(
      engine.documents.previewOperation(operation.id, DocumentTemplateType.RECEIPT, actor, context),
    ).rejects.toThrow('cancelado');
  });

  it('creates a single entry when the first receipt import is requested concurrently', async () => {
    await createOrganization();
    const actor = await createActor();
    const operation = await createOperation(actor);
    await prisma.operation.update({ where: { id: operation.id }, data: { receiptAmount: 100 } });
    await Promise.all(
      Array.from({ length: 5 }, () => financial.syncReceiptEntry(operation.id, actor.id, context)),
    );
    const entries = await prisma.financialEntry.findMany({ where: { originId: operation.id } });
    expect(entries).toHaveLength(1);
    expect(await balance(entries[0].accountId)).toBe(100);
  });

  it('allows a zero value without leaving the previous receipt value in the balance', async () => {
    const { actor, document, entry } = await receiptFixture();
    await receipts.update(
      document.id,
      {
        revision: 0,
        receiptAmount: 0,
        receiptAmountInWords: 'zero reais',
        receiptDescription: 'Sem cobrança',
      },
      actor,
      context,
    );
    expect(await balance(entry.accountId)).toBe(0);
  });

  it('serializes simultaneous imports and rejects a concurrent edit based on an outdated revision', async () => {
    const { actor, operation, document, entry } = await receiptFixture();
    await Promise.all(
      Array.from({ length: 5 }, () => financial.syncReceiptEntry(operation.id, actor.id, context)),
    );
    expect(await prisma.financialEntry.count({ where: { originId: operation.id } })).toBe(1);
    const results = await Promise.allSettled(
      [200, 300].map((receiptAmount) =>
        receipts.update(
          document.id,
          {
            revision: document.revision,
            receiptAmount,
            receiptAmountInWords: 'valor',
            receiptDescription: 'Ajuste',
          },
          actor,
          context,
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const current = await prisma.operation.findUniqueOrThrow({ where: { id: operation.id } });
    expect(await balance(entry.accountId)).toBe(Number(current.receiptAmount));
  });

  it('rolls back the receipt and revision if the financial adjustment fails', async () => {
    const { actor, document, operation, entry } = await receiptFixture();
    const broken = new ReceiptService(
      prisma as never,
      { syncReceiptEntryTx: () => Promise.reject(new Error('Financial failure')) } as never,
    );
    await expect(
      broken.update(
        document.id,
        {
          revision: 0,
          receiptAmount: 500,
          receiptAmountInWords: 'quinhentos reais',
          receiptDescription: 'Ajuste',
        },
        actor,
        context,
      ),
    ).rejects.toThrow('Financial failure');
    expect(
      Number(
        (await prisma.operation.findUniqueOrThrow({ where: { id: operation.id } })).receiptAmount,
      ),
    ).toBe(100);
    expect(
      (await prisma.operationDocument.findUniqueOrThrow({ where: { id: document.id } })).revision,
    ).toBe(0);
    expect(await balance(entry.accountId)).toBe(100);
  });

  it.each([Role.OPERATOR, Role.VIEWER])('rejects receipt changes by %s', async (role) => {
    const { document } = await receiptFixture();
    const actor = await createActor(role);
    await expect(receipts.cancel(document.id, { revision: 0 }, actor, context)).rejects.toThrow(
      'Somente a gestão',
    );
    await expect(receipts.get(document.id, actor)).rejects.toThrow('Somente a gestão');
  });

  function operations(): OperationsService {
    return new OperationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { syncFromOperationTx: () => Promise.resolve(undefined) } as never,
      {
        createForOperationTx: async (
          tx: Prisma.TransactionClient,
          data: Prisma.AssignmentUncheckedCreateInput,
        ) => tx.assignment.create({ data }),
      } as never,
      new OperationAccessService(prisma as never),
      financial,
      {
        assertValidTypeKeys: () => Promise.resolve(undefined),
        getReminderConfigByKey: () => Promise.resolve(null),
      } as never,
    );
  }

  async function equipmentFixture(documentType: DocumentTemplateType): Promise<{
    actor: AuthenticatedUser;
    graph: Awaited<ReturnType<typeof createCustomerGraph>>;
    payload: CreateOperationDto;
  }> {
    const organization = await createOrganization();
    const actor = await createActor(Role.OPERATOR);
    const graph = await createCustomerGraph();
    const catalog = await prisma.technicalCatalog.create({
      data: {
        organizationId: organization.id,
        type: 'EQUIPMENT_TYPE',
        title: 'Split',
        tags: ['legacy-split'],
      },
    });
    const payload: CreateOperationDto = {
      customerId: graph.customerId,
      addressId: graph.addressId,
      equipmentId: graph.equipmentId,
      type: 'INSTALACAO',
      documentType,
      inspectedEquipments: [{ equipmentId: graph.equipmentId, sector: 'Sala' }],
      signatureData:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      customerSignerName: 'Cliente',
      newEquipments: ['Novo 1', 'Novo 2'].map((model) => ({
        equipmentTypeCatalogId: catalog.id,
        manufacturer: 'Carrier',
        model,
        capacity: '18000 BTU/h',
        sector: 'Recepção',
      })),
    };
    return { actor, graph, payload };
  }

  it.each([DocumentTemplateType.WORK_ORDER, DocumentTemplateType.TECHNICAL_REPORT])(
    'saves multiple new equipments and existing equipment together for %s',
    async (type) => {
      const { actor, graph, payload } = await equipmentFixture(type);
      const operation = (await operations().create(payload, actor, context)) as { id: string };
      const items = await prisma.operationInspectedEquipment.findMany({
        where: { operationId: operation.id },
        orderBy: { position: 'asc' },
        include: { equipment: true },
      });
      expect(items).toHaveLength(3);
      expect(items[0].equipmentId).toBe(graph.equipmentId);
      expect(items.slice(1).map((item) => item.equipment.model)).toEqual(['Novo 1', 'Novo 2']);
      for (const item of items.slice(1)) {
        expect(item.equipment.customerId).toBe(graph.customerId);
        expect(item.equipment.addressId).toBe(graph.addressId);
        expect(item.equipment.capacity).toBe('18000 BTU/h');
        expect(item.equipment.qrCode).toMatch(/^equipment:/);
      }
      expect(await prisma.equipment.count({ where: { customerId: graph.customerId } })).toBe(3);
      const blueprint = JSON.stringify(
        await engine.documents.previewOperation(operation.id, type, actor, context),
      );
      expect(blueprint).toContain('Novo 1');
      expect(blueprint).toContain('Novo 2');
    },
  );

  it('chooses a new equipment as the primary equipment when the client has no selected equipment', async () => {
    const { actor, payload } = await equipmentFixture(DocumentTemplateType.TECHNICAL_REPORT);
    delete payload.equipmentId;
    payload.inspectedEquipments = [];
    const operation = (await operations().create(payload, actor, context)) as {
      id: string;
      equipmentId: string;
    };
    const inspected = await prisma.operationInspectedEquipment.findFirstOrThrow({
      where: { operationId: operation.id },
      orderBy: { position: 'asc' },
    });
    expect(operation.equipmentId).toBe(inspected.equipmentId);
  });

  it('does not leave new equipments behind if operation creation fails', async () => {
    const { actor, graph, payload } = await equipmentFixture(DocumentTemplateType.TECHNICAL_REPORT);
    await expect(
      operations().create(payload, actor, context, () =>
        Promise.reject(new Error('Operation failure')),
      ),
    ).rejects.toThrow('Operation failure');
    expect(await prisma.equipment.count({ where: { customerId: graph.customerId } })).toBe(1);
    expect(await prisma.operation.count()).toBe(0);
  });

  it('rejects an unavailable type, incomplete technical fields and equipment from another client', async () => {
    const { actor, graph, payload } = await equipmentFixture(DocumentTemplateType.TECHNICAL_REPORT);
    await prisma.technicalCatalog.update({
      where: { id: payload.newEquipments![0].equipmentTypeCatalogId },
      data: { active: false },
    });
    await expect(operations().create(payload, actor, context)).rejects.toThrow(
      'tipos de equipamento',
    );
    payload.newEquipments![0].capacity = '';
    await expect(operations().create(payload, actor, context)).rejects.toThrow(
      'marca, modelo e capacidade',
    );
    payload.newEquipments = [];
    const other = await createCustomerGraph();
    payload.inspectedEquipments = [{ equipmentId: other.equipmentId, sector: 'Outro cliente' }];
    await expect(operations().create(payload, actor, context)).rejects.toThrow(
      'pertencer ao cliente',
    );
    expect(await prisma.equipment.count({ where: { customerId: graph.customerId } })).toBe(1);
    expect(await prisma.operation.count()).toBe(0);
  });
});
