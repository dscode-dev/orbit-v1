import { HttpStatus } from '@nestjs/common';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ERROR_CODES } from '../src/shared/constants/error-codes.constants';
import { ApplicationException } from '../src/shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../src/shared/types/authenticated-user.type';

const actor: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@orbit.test',
  username: 'owner',
  name: 'Owner',
  role: 'OWNER',
  isActive: true,
  mustChangePassword: false,
};

const context = { requestId: 'unit-test', ip: '127.0.0.1', userAgent: 'jest' };

function serviceWithTx(tx: Record<string, unknown>): InventoryService {
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return new InventoryService(prisma as never, {} as never, {} as never);
}

function createTx(supplier: { id: string; isActive: boolean } | null = { id: supplierId, isActive: true }): {
  product: {
    create: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  supplier: {
    findUnique: jest.Mock;
  };
  productSupplier: {
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
  organization: {
    findFirst: jest.Mock;
  };
  inventoryItem: {
    create: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
} {
  const product = { id: productId, sku: 'HVAC-FILTRO-G4-001', name: 'Filtro G4', unit: 'UN' };
  return {
    product: {
      create: jest.fn().mockResolvedValue(product),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...product,
        inventoryItems: [],
        suppliers: supplier ? [{ id: relationId, productId, supplierId: supplier.id, isPrimary: true, supplier }] : [],
      }),
    },
    supplier: {
      findUnique: jest.fn().mockResolvedValue(supplier),
    },
    productSupplier: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: relationId }),
    },
    organization: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    inventoryItem: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
    },
  };
}

const productId = '22222222-2222-4222-8222-222222222222';
const supplierId = '33333333-3333-4333-8333-333333333333';
const relationId = '44444444-4444-4444-8444-444444444444';

describe('InventoryService ProductSupplier relationship', () => {
  it('requires at least one commercial classification', async () => {
    const tx = createTx();
    const service = serviceWithTx(tx);

    await expect(
      service.createProduct(
        {
          sku: 'HVAC-INVALID-001',
          name: 'Produto sem finalidade',
          unit: 'UN',
          isPurchasable: false,
          isSellable: false,
        },
        actor,
        context,
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCT_COMMERCIAL_CLASSIFICATION_REQUIRED,
      status: HttpStatus.BAD_REQUEST,
    });
    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('persists primary supplier when creating a product', async () => {
    const tx = createTx();
    const service = serviceWithTx(tx);

    const result = await service.createProduct(
      {
        sku: 'HVAC-FILTRO-G4-001',
        name: 'Filtro G4',
        unit: 'UN',
        primarySupplierId: supplierId,
      },
      actor,
      context,
    );

    expect(tx.supplier.findUnique).toHaveBeenCalledWith({
      where: { id: supplierId },
      select: { id: true, isActive: true },
    });
    expect(tx.productSupplier.upsert).toHaveBeenCalledWith({
      where: { productId_supplierId: { productId, supplierId } },
      create: { productId, supplierId, isPrimary: true },
      update: { isPrimary: true },
    });
    expect(result).toMatchObject({
      id: productId,
      suppliers: [{ productId, supplierId, isPrimary: true }],
    });
  });

  it('rejects inactive supplier and does not persist relation', async () => {
    const tx = createTx({ id: supplierId, isActive: false });
    const service = serviceWithTx(tx);

    await expect(
      service.createProduct(
        {
          sku: 'HVAC-FILTRO-G4-002',
          name: 'Filtro G4',
          unit: 'UN',
          primarySupplierId: supplierId,
        },
        actor,
        context,
      ),
    ).rejects.toEqual(
      new ApplicationException(ERROR_CODES.SUPPLIER_NOT_FOUND, 'Fornecedor inativo', HttpStatus.CONFLICT),
    );
    expect(tx.productSupplier.upsert).not.toHaveBeenCalled();
  });
});
