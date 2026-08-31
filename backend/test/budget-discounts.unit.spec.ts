import { BudgetItemSource, BudgetItemType } from '@prisma/client';
import { BudgetsService } from '../src/modules/budgets/budgets.service';

describe('Budget scoped discounts', () => {
  const service = new BudgetsService({} as never, {} as never, {} as never);
  const calculate = (
    service as unknown as {
      calculateTotals: (
        items: Array<Record<string, unknown>>,
        input: Record<string, number | undefined>,
      ) => Record<string, string>;
    }
  ).calculateTotals.bind(service);
  const items = [
    {
      productId: null,
      type: BudgetItemType.SERVICE,
      source: BudgetItemSource.MANUAL,
      description: 'Higienização',
      quantity: 1,
      unit: 'SERV',
      unitPrice: '800.00',
      sortOrder: 0,
      snapshotCost: '0.00',
      snapshotSalePrice: '800.00',
      snapshotMargin: '0.00',
      total: '800.00',
    },
    {
      productId: null,
      type: BudgetItemType.MATERIAL,
      source: BudgetItemSource.MANUAL,
      description: 'Filtro',
      quantity: 2,
      unit: 'UN',
      unitPrice: '100.00',
      sortOrder: 1,
      snapshotCost: '0.00',
      snapshotSalePrice: '100.00',
      snapshotMargin: '0.00',
      total: '200.00',
    },
  ];

  it('subtracts service and material discounts from the official total', () => {
    expect(calculate(items, { serviceDiscount: 80, materialDiscount: 20 })).toMatchObject({
      serviceSubtotal: '800.00',
      materialSubtotal: '200.00',
      serviceDiscount: '80.00',
      materialDiscount: '20.00',
      discount: '100.00',
      total: '900.00',
    });
  });

  it('rejects a discount greater than its category subtotal', () => {
    expect(() => calculate(items, { serviceDiscount: 801, materialDiscount: 0 })).toThrow(
      'O desconto dos serviços não pode superar o subtotal dos serviços',
    );
    expect(() => calculate(items, { serviceDiscount: 0, materialDiscount: 201 })).toThrow(
      'O desconto dos materiais não pode superar o subtotal dos materiais',
    );
  });

  it('keeps the legacy aggregate contract compatible by allocating services first', () => {
    expect(calculate(items, { discount: 850 })).toMatchObject({
      serviceDiscount: '800.00',
      materialDiscount: '50.00',
      discount: '850.00',
      total: '150.00',
    });
  });
});
