/**
 * Core HTTP client for the ERP backend.
 *
 * Responsibilities:
 * - prefix every request with the configured base URL (`/api/v1`);
 * - attach `Authorization: Bearer <accessToken>` and a fresh `X-Request-Id`;
 * - unwrap the `{ success, data }` envelope and raise a typed `ApiClientError`;
 * - on 401, attempt a single-flight refresh and replay the request once;
 * - notify the session layer when the session is irrecoverable.
 *
 * Components must never call `fetch` directly — always go through the domain
 * modules in `lib/api/*`, which build on this client.
 */
import type { ApiErrorBody } from "@erp/types";
import { clearTokens, getAccessToken, getRefreshToken, getSessionScope, setTokens } from "./tokens";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NODE_ENV === "production" ? "/api/v1" : "http://localhost:3000/api/v1")
).replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(args.message);
    this.name = "ApiClientError";
    this.code = args.code;
    this.status = args.status;
    this.details = args.details ?? {};
    this.requestId = args.requestId ?? null;
  }

  /** True when the session can no longer recover and the user must re-login. */
  get isSessionFatal(): boolean {
    return (
      this.status === 401 ||
      this.code === "AUTH_SESSION_REVOKED" ||
      this.code === "AUTH_USER_INACTIVE" ||
      this.code === "AUTH_INVALID_TOKEN"
    );
  }

  get isForbidden(): boolean {
    return this.status === 403 && this.code !== "PASSWORD_CHANGE_REQUIRED";
  }

  get requiresPasswordChange(): boolean {
    return this.code === "PASSWORD_CHANGE_REQUIRED";
  }
}

/** Listeners invoked when the session becomes invalid (used by the auth provider). */
type SessionListener = (reason: "expired" | "password-change") => void;
const sessionListeners = new Set<SessionListener>();

