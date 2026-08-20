"use client";

/**
 * Route guard for an authenticated shell. Paths default from the active session
 * scope (platform → /login, operator → /operator/login) and can be overridden.
 *
 * - `loading`         → full-screen spinner;
 * - `unauthenticated` → redirect to the scope's login;
 * - `password-change` → redirect to the scope's mandatory password screen;
 * - role mismatch     → redirect to `fallbackPath` (defense in depth; backend is authority).
 */
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "./auth-provider";
import type { Role } from "@erp/api";

function FullScreenLoader() {
  return (
    <div className="min-h-dvh grid place-items-center bg-[var(--color-background)] text-[var(--color-muted-foreground)]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
        <span className="text-sm">Carregando sessão…</span>
      </div>
    </div>
  );
}

export function RequireAuth({
  children,
  roles,
  fallbackPath,
  loginPath,
  changePasswordPath,
}: {
  children: ReactNode;
  roles?: Role[];
  /** Where to send a user whose role is not allowed here. */
  fallbackPath?: string;
  loginPath?: string;
  changePasswordPath?: string;
}) {
  const { status, role, scope } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const base = scope === "operator" ? "/operator" : scope === "customer" ? "/customer" : "";
  const login = loginPath ?? `${base}/login`;
  const change = changePasswordPath ?? `${base}/trocar-senha`;
  const home = fallbackPath ?? `${base}/`;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`${login}?next=${encodeURIComponent(pathname)}`);
    } else if (status === "password-change") {
      router.replace(change);
    } else if (status === "authenticated" && roles && role && !roles.includes(role)) {
      router.replace(home);
    }
  }, [status, role, roles, router, pathname, login, change, home]);

  if (status !== "authenticated") return <FullScreenLoader />;
  if (roles && role && !roles.includes(role)) return <FullScreenLoader />;

  return <>{children}</>;
}
