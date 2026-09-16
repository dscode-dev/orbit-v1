"use client";

/**
 * Dashboard V3 — visão executiva.
 *
 * Resumo executivo (KPIs clicáveis).
 * Linha 1: Cobertura operacional — Comparativo (agendado × atendido) | Radar de cobertura.
 * Linha 2: Saúde financeira (evolução) | Atividades relevantes e recentes.
 * Linha 3: Timeline operacional (Hoje / 7 dias) | Carga por operador.
 *
 * Métrica de cobertura por relatório (mês atual):
 *   agendado = documentos em preparação (DRAFT + READY);
 *   atendido = documentos concluídos (VALIDATED + SENT).
 * Consome apenas domínios e componentes já existentes — sem novas regras.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, Clock, FileText, RefreshCw, ShieldCheck, TrendingUp, Users, Wrench } from "lucide-react";
import { DashboardSection } from "@platform/components/dashboard-section";
import { GreetingHeader } from "@platform/components/greeting-header";
import { MetricCard } from "@erp/ui/metric-card";
import { SkeletonCard, SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { StatusChip } from "@erp/ui/status-chip";
import { Gate } from "@erp/ui/auth/gate";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { OPERATION_STATUS, operationCode } from "@erp/ui/operations/operation-shared";
import { useServiceTypeLabel } from "@erp/ui/operations/use-service-type-label";
import {
  assetLifecycleApi,
  assignmentsApi,
  documentsApi,
  financialApi,
  operationApi,
  pmocApi,
  useQuery,
  type AssetLifecycleEvent,
  type Assignment,
  type DocumentKind,
  type FinancialStats,
  type OperationStats,
  type Paginated,
  type PmocStats,
} from "@erp/api";
import { firstName, formatDateTime, formatNumber } from "@erp/utils";

type TimelineRange = "today" | "7d";
type Coverage = { scheduled: number; attended: number };
type CoverageRow = Coverage & { label: string; short: string };

// Cores da marca definidas em Configurações (primária + secundária/accent),
// aplicadas via applyBranding. Evita o verde fixo e segue a identidade do cliente.
const ATTENDED_COLOR = "var(--color-primary)";
const SCHEDULED_COLOR = "var(--color-accent)";

export default function PlatformHome() {
  const { session, can, hasRole } = useAuth();
  const canSeeFinancial = hasRole("OWNER", "MANAGER") && can("canFinancial");
  const [timelineRange, setTimelineRange] = useState<TimelineRange>("today");

  const cur = useMemo(() => monthBounds(0), []);

  const operationStats = useQuery<OperationStats>((s) => operationApi.getOperationStats({ signal: s }), []);
  const timeline = useQuery<Paginated<Assignment>>((s) => assignmentsApi.listAssignments({ limit: 100, signal: s }), []);
  const completed = useQuery<Paginated<Assignment>>((s) => assignmentsApi.listAssignments({ status: "COMPLETED", limit: 100, signal: s }), []);
  const pmocStats = useQuery<PmocStats>((s) => pmocApi.getPmocStats({ signal: s }), []);
  const lifecycle = useQuery((s) => assetLifecycleApi.listLifecycle({ limit: 12, signal: s }), []);
  const financial = useQuery<FinancialStats | null>((s) => (canSeeFinancial ? financialApi.getStats({ signal: s }) : Promise.resolve(null)), [canSeeFinancial]);
  const receivablesPending = useQuery<number | null>(
    (s) => (canSeeFinancial ? financialApi.listEntries({ type: "RECEIVABLE", status: "PENDING", limit: 1, signal: s }).then((r) => r.pagination.total) : Promise.resolve(null)),
    [canSeeFinancial],
  );

  // Cobertura por relatório (mês atual): agendado (DRAFT+READY) × atendido (VALIDATED+SENT).
  const osCov = useCoverage("WORK_ORDER", cur);
  const pmocCov = useCoverage("PMOC", cur);
  const visitCov = useCoverage("TECHNICAL_REPORT", cur);
  const laudoCov = useCoverage("TECHNICAL_OPINION", cur);
  const budgetCov = useCoverage("BUDGET", cur);

  const coverage: CoverageRow[] = [
    { label: "Ordens de Serviço", short: "OS", ...osCov.data },
    { label: "PMOCs", short: "PMOC", ...pmocCov.data },
    { label: "Visitas Técnicas", short: "Visitas", ...visitCov.data },
    { label: "Laudos Técnicos", short: "Laudos", ...laudoCov.data },
    { label: "Orçamentos", short: "Orçam.", ...budgetCov.data },
  ];
  const coverageLoading = osCov.loading || pmocCov.loading || visitCov.loading || laudoCov.loading || budgetCov.loading;

  const byStatus = operationStats.data?.byStatus;
  const open = (byStatus?.DRAFT ?? 0) + (byStatus?.PENDING ?? 0);
  const inProgress = byStatus?.IN_PROGRESS ?? 0;
  const review = byStatus?.REVIEW ?? 0;
  const finishedToday = (completed.data?.items ?? []).filter((a) => isToday(a.completedAt)).length;

  const workload = useMemo(() => buildWorkload(timeline.data?.items ?? []), [timeline.data]);

  function refreshAll() {
    operationStats.refetch(); timeline.refetch(); completed.refetch(); pmocStats.refetch(); lifecycle.refetch(); financial.refetch(); receivablesPending.refetch();
    osCov.refetch(); pmocCov.refetch(); visitCov.refetch(); laudoCov.refetch(); budgetCov.refetch();
  }

  return (
    <div className="space-y-6 max-w-[1500px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <GreetingHeader name={firstName(session?.user.name ?? "Equipe")} pending={open + review} />
        <button type="button" className="btn-secondary self-start" onClick={refreshAll}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      {/* Resumo executivo — KPIs */}
      <DashboardSection title="Resumo executivo">
        {operationStats.loading && !operationStats.data ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi href="/operacoes?status=PENDING" label="Operações em aberto" value={open} icon="ClipboardList" trend={open > 0 ? "up" : "flat"} />
            <Kpi href="/operacoes?status=IN_PROGRESS" label="Em andamento" value={inProgress} icon="Activity" trend={inProgress > 0 ? "up" : "flat"} />
            <Kpi href="/operacoes?status=REVIEW" label="Aguardando revisão" value={review} icon="Clock" trend={review > 0 ? "down" : "flat"} />
            <Kpi href="/operacoes?status=COMPLETED" label="Finalizadas hoje" value={finishedToday} icon="CheckCircle2" trend="up" />
            <Kpi href="/pmoc" label="PMOCs pendentes" value={pmocStats.data?.pendingExecutions ?? 0} icon="ShieldCheck" trend={(pmocStats.data?.pendingExecutions ?? 0) > 0 ? "down" : "flat"} />
            {canSeeFinancial ? (
              <Kpi href="/financial?type=RECEIVABLE&status=PENDING" label="Recebimentos pendentes" value={receivablesPending.data ?? 0} icon="Wallet" trend={(receivablesPending.data ?? 0) > 0 ? "down" : "flat"} />
            ) : (
              <MetricCard label="Recebimentos pendentes" value="restrito" delta="acesso financeiro" icon="Lock" />
            )}
          </div>
        )}
      </DashboardSection>

      {/* Linha 1 — Cobertura operacional: comparativo | radar */}
      <div className="grid items-stretch gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <DashboardSection className="h-full" title="Comparativo operacional" action={<CoverageLegend />}>
          <CoverageComparison loading={coverageLoading} rows={coverage} />
        </DashboardSection>

        <DashboardSection className="h-full" title="Cobertura de atividades" action={<span className="text-caption">agendado × atendido</span>}>
          <CoverageRadar loading={coverageLoading} rows={coverage} />
        </DashboardSection>
      </div>

      {/* Linha 2 — Saúde financeira | Atividades relevantes */}
      <div className="grid items-stretch gap-6 xl:grid-cols-2">
        <Gate roles={["OWNER", "MANAGER"]} permission="canFinancial" fallback={<DashboardSection className="h-full" title="Saúde financeira"><Panel><EmptyFill icon={FileText} title="Financeiro restrito" description="Seu perfil não possui acesso aos indicadores financeiros." /></Panel></DashboardSection>}>
          <DashboardSection className="h-full" title="Saúde financeira" action={<Link href="/financial" className="text-xs font-medium text-[var(--color-primary)] hover:underline">abrir financeiro</Link>}>
            <FinancialHealth loading={financial.loading && !financial.data} error={financial.error} onRetry={financial.refetch} stats={financial.data} />
          </DashboardSection>
        </Gate>

        <DashboardSection className="h-full" title="Atividades relevantes e recentes" action={<Link href="/clientes" className="text-xs font-medium text-[var(--color-primary)] hover:underline">ver clientes e ativos</Link>}>
          <RecentActivity loading={lifecycle.loading && !lifecycle.data} error={lifecycle.error} onRetry={lifecycle.refetch} events={lifecycle.data?.items ?? []} />
        </DashboardSection>
      </div>

      {/* Linha 3 — Timeline operacional | Carga por operador */}
      <div className="grid items-stretch gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <DashboardSection
          className="h-full"
          title="Timeline operacional"
          action={
            <div className="flex gap-1.5">
              {(["today", "7d"] as TimelineRange[]).map((key) => (
                <button key={key} type="button" onClick={() => setTimelineRange(key)} className={`h-7 rounded-[var(--radius-md)] px-2.5 text-[11px] font-medium transition ${timelineRange === key ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]" : "border border-[var(--color-border)] hover:bg-[var(--color-muted)]"}`}>
                  {key === "today" ? "Hoje" : "Próximos 7 dias"}
                </button>
              ))}
            </div>
          }
        >
          <OperationalTimeline loading={timeline.loading && !timeline.data} error={timeline.error} onRetry={timeline.refetch} assignments={timeline.data?.items ?? []} range={timelineRange} />
        </DashboardSection>

        <DashboardSection className="h-full" title="Carga por operador" action={<span className="text-caption">agenda ativa</span>}>
          <OperatorWorkload loading={timeline.loading && !timeline.data} items={workload} />
        </DashboardSection>
      </div>
    </div>
  );
}

