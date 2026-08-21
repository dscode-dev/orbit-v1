/**
 * Token storage — per-session-scope.
 *
 * Platform and Operator are independent applications that must NEVER share a
 * session. Each scope persists its own access/refresh tokens under a distinct
 * localStorage namespace (`erp.platform.*` / `erp.operator.*`). The active
 * scope is set by each app's AuthProvider on mount.
 *
 * In production the two apps live on separate subdomains, so isolation is
 * physical; this scoping additionally guarantees isolation when both areas are
 * served from the same origin during development.
 */
import type { AuthTokens } from "@erp/types";

export type SessionScope = "platform" | "operator" | "customer";

let activeScope: SessionScope = "platform";

/** Set the active session scope. Called by each app's AuthProvider. */
export function setSessionScope(scope: SessionScope): void {
  activeScope = scope;
}

export function getSessionScope(): SessionScope {
  return activeScope;
}

function accessKey(scope: SessionScope = activeScope): string {
  return `erp.${scope}.accessToken`;
}
function refreshKey(scope: SessionScope = activeScope): string {
  return `erp.${scope}.refreshToken`;
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(accessKey());
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(refreshKey());
}

export function setTokens(tokens: Pick<AuthTokens, "accessToken" | "refreshToken">): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(accessKey(), tokens.accessToken);
  window.localStorage.setItem(refreshKey(), tokens.refreshToken);
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(accessKey());
  window.localStorage.removeItem(refreshKey());
}

export function hasSession(): boolean {
  return Boolean(getAccessToken());
}
