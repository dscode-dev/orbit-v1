"use client";

import { LogOut, ShieldCheck, Building2, Loader2, Smartphone } from "lucide-react";
import { ThemeToggle } from "@erp/ui/theme/theme-toggle";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { InstallButton } from "@erp/ui/pwa/install-button";
import { initials } from "@erp/utils";
import { OperatorSignatureSettings } from "@operator/components/operator-signature";
import { BiometricDevices } from "@erp/ui/auth/biometric-devices";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Proprietário",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  VIEWER: "Visualizador",
};

const PERMISSION_LABEL: Record<string, string> = {
  canFinancial: "Financeiro",
  canUsers: "Usuários",
  canReports: "Relatórios",
  canSchedules: "Agendamentos",
  canTemplates: "Modelos",
};

export default function OperatorProfile() {
  const { session, logout, status } = useAuth();

  if (status !== "authenticated" || !session) {
    return (
      <div className="px-4 pt-10 flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando perfil…
      </div>
    );
  }

  const { user, organization, permissions } = session;
  const activePermissions = Object.entries(permissions).filter(([, v]) => v).map(([k]) => PERMISSION_LABEL[k] ?? k);

  return (
    <div className="px-4 pt-6 pb-24 space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-full bg-[var(--color-accent)] grid place-items-center text-white font-semibold text-lg">
          {initials(user.name)}
        </div>
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight truncate">{user.name}</h1>
          <p className="text-caption truncate">{user.email}</p>
        </div>
      </header>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)] space-y-3">
        <Row icon={<ShieldCheck className="h-4 w-4" />} label="Cargo" value={ROLE_LABEL[user.role] ?? user.role} />
        <Row icon={<Building2 className="h-4 w-4" />} label="Organização" value={organization.tradeName || organization.legalName} />
        {user.jobTitle && <Row label="Função" value={user.jobTitle} />}
        {user.phone && <Row label="Telefone" value={user.phone} />}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
        <div className="text-caption uppercase tracking-wider mb-2">Permissões</div>
        {activePermissions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Sem permissões administrativas.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activePermissions.map((p) => (
              <span key={p} className="text-[11px] rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2 py-0.5">{p}</span>
            ))}
          </div>
        )}
      </section>

      {user.role === "OPERATOR" && <OperatorSignatureSettings />}

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
        <BiometricDevices />
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)] space-y-3">
        <div className="flex items-center gap-2 text-caption uppercase tracking-wider">
          <Smartphone className="h-3.5 w-3.5" /> Aplicativo
        </div>
        <InstallButton />
      </section>

      <section className="flex items-center justify-between rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
        <span className="text-sm font-medium">Tema</span>
        <ThemeToggle />
      </section>

      <button
        type="button"
        onClick={() => logout()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)] h-11 text-sm font-semibold active:scale-[0.99]"
      >
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-2 text-caption">{icon}{label}</span>
      <span className="text-sm text-right truncate">{value}</span>
    </div>
  );
}