/* ---------- primitivos de layout ---------- */

/** Card com altura total (para igualar alturas entre colunas). */
function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex h-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 ${className ?? ""}`}>{children}</div>;
}

function EmptyFill({ icon, title, description }: { icon: typeof FileText; title: string; description: string }) {
  return <div className="grid flex-1 place-items-center"><EmptyState icon={icon} title={title} description={description} /></div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</span>;
}

function CoverageLegend() {
  return (
    <div className="flex gap-3 text-caption">
      <Legend color={SCHEDULED_COLOR} label="Agendado" />
      <Legend color={ATTENDED_COLOR} label="Atendido" />
    </div>
  );
}

/* ---------- KPI ---------- */

function Kpi({ href, label, value, icon, trend }: { href: string; label: string; value: number; icon: Parameters<typeof MetricCard>[0]["icon"]; trend?: "up" | "down" | "flat" }) {
  return (
    <Link href={href} className="block rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 transition hover:-translate-y-0.5">
      <MetricCard label={label} value={formatNumber(value)} delta="ver detalhes" trend={trend} icon={icon} />
    </Link>
  );
}

/* ---------- Comparativo operacional (agendado × atendido) ---------- */

function CoverageComparison({ loading, rows }: { loading: boolean; rows: CoverageRow[] }) {
  if (loading) return <Panel><SkeletonList rows={5} /></Panel>;
  return (
    <Panel>
      <div className="flex flex-1 flex-col justify-center gap-4">
        {rows.map((row) => {
          const total = row.scheduled + row.attended;
          const pct = total > 0 ? Math.round((row.attended / total) * 100) : 0;
          return (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="flex items-center gap-2 text-caption tabular-nums">
                  <span><span className="font-semibold text-[var(--color-foreground)]">{formatNumber(row.attended)}</span> de {formatNumber(total)}</span>
                  <CoveragePill pct={pct} />
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--color-muted)]">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ATTENDED_COLOR }} />
                <div className="h-full flex-1" style={{ background: total > 0 ? `color-mix(in srgb, ${SCHEDULED_COLOR} 28%, transparent)` : "transparent" }} />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function CoveragePill({ pct }: { pct: number }) {
  const tone = pct >= 75 ? "var(--color-success)" : pct >= 40 ? "var(--color-warning)" : "var(--color-danger)";
  return (
    <span className="inline-flex min-w-[3rem] justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums" style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>
      {pct}%
    </span>
  );
}

/* ---------- Radar de cobertura (demanda × atendido) ---------- */

function CoverageRadar({ loading, rows }: { loading: boolean; rows: CoverageRow[] }) {
  if (loading) return <Panel><SkeletonCard /></Panel>;
  const totalScheduled = rows.reduce((s, r) => s + r.scheduled + r.attended, 0);
  const totalAttended = rows.reduce((s, r) => s + r.attended, 0);
  const overall = totalScheduled > 0 ? Math.round((totalAttended / totalScheduled) * 100) : 0;
  return (
    <Panel>
      <div className="grid flex-1 place-items-center py-1">
        <RadarChart rows={rows} />
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 border-t border-[var(--color-border)] pt-3 text-caption">
        <TrendingUp className="h-3.5 w-3.5 text-[var(--color-primary)]" />
        <span>Cobertura geral do mês</span>
        <span className="font-semibold text-[var(--color-foreground)] tabular-nums">{overall}%</span>
      </div>
    </Panel>
  );
}

function RadarChart({ rows }: { rows: CoverageRow[] }) {
  const size = 300;
  const c = size / 2;
  const radius = c - 60;
  const n = rows.length;
  const max = Math.max(...rows.map((r) => r.scheduled + r.attended), 1);
  const angle = (i: number) => (-90 + (i * 360) / n) * (Math.PI / 180);
  const point = (value: number, i: number) => {
    const r = (value / max) * radius;
    return [c + r * Math.cos(angle(i)), c + r * Math.sin(angle(i))] as const;
  };
  const polygon = (fn: (r: CoverageRow) => number) => rows.map((r, i) => point(fn(r), i).map((v) => v.toFixed(1)).join(",")).join(" ");
  const demand = (r: CoverageRow) => r.scheduled + r.attended;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-[320px]" role="img" aria-label="Radar de cobertura de atividades">
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} points={rows.map((_, i) => { const [px, py] = [c + ring * radius * Math.cos(angle(i)), c + ring * radius * Math.sin(angle(i))]; return `${px.toFixed(1)},${py.toFixed(1)}`; }).join(" ")} fill="none" stroke="var(--color-border)" strokeDasharray="2 3" />
      ))}
      {rows.map((_, i) => { const [px, py] = point(max, i); return <line key={i} x1={c} y1={c} x2={px} y2={py} stroke="var(--color-border)" />; })}
      <polygon points={polygon(demand)} fill={SCHEDULED_COLOR} fillOpacity="0.1" stroke={SCHEDULED_COLOR} strokeOpacity="0.55" strokeWidth="1.5" />
      <polygon points={polygon((r) => r.attended)} fill={ATTENDED_COLOR} fillOpacity="0.2" stroke={ATTENDED_COLOR} strokeWidth="2" />
      {rows.map((r, i) => point(r.attended, i)).map(([px, py], i) => <circle key={i} cx={px} cy={py} r={3} fill={ATTENDED_COLOR} stroke="var(--color-card)" strokeWidth="1.5" />)}
      {rows.map((r, i) => {
        const [lx, ly] = [c + (radius + 26) * Math.cos(angle(i)), c + (radius + 26) * Math.sin(angle(i))];
        const anchor = Math.abs(lx - c) < 10 ? "middle" : lx > c ? "start" : "end";
        return (
          <text key={r.label} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fill="var(--color-muted-foreground)">
            <tspan fontWeight="600" fill="var(--color-foreground)">{r.short}</tspan>
            <tspan dx="4">{r.attended}/{demand(r)}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

/* ---------- Saúde financeira (evolução, sempre exibida) ---------- */

function FinancialHealth({ loading, error, onRetry, stats }: { loading: boolean; error: unknown; onRetry: () => void; stats: FinancialStats | null }) {
  if (loading) return <Panel><SkeletonCard /></Panel>;
  if (error) return <Panel><EmptyFill icon={FileText} title="Financeiro indisponível" description="Não foi possível carregar a evolução." /><button type="button" onClick={onRetry} className="mt-2 self-center text-xs text-[var(--color-primary)] hover:underline">Tentar novamente</button></Panel>;
  const raw = (stats?.monthlyFlow ?? []).map((m) => {
    const income = Number(m.income) || 0;
    const expenses = Number(m.expenses) || 0;
    return { month: shortMonth(m.month), income, expenses, balance: income - expenses };
  });
  // Sempre exibe o gráfico — quando não há histórico, mostra a série zerada.
  const flow = raw.length > 0 ? raw : zeroedFlow();
  const last = flow[flow.length - 1];
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-caption">
          <Legend color="var(--color-success)" label="Receitas" />
          <Legend color="var(--color-danger)" label="Despesas" />
          <Legend color="var(--color-foreground)" label="Saldo" />
        </div>
        <span className={`text-sm font-semibold tabular-nums ${last.balance >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {last.balance >= 0 ? "+" : ""}{formatCurrency(last.balance)}
        </span>
      </div>
      <div className="grid flex-1 place-items-center pt-2">
        <EvolutionChart data={flow} />
      </div>
      {raw.length === 0 && <p className="text-center text-[11px] text-[var(--color-muted-foreground)]">Sem lançamentos no período — evolução zerada.</p>}
    </Panel>
  );
}

