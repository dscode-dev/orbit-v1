import { DocumentTemplateType, Role } from '@prisma/client';
import { DocumentAssetResolver } from '../../src/modules/document-engine/assets/document-asset-resolver.service';
import { DocumentHandoffService } from '../../src/modules/document-engine/document-handoff.service';
import { OperationAccessService } from '../../src/modules/operation-access/operation-access.service';
import {
  ControlledStorage,
  createActor,
  createMaintenanceFixture,
  createOperation,
  createOrganization,
  disconnectDatabase,
  prisma,
  resetDatabase,
} from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const audit = { requestId: 'handoff-integration', ip: '127.0.0.1', userAgent: 'jest' };

describe('Field Report Handoff', () => {
  const storage = new ControlledStorage();
  const service = new DocumentHandoffService(
    prisma as never,
    new DocumentAssetResolver(storage, { warn() {} } as never),
    new OperationAccessService(prisma as never),
  );

  beforeEach(async () => {
    await resetDatabase();
    storage.files.clear();
    storage.saves.length = 0;
  });

  afterAll(disconnectDatabase);

  it('persists Operator collection, management review, signature snapshots and immutable history', async () => {
    const organization = await createOrganization();
    const owner = await createActor(Role.OWNER, 'handoff-owner');
    const operator = await createActor(Role.OPERATOR, 'handoff-operator');
    const operation = await createOperation(operator);
    await prisma.assignment.create({
      data: {
        operationId: operation.id,
        assignedBy: owner.id,
        assignedTo: operator.id,
      },
    });
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        reportedIssue: 'Falha de refrigeração informada em campo',
        signatureData: `data:image/png;base64,${PNG.toString('base64')}`,
        customerSignerName: 'Responsável local',
        signedAt: new Date('2026-07-17T12:00:00.000Z'),
        inspectedEquipments: {
          create: { equipmentId: operation.equipmentId, position: 0, sector: 'Sala técnica' },
        },
      },
    });
    const sourceKey = 'documents/signatures/integration-source.png';
    storage.files.set(sourceKey, PNG);
    const signature = await prisma.signature.create({
      data: {
        organizationId: organization.id,
        userId: operator.id,
        name: 'Engenheira Responsável',
        title: 'Responsável Técnica',
        profession: 'Engenheira Mecânica',
        professionalCouncil: 'CREA-PE',
        registrationNumber: '123456',
        department: 'Engenharia',
        imageStorageKey: sourceKey,
        mimeType: 'image/png',
        originalFileName: 'assinatura.png',
        fileSize: PNG.length,
        active: true,
        isDefault: true,
      },
    });

    const draft = await service.saveDraft(
      { operationId: operation.id, type: DocumentTemplateType.WORK_ORDER },
      operator,
      audit,
    ) as { id: string; editorialStatus: string; technicalSignature: { id: string } };
    expect(draft.editorialStatus).toBe('DRAFT');
    expect(draft.technicalSignature.id).toBe(signature.id);

    const submitted = await service.submit(draft.id, operator, audit) as {
      editorialStatus: string;
      customerSignature: { name: string; origin: string };
    };
    expect(submitted.editorialStatus).toBe('PENDING');
    expect(submitted.customerSignature).toMatchObject({ name: 'Responsável local', origin: 'OPERATOR' });

    const replaced = await service.collectCustomerSignature(
      draft.id,
      {
        signerName: 'Responsável substituto',
        signerRole: 'Cliente',
        signatureData: `data:image/png;base64,${PNG.toString('base64')}`,
        collectedAt: '2026-07-17T15:42:00.000Z',
        timezone: 'America/Recife',
      },
      owner,
      audit,
    ) as { customerSignature: { name: string; collectedBy: { id: string } }; collectedBy: { id: string } };
    expect(replaced.customerSignature).toMatchObject({ name: 'Responsável substituto', collectedBy: { id: owner.id } });
    expect(replaced.collectedBy.id).toBe(owner.id);

    await service.startReview(draft.id, owner, audit);
    const finalized = await service.finalize(draft.id, owner, audit) as {
      editorialStatus: string;
      finalizedBy: { id: string };
    };
    expect(finalized.editorialStatus).toBe('READY');
    expect(finalized.finalizedBy.id).toBe(owner.id);

    const persisted = await prisma.operationDocument.findUniqueOrThrow({ where: { id: draft.id } });
    expect(persisted.technicalSignatureSnapshot).toMatchObject({ name: 'Engenheira Responsável', registrationNumber: '123456' });
    expect(persisted.customerSignatureSnapshot).toMatchObject({ name: 'Responsável substituto', origin: 'PLATFORM' });
    expect(persisted.collectedById).toBe(owner.id);
    expect(await prisma.documentRevision.count({ where: { documentId: draft.id } })).toBeGreaterThanOrEqual(5);
    expect(storage.saves).toHaveLength(3);
  });

  it('enforces Assignment authorization and management finalization for special documents', async () => {
    await createOrganization();
    const owner = await createActor(Role.OWNER, 'matrix-owner');
    const operator = await createActor(Role.OPERATOR, 'matrix-operator');
    const otherOperator = await createActor(Role.OPERATOR, 'matrix-other');
    const operation = await createOperation(operator);
    await prisma.assignment.create({ data: { operationId: operation.id, assignedBy: owner.id, assignedTo: operator.id } });

    await expect(service.saveDraft({ operationId: operation.id, type: DocumentTemplateType.WORK_ORDER }, otherOperator, audit)).rejects.toMatchObject({ status: 403 });
    await expect(service.saveDraft({ operationId: operation.id, type: DocumentTemplateType.RECEIPT }, operator, audit)).rejects.toMatchObject({ status: 403 });

    const opinion = await service.saveDraft({ operationId: operation.id, type: DocumentTemplateType.TECHNICAL_OPINION }, operator, audit) as { id: string };
    await expect(service.submit(opinion.id, operator, audit)).resolves.toMatchObject({ editorialStatus: 'PENDING', workflowStatus: 'REVIEW', assignmentOrigin: 'MANAGEMENT', customerSignature: null });
    await expect(service.finalize(opinion.id, operator, audit)).rejects.toMatchObject({ status: 403 });
    await service.startReview(opinion.id, owner, audit);
    await expect(service.finalize(opinion.id, owner, audit)).rejects.toMatchObject({ status: 409 });
  });

  it('allows the assigned operator to finalize a completed Work Order', async () => {
    const organization = await createOrganization();
    const operator = await createActor(Role.OPERATOR, 'direct-work-order-operator');
    const operation = await createOperation(operator);
    await prisma.assignment.create({
      data: { operationId: operation.id, assignedBy: operator.id, assignedTo: operator.id },
    });
    const signatureKey = 'documents/signatures/direct-work-order.png';
    storage.files.set(signatureKey, PNG);
    await prisma.signature.create({
      data: {
        organizationId: organization.id,
        userId: operator.id,
        name: 'Responsável técnica padrão',
        title: 'Responsável técnica',
        imageStorageKey: signatureKey,
        mimeType: 'image/png',
        originalFileName: 'direct-work-order.png',
        fileSize: PNG.length,
        active: true,
        isDefault: true,
      },
    });
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        signatureData: `data:image/png;base64,${PNG.toString('base64')}`,
        customerSignerName: 'Cliente em campo',
        signedAt: new Date(),
      },
    });
    await prisma.operationDocument.create({
      data: {
        operationId: operation.id,
        type: DocumentTemplateType.WORK_ORDER,
        number: 'OS-000001',
      },
    });

    const draft = await service.saveDraft(
      { operationId: operation.id, type: DocumentTemplateType.WORK_ORDER },
      operator,
      audit,
    ) as { id: string; technicalSignature: { id: string } };
    expect(draft.technicalSignature.id).toBeTruthy();
    await service.submit(draft.id, operator, audit);
    await expect(service.finalize(draft.id, operator, audit)).resolves.toMatchObject({
      editorialStatus: 'READY',
      finalizedBy: { id: operator.id },
    });
    await expect(prisma.operationDocument.findUniqueOrThrow({ where: { id: draft.id } }))
      .resolves.toMatchObject({ editorialStatus: 'READY', finalizedById: operator.id });
  });

  it('allows an operator to select only their own technical signature for OS/RVT', async () => {
    const organization = await createOrganization();
    const operator = await createActor(Role.OPERATOR, 'own-signature-operator');
    const other = await createActor(Role.OPERATOR, 'other-signature-operator');
    const operation = await createOperation(operator);
    await prisma.assignment.create({
      data: { operationId: operation.id, assignedBy: other.id, assignedTo: operator.id },
    });
    const ownKey = 'documents/signatures/own-operator.png';
    const otherKey = 'documents/signatures/other-operator.png';
    storage.files.set(ownKey, PNG);
    storage.files.set(otherKey, PNG);
    const own = await prisma.signature.create({
      data: {
        organizationId: organization.id,
        userId: operator.id,
        name: operator.name,
        title: 'Técnico de campo',
        imageStorageKey: ownKey,
        mimeType: 'image/png',
        originalFileName: 'own.png',
        fileSize: PNG.length,
      },
    });
    const foreign = await prisma.signature.create({
      data: {
        organizationId: organization.id,
        userId: other.id,
        name: other.name,
        title: 'Outro técnico',
        imageStorageKey: otherKey,
        mimeType: 'image/png',
        originalFileName: 'other.png',
        fileSize: PNG.length,
      },
    });

    const draft = await service.saveDraft(
      { operationId: operation.id, type: DocumentTemplateType.TECHNICAL_REPORT },
      operator,
      audit,
    ) as { id: string; technicalSignature: { id: string } };
    expect(draft.technicalSignature.id).toBe(own.id);
    await expect(service.selectTechnicalSignature(draft.id, foreign.id, operator, audit))
      .rejects.toMatchObject({ status: 403 });
    await expect(service.selectTechnicalSignature(draft.id, own.id, operator, audit))
      .resolves.toMatchObject({ technicalSignature: { id: own.id }, editorialStatus: 'DRAFT' });
  });

  it('prioritizes the PMOC technical signature override when preparing the official handoff', async () => {
    const organization = await createOrganization();
    const owner = await createActor(Role.OWNER, 'pmoc-signature-owner');
    const fixture = await createMaintenanceFixture(owner);
    const operation = await prisma.operation.findUniqueOrThrow({ where: { id: fixture.operationId } });
    const overrideKey = 'documents/signatures/pmoc-override.png';
    storage.files.set(overrideKey, PNG);
    const override = await prisma.signature.create({
      data: {
        organizationId: organization.id,
        name: 'Responsável Técnica do PMOC',
        title: 'Engenheira responsável',
        imageStorageKey: overrideKey,
        mimeType: 'image/png',
        originalFileName: 'pmoc-override.png',
        fileSize: PNG.length,
        active: true,
      },
    });
    await prisma.pmocPlan.create({
      data: {
        organizationId: organization.id,
        customerId: operation.customerId,
        equipmentId: operation.equipmentId!,
        maintenancePlanId: fixture.planId,
        signatureOverrideId: override.id,
        responsibleTechnician: 'Responsável Técnica do PMOC',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
      },
    });

    await expect(
      service.saveDraft(
        { operationId: fixture.operationId, type: DocumentTemplateType.PMOC },
        owner,
        audit,
      ),
    ).resolves.toMatchObject({ technicalSignature: { id: override.id, name: override.name } });
  });

  it('rejects a special document initiated by an operator without management assignment', async () => {
    await createOrganization();
    const operator = await createActor(Role.OPERATOR, 'self-review-operator');
    const operation = await createOperation(operator);
    await prisma.assignment.create({
      data: { operationId: operation.id, assignedBy: operator.id, assignedTo: operator.id },
    });

    await expect(service.saveDraft(
      { operationId: operation.id, type: DocumentTemplateType.TECHNICAL_OPINION },
      operator,
      audit,
    )).rejects.toMatchObject({ status: 403 });
  });
});
