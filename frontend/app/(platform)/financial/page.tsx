"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2, Percent, Plus, RefreshCw, Search, Wallet } from "lucide-react";
import { PageHeader } from "@platform/components/page-header";
import { DashboardSection } from "@platform/components/dashboard-section";
import { Pagination } from "@platform/components/pagination";
import { MetricCard } from "@erp/ui/metric-card";
import { SkeletonCard } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { ErrorState } from "@erp/ui/states";
import { Gate } from "@erp/ui/auth/gate";
import { Drawer } from "@erp/ui/drawer";
import {
  financialApi,
  useQuery,
  ApiClientError,
  type FinancialEntry,
  type FinancialEntryStatus,
  type FinancialEntryType,
  type FinancialStats,
  type ImportableReceipt,
  type Paginated,
} from "@erp/api";
import { formatCurrencyBRL, formatDate } from "@erp/utils";
import { FinancialStatusBadge, FinancialTypeBadge } from "@platform/components/financial-procurement-badges";
import { CommissionSettingsDrawer } from "@platform/components/commission-settings-drawer";

const entryTypes: Array<FinancialEntryType | ""> = ["", "RECEIVABLE", "PAYABLE"];
const statuses: Array<FinancialEntryStatus | ""> = ["", "PENDING", "PAID", "OVERDUE", "CANCELED"];
const ENTRY_TYPE_LABEL: Record<string, string> = { RECEIVABLE: "Entrada", PAYABLE: "Saída", TRANSFER: "Transferência" };
const ORIGIN_LABEL: Record<string, string> = { MANUAL: "Manual", BUDGET: "Orçamento", PURCHASE: "Compra", OPERATION: "Operação", PMOC: "PMOC", RECEIPT: "Recibo", OTHER: "Outro" };
const inputCls = "input";

