import {
  BudgetStatus,
  CustomerType,
  EquipmentStatus,
  EquipmentType,
  FinancialAccountType,
  FinancialCategoryType,
  FinancialEntryOrigin,
  FinancialEntryStatus,
  FinancialEntryType,
  MaintenancePlanType,
  MaintenancePriority,
  OperationStatus,
  OperationType,
  Prisma,
  PrismaClient,
  PurchaseOrderStatus,
  Role,
  StockMovementType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DocumentAssetResolver } from '../../src/modules/document-engine/assets/document-asset-resolver.service';
import { DocumentBuilderService } from '../../src/modules/document-engine/builder/document-builder.service';
import { DocumentConfigurationService } from '../../src/modules/document-engine/configuration/document-configuration.service';
import { DocumentContextService } from '../../src/modules/document-engine/context/document-context.service';
import { DocumentEngineService } from '../../src/modules/document-engine/document-engine.service';
import { LayoutEngine } from '../../src/modules/document-engine/layout/layout-engine.service';
import { DocumentMeasureService } from '../../src/modules/document-engine/measurement/document-measure.service';
import { PdfEngineService } from '../../src/modules/document-engine/pdf/pdf-engine.service';
import { DocumentRendererService } from '../../src/modules/document-engine/renderer/document-renderer.service';
import { AppLoggerService } from '../../src/infra/logger/app-logger.service';
import type { StorageProviderContract, StorageSaveInput, StoredFile } from '../../src/infra/storage/storage-provider.type';
import { LifecyclePublisher } from '../../src/modules/asset-lifecycle/lifecycle-publisher.service';
import { OperationAccessService } from '../../src/modules/operation-access/operation-access.service';
import type { AuthenticatedUser } from '../../src/shared/types/authenticated-user.type';
import type { FinancialAuditContext } from '../../src/modules/financial/financial.service';

export const prisma = new PrismaClient();

export const context: FinancialAuditContext = {
  requestId: 'integration-test',
  ip: '127.0.0.1',
  userAgent: 'jest-integration',
};

