import { RequireAuth } from '@erp/ui/auth/require-auth';
import { OperatorBudgetWizard } from '@operator/features/budgets/operator-budget-wizard';

export default async function OperatorBudgetPage({ searchParams }: { searchParams: Promise<{ budgetId?: string }> }) {
  const { budgetId } = await searchParams;
  return (
    <RequireAuth roles={['OWNER']} fallbackPath="/operator">
      <OperatorBudgetWizard initialBudgetId={budgetId} />
    </RequireAuth>
  );
}
