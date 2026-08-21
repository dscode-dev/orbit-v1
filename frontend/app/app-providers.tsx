"use client";

/**
 * AppProviders — selects the correct application context by route.
 *
 * Platform and Operator are independent apps that share only the backend and
 * design system. Here they are served from one Next.js runtime, so the active
 * app is chosen by pathname and gets its OWN scoped AuthProvider (separate
 * session, separate localStorage namespace). State is never shared between them.
 *
 * The CommandPalette (global search) belongs to the Platform only.
 */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider } from "@erp/ui/auth/auth-provider";
import { CommandPaletteProvider } from "@platform/components/command-palette";
import { CustomerAuthProvider } from "@erp/ui/auth/customer-auth-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Match the Operator route segment, not Platform routes that merely share
  // the prefix (for example `/operator-executions`).
  const isOperator = pathname === "/operator" || pathname?.startsWith("/operator/") === true;
  const isCustomer = pathname === "/customer" || pathname?.startsWith("/customer/") === true;

  if (isCustomer) {
    return <CustomerAuthProvider>{children}</CustomerAuthProvider>;
  }

  if (isOperator) {
    return <AuthProvider scope="operator">{children}</AuthProvider>;
  }

  return (
    <AuthProvider scope="platform">
      <CommandPaletteProvider>{children}</CommandPaletteProvider>
    </AuthProvider>
  );
}
