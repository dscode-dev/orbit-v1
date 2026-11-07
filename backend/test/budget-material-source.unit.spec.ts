import 'reflect-metadata';

import { BudgetItemSource, BudgetItemType } from '@prisma/client';
import { BudgetsService } from '../src/modules/budgets/budgets.service';

describe('Budget material sources', () => {
  const service = new BudgetsService({} as never, {} as never, {} as never);
  const resolve = (
    service as unknown as {
      resolveSnapshotItems: (items: unknown[]) => Promise<
        Array<{ source: BudgetItemSource; quantity: number; unit: string; unitPrice: string; total: string }>
      >;
    }
  ).resolveSnapshotItems.bind(service);

  it('forces catalog descriptions to zero without changing manual commercial values', async () => {
    const items = await resolve([
      {
        type: BudgetItemType.MATERIAL,
        source: BudgetItemSource.CATALOG,
        description: 'Tubulação frigorígena',
        quantity: 2.375,
        unit: 'm',
        unitPrice: 999,
      },
      {
        type: BudgetItemType.MATERIAL,
        source: BudgetItemSource.MANUAL,
        description: 'Filtro fornecido',
        quantity: 2,
        unit: 'UN',
        unitPrice: 80,
      },
    ]);

    expect(items[0]).toMatchObject({
      source: BudgetItemSource.CATALOG,
      quantity: 2.375,
      unit: 'M',
      unitPrice: '0.00',
      total: '0.00',
    });
    expect(items[1]).toMatchObject({
      source: BudgetItemSource.MANUAL,
      unitPrice: '80.00',
      total: '160.00',
    });
  });
});