function EvolutionChart({ data }: { data: Array<{ month: string; income: number; expenses: number; balance: number }> }) {
  const W = 620;
  const H = 220;
  const padX = 36;
  const padY = 24;
  const values = data.flatMap((d) => [d.income, d.expenses, d.balance]).filter((v) => Number.isFinite(v));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const spanRange = max - min || 1;
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - padY - ((v - min) / spanRange) * (H - padY * 2);
  const line = (key: "income" | "expenses" | "balance") => data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = `${line("income")} L${x(data.length - 1).toFixed(1)},${(H - padY).toFixed(1)} L${x(0).toFixed(1)},${(H - padY).toFixed(1)} Z`;
  const zeroY = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Evolução de receitas, despesas e saldo">
      <defs>
        <linearGradient id="fin-income" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((p) => <line key={p} x1={padX} x2={W - padX} y1={padY + p * (H - padY * 2)} y2={padY + p * (H - padY * 2)} stroke="var(--color-border)" strokeDasharray="3 3" />)}
      {min < 0 && <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke="var(--color-muted-foreground)" strokeWidth="1" />}
      <path d={area} fill="url(#fin-income)" stroke="none" />
      <path d={line("income")} fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={line("expenses")} fill="none" stroke="var(--color-danger)" strokeOpacity="0.85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={line("balance")} fill="none" stroke="var(--color-foreground)" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.income)} r={3} fill="var(--color-success)" stroke="var(--color-card)" strokeWidth="1.5" />)}
      {data.map((d, i) => <text key={d.month + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted-foreground)">{d.month}</text>)}
    </svg>
  );
}

