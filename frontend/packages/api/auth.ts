/** Authentication endpoints. */
import { api, apiRequest } from "./client";
import { clearTokens, getRefreshToken, getSessionScope, setTokens } from "./tokens";
import type { AuthTokens, LoginPayload } from "@erp/types";

/** POST /auth/login — stores tokens on success. */
export async function login(payload: LoginPayload): Promise<AuthTokens> {
  const scope = getSessionScope();
  const endpoint = scope === "platform" ? "/auth/login" : `/auth/${scope}/login`;
  const tokens = await apiRequest<AuthTokens>(endpoint, {
    method: "POST",
    body: payload,
    auth: false,
  });
  setTokens(tokens);
  return tokens;
}

/** POST /auth/logout — best-effort revoke, always clears local tokens. */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await api.post<{ revoked: boolean }>("/auth/logout", { refreshToken });
    }
  } catch {
    // Logout is best-effort; tokens are cleared regardless.
  } finally {
    clearTokens();
  }
}
