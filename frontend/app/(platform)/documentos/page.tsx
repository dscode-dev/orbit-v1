"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@platform/components/page-header";
import { DataTable, type Column } from "@platform/components/data-table";
import { Pagination } from "@platform/components/pagination";
import { FilterBar } from "@erp/ui/filter-bar";
import { StatusChip, type ChipTone } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { ErrorState } from "@erp/ui/states";
import { EmptyState } from "@erp/ui/empty-state";
import { Drawer } from "@erp/ui/drawer";
import { DocumentViewer } from "@erp/ui/documents/document-viewer";
import { documentsApi, useQuery, type DocumentCatalogItem, type DocumentEditorialStatus, type DocumentKind } from "@erp/api";
import { DOCUMENT_KIND_LABEL } from "@erp/types";
import { formatBytes, formatDate, formatDateTime } from "@erp/utils";

const STATUS: Record<DocumentEditorialStatus, { tone: ChipTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Rascunho" }, PENDING: { tone: "warning", label: "Pendente" },
  READY: { tone: "success", label: "Pronto" }, STALE: { tone: "danger", label: "Desatualizado" },
};
const KINDS: DocumentKind[] = ["WORK_ORDER", "TECHNICAL_REPORT", "TECHNICAL_OPINION", "PMOC", "BUDGET", "QUOTE", "RECEIPT", "REPORT"];
const selectCls = "h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-sm outline-none focus:border-[var(--color-primary)]";

export default function DocumentosPage() {
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState(""); const [customerId, setCustomerId] = useState("");
  const [equipmentId, setEquipmentId] = useState(""); const [operatorId, setOperatorId] = useState("");
  const [kind, setKind] = useState<"" | DocumentKind>(""); const [status, setStatus] = useState<"" | DocumentEditorialStatus>("");
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [detail, setDetail] = useState<DocumentCatalogItem | null>(null);
  const docs = useQuery((signal) => documentsApi.listDocuments({ page, limit, search: search || undefined, customerId: customerId || undefined, equipmentId: equipmentId || undefined, operatorId: operatorId || undefined, type: kind || undefined, editorialStatus: status || undefined, includeDrafts: includeDrafts || undefined, from: from || undefined, to: to || undefined, signal }), [page, limit, search, customerId, equipmentId, operatorId, kind, status, includeDrafts, from, to]);
  const items = useMemo(() => docs.data?.items ?? [], [docs.data]);
  const options = useMemo(() => ({
    customers: unique(items.flatMap((item) => item.customer ? [item.customer] : [])),
    equipments: unique(items.flatMap((item) => item.equipment ? [item.equipment] : [])),
    operators: unique(items.flatMap((item) => item.responsible ? [item.responsible] : [])),
  }), [items]);
  const columns: Column<DocumentCatalogItem>[] = [
    { key: "doc", header: "Documento", cell: (d) => <div><div className="font-medium">{d.number}</div><div className="text-caption">{DOCUMENT_KIND_LABEL[d.type]}</div></div> },
    { key: "customer", header: "Cliente", cell: (d) => d.customer?.name ?? "—" },
    { key: "equipment", header: "Equipamento", cell: (d) => d.equipment?.name ?? "—" },
    { key: "origin", header: "Origem", cell: (d) => d.origin === "BUDGET" ? "Orçamento" : "Operação" },
    { key: "responsible", header: "Responsável", cell: (d) => d.responsible?.name ?? "—" },
    { key: "issued", header: "Emissão", cell: (d) => formatDate(d.issuedAt) },
    { key: "version", header: "Versão", cell: (d) => `v${d.version} · r${d.revision}` },
    { key: "status", header: "Status", cell: (d) => <StatusChip tone={STATUS[d.editorialStatus].tone} dot>{STATUS[d.editorialStatus].label}</StatusChip> },
  ];
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  return <div className="space-y-6 max-w-[1500px]">
    <PageHeader eyebrow="Documentos" title="Central de documentos" description="Repositório oficial de todos os documentos emitidos pelo Orbit." />
    <FilterBar search={search} onSearch={resetPage(setSearch)} searchPlaceholder="Número, cliente ou equipamento…">
      <Select label="Cliente" value={customerId} onChange={resetPage(setCustomerId)} options={options.customers} />
      <Select label="Equipamento" value={equipmentId} onChange={resetPage(setEquipmentId)} options={options.equipments} />
      <Select label="Operador" value={operatorId} onChange={resetPage(setOperatorId)} options={options.operators} />
      <select className={selectCls} value={kind} onChange={(e) => resetPage(setKind)(e.target.value as DocumentKind | "")}><option value="">Todos os tipos</option>{KINDS.map((item) => <option key={item} value={item}>{DOCUMENT_KIND_LABEL[item]}</option>)}</select>
      <select className={selectCls} value={status} onChange={(e) => resetPage(setStatus)(e.target.value as DocumentEditorialStatus | "")}><option value="">Todos os status</option>{Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
      <input className={selectCls} type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} aria-label="Data inicial" />
      <input className={selectCls} type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} aria-label="Data final" />
      <Toggle checked={includeDrafts} onChange={resetPage(setIncludeDrafts)} label="Mostrar rascunhos" />
    </FilterBar>
    {docs.loading && !docs.data ? <SkeletonList rows={6} /> : docs.error && !docs.data ? <ErrorState error={docs.error} onRetry={docs.refetch} /> : items.length === 0 ? <EmptyState icon={FileText} title="Nenhum documento" description="Nenhum documento emitido corresponde aos filtros." /> : <div className="space-y-3"><DataTable columns={columns} rows={items} onRowClick={setDetail} />{docs.data && <Pagination pagination={docs.data.pagination} onPageChange={setPage} onPageSizeChange={(value) => { setLimit(value); setPage(1); }} />}</div>}
    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} eyebrow="Documento oficial" title={detail?.number ?? ""} width="max-w-[1280px]">
      {detail && <div className="space-y-5">
        <section><h3 className="font-semibold">Resumo</h3><p className="text-sm text-[var(--color-muted-foreground)]">{DOCUMENT_KIND_LABEL[detail.type]} · {STATUS[detail.editorialStatus].label} · versão {detail.version} · revisão {detail.revision}</p></section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Meta label="Cliente" value={detail.customer?.name} /><Meta label="Equipamento" value={detail.equipment?.name} /><Meta label="Responsável" value={detail.responsible?.name} /><Meta label="Emissão" value={formatDateTime(detail.issuedAt)} /><Meta label="Origem" value={detail.origin === "BUDGET" ? "Orçamento" : "Operação"} /><Meta label="Tamanho" value={formatBytes(detail.fileSize)} /></section>
        <section><h3 className="font-semibold mb-2">Assinaturas, preview e ações</h3><DocumentViewer source={{ documentId: detail.id, type: detail.type }} title={detail.number} onRendered={() => docs.refetch()} /></section>
      </div>}
    </Drawer>
  </div>;
}

function unique<T extends { id: string; name: string }>(items: T[]): T[] { return Array.from(new Map(items.map((item) => [item.id, item])).values()); }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }> }) { return <select className={selectCls} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Todos · {label.toLowerCase()}</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>; }
function Meta({ label, value }: { label: string; value?: string | null }) { return <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"><div className="text-caption">{label}</div><div className="text-sm font-medium">{value || "—"}</div></div>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 h-9 px-1 text-sm text-[var(--color-foreground)]" title="Rascunhos (ex.: OS ainda não emitidas) ficam ocultos por padrão">
    <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </span>
    {label}
  </button>;
}
