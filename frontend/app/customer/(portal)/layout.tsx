import type { ReactNode } from 'react';
import { RequireCustomerAuth } from '@erp/ui/auth/require-customer-auth';

export default function CustomerPortalLayout({ children }: { children: ReactNode }) {
  return <RequireCustomerAuth>{children}</RequireCustomerAuth>;
}
