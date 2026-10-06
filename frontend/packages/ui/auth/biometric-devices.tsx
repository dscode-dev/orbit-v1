"use client";

/**
 * Biometria do aparelho (passkeys): convite para ativar e lista de aparelhos.
 * Só aparece quando o recurso está ligado na API (WEBAUTHN_RP_ID) e o aparelho
 * tem biometria/PIN utilizável pelo navegador.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Fingerprint, Loader2, Smartphone, Trash2, X } from "lucide-react";
import { webauthnApi, type Passkey } from "@erp/api";
import { formatDateTime } from "@erp/utils";
import { useAuth } from "./auth-provider";

/**
 * - available: recurso ligado e aparelho com biometria;
 * - insecure: recurso ligado, mas a página não está em conexão segura (http
 *   por IP) — o navegador esconde a biometria; só funciona via https/localhost;
 * - unavailable: recurso desligado na API ou aparelho sem biometria.
 */
type Availability = "checking" | "available" | "insecure" | "unavailable";

/** Recurso ligado na API e aparelho com biometria? */
export function useBiometricAvailability(): Availability {
  const [state, setState] = useState<Availability>("checking");
  useEffect(() => {
    let alive = true;
    Promise.all([webauthnApi.isEnabled(), webauthnApi.deviceSupportsBiometrics()])
      .then(([enabled, supported]) => {
        if (!alive) return;
        if (enabled && !window.isSecureContext) setState("insecure");
        else setState(enabled && supported ? "available" : "unavailable");
      })
      .catch(() => alive && setState("unavailable"));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

const dismissKey = (userId: string) => `erp.biometric.prompt-dismissed.${userId}`;

/**
 * Convite logo após o login (inclusive no primeiro acesso): "entrar com
 * biometria neste aparelho?". Some quando o usuário ativa ou recusa.
 */
export function BiometricEnrollPrompt() {
  const { session } = useAuth();
  const availability = useBiometricAvailability();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    if (availability !== "available" || !userId) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(dismissKey(userId)) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;
    // Só convida quem ainda não tem nenhum aparelho cadastrado.
    webauthnApi
      .listPasskeys()
      .then((items) => setVisible(items.length === 0))
      .catch(() => setVisible(false));
  }, [availability, userId]);

  function dismiss() {
    if (userId) {
      try {
        localStorage.setItem(dismissKey(userId), "1");
      } catch {
        // Sem armazenamento local: o convite volta no próximo acesso.
      }
    }
    setVisible(false);
  }

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      await webauthnApi.registerThisDevice();
      setDone(true);
      setTimeout(() => setVisible(false), 2500);
    } catch (cause) {
      setError(webauthnApi.biometricErrorMessage(cause, "Não foi possível ativar a biometria."));
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <section className="relative rounded-[var(--radius-lg)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.06] p-4 shadow-[var(--shadow-card)]">
      {!done && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Agora não"
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-start gap-3 pr-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)]">
          {done ? <Check className="h-5 w-5" /> : <Fingerprint className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {done ? "Biometria ativada neste aparelho" : "Entrar mais rápido com biometria?"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
            {done
              ? "No próximo acesso, toque em “Entrar com biometria”."
              : "Use digital ou reconhecimento facial deste aparelho em vez de digitar a senha. A biometria não sai do aparelho."}
          </p>
          {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
          {!done && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void activate()}
                disabled={busy}
                className="inline-flex h-9 shrink-0 whitespace-nowrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                Ativar biometria
              </button>
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                className="h-9 whitespace-nowrap rounded-[var(--radius-md)] px-3 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              >
                Agora não
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Biometria ligada, mas a página não está em conexão segura (http por IP). */
export function InsecureHint() {
  return (
    <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
      A biometria só funciona com o app aberto pelo endereço seguro (https). Por este endereço, use e-mail e senha.
    </p>
  );
}

/** Lista de aparelhos com biometria do usuário: cadastrar este e remover. */
export function BiometricDevices() {
  const availability = useBiometricAvailability();
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const load = useCallback(() => {
    webauthnApi
      .listPasskeys()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    webauthnApi.isEnabled().then((on) => {
      setEnabled(on);
      if (on) load();
    });
  }, [load]);

  // Recurso desligado na API: a seção nem aparece.
  if (enabled !== true) return null;

  async function addThisDevice() {
    setBusy("add");
    setError(null);
    try {
      await webauthnApi.registerThisDevice();
      load();
    } catch (cause) {
      setError(webauthnApi.biometricErrorMessage(cause, "Não foi possível cadastrar este aparelho."));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await webauthnApi.deletePasskey(id);
      load();
    } catch (cause) {
      setError(webauthnApi.biometricErrorMessage(cause, "Não foi possível remover o aparelho."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Fingerprint className="h-4 w-4 text-[var(--color-primary)]" /> Entrar com biometria
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
            Aparelhos onde você entra com digital ou rosto. Remova os que não usa mais.
          </p>
        </div>
        {availability === "available" && (
          <button
            type="button"
            onClick={() => void addThisDevice()}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            Cadastrar este aparelho
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      {availability === "insecure" && <InsecureHint />}
      {items === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
      ) : items.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-3 text-center text-xs text-[var(--color-muted-foreground)]">
          {availability === "available"
            ? "Nenhum aparelho cadastrado. Cadastre este para entrar sem digitar a senha."
            : "Nenhum aparelho cadastrado. Abra o app no celular para cadastrar a biometria."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
          {items.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 px-3 py-2.5">
              <Smartphone className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{passkey.deviceName}</p>
                <p className="text-[11px] text-[var(--color-muted-foreground)]">
                  Cadastrado em {formatDateTime(passkey.createdAt)}
                  {passkey.lastUsedAt ? ` · último uso ${formatDateTime(passkey.lastUsedAt)}` : " · ainda não usado"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(passkey.id)}
                disabled={busy !== null}
                aria-label={`Remover ${passkey.deviceName}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
              >
                {busy === passkey.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
