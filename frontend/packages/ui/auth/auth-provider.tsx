"use client";

/**
 * Session + RBAC provider.
 *
 * Owns the authenticated session for the whole app:
 * - bootstraps from `GET /users/me` when a token exists;
 * - exposes user, organization, role and permission flags;
 * - drives the navigation gate (`mustChangePassword`, expiry);
 * - applies white-label branding (organization colors) to the theme.
 *
 * RBAC is intentionally a UI concern only. The backend remains the authority:
 * 401/403 responses are handled by the API client and surfaced here. Never use
 * these helpers as a security boundary.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, usersApi, setSessionScope, type SessionScope } from "@erp/api";
import { clearTokens, ensureFreshSession, hasSession, onSessionInvalid } from "@erp/api";
import type { Role, SessionUser, UserPermissions } from "@erp/api";

export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "password-change";

type AuthContextValue = {
  /** Which application this session belongs to. */
  scope: SessionScope;
  status: SessionStatus;
  session: SessionUser | null;
  role: Role | null;
  permissions: UserPermissions | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /users/me (e.g. after profile/preference changes). */
  refresh: () => Promise<void>;
  /** Permission flag check (OWNER effective flags are always true). */
  can: (flag: keyof UserPermissions) => boolean;
  /** Role membership check. */
  hasRole: (...roles: Role[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Apply white-label branding (organization colors) to the live theme.
 * Exported so the Settings screen can preview/persist changes instantly.
 */
export function applyBranding(primary?: string, secondary?: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (primary && HEX.test(primary)) {
    root.style.setProperty("--color-primary", primary);
    root.style.setProperty("--color-ring", primary);
  }
  if (secondary && HEX.test(secondary)) root.style.setProperty("--color-accent", secondary);
}

export function AuthProvider({ scope = "platform", children }: { scope?: SessionScope; children: ReactNode }) {
  // Bind the API token store to this app's scope BEFORE any token access.
  // Runs on every render (idempotent) and, crucially, before the mount effect.
  setSessionScope(scope);

  const [status, setStatus] = useState<SessionStatus>("loading");
  const [session, setSession] = useState<SessionUser | null>(null);

  const loadSession = useCallback(async () => {
    if (!hasSession()) {
      setSession(null);
      setStatus("unauthenticated");
      return;
    }
    try {
      const me = await usersApi.getMe();
      const allowed = scope === "operator"
        ? me.role === "OPERATOR"
        : scope === "customer"
          ? me.role === "CUSTOMER"
          : ["OWNER", "MANAGER", "VIEWER"].includes(me.role);
      if (!allowed) {
        clearTokens();
        setSession(null);
        setStatus("unauthenticated");
        return;
      }
      setSession(me);
      applyBranding(me.organization.primaryColor, me.organization.secondaryColor);
      setStatus(me.user.mustChangePassword ? "password-change" : "authenticated");
    } catch {
      // API client already cleared tokens / emitted on fatal errors.
      setSession(null);
      setStatus("unauthenticated");
    }
  }, [scope]);

  // Bootstrap on mount.
  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // React to session invalidation raised anywhere in the API layer.
  useEffect(() => {
    return onSessionInvalid((reason) => {
      if (reason === "password-change") {
        setStatus((s) => (s === "authenticated" ? "password-change" : s));
      } else {
        setSession(null);
        setStatus("unauthenticated");
      }
    });
  }, []);

  // Renovação proativa da sessão: mantém o access token fresco enquanto o app
  // está aberto e renova imediatamente ao voltar o foco/visibilidade — evita o
  // "voltei para a página e caí no login" quando o access expirou em segundo
  // plano (o refresh token continua válido).
  useEffect(() => {
    const tick = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void ensureFreshSession();
      }
    };
    tick();
    const interval = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ensureFreshSession();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await authApi.login({ email, password });
      await loadSession();
    },
    [loadSession],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const can = useCallback(
    (flag: keyof UserPermissions) => {
      if (!session) return false;
      if (session.role === "OWNER") return true;
      return Boolean(session.permissions?.[flag]);
    },
    [session],
  );

  const hasRole = useCallback(
    (...roles: Role[]) => (session ? roles.includes(session.role) : false),
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      scope,
      status,
      session,
      role: session?.role ?? null,
      permissions: session?.permissions ?? null,
      login,
      logout,
      refresh: loadSession,
      can,
      hasRole,
    }),
    [scope, status, session, login, logout, loadSession, can, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