export default function FinancialPage() {
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FinancialEntryType | "">(() => parseEnum(params.get("type"), entryTypes));
  const [status, setStatus] = useState<FinancialEntryStatus | "">(() => parseEnum(params.get("status"), statuses));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [commissionOpen, setCommissionOpen] = useState(false);

  const stats = useQuery<FinancialStats>((signal) => financialApi.getStats({ signal }), []);
  const entries = useQuery<Paginated<FinancialEntry>>(
    (signal) => financialApi.listEntries({
      page,
      limit,
      search,
      type: type || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      signal,
    }),
    [page, limit, search, type, status, from, to],
  );

  const overdueTotal = useMemo(() => {
    const data = stats.data?.overdue;
    return Number(data?.receivable ?? 0) + Number(data?.payable ?? 0);
  }, [stats.data]);

  const refetchAll = () => {
    stats.refetch();
    entries.refetch();
  };

  return (
    <Gate
      roles={["OWNER", "MANAGER"]}
      permission="canFinancial"
      fallback={
        <div className="max-w-[1440px]">
          <PageHeader eyebrow="Financeiro" title="Financeiro" description="Você não possui permissão para acessar esta área." />
          <ErrorState error={{ message: "Seu perfil não possui permissão financeira." }} />
        </div>
      }
    >
      <div className="space-y-8 max-w-[1440px]">
        <PageHeader
          eyebrow={<span className="inline-flex items-center gap-1.5"><Wallet className="h-3 w-3" /> Conta geral</span>}
          title="Financeiro"
          description="Registre entradas e saídas na conta geral. Os recibos emitidos entram automaticamente como entrada."
          actions={
            <>
              <button className="btn-secondary" onClick={refetchAll}><RefreshCw className="h-4 w-4" /> Atualizar</button>
              <Gate roles={["OWNER"]}>
                <button className="btn-secondary" onClick={() => setCommissionOpen(true)}><Percent className="h-4 w-4" /> Comissões</button>
              </Gate>
              <button className="btn-secondary" onClick={() => setImportOpen(true)}><Download className="h-4 w-4" /> Importar recibos</button>
              <button className="btn-primary" onClick={() => setEntryOpen(true)}><Plus className="h-4 w-4" /> Novo lançamento</button>
            </>
          }
        />

        <DashboardSection title="Resumo da conta geral">
          {stats.loading && !stats.data ? (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
          ) : stats.error && !stats.data ? (
            <ErrorState error={stats.error} onRetry={stats.refetch} />
          ) : (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
              <MetricCard label="Saldo atual" value={formatCurrencyBRL(Number(stats.data?.currentBalance ?? 0))} icon="Wallet" />
              <MetricCard label="Entradas" value={formatCurrencyBRL(Number(stats.data?.income ?? 0))} trend="up" icon="ArrowUpCircle" />
              <MetricCard label="Saídas" value={formatCurrencyBRL(Number(stats.data?.expenses ?? 0))} trend="down" icon="ArrowDownCircle" />
              <MetricCard label="Receber hoje" value={formatCurrencyBRL(Number(stats.data?.receivableToday ?? 0))} trend="up" icon="TrendingUp" />
              <MetricCard label="Pagar hoje" value={formatCurrencyBRL(Number(stats.data?.payableToday ?? 0))} trend="down" icon="TrendingDown" />
              <MetricCard label="Em atraso" value={formatCurrencyBRL(overdueTotal)} trend={overdueTotal > 0 ? "down" : "flat"} icon="AlertTriangle" />
            </div>
          )}
        </DashboardSection>

        <DashboardSection title="Lançamentos">
          <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <label className="relative xl:col-span-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-muted-foreground)]" />
              <input className="input pl-9" placeholder="Buscar lançamento" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </label>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value as FinancialEntryType | ""); setPage(1); }}>{entryTypes.map((v) => <option key={v || "all"} value={v}>{v ? ENTRY_TYPE_LABEL[v] : "Tipo"}</option>)}</select>
            <select className="input" value={status} onChange={(e) => { setStatus(e.target.value as FinancialEntryStatus | ""); setPage(1); }}>{statuses.map((v) => <option key={v || "all"} value={v}>{v || "Status"}</option>)}</select>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
              <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
            </div>
          </div>

          {entries.loading && !entries.data ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}</div>
          ) : entries.error && !entries.data ? (
            <ErrorState error={entries.error} onRetry={entries.refetch} />
          ) : (entries.data?.items.length ?? 0) === 0 ? (
            <EmptyState icon={Wallet} title="Nenhum lançamento" description="Registre uma entrada/saída ou importe um recibo emitido." />
          ) : (
            <>
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-card)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-muted)]/50 text-left text-caption">
                    <tr><th className="p-3">Descrição</th><th>Tipo</th><th>Status</th><th>Origem</th><th>Data</th><th className="p-3 text-right">Valor</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {entries.data?.items.map((entry) => (
                      <tr key={entry.id} className="hover:bg-[var(--color-muted)]/40">
                        <td className="p-3 font-medium">{entry.description}</td>
                        <td><FinancialTypeBadge type={entry.type} /></td>
                        <td><FinancialStatusBadge status={entry.status} /></td>
                        <td className="text-caption">{ORIGIN_LABEL[entry.origin] ?? entry.origin}</td>
                        <td>{formatDate(entry.paidAt ?? entry.dueDate)}</td>
                        <td className={`p-3 text-right font-mono ${entry.type === "PAYABLE" ? "text-[var(--color-danger)]" : "text-emerald-600"}`}>{entry.type === "PAYABLE" ? "-" : "+"}{formatCurrencyBRL(Number(entry.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {entries.data && <div className="mt-4"><Pagination pagination={entries.data.pagination} onPageChange={setPage} onPageSizeChange={(next) => { setLimit(next); setPage(1); }} /></div>}
            </>
          )}
        </DashboardSection>

        <NewEntryDrawer open={entryOpen} onClose={() => setEntryOpen(false)} onSaved={refetchAll} />
        <ImportReceiptsDrawer open={importOpen} onClose={() => setImportOpen(false)} onImported={refetchAll} />
        <CommissionSettingsDrawer open={commissionOpen} onClose={() => setCommissionOpen(false)} />
      </div>
    </Gate>
  );
}

function NewEntryDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"RECEIVABLE" | "PAYABLE">("RECEIVABLE");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [settled, setSettled] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setType("RECEIVABLE"); setDescription(""); setAmount(""); setDate(new Date().toISOString().slice(0, 10)); setSettled(true); setNotes(""); setError(null);
  }

  async function save() {
    const value = Number(amount.replace(",", "."));
    if (description.trim().length < 2) { setError("Informe uma descrição."); return; }
    if (!Number.isFinite(value) || value <= 0) { setError("Informe um valor válido."); return; }
    setSaving(true); setError(null);
    try {
      const entry = await financialApi.createEntry({
        type,
        amount: value,
        description: description.trim(),
        dueDate: new Date(`${date}T12:00:00`).toISOString(),
        notes: notes.trim() || undefined,
      });
      // "Já pago/recebido": liquida na hora para refletir no saldo.
      if (settled) await financialApi.payEntry(entry.id, { paidAt: new Date(`${date}T12:00:00`).toISOString() });
      reset();
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Não foi possível salvar o lançamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} eyebrow="Conta geral" title="Novo lançamento" width="max-w-md"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</button>
      </>}>
      <div className="space-y-4">
        {error && <p className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setType("RECEIVABLE")} className={`h-10 rounded-[var(--radius-md)] border text-sm font-medium ${type === "RECEIVABLE" ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-[var(--color-border)]"}`}>Entrada</button>
          <button type="button" onClick={() => setType("PAYABLE")} className={`h-10 rounded-[var(--radius-md)] border text-sm font-medium ${type === "PAYABLE" ? "border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)]" : "border-[var(--color-border)]"}`}>Saída</button>
        </div>
        <Field label="Descrição *"><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} placeholder="Ex.: Recebimento de serviço, compra de peça…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$) *"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></Field>
          <Field label="Data"><input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} /> Já {type === "RECEIVABLE" ? "recebido" : "pago"} (reflete no saldo)</label>
        <Field label="Observações (opcional)"><textarea className={`${inputCls} h-auto py-2 resize-none`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} /></Field>
      </div>
    </Drawer>
  );
}

