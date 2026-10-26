import { RequireAuth } from '@erp/ui/auth/require-auth';
import { OperatorBudgetWizard } from '@operator/features/budgets/operator-budget-wizard';

export default function OperatorBudgetPage() {
  return (
    <RequireAuth roles={['OWNER']} fallbackPath="/operator">
      <OperatorBudgetWizard />
    </RequireAuth>
  );
}
