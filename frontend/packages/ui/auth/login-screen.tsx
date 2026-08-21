"use client";

/**
 * Shared login screen. Same form + session logic for both apps; `variant`
 * changes only the identity (Platform = administrative, Operator = field app).
 * Each app renders this under its own scoped AuthProvider, so sessions stay
 * isolated.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { useAuth } from "./auth-provider";
import { BrandLogo } from "../brand";
import { ApiClientError } from "@erp/api";

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: "E-mail ou senha incorretos.",
  AUTH_USER_INACTIVE: "Usuário desativado. Procure um administrador.",
  AUTH_LOGIN_CHANNEL_FORBIDDEN: "Este usuário deve acessar o ambiente correspondente ao seu perfil.",
  RATE_LIMIT_EXCEEDED: "Muitas tentativas. Aguarde alguns instantes.",
  VALIDATION_ERROR: "Informe um e-mail e uma senha válidos.",
};

type Variant = "platform" | "operator";

const COPY: Record<Variant, { title: string; subtitle: string; home: string; change: string }> = {
  platform: {
    title: "Acessar plataforma",
    subtitle: "Gestão · OWNER e MANAGER.",
    home: "/inicio",
    change: "/trocar-senha",
  },
  operator: {
    title: "Operador de campo",
    subtitle: "Acesse para iniciar seus atendimentos.",
    home: "/operator",
    change: "/operator/trocar-senha",
  },
};

function LoginForm({ variant }: { variant: Variant }) {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const copy = COPY[variant];
  const next = params.get("next") ?? copy.home;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
    else if (status === "password-change") router.replace(copy.change);
  }, [status, next, router, copy.change]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : "UNKNOWN_ERROR";
      setError(ERROR_MESSAGES[code] ?? "Não foi possível entrar. Tente novamente.");
      setSubmitting(false);
    }
  }

  const isOperator = variant === "operator";

  return (
    <div className="min-h-dvh grid place-items-center bg-[var(--color-background)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <BrandLogo height={56} className="rounded-[var(--radius-lg)]" />
          <h1 className="text-page-title mt-5">{copy.title}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{copy.subtitle}{isOperator ? " · app de campo" : ""}</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-card)] space-y-4">
          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">E-mail</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-11 text-sm outline-none focus:border-[var(--color-primary)]" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Senha</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-11 text-sm outline-none focus:border-[var(--color-primary)]" />
          </label>
          <button type="submit" disabled={submitting || !email || !password} className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] h-11 text-sm font-semibold disabled:opacity-50 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-hover)] transition-shadow active:scale-[0.99]">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Entrar
          </button>
        </form>

        <p className="text-center text-[11px] text-[var(--color-muted-foreground)] mt-6">
          {isOperator ? "App de campo · sessão independente" : "Acesso restrito · sessão protegida por token"}
        </p>
      </div>
    </div>
  );
}

export function LoginScreen({ variant }: { variant: Variant }) {
  return (
    <Suspense fallback={null}>
      <LoginForm variant={variant} />
    </Suspense>
  );
}
