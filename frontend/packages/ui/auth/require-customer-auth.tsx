'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useCustomerAuth } from './customer-auth-provider';

export function RequireCustomerAuth({ children }: { children: ReactNode }) {
  const { status } = useCustomerAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/customer/login?next=${encodeURIComponent(pathname)}`);
    if (status === 'password-change') router.replace('/customer/change-password');
  }, [status, router, pathname]);
  if (status !== 'authenticated') return <div className="min-h-dvh grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" /></div>;
  return <>{children}</>;
}
