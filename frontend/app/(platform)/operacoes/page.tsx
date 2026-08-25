"use client";

/**
 * Operações — domínio operacional central. Cada item é uma Operation (atendimento
 * em campo) que origina a Ordem de Serviço e os demais documentos. Substitui
 * gradualmente a visão de Serviços. Consome a API real `/operations`.
 */
import { Suspense, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { CalendarClock, Check, ClipboardList, Loader2, Plus, ReceiptText, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@platform/components/page-header";
import { DataTable, type Column } from "@platform/components/data-table";
import { Pagination } from "@platform/components/pagination";
import { ExportButton } from "@platform/components/export-button";
import { FilterBar, FilterChip } from "@erp/ui/filter-bar";
import { StatusChip } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { ErrorState } from "@erp/ui/states";
import { OperationDetailDrawer } from "@platform/components/operation-detail-drawer";
import { OperationCreationDrawer } from "@platform/components/operation-creation-drawer";
import { Gate } from "@erp/ui/auth/gate";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { OPERATION_STATUS, OPERATION_TYPE_LABEL, operationCode } from "@erp/ui/operations/operation-shared";
import { assignmentsApi, operationApi, useQuery, type OperationSummary, type OperationStatus, type PendingDemandGroup } from "@erp/api";
import { useDebounce, formatDateTime } from "@erp/utils";

type OpsTab = "overview" | "authorize";

const ReportWorkflowDrawer = dynamic(
  () => import("@platform/components/report-center").then((module) => module.ReportWorkflowDrawer),
  { ssr: false },
);

const STATUS_FILTERS: Array<{ key: "all" | OperationStatus; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "PENDING", label: "Pendentes" },
  { key: "IN_PROGRESS", label: "Em andamento" },
  { key: "REVIEW", label: "Em revisão" },
  { key: "COMPLETED", label: "Concluídas" },
  { key: "DRAFT", label: "Rascunho" },
  { key: "CANCELED", label: "Canceladas" },
];

function OperacoesInner() {
  const params = useSearchParams();
  const customerId = params.get("customerId") ?? undefined;
  const equipmentId = params.get("equipmentId") ?? undefined;
  const initialStatus = parseStatus(params.get("status"));

  const { hasRole } = useAuth();
  const canAuthorize = hasRole("OWNER", "MANAGER");
  const canGenerateReceipt = hasRole("OWNER", "MANAGER");
  const [tab, setTab] = useState<OpsTab>("overview");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | OperationStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  // Deep link (ex.: clique em uma notificação) abre o drawer da operação direto.
  const [detailId, setDetailId] = useState<string | null>(params.get("operationId"));
  const [receiptOperationId, setReceiptOperationId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebounce(search, 300);

  const list = useQuery(
    (signal) =>
      operationApi.listOperations({
        page,
        limit,
        search: debounced || undefined,
        status: status === "all" ? undefined : status,
        customerId,
        equipmentId,
        signal,
      }),
    [page, limit, debounced, status, customerId, equipmentId],
    // "Como se fosse em tempo real": poll silencioso + refresh ao focar a aba.
    { refetchInterval: 10_000, refetchOnFocus: true },
  );

  const columns = useMemo<Column<OperationSummary>[]>(
    () => [
      { key: "number", header: "Número", className: "w-[120px]", cell: (o) => <span className="font-mono text-xs">{operationCode(o.number)}</span> },
      {
        key: "customer", header: "Cliente",
        cell: (o) => <div className="min-w-0"><div className="font-medium truncate">{o.customer?.name ?? "—"}</div><div className="text-caption truncate">{o.equipment?.name ?? "Sem equipamento"}</div></div>,
      },
      { key: "operator", header: "Operador", className: "w-[150px]", cell: (o) => <span className="text-sm truncate">{o.operator?.name ?? "—"}</span> },
      { key: "type", header: "Tipo", className: "w-[140px]", cell: (o) => <span className="text-sm">{OPERATION_TYPE_LABEL[o.type]}</span> },
      { key: "createdAt", header: "Criado", className: "w-[125px]", cell: (o) => <span className="font-mono text-xs">{formatDateTime(o.createdAt)}</span> },
      { key: "scheduledFor", header: "Data do agendamento", className: "w-[155px]", cell: (o) => <span className="font-mono text-xs">{o.scheduledFor ? formatDateTime(o.scheduledFor) : "Não agendado"}</span> },
      { key: "status", header: "Status", className: "w-[190px]", cell: (o) => {
        const cancellation = o.cancellations?.[0];
        const label = cancellation?.status === "REQUESTED" ? "Cancelada · operador" : cancellation?.status === "RESCHEDULED" && o.status !== "COMPLETED" ? "Reagendada" : cancellation?.status === "APPROVED" ? "Cancelada" : OPERATION_STATUS[o.status].label;
        const tone = cancellation?.status === "REQUESTED" || cancellation?.status === "APPROVED" ? "danger" : cancellation?.status === "RESCHEDULED" ? "info" : OPERATION_STATUS[o.status].tone;
        return <StatusChip tone={tone} dot className="whitespace-nowrap" >{label}</StatusChip>;
      } },
      ...(canGenerateReceipt
        ? [{
            key: "receipt",
            header: "Ações",
            className: "w-[145px]",
            link: false,
            cell: (operation: OperationSummary) =>
              operation.status === "COMPLETED" && operation.requestedDocumentType === "WORK_ORDER" ? (
                <button
                  type="button"
                  title="Gerar Recibo a partir desta Ordem de Serviço"
                  aria-label={`Gerar Recibo da ${operationCode(operation.number)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setReceiptOperationId(operation.id);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-primary)] transition hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5"
                >
                  <ReceiptText className="h-3.5 w-3.5" /> Gerar Recibo
                </button>
              ) : null,
          } satisfies Column<OperationSummary>]
        : []),
    ],
    [canGenerateReceipt],
  );

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        eyebrow="Operação"
        title="Operações"
        description="Domínio operacional central. Cada operação origina a Ordem de Serviço e os documentos relacionados."
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              label="Exportar"
              fileName="operacoes"
              onPdf={() =>
                operationApi.exportOperationsPdf({
                  search: debounced || undefined,
                  status: status === "all" ? undefined : status,
                  customerId,
                  equipmentId,
                })
              }
              rows={(list.data?.items ?? []).map((o) => ({
                numero: operationCode(o.number),
                cliente: o.customer?.name ?? "",
                equipamento: o.equipment?.name ?? "",
                operador: o.operator?.name ?? "",
                tipo: OPERATION_TYPE_LABEL[o.type],
                criadoEm: formatDateTime(o.createdAt),
                agendadoPara: o.scheduledFor ? formatDateTime(o.scheduledFor) : "Não agendado",
                status: OPERATION_STATUS[o.status].label,
              }))}
            />
            <Gate roles={["OWNER", "MANAGER", "OPERATOR"]}>
              <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium">
                <Plus className="h-4 w-4" /> Nova operação
              </button>
            </Gate>
          </div>
        }
      />

      {canAuthorize && (
        <nav className="flex gap-1 border-b border-[var(--color-border)]">
          {([["overview", "Visão geral"], ["authorize", "Autorizar demandas"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`px-4 py-2.5 text-sm font-medium ${tab === value ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {canAuthorize && tab === "authorize" && <AuthorizeDemands />}

      {(!canAuthorize || tab === "overview") && <>
      <FilterBar search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchPlaceholder="Buscar por cliente, equipamento, operador…">
        {STATUS_FILTERS.map((f) => (
          <FilterChip key={f.key} active={status === f.key} onClick={() => { setStatus(f.key); setPage(1); }}>{f.label}</FilterChip>
        ))}
      </FilterBar>

      {list.loading && !list.data ? (
        <SkeletonList rows={6} />
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhuma operação" description={debounced || status !== "all" ? "Ajuste os filtros." : "As operações criadas pelos operadores aparecerão aqui."} />
      ) : list.data ? (
        <div className="space-y-3">
          <div className="flex h-4 items-center justify-end">
            {list.refreshing && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-primary)]" /> Atualizando…
              </span>
            )}
          </div>
          <DataTable columns={columns} rows={list.data.items} onRowClick={(o) => setDetailId(o.id)} />
          <Pagination
            pagination={list.data.pagination}
            onPageChange={setPage}
            onPageSizeChange={(next) => { setLimit(next); setPage(1); }}
          />
        </div>
      ) : null}
      </>}

      <OperationDetailDrawer operationId={detailId} open={detailId !== null} onClose={() => { setDetailId(null); list.refetch(); }} />
      <OperationCreationDrawer open={createOpen} mode="operation" onClose={() => setCreateOpen(false)} onCreated={(op) => { setDetailId(op.id); list.refetch(); }} />
      {receiptOperationId && (
        <ReportWorkflowDrawer
          type="RECEIPT"
          initialOperationId={receiptOperationId}
          onClose={() => setReceiptOperationId(null)}
          onRendered={list.refetch}
        />
      )}
    </div>
  );
}

export default function OperacoesPage() {
  return (
    <Suspense fallback={null}>
      <OperacoesInner />
    </Suspense>
  );
}

function parseStatus(value: string | null): "all" | OperationStatus {
  return value === "DRAFT" || value === "PENDING" || value === "IN_PROGRESS" || value === "REVIEW" || value === "COMPLETED" || value === "CANCELED" ? value : "all";
}

/* ---------------- Autorizar demandas ---------------- */

const smallPrimary = "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50";
const smallGhost = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50";

function dayKeyOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "none";
}
function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}
function bucketByDay(items: PendingDemandGroup["items"]): Array<[string, PendingDemandGroup["items"]]> {
  const map = new Map<string, PendingDemandGroup["items"]>();
  for (const item of items) {
    const key = dayKeyOf(item.scheduledFor);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : a[0].localeCompare(b[0])));
}

function AuthorizeDemands() {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [globalDate, setGlobalDate] = useState("");
  const [globalOperator, setGlobalOperator] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery<PendingDemandGroup[]>(
    (s) => assignmentsApi.listPendingDemands({ signal: s }),
    [tick],
    { refetchInterval: 20_000, refetchOnFocus: true },
  );

  async function authorize(payload: { operatorId?: string; date?: string }) {
    setBusy(true);
    setMsg(null);
    try {
      const { authorized } = await assignmentsApi.authorizeDemands(payload);
      setMsg(authorized > 0 ? `${authorized} demanda(s) liberada(s) para o app do operador.` : "Nenhuma demanda correspondente para autorizar.");
      setTick((v) => v + 1);
    } catch {
      setMsg("Não foi possível autorizar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const groups = q.data ?? [];

  return (
    <div className="max-w-[1000px] space-y-5">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        As demandas criadas pela gestão ficam <strong>ocultas</strong> no app do operador até você autorizar aqui — evita que o técnico veja a carga futura antecipadamente. Itens já em andamento ou concluídos permanecem visíveis.
      </p>

      <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <h3 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-[var(--color-primary)]" /> Autorização geral por dia</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-medium">Dia
            <input type="date" value={globalDate} onChange={(e) => setGlobalDate(e.target.value)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-medium">Técnico (opcional)
            <select value={globalOperator} onChange={(e) => setGlobalOperator(e.target.value)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-sm">
              <option value="">Todos os técnicos</option>
              {groups.map((g) => <option key={g.operator.id} value={g.operator.id}>{g.operator.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={!globalDate || busy} onClick={() => authorize({ date: globalDate, operatorId: globalOperator || undefined })} className={smallPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Autorizar dia
          </button>
        </div>
      </div>

      {msg && <p className="rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2 text-sm text-[var(--color-primary)]">{msg}</p>}

      {q.loading && !q.data ? (
        <SkeletonList rows={4} />
      ) : q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : groups.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nada aguardando autorização" description="Todas as demandas agendadas já estão visíveis para os técnicos." />
      ) : (
        <div className="space-y-3">{groups.map((group) => <DemandGroupCard key={group.operator.id} group={group} busy={busy} onAuthorize={authorize} />)}</div>
      )}
    </div>
  );
}

function DemandGroupCard({ group, busy, onAuthorize }: { group: PendingDemandGroup; busy: boolean; onAuthorize: (payload: { operatorId?: string; date?: string }) => void }) {
  const days = bucketByDay(group.items);
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><Users className="h-4 w-4" /></span>
          <strong className="text-sm">{group.operator.name}</strong>
          <StatusChip tone="warning">{group.total} pendente(s)</StatusChip>
        </div>
        <button type="button" disabled={busy} onClick={() => onAuthorize({ operatorId: group.operator.id })} className={smallPrimary}>
          <Check className="h-4 w-4" /> Autorizar tudo
        </button>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {days.map(([day, items]) => (
          <li key={day} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
              <span className="truncate">{day === "none" ? "Sem data agendada" : formatDay(day)} · {items.length} operação(ões)</span>
            </span>
            {day !== "none" && (
              <button type="button" disabled={busy} onClick={() => onAuthorize({ operatorId: group.operator.id, date: day })} className={smallGhost}>Autorizar dia</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