/* ---------- Atividades relevantes e recentes ---------- */

function RecentActivity({ loading, error, onRetry, events }: { loading: boolean; error: unknown; onRetry: () => void; events: AssetLifecycleEvent[] }) {
  if (loading) return <Panel><SkeletonList rows={6} /></Panel>;
  if (error) return <Panel><EmptyFill icon={ShieldCheck} title="Atividade indisponível" description="Não foi possível carregar os eventos." /><button type="button" onClick={onRetry} className="mt-2 self-center text-xs text-[var(--color-primary)] hover:underline">Tentar novamente</button></Panel>;
  if (events.length === 0) return <Panel><EmptyFill icon={ShieldCheck} title="Sem atividade recente" description="Nenhum evento relevante registrado até o momento." /></Panel>;
  return (
    <Panel className="!p-0">
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {events.map((event) => (
          <li key={event.id} className="group flex items-start gap-3 rounded-[var(--radius-md)] px-2.5 py-2 transition-colors hover:bg-[var(--color-muted)]">
            <span className="relative mt-0.5 flex flex-col items-center">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${event.timeline.color}1a`, color: event.timeline.color }}>
                {event.type === "DOCUMENT" ? <FileText className="h-3.5 w-3.5" /> : event.timeline.category === "maintenance" ? <Wrench className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              </span>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{event.timeline.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)] tabular-nums">{formatDateTime(event.timeline.date)}</span>
              </div>
              <p className="truncate text-caption">{event.timeline.subtitle ?? event.timeline.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------- Timeline operacional ---------- */

function OperationalTimeline({ loading, error, onRetry, assignments, range }: { loading: boolean; error: unknown; onRetry: () => void; assignments: Assignment[]; range: TimelineRange }) {
  const typeLabel = useServiceTypeLabel();
  const items = useMemo(() => {
    const withSchedule = assignments.filter((a) => Boolean(a.operation.scheduledFor));
    const filtered = withSchedule.filter((a) => (range === "today" ? isToday(a.operation.scheduledFor) : inNextDays(a.operation.scheduledFor, 7)));
    return filtered.sort((a, b) => (a.operation.scheduledFor ?? "").localeCompare(b.operation.scheduledFor ?? ""));
  }, [assignments, range]);

  if (loading) return <Panel><SkeletonList rows={6} /></Panel>;
  if (error) return <Panel><EmptyFill icon={CalendarClock} title="Timeline indisponível" description="Não foi possível carregar a agenda." /><button type="button" onClick={onRetry} className="mt-2 self-center text-xs text-[var(--color-primary)] hover:underline">Tentar novamente</button></Panel>;
  if (items.length === 0) return <Panel><EmptyFill icon={CalendarClock} title={range === "today" ? "Sem operações hoje" : "Sem operações nos próximos 7 dias"} description="Nenhum atendimento agendado para o período." /></Panel>;
  return (
    <Panel className="!p-0">
      <ul className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
        {items.map((a) => {
          const op = a.operation;
          const priority = priorityOf(op.scheduledFor, op.status);
          return (
            <li key={a.id}>
              <Link href={`/operacoes?operationId=${op.id}`} className="flex items-center gap-3 p-3 transition-colors hover:bg-[var(--color-muted)]">
                <span className="flex w-14 shrink-0 flex-col items-center text-[var(--color-muted-foreground)]">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="mt-0.5 font-mono text-xs tabular-nums">{timeOf(op.scheduledFor)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{op.customer?.name ?? operationCode(op.number)}</span>
                  <span className="block truncate text-caption">{typeLabel(op.type)} · {a.assignee.name}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip tone={OPERATION_STATUS[op.status].tone} dot>{OPERATION_STATUS[op.status].label}</StatusChip>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${priority.className}`}>{priority.label}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ---------- Carga por operador ---------- */

function OperatorWorkload({ loading, items }: { loading: boolean; items: Array<{ operator: string; count: number }> }) {
  if (loading) return <Panel><SkeletonList rows={4} /></Panel>;
  if (items.length === 0) return <Panel><EmptyFill icon={Users} title="Sem carga agendada" description="Nenhuma operação ativa atribuída a operadores." /></Panel>;
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <Panel>
      <div className="flex flex-1 flex-col justify-center gap-3.5">
        {items.map((item, i) => {
          const share = total > 0 ? Math.round((item.count / total) * 100) : 0;
          return (
            <div key={item.operator} className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-primary-soft)] text-xs font-semibold text-[var(--color-primary)]">
                {initials(item.operator)}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{item.operator}</span>
                  <span className="shrink-0 text-caption tabular-nums"><span className="font-semibold text-[var(--color-foreground)]">{formatNumber(item.count)}</span> · {share}%</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-muted)]">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(item.count / max) * 100}%`, background: i === 0 ? "var(--color-primary)" : "color-mix(in srgb, var(--color-primary) 55%, var(--color-muted))" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function buildWorkload(assignments: Assignment[]): Array<{ operator: string; count: number }> {
  const active = assignments.filter((a) => !["COMPLETED", "CANCELED", "REJECTED"].includes(a.status));
  const map = new Map<string, number>();
  for (const a of active) map.set(a.assignee.name, (map.get(a.assignee.name) ?? 0) + 1);
  return [...map.entries()].map(([operator, count]) => ({ operator, count })).sort((a, b) => b.count - a.count).slice(0, 6);
}

/* ---------- data helpers ---------- */

const EMPTY_COVERAGE: Coverage = { scheduled: 0, attended: 0 };

/**
 * Cobertura por relatório: conta documentos do tipo no período e separa
 * atendido (PDF pronto — status READY em diante) de agendado (ainda em DRAFT).
 *
 * O status do documento só assume DRAFT (criado) e READY (renderizado); por isso
 * "atendido" = total − DRAFT, contabilizando os relatórios efetivamente prontos.
 */
function useCoverage(type: DocumentKind, bounds: { from: string; to: string }) {
  const q = useQuery<Coverage>(
    (s) =>
      Promise.all([
        documentsApi.listDocuments({ type, from: bounds.from, to: bounds.to, limit: 1, signal: s }).then((r) => r.pagination.total),
        documentsApi.listDocuments({ type, status: "DRAFT", from: bounds.from, to: bounds.to, limit: 1, signal: s }).then((r) => r.pagination.total),
      ]).then(([total, draft]) => {
        const scheduled = Math.min(draft, total);
        return { attended: Math.max(0, total - scheduled), scheduled };
      }),
    [],
  );
  return { data: q.data ?? EMPTY_COVERAGE, loading: q.loading, refetch: q.refetch };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function priorityOf(scheduled: string | null, status: string): { label: string; className: string } {
  if (isOverdue(scheduled, status)) return { label: "Alta", className: "text-[var(--color-danger)]" };
  if (isToday(scheduled)) return { label: "Média", className: "text-[var(--color-warning)]" };
  return { label: "Normal", className: "text-[var(--color-muted-foreground)]" };
}

function isOverdue(scheduled: string | null, status: string): boolean {
  if (!scheduled || ["COMPLETED", "CANCELED"].includes(status)) return false;
  return new Date(scheduled).getTime() < Date.now();
}

function monthBounds(offset: number): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1, 0, 0, 0, 0);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function inNextDays(iso: string | null, days: number): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + days * 24 * 60 * 60 * 1000;
  return d >= start.getTime() && d <= end;
}

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function shortMonth(month: string): string {
  const parsed = /^\d{4}-\d{2}$/.test(month) ? new Date(`${month}-01T00:00:00`) : new Date(month);
  if (Number.isNaN(parsed.getTime())) return month;
  return parsed.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/** Série de 3 meses zerada, para exibir o gráfico financeiro mesmo sem histórico. */
function zeroedFlow(): Array<{ month: string; income: number; expenses: number; balance: number }> {
  const now = new Date();
  return [2, 1, 0].map((off) => {
    const d = new Date(now.getFullYear(), now.getMonth() - off, 1);
    return { month: shortMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`), income: 0, expenses: 0, balance: 0 };
  });
}
