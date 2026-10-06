"use client";

/**
 * OperatorHome — field-app home powered by real Assignments.
 * This is intentionally not an admin dashboard: it prioritizes today's work,
 * large cards and fast one-handed actions.
 */
import Link from "next/link";
import { useEffect } from "react";
import { Calendar, ChevronRight, ClipboardList, FileText, Plus, QrCode, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { AssignmentCard } from "@operator/components/assignment-card";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { BiometricEnrollPrompt } from "@erp/ui/auth/biometric-devices";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { ErrorState } from "@erp/ui/states";
import { assignmentsApi, useQuery, type Assignment } from "@erp/api";
import { firstName, greeting } from "@erp/utils";

const HOME_REFRESH_MS = 30_000;

function isSameDay(iso: string | null | undefined, target = new Date()) {
  if (!iso) return false;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.toDateString() === target.toDateString();
}

function isPast(assignment: Assignment) {
  const iso = assignment.operation.scheduledFor;
  if (!iso || ["COMPLETED", "CANCELED", "REJECTED"].includes(assignment.status)) return false;
  return new Date(iso).getTime() < Date.now() && !isSameDay(iso);
}

export function OperatorHome() {
  const { session, role, can } = useAuth();
  // Sem permissão de Relatórios, o operador é somente-visualização: pode ver a
  // agenda/OS mas não inicia atendimentos que geram relatórios. Só restringe
  // operadores — owner/manager (que podem usar o app) têm acesso pleno.
  const canReports = role !== "OPERATOR" || can("canReports");
  const assignments = useQuery((signal) => assignmentsApi.listMyAssignments({ limit: 50, signal }), []);

  // Auto-atualização: novos atendimentos chegam sem o operador precisar
  // recarregar — intervalo curto + refetch ao voltar o foco para o app.
  const { refetch } = assignments;
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, HOME_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  const items = assignments.data?.items ?? [];
  const today = items.filter((item) => isSameDay(item.operation.scheduledFor));
  const ongoing = items.filter((item) => item.status === "STARTED");
  const upcoming = items.filter((item) => Boolean(item.operation.scheduledFor) && !isSameDay(item.operation.scheduledFor) && !isPast(item)).slice(0, 4);
  const overdue = items.filter(isPast);
  // Dashboard: acesso rápido só aos atendimentos já concluídos (mais recentes).
  const recentCompleted = items.filter((item) => item.status === "COMPLETED").slice(-8).reverse();

  return (
    <div className="px-4 pt-4 pb-24 space-y-6">
      <header>
        <p className="text-caption">{greeting()},</p>
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{firstName(session?.user.name ?? "Operador")}.</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Sua fila de campo está pronta.</p>
      </header>

      {/* Convite para entrar com biometria (logo após o primeiro acesso/login). */}
      <BiometricEnrollPrompt />

      <div className="grid grid-cols-2 gap-2.5">
        <Metric label="Hoje" value={today.length} />
        <Metric label="Em andamento" value={ongoing.length} tone="primary" />
        <Metric label="Próximas" value={upcoming.length} />
        <Metric label="Atrasadas" value={overdue.length} tone={overdue.length ? "danger" : "muted"} />
      </div>

      {canReports && (
        <Link href="/operator/atendimento" className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius-xl)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] shadow-[var(--shadow-card)] active:scale-[0.99]">
          <Plus className="h-5 w-5" /> Iniciar atendimento ou relatório
        </Link>
      )}

      <div className="grid grid-cols-4 gap-2.5">
        <Shortcut href="/operator/services" icon={ClipboardList} label="Ordens" />
        <Shortcut href="/operator/qr" icon={QrCode} label="QR" />
        <Shortcut href="/operator/agenda" icon={Calendar} label="Agenda" />
        <Shortcut href="/operator/documents" icon={FileText} label="Docs" />
      </div>

      {role === "OWNER" && (
        <Link
          href="/operator/autorizar-demandas"
          className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 active:scale-[0.99] transition-transform"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Autorizar demandas</span>
            <span className="block text-xs text-[var(--color-muted-foreground)]">Liberar demandas da gestão para os técnicos</span>
          </span>
          <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        </Link>
      )}

      {assignments.loading && !assignments.data ? (
        <SkeletonList rows={4} />
      ) : assignments.error && !assignments.data ? (
        <ErrorState error={assignments.error} onRetry={assignments.refetch} />
      ) : recentCompleted.length === 0 ? (
        <EmptyState icon={Wrench} title="Nenhum atendimento concluído" description="Seus atendimentos concluídos aparecerão aqui para acesso rápido às informações." />
      ) : (
        <Section title="Concluídos recentes">
          {recentCompleted.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} compact />)}
        </Section>
      )}

      <Link href="/operator/sync" className="inline-flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <RefreshCw className="h-4 w-4" /> Sincronização offline permanece fora do escopo desta sprint.
      </Link>
    </div>
  );
}

function Metric({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "primary" | "danger" }) {
  const cls =
    tone === "primary" ? "text-[var(--color-primary)]"
    : tone === "danger" ? "text-[var(--color-danger)]"
    : "text-[var(--color-foreground)]";
  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[12px] text-[var(--color-muted-foreground)]">{label}</div>
    </div>
  );
}

function Shortcut({ href, icon: Icon, label }: { href: string; icon: typeof Calendar; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] py-4 active:scale-[0.97] transition-transform">
      <Icon className="h-6 w-6 text-[var(--color-primary)]" />
      <span className="text-[12px] font-medium">{label}</span>
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