export function onSessionInvalid(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function emitSessionInvalid(reason: "expired" | "password-change") {
  sessionListeners.forEach((l) => l(reason));
}

function requestId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ---------- single-flight refresh ---------- */

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refresh com rotação segura:
 * - single-flight dentro da aba (uma renovação por vez);
 * - serializado ENTRE abas via Web Locks (mesmo escopo de sessão), evitando a
 *   corrida em que duas abas rotacionam o mesmo refresh token;
 * - ao entrar no lock, se outra aba já renovou (access token mudou), reutiliza
 *   o resultado sem chamar o endpoint.
 */
async function refreshSession(): Promise<boolean> {
  if (!getRefreshToken()) return false;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const accessBefore = getAccessToken();
        const run = () => performRefresh(accessBefore);
        const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
        if (locks?.request) {
          return await locks.request(`erp.session.refresh.${getSessionScope()}`, run);
        }
        return await run();
      } catch {
        return false;
      } finally {
        // Cleared on the next tick so concurrent callers share this resolution.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }

  return refreshInFlight;
}

async function performRefresh(accessBefore: string | null): Promise<boolean> {
  // Outra aba pode ter renovado enquanto aguardávamos o lock.
  const currentAccess = getAccessToken();
  if (currentAccess && currentAccess !== accessBefore && !tokenNearExpiry(currentAccess)) {
    return true;
  }
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const refreshPath = getSessionScope() === "customer" ? "/customer/auth/refresh" : "/auth/refresh";
    const res = await fetch(`${API_BASE_URL}${refreshPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId() },
      body: JSON.stringify({ refreshToken }),
    });
    const body = (await res.json().catch(() => null)) as
      | { success: true; data: { accessToken: string; refreshToken: string } }
      | ApiErrorBody
      | null;
    if (res.ok && body && body.success) {
      setTokens({
        accessToken: body.data.accessToken,
        refreshToken: body.data.refreshToken,
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Segundos até o `exp` do JWT; null quando o token não é decodificável. */
function tokenSecondsToExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp - Math.floor(Date.now() / 1000);
  } catch {
    return null;
  }
}

function tokenNearExpiry(token: string, thresholdSeconds = 120): boolean {
  const remaining = tokenSecondsToExpiry(token);
  return remaining !== null && remaining <= thresholdSeconds;
}

/**
 * Renovação proativa: se o access token está expirado ou perto de expirar
 * (< 2 min) e existe refresh token, renova antes que as chamadas tomem 401.
 * Chamada pelo AuthProvider em intervalo e ao voltar o foco para a página.
 */
export async function ensureFreshSession(): Promise<void> {
  const access = getAccessToken();
  if (!access || !getRefreshToken()) return;
  if (!tokenNearExpiry(access)) return;
  // Falha aqui não desloga: pode ser rede. O fluxo de 401 das chamadas reais
  // decide quando a sessão é irrecuperável.
  await refreshSession();
}

/* ---------- request core ---------- */

export type RequestOptions = {
  method?: string;
  body?: unknown;
  /** multipart/form-data body; Content-Type is left to the browser. */
  form?: FormData;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Skip the bearer token (public endpoints such as /auth/login, /health). */
  auth?: boolean;
  /** Skip the automatic refresh+replay on 401 (used by the refresh call itself). */
  retryOnUnauthorized?: boolean;
  signal?: AbortSignal;
};

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const requestPath = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_ORIGIN ?? "http://localhost";
  const url = new URL(requestPath, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function rawRequest<T>(path: string, opts: RequestOptions): Promise<T> {
  const { method = "GET", body, form, query, auth = true, signal } = opts;

  const headers: Record<string, string> = { "X-Request-Id": requestId() };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined && !form) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal,
  });

  const responseRequestId = res.headers.get("X-Request-Id");

  // 204 / empty body
  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | ApiErrorBody
    | null;

  if (res.ok && payload && payload.success) {
    return payload.data;
  }

  const error = payload && !payload.success ? payload.error : null;
  throw new ApiClientError({
    code: error?.code ?? "UNKNOWN_ERROR",
    message: error?.message ?? `Request failed with status ${res.status}`,
    status: res.status,
    details: error?.details ?? {},
    requestId: responseRequestId,
  });
}

async function rawBlobRequest(path: string, opts: RequestOptions): Promise<{ blob: Blob; filename: string | null }> {
  const { method = "GET", query, auth = true, signal } = opts;
  const headers: Record<string, string> = { "X-Request-Id": requestId() };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(buildUrl(path, query), { method, headers, signal });
  const responseRequestId = res.headers.get("X-Request-Id");
  if (res.ok) {
    const disposition = res.headers.get("Content-Disposition");
    return { blob: await res.blob(), filename: filenameFromDisposition(disposition) };
  }
  const payload = (await res.json().catch(() => null)) as ApiErrorBody | null;
  const error = payload && !payload.success ? payload.error : null;
  throw new ApiClientError({
    code: error?.code ?? "UNKNOWN_ERROR",
    message: error?.message ?? `Request failed with status ${res.status}`,
    status: res.status,
    details: error?.details ?? {},
    requestId: responseRequestId,
  });
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, opts);
  } catch (err) {
    if (!(err instanceof ApiClientError)) throw err;

    // Password change gate — surface to the session layer and re-throw.
    if (err.requiresPasswordChange) {
      emitSessionInvalid("password-change");
      throw err;
    }

    // Attempt one transparent refresh + replay on 401.
    const canRetry = opts.auth !== false && opts.retryOnUnauthorized !== false;
    if (err.status === 401 && canRetry) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return rawRequest<T>(path, { ...opts, retryOnUnauthorized: false });
      }
      clearTokens();
      emitSessionInvalid("expired");
    }

    throw err;
  }
}

export async function apiBlobRequest(path: string, opts: RequestOptions = {}): Promise<{ blob: Blob; filename: string | null }> {
  try {
    return await rawBlobRequest(path, opts);
  } catch (err) {
    if (!(err instanceof ApiClientError)) throw err;
    if (err.requiresPasswordChange) {
      emitSessionInvalid("password-change");
      throw err;
    }
    const canRetry = opts.auth !== false && opts.retryOnUnauthorized !== false;
    if (err.status === 401 && canRetry) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return rawBlobRequest(path, { ...opts, retryOnUnauthorized: false });
      }
      clearTokens();
      emitSessionInvalid("expired");
    }
    throw err;
  }
}

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : null;
}

/* ---------- convenience verbs ---------- */

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
  upload: <T>(path: string, form: FormData, opts?: Omit<RequestOptions, "method" | "form">) =>
    apiRequest<T>(path, { ...opts, method: "POST", form }),
  blob: (path: string, opts?: Omit<RequestOptions, "method" | "body" | "form">) =>
    apiBlobRequest(path, { ...opts, method: "GET" }),
};
