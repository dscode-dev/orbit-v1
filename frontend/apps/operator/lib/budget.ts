import { budgetsApi, type Budget } from '@erp/api';

/** Re-read the decision on every retry: approval may have succeeded before a network failure. */
export async function approveAndRenderOperatorBudget(
  id: string,
  onApproved: (budget: Budget) => void,
): Promise<void> {
  let budget = await budgetsApi.getBudget(id);
  if (budget.status !== 'APPROVED') budget = await budgetsApi.approveBudget(id);
  onApproved(budget);
  await budgetsApi.renderBudget(id);
}