export function testId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function digits(length: number): string {
  return randomUUID().replace(/\D/g, '').padEnd(length, '0').slice(0, length);
}

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_logs",
      "asset_lifecycle_attachments",
      "asset_lifecycle_events",
      "assignment_history",
      "assignments",
      "budget_approvals",
      "budget_history",
      "budget_items",
      "budgets",
      "financial_entry_allocations",
      "financial_history",
      "financial_entries",
      "financial_categories",
      "financial_accounts",
      "operation_parts",
      "stock_movements",
      "inventory_items",
      "product_suppliers",
      "purchase_history",
      "purchase_receipts",
      "purchase_order_items",
      "purchase_orders",
      "product_pricings",
      "products",
      "maintenance_executions",
      "maintenance_plans",
      "operation_documents",
      "operations",
      "equipments",
      "customer_addresses",
      "customers",
      "organization_settings",
      "organizations",
      "users"
    RESTART IDENTITY CASCADE
  `);
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export async function createActor(role: Role = Role.OWNER, usernamePrefix = 'owner'): Promise<AuthenticatedUser> {
  const suffix = testId(usernamePrefix);
  const user = await prisma.user.create({
    data: {
      email: `${suffix}@orbit.test`,
      username: suffix.slice(0, 50),
      name: `${usernamePrefix} user`,
      passwordHash: 'argon2-test-hash',
      role,
      isActive: true,
      mustChangePassword: false,
    },
  });
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function createOrganization(): Promise<{ id: string }> {
  return prisma.organization.create({
    data: {
      legalName: 'Orbit Integration LTDA',
      tradeName: 'Orbit Integration',
      cnpj: digits(14),
      email: 'integration@orbit.test',
      phone: '+5581000000000',
      city: 'Recife',
      state: 'PE',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      isActive: true,
      settings: {
        create: {
          language: 'pt-BR',
          timezone: 'America/Recife',
          currency: 'BRL',
          documentPrefix: 'ORB',
        },
      },
    },
    select: { id: true },
  });
}

export async function createCustomerGraph(): Promise<{ customerId: string; addressId: string; equipmentId: string }> {
  const customer = await prisma.customer.create({
    data: {
      type: CustomerType.COMPANY,
      name: 'Hospital Integração',
      tradeName: testId('hospital'),
      cnpj: digits(14),
      email: 'hospital@orbit.test',
      isActive: true,
    },
  });
  const address = await prisma.customerAddress.create({
    data: {
      customerId: customer.id,
      name: 'Matriz',
      zipCode: '50000-000',
      street: 'Rua Teste',
      number: '100',
      district: 'Boa Viagem',
      city: 'Recife',
      state: 'PE',
      isPrimary: true,
    },
  });
  const equipment = await prisma.equipment.create({
    data: {
      customerId: customer.id,
      addressId: address.id,
      type: EquipmentType.SPLIT,
      status: EquipmentStatus.ACTIVE,
      name: testId('Split 12000 BTU'),
      tag: testId('TAG').slice(0, 80),
      qrCode: testId('QR').slice(0, 100),
      isActive: true,
    },
  });
  return { customerId: customer.id, addressId: address.id, equipmentId: equipment.id };
}

export async function createOperation(actor: AuthenticatedUser): Promise<{ id: string; equipmentId: string; customerId: string; addressId: string }> {
  const graph = await createCustomerGraph();
  const operation = await prisma.operation.create({
    data: {
      customerId: graph.customerId,
      addressId: graph.addressId,
      equipmentId: graph.equipmentId,
      operatorId: actor.id,
      type: OperationType.CORRETIVA,
      status: OperationStatus.DRAFT,
      checklist: [],
    },
  });
  return { id: operation.id, ...graph };
}

export async function createProductWithInventory(organizationId: string, currentQuantity = 0): Promise<{ productId: string; inventoryItemId: string }> {
  const product = await prisma.product.create({
    data: {
      sku: testId('SKU').slice(0, 80),
      name: 'Filtro G4',
      unit: 'UN',
      isActive: true,
    },
  });
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      productId: product.id,
      currentQuantity,
      minimumQuantity: 0,
      idealQuantity: 0,
      reservedQuantity: 0,
      availableQuantity: currentQuantity,
      location: null,
      isActive: true,
    },
  });
  return { productId: product.id, inventoryItemId: item.id };
}

export async function createFinancialEntryFixture(actor: AuthenticatedUser, amount = 100): Promise<{ accountId: string; categoryId: string; entryId: string }> {
  const org = await createOrganization();
  const account = await prisma.financialAccount.create({
    data: {
      organizationId: org.id,
      name: testId('Banco'),
      type: FinancialAccountType.BANK,
      openingBalance: 0,
      currentBalance: 0,
      active: true,
    },
  });
  const category = await prisma.financialCategory.create({
    data: {
      organizationId: org.id,
      name: testId('Receita'),
      type: FinancialCategoryType.INCOME,
      active: true,
    },
  });
  const entry = await prisma.financialEntry.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      categoryId: category.id,
      type: FinancialEntryType.RECEIVABLE,
      origin: FinancialEntryOrigin.MANUAL,
      amount,
      dueDate: new Date(),
      description: testId('Entrada'),
      status: FinancialEntryStatus.PENDING,
      createdBy: actor.id,
    },
  });
  return { accountId: account.id, categoryId: category.id, entryId: entry.id };
}

export async function createSupplierProductPurchase(
  actor: AuthenticatedUser,
  organizationId: string,
  quantity = 10,
): Promise<{ orderId: string; itemId: string; productId: string }> {
  const supplier = await prisma.supplier.create({
    data: {
      legalName: testId('Fornecedor'),
      document: testId('doc').slice(0, 30),
      isActive: true,
    },
  });
  const product = await prisma.product.create({
    data: { sku: testId('PO-SKU').slice(0, 80), name: 'Compressor', unit: 'UN', isActive: true },
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      organizationId,
      supplierId: supplier.id,
      createdBy: actor.id,
      status: PurchaseOrderStatus.SENT,
    },
  });
  const item = await prisma.purchaseOrderItem.create({
    data: {
      purchaseOrderId: order.id,
      productId: product.id,
      quantity,
      unit: 'UN',
      snapshotCost: 100,
      snapshotDescription: 'Compressor',
    },
  });
  return { orderId: order.id, itemId: item.id, productId: product.id };
}

export async function createPricingFixture(organizationId: string): Promise<{ productId: string }> {
  const product = await prisma.product.create({
    data: { sku: testId('PRICE').slice(0, 80), name: 'Sensor', unit: 'UN', isActive: true },
  });
  await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return { productId: product.id };
}

export async function createBudgetFixture(actor: AuthenticatedUser): Promise<{ budgetId: string; operationId: string; productId: string }> {
  const org = await createOrganization();
  const op = await createOperation(actor);
  const product = await prisma.product.create({
    data: { sku: testId('BUD').slice(0, 80), name: 'Peça orçamento', unit: 'UN', isActive: true },
  });
  await prisma.productPricing.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      costPrice: 50,
      replacementCost: 55,
      averageCost: 50,
      salePrice: 100,
      minimumSalePrice: 80,
      suggestedSalePrice: 110,
      marginPercentage: 50,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      active: true,
    },
  });
  const budget = await prisma.budget.create({
    data: {
      organizationId: org.id,
      operationId: op.id,
      customerId: op.customerId,
      customerAddressId: op.addressId,
      equipmentId: op.equipmentId,
      title: testId('Budget'),
      introduction: 'Integration budget',
      amountInWords: 'cem reais',
      status: BudgetStatus.PENDING,
      subtotal: 100,
      total: 100,
      expirationDate: new Date('2026-12-31T00:00:00.000Z'),
      createdBy: actor.id,
      items: {
        create: {
          productId: product.id,
          description: 'Peça orçamento',
          quantity: 1,
          unit: 'UN',
          unitPrice: 100,
          snapshotCost: 50,
          snapshotSalePrice: 100,
          snapshotMargin: 50,
          total: 100,
        },
      },
    },
  });
  return { budgetId: budget.id, operationId: op.id, productId: product.id };
}

export async function createMaintenanceFixture(actor: AuthenticatedUser): Promise<{ planId: string; executionId: string; operationId: string }> {
  const op = await createOperation(actor);
  const plan = await prisma.maintenancePlan.create({
    data: {
      equipmentId: op.equipmentId,
      name: testId('Plano'),
      type: MaintenancePlanType.PREVENTIVE,
      active: true,
      priority: MaintenancePriority.MEDIUM,
      recurrenceRule: { frequency: 'MONTHLY', interval: 1 },
      firstExecution: new Date('2026-01-31T00:00:00.000Z'),
      nextExecution: new Date('2026-01-31T00:00:00.000Z'),
      createdBy: actor.id,
    },
  });
  const execution = await prisma.maintenanceExecution.create({
    data: {
      maintenancePlanId: plan.id,
      operationId: op.id,
      scheduledAt: new Date('2026-01-31T00:00:00.000Z'),
    },
  });
  return { planId: plan.id, executionId: execution.id, operationId: op.id };
}

export function settledFailures(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result): unknown => result.reason);
}

export function settledSuccesses<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.filter((result): result is PromiseFulfilledResult<T> => result.status === 'fulfilled').map((result) => result.value);
}

export const stockIn = StockMovementType.IN;

export function decimal(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export class ControlledStorage implements StorageProviderContract {
  readonly files = new Map<string, Buffer>();
  readonly saves: string[] = [];
  readonly deletes: string[] = [];
  failSave = false;
  failGet = false;
  afterSave?: (file: StoredFile) => Promise<void>;
  private saveBarrier: { target: number; resolve?: () => void; promise: Promise<void> } | null = null;

  setSaveBarrier(target: number): void {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.saveBarrier = { target, resolve, promise };
  }

  async save(input: StorageSaveInput): Promise<StoredFile> {
    if (this.failSave) throw new Error('controlled storage save failure');
    this.saves.push(input.storageKey);
    if (this.saveBarrier) {
      if (this.saves.length >= this.saveBarrier.target) this.saveBarrier.resolve?.();
      await this.saveBarrier.promise;
    }
    this.files.set(input.storageKey, input.content);
    const file = { storageKey: input.storageKey, content: input.content };
    await this.afterSave?.(file);
    return file;
  }

  get(storageKey: string): Promise<StoredFile> {
    if (this.failGet || !this.files.has(storageKey)) throw new Error('controlled storage get failure');
    return Promise.resolve({ storageKey, content: this.files.get(storageKey)! });
  }

  delete(storageKey: string): Promise<void> {
    this.deletes.push(storageKey);
    this.files.delete(storageKey);
    return Promise.resolve();
  }

  exists(storageKey: string): Promise<boolean> {
    return Promise.resolve(this.files.has(storageKey));
  }
}

export function createDocumentEngine(storage = new ControlledStorage()): {
  documents: DocumentEngineService;
  builder: DocumentBuilderService;
  storage: ControlledStorage;
} {
  const assets = new DocumentAssetResolver(storage, { warn() {} } as never);
  const configuration = new DocumentConfigurationService(prisma as never);
  const contextService = new DocumentContextService(prisma as never, configuration, assets);
  const builder = new DocumentBuilderService(contextService);
  const measure = new DocumentMeasureService();
  const layout = new LayoutEngine(measure);
  const renderer = new DocumentRendererService(layout);
  const pdf = new PdfEngineService();
  const logger = new AppLoggerService({ appName: 'test', logLevel: 'error' } as never);
  const lifecycle = new LifecyclePublisher(prisma as never);
  return {
    documents: new DocumentEngineService(
      prisma as never,
      builder,
      renderer,
      pdf,
      logger,
      assets,
      lifecycle,
      new OperationAccessService(prisma as never),
    ),
    builder,
    storage,
  };
}
