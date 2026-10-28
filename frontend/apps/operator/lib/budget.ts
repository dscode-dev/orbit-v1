import { budgetsApi, type Budget } from '@erp/api';

/** Generating a commercial proposal never records a customer's acceptance. */
export async function renderOperatorBudget(id: string, onLoaded: (budget: Budget) => void): Promise<void> {
  const budget = await budgetsApi.getBudget(id);
  onLoaded(budget);
  await budgetsApi.renderBudget(id);
}

/** Called only after the owner explicitly confirms the customer's acceptance. */
export async function confirmOperatorBudgetAcceptance(id: string, onApproved: (budget: Budget) => void): Promise<void> {
  let budget = await budgetsApi.getBudget(id);
  if (budget.status !== 'APPROVED') budget = await budgetsApi.approveBudget(id);
  onApproved(budget);
  await budgetsApi.renderBudget(id);
}
