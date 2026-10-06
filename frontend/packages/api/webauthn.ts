/**
 * Login por biometria do aparelho (passkeys / WebAuthn).
 *
 * O aparelho guarda a chave privada e só a usa com biometria (ou PIN); a API
 * confere a assinatura. Nada da biometria sai do aparelho.
 */
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "./client";
import { setTokens } from "./tokens";
import type { AuthTokens } from "@erp/types";

export type Passkey = {
  id: string;
  deviceName: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

/** O recurso está ligado na API (WEBAUTHN_RP_ID configurado)? */
export async function isEnabled(): Promise<boolean> {
  try {
    const status = await api.get<{ enabled: boolean }>("/auth/webauthn/status", { auth: false });
    return status.enabled;
  } catch {
    return false;
  }
}

/** Este aparelho tem biometria/PIN utilizável pelo navegador? */
export async function deviceSupportsBiometrics(): Promise<boolean> {
  if (typeof window === "undefined" || !browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/** Nome amigável do aparelho para a lista de "aparelhos com biometria". */
export function guessDeviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Celular Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Computador Windows";
  return "Este aparelho";
}

/**
 * Traduz o erro do navegador/aparelho para uma mensagem ao usuário (cancelou,
 * aparelho já cadastrado…). Erros da API seguem como estão.
 */
export function biometricErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") return "Biometria cancelada ou não confirmada.";
    if (error.name === "InvalidStateError") return "Este aparelho já está cadastrado para entrar com biometria.";
    if (error.name === "SecurityError") return "Biometria indisponível neste endereço. Use o app pelo endereço oficial (https).";
    if ("code" in error && typeof (error as { message?: string }).message === "string") return error.message;
  }
  return fallback;
}

/** Cadastra a biometria deste aparelho para o usuário logado. */
export async function registerThisDevice(deviceName: string = guessDeviceName()): Promise<Passkey> {
  const { challengeId, options } = await api.post<{
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }>("/auth/webauthn/registration/options");
  const response = await startRegistration({ optionsJSON: options });
  return api.post<Passkey>("/auth/webauthn/registration/verify", { challengeId, response, deviceName });
}

/** Entra com a biometria do aparelho; guarda a sessão como o login por senha. */
export async function loginWithBiometrics(channel: "PLATFORM" | "OPERATOR"): Promise<void> {
  const { challengeId, options } = await api.post<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/auth/webauthn/authentication/options", undefined, { auth: false });
  const response = await startAuthentication({ optionsJSON: options });
  const tokens = await api.post<AuthTokens>(
    "/auth/webauthn/authentication/verify",
    { challengeId, response, channel },
    { auth: false },
  );
  setTokens(tokens);
}

export function listPasskeys(opts?: { signal?: AbortSignal }): Promise<Passkey[]> {
  return api.get<Passkey[]>("/auth/webauthn/credentials", opts);
}

export function deletePasskey(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/auth/webauthn/credentials/${id}`);
}