function ImportReceiptsDrawer({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const receipts = useQuery<ImportableReceipt[]>((signal) => (open ? financialApi.listImportableReceipts({ signal }) : Promise.resolve([])), [open, tick]);
  const items = receipts.data ?? [];

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function importSelected(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true); setMessage(null);
    try {
      const { imported } = await financialApi.importReceipts(ids);
      setMessage(`${imported} recibo(s) lançado(s) como entrada.`);
      setSelected(new Set());
      setTick((v) => v + 1);
      onImported();
    } catch {
      setMessage("Não foi possível importar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} eyebrow="Conta geral" title="Importar recibos" width="max-w-lg"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Fechar</button>
        <button className="btn-primary" disabled={busy || selected.size === 0} onClick={() => void importSelected([...selected])}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Lançar selecionados ({selected.size})</button>
      </>}>
      <div className="space-y-3">
        <p className="text-caption">Recibos emitidos que ainda não viraram entrada na conta geral. O valor total é extraído automaticamente.</p>
        {message && <p className="rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2 text-sm text-[var(--color-primary)]">{message}</p>}
        {receipts.loading && !receipts.data ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        ) : items.length === 0 ? (
          <EmptyState icon={Download} title="Nada para importar" description="Todos os recibos emitidos já estão lançados." />
        ) : (
          <>
            <button type="button" className="text-sm font-medium text-[var(--color-primary)]" onClick={() => setSelected(new Set(items.map((r) => r.operationId)))}>Selecionar todos</button>
            <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
              {items.map((receipt) => (
                <li key={receipt.operationId}>
                  <label className="flex items-center gap-3 p-3 hover:bg-[var(--color-muted)]/40">
                    <input type="checkbox" checked={selected.has(receipt.operationId)} onChange={() => toggle(receipt.operationId)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{receipt.receiptNumber ? `Recibo ${receipt.receiptNumber}` : "Recibo"}{receipt.customerName ? ` · ${receipt.customerName}` : ""}</span>
                      <span className="block truncate text-caption">{receipt.service ?? "Serviço"} · {formatDate(receipt.date)}</span>
                    </span>
                    <strong className="font-mono text-sm text-emerald-600">+{formatCurrencyBRL(Number(receipt.amount))}</strong>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}

function parseEnum<T extends string>(value: string | null, allowed: readonly (T | "")[]): T | "" {
  return value && allowed.includes(value as T) ? (value as T) : "";
}
