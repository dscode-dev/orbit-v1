import {
  BudgetStatus,
  CustomerType,
  EquipmentType,
  OperationStatus,
  Role,
  OperationMaintenanceType,
  TechnicalCatalogArea,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import { OperationType } from '../../src/shared/constants/service-types.constants';
import {
  createActor,
  createBudgetFixture,
  createCustomerGraph,
  createOperation,
  createOrganization,
  createPricingFixture,
  createProductWithInventory,
  disconnectDatabase,
  prisma,
  resetDatabase,
} from './helpers';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { CustomersService } from '../../src/modules/customers/customers.service';

describe('database integrity constraints with real PostgreSQL', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('enforces one approved Budget per Operation through partial unique index', async () => {
    const actor = await createActor();
    const first = await createBudgetFixture(actor);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: first.budgetId } });
    await prisma.budget.update({
      where: { id: first.budgetId },
      data: { status: BudgetStatus.APPROVED },
    });

    await expect(
      prisma.budget.create({
        data: {
          organizationId: budget.organizationId,
          operationId: budget.operationId,
          customerId: budget.customerId,
          customerAddressId: budget.customerAddressId,
          equipmentId: budget.equipmentId,
          title: 'violating budget',
          introduction: 'Integrity verification',
          amountInWords: 'um real',
          status: BudgetStatus.APPROVED,
          subtotal: 1,
          total: 1,
          expirationDate: new Date('2026-12-31T00:00:00.000Z'),
          createdBy: actor.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces one active InventoryItem per organization/product/location including null location', async () => {
    const org = await createOrganization();
    const item = await createProductWithInventory(org.id, 0);

    await expect(
      prisma.inventoryItem.create({
        data: {
          organizationId: org.id,
          productId: item.productId,
          currentQuantity: 0,
          minimumQuantity: 0,
          idealQuantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          location: null,
          isActive: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces active ProductPricing non-overlap through exclusion constraint', async () => {
    const org = await createOrganization();
    const { productId } = await createPricingFixture(org.id);
    await prisma.productPricing.create({
      data: {
        organizationId: org.id,
        productId,
        costPrice: 10,
        replacementCost: 10,
        averageCost: 10,
        salePrice: 20,
        minimumSalePrice: 15,
        suggestedSalePrice: 22,
        marginPercentage: 50,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
      },
    });

    await expect(
      prisma.productPricing.create({
        data: {
          organizationId: org.id,
          productId,
          costPrice: 11,
          replacementCost: 11,
          averageCost: 11,
          salePrice: 22,
          minimumSalePrice: 16,
          suggestedSalePrice: 24,
          marginPercentage: 50,
          validFrom: new Date('2026-06-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
          active: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('rolls back transactional writes on thrown failure', async () => {
    const org = await createOrganization();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.financialAccount.create({
          data: {
            organizationId: org.id,
            name: 'rollback-account',
            type: 'BANK',
            openingBalance: 0,
            currentBalance: 0,
            active: true,
          },
        });
        await tx.auditLog.create({
          data: { action: 'ROLLBACK_TEST', resource: 'integration', actor: 'test', metadata: {} },
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    await expect(prisma.financialAccount.count()).resolves.toBe(0);
    await expect(prisma.auditLog.count({ where: { action: 'ROLLBACK_TEST' } })).resolves.toBe(0);
  });

  it('persists the technical report reference period, typed checklist and equipment snapshot', async () => {
    const actor = await createActor();
    const operation = await createOperation(actor);

    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        referenceMonth: 6,
        referenceYear: 2026,
        maintenanceType: OperationMaintenanceType.SEMIANNUAL,
        maintenanceChecklistItems: {
          create: {
            maintenanceType: OperationMaintenanceType.SEMIANNUAL,
            description: 'Higienizar filtros e verificar drenagem',
            executed: true,
            observations: 'Executado durante a visita',
            position: 0,
          },
        },
        inspectedEquipments: {
          create: {
            equipmentId: operation.equipmentId,
            position: 0,
            sector: 'Recepção',
            brandSnapshot: 'Orbit HVAC',
            modelSnapshot: 'Split 12000',
            capacitySnapshot: '12.000 BTU/h',
          },
        },
      },
    });

    const persisted = await prisma.operation.findUniqueOrThrow({
      where: { id: operation.id },
      include: { maintenanceChecklistItems: true, inspectedEquipments: true },
    });
    expect(persisted).toMatchObject({
      referenceMonth: 6,
      referenceYear: 2026,
      maintenanceType: OperationMaintenanceType.SEMIANNUAL,
    });
    expect(persisted.maintenanceChecklistItems).toHaveLength(1);
    expect(persisted.inspectedEquipments[0]).toMatchObject({
      sector: 'Recepção',
      brandSnapshot: 'Orbit HVAC',
      capacitySnapshot: '12.000 BTU/h',
    });

    await expect(
      prisma.$executeRaw`UPDATE "operations" SET "reference_year" = NULL WHERE "id" = ${operation.id}::uuid`,
    ).rejects.toThrow();
  });

  it('accepts a non-negative operational service value and rejects negative values', async () => {
    const actor = await createActor();
    const operation = await createOperation(actor);

    const updated = await prisma.operation.update({
      where: { id: operation.id },
      data: { serviceValue: 1350 },
    });
    expect(updated.serviceValue?.toString()).toBe('1350');

    await expect(
      prisma.$executeRaw`UPDATE "operations" SET "service_value" = -1 WHERE "id" = ${operation.id}::uuid`,
    ).rejects.toThrow();
  });

  it('preserves equipment classification when a catalog type is archived', async () => {
    const actor = await createActor();
    const organization = await createOrganization();
    const operation = await createOperation(actor);
    const catalog = await prisma.technicalCatalog.create({
      data: {
        organizationId: organization.id,
        type: TechnicalCatalogType.EQUIPMENT_TYPE,
        title: 'Self-contained',
        tags: ['equipment-type'],
        areas: [TechnicalCatalogArea.GENERAL],
        workflows: [TechnicalCatalogWorkflow.GENERAL],
      },
    });

    await prisma.equipment.update({
      where: { id: operation.equipmentId },
      data: {
        type: EquipmentType.OTHER,
        equipmentTypeCatalogId: catalog.id,
      },
    });
    await prisma.technicalCatalog.update({
      where: { id: catalog.id },
      data: { active: false, deletedAt: new Date() },
    });

    const equipment = await prisma.equipment.findUniqueOrThrow({
      where: { id: operation.equipmentId },
      include: { equipmentTypeCatalog: true },
    });
    expect(equipment.equipmentTypeCatalog).toMatchObject({
      id: catalog.id,
      title: 'Self-contained',
      active: false,
    });
    await expect(
      prisma.technicalCatalog.delete({ where: { id: catalog.id } }),
    ).rejects.toThrow();
  });

  it('atomically creates a walk-in customer with multiple field equipments', async () => {
    const organization = await createOrganization();
    const operator = await createActor(Role.OPERATOR, 'walk-in-operator');
    const splitCatalog = await prisma.technicalCatalog.create({
      data: {
        organizationId: organization.id,
        type: TechnicalCatalogType.EQUIPMENT_TYPE,
        title: 'Split',
        tags: ['legacy-split'],
        areas: [TechnicalCatalogArea.GENERAL],
        workflows: [TechnicalCatalogWorkflow.GENERAL],
      },
    });
    const chillerCatalog = await prisma.technicalCatalog.create({
      data: {
        organizationId: organization.id,
        type: TechnicalCatalogType.EQUIPMENT_TYPE,
        title: 'Chiller',
        tags: ['legacy-chiller'],
        areas: [TechnicalCatalogArea.GENERAL],
        workflows: [TechnicalCatalogWorkflow.GENERAL],
      },
    });
    const service = new CustomersService(prisma as never, {} as never);

    const result = await service.createWalkIn(
      {
        type: CustomerType.COMPANY,
        name: 'Cliente cadastrado em campo',
        address: {
          street: 'Rua da Aurora', number: '100', district: 'Boa Vista', city: 'Recife', state: 'PE',
        },
        contact: { name: 'Ana Lima', phone: '81999999999' },
        equipments: [
          {
            equipmentTypeCatalogId: splitCatalog.id,
            manufacturer: 'Midea', model: 'Xtreme Save', capacity: '12.000 BTU/h', sector: 'Recepção',
          },
          {
            equipmentTypeCatalogId: chillerCatalog.id,
            manufacturer: 'Carrier', model: 'AquaSnap', capacity: '20 TR', sector: 'Sala técnica',
          },
        ],
      },
      operator,
      { requestId: 'walk-in-multiple-equipment', ip: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.equipments).toHaveLength(2);
    expect(result.equipmentId).toBe(result.equipments[0]?.id);
    const persisted = await prisma.equipment.findMany({
      where: { customerId: result.customerId },
      orderBy: { createdAt: 'asc' },
    });
    expect(persisted).toHaveLength(2);
    expect(persisted.map((item) => item.type)).toEqual([EquipmentType.SPLIT, EquipmentType.CHILLER]);
    expect(persisted.every((item) => item.addressId === result.addressId && Boolean(item.qrToken))).toBe(true);
  });

  it('atomically registers field equipment and links it to an unscoped assigned Operation', async () => {
    const organization = await createOrganization();
    const owner = await createActor(Role.OWNER, 'field-owner');
    const operator = await createActor(Role.OPERATOR, 'field-operator');
    const graph = await createCustomerGraph();
    const operation = await prisma.operation.create({
      data: {
        customerId: graph.customerId,
        addressId: graph.addressId,
        operatorId: operator.id,
        type: OperationType.CORRETIVA,
        status: OperationStatus.IN_PROGRESS,
        checklist: [],
        assignments: {
          create: { assignedBy: owner.id, assignedTo: operator.id, status: 'STARTED' },
        },
      },
    });
    const catalog = await prisma.technicalCatalog.create({
      data: {
        organizationId: organization.id,
        type: TechnicalCatalogType.EQUIPMENT_TYPE,
        title: 'Split de campo',
        tags: ['legacy-split'],
        areas: [TechnicalCatalogArea.GENERAL],
        workflows: [TechnicalCatalogWorkflow.GENERAL],
      },
    });
    const access = { assertOperationAccess: jest.fn().mockResolvedValue(undefined) };
    const service = new OperationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      access as never,
      {} as never,
      { assertValidTypeKeys: async () => undefined, getReminderConfigByKey: async () => null } as never,
    );

    await service.addFieldEquipments(
      operation.id,
      {
        newEquipments: [{
          equipmentTypeCatalogId: catalog.id,
          sector: 'Sala CORE',
          manufacturer: 'Carrier',
          model: 'Ecosplit',
          capacity: '20 TR',
        }],
      },
      operator,
      { requestId: 'field-equipment-integration', ip: '127.0.0.1', userAgent: 'jest' },
    );

    const persisted = await prisma.operation.findUniqueOrThrow({
      where: { id: operation.id },
      include: { equipment: true, inspectedEquipments: true },
    });
    expect(persisted.equipment).toMatchObject({
      customerId: graph.customerId,
      addressId: graph.addressId,
      manufacturer: 'Carrier',
      model: 'Ecosplit',
      capacity: '20 TR',
    });
    expect(persisted.inspectedEquipments).toHaveLength(1);
    await expect(
      service.addFieldEquipments(
        operation.id,
        { existingEquipmentIds: [graph.equipmentId] },
        operator,
        { requestId: 'field-equipment-retry', ip: null, userAgent: 'jest' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_EQUIPMENT_INVALID' });
    await expect(
      prisma.auditLog.count({
        where: { action: { in: ['EQUIPMENT_CREATED', 'OPERATION_FIELD_EQUIPMENTS_ATTACHED'] } },
      }),
    ).resolves.toBe(2);
  });
});
