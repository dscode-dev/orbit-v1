import type { ReactNode } from "react";
import { PlatformSidebar } from "@platform/components/sidebar";
import { PlatformTopbar } from "@platform/components/topbar";
import { RequireAuth } from "@erp/ui/auth/require-auth";

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={['OWNER', 'MANAGER']} fallbackPath="/operator">
      <div className="min-h-dvh flex bg-[var(--color-background)] text-[var(--color-foreground)]">
        <PlatformSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <PlatformTopbar />
          <main className="flex-1 p-6 lg:p-8 animate-fade-in">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
