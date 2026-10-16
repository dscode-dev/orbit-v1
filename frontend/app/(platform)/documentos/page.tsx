"use client";

import { useMemo, useState } from "react";
import { ArchiveRestore, FileText, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { ReceiptEditDrawer } from "@platform/components/receipt-edit-drawer";
import { PageHeader } from "@platform/components/page-header";
import { DataTable, type Column } from "@platform/components/data-table";
import { Pagination } from "@platform/components/pagination";
import { FilterBar } from "@erp/ui/filter-bar";
import { StatusChip, type ChipTone } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { ErrorState } from "@erp/ui/states";
import { EmptyState } from "@erp/ui/empty-state";
import { Drawer } from "@erp/ui/drawer";
import { ConfirmDialog } from "@erp/ui/confirm-dialog";
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
  const { hasRole } = useAuth();
  const canEditReceipts = hasRole("OWNER", "MANAGER");
  // Exclusão lógica de documento (inclusive emitido/assinado) e restauração: só o proprietário.
  const canDelete = hasRole("OWNER");
  const [toDelete, setToDelete] = useState<DocumentCatalogItem | null>(null);
  const [toRestore, setToRestore] = useState<DocumentCatalogItem | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingReceipt, setEditingReceipt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function editReceipt(document: DocumentCatalogItem) { setDetail(null); setNotice(null); setEditingReceipt(document.id); }

  const [page, setPage] = useState(1); const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState(""); const [customerId, setCustomerId] = useState("");
  const [equipmentId, setEquipmentId] = useState(""); const [operatorId, setOperatorId] = useState("");
  const [kind, setKind] = useState<"" | DocumentKind>(""); const [status, setStatus] = useState<"" | DocumentEditorialStatus>("");
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [detail, setDetail] = useState<DocumentCatalogItem | null>(null);
  const docs = useQuery((signal) => documentsApi.listDocuments({ page, limit, search: search || undefined, customerId: customerId || undefined, equipmentId: equipmentId || undefined, operatorId: operatorId || undefined, type: kind || undefined, editorialStatus: status || undefined, includeDrafts: includeDrafts || undefined, deleted: showDeleted || undefined, from: from || undefined, to: to || undefined, signal }), [page, limit, search, customerId, equipmentId, operatorId, kind, status, includeDrafts, showDeleted, from, to]);
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
    { key: "status", header: "Status", cell: (d) => d.deletedAt ? <StatusChip tone="danger" dot>Excluído · {formatDateTime(d.deletedAt)}</StatusChip> : <StatusChip tone={d.canceledAt ? "danger" : STATUS[d.editorialStatus].tone} dot>{d.canceledAt ? "Cancelado" : STATUS[d.editorialStatus].label}</StatusChip> },
    ...(canEditReceipts ? [{ key: "actions", header: "Ações", cell: (d: DocumentCatalogItem) => d.deletedAt ? (
      canDelete ? <button type="button" title={d.operationDeleted ? "Excluído junto com o atendimento" : "Restaurar documento"} aria-label={`Restaurar ${d.number}`} onClick={(event) => { event.stopPropagation(); setNotice(null); setDeleteError(null); setToRestore(d); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-primary)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5"><ArchiveRestore className="h-4 w-4" /> Restaurar</button> : null
    ) : (
      <div className="flex items-center gap-1">
        {d.type === "RECEIPT" && !d.canceledAt && <button type="button" onClick={(event) => { event.stopPropagation(); editReceipt(d); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"><Pencil className="h-4 w-4" /> Editar recibo</button>}
        {canDelete && <button type="button" title="Excluir documento" aria-label={`Excluir ${d.number}`} onClick={(event) => { event.stopPropagation(); setNotice(null); setDeleteError(null); setToDelete(d); }} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-danger)] transition hover:border-[var(--color-danger)]/50 hover:bg-[var(--color-danger)]/10"><Trash2 className="h-4 w-4" /></button>}
      </div>
    ) }] : []),
  ];
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  return <div className="space-y-6 max-w-[1500px]">
    <PageHeader eyebrow="Documentos" title="Central de documentos" description="Repositório oficial de todos os documentos emitidos pelo Orbit." />
    {notice && <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-success)]/10 p-3 text-sm text-[var(--color-success)]">{notice}</p>}
    {deleteError && <p role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{deleteError}</p>}
    <FilterBar search={search} onSearch={resetPage(setSearch)} searchPlaceholder="Número, cliente ou equipamento…">
      <Select label="Cliente" value={customerId} onChange={resetPage(setCustomerId)} options={options.customers} />
      <Select label="Equipamento" value={equipmentId} onChange={resetPage(setEquipmentId)} options={options.equipments} />
      <Select label="Operador" value={operatorId} onChange={resetPage(setOperatorId)} options={options.operators} />
      <select className={selectCls} value={kind} onChange={(e) => resetPage(setKind)(e.target.value as DocumentKind | "")}><option value="">Todos os tipos</option>{KINDS.map((item) => <option key={item} value={item}>{DOCUMENT_KIND_LABEL[item]}</option>)}</select>
      <select className={selectCls} value={status} onChange={(e) => resetPage(setStatus)(e.target.value as DocumentEditorialStatus | "")}><option value="">Todos os status</option>{Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
      <input className={selectCls} type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} aria-label="Data inicial" />
      <input className={selectCls} type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} aria-label="Data final" />
      <Toggle checked={includeDrafts} onChange={resetPage(setIncludeDrafts)} label="Mostrar rascunhos" />
      {canDelete && <Toggle checked={showDeleted} onChange={resetPage(setShowDeleted)} label="Mostrar só excluídos" />}
    </FilterBar>
    {showDeleted && <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-3 text-sm text-[var(--color-muted-foreground)]">Documentos excluídos continuam guardados para auditoria, com PDF e revisões. Use <strong>Restaurar</strong> para trazê-los de volta.</p>}
    {docs.loading && !docs.data ? <SkeletonList rows={6} /> : docs.error && !docs.data ? <ErrorState error={docs.error} onRetry={docs.refetch} /> : items.length === 0 ? <EmptyState icon={FileText} title={showDeleted ? "Nenhum documento excluído" : "Nenhum documento"} description={showDeleted ? "Os documentos excluídos aparecerão aqui, prontos para restaurar." : "Nenhum documento emitido corresponde aos filtros."} /> : <div className="space-y-3"><DataTable columns={columns} rows={items} onRowClick={setDetail} />{docs.data && <Pagination pagination={docs.data.pagination} onPageChange={setPage} onPageSizeChange={(value) => { setLimit(value); setPage(1); }} />}</div>}
    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} eyebrow="Documento oficial" title={detail?.number ?? ""} width="max-w-[1280px]">
      {detail && <div className="space-y-5">
        <section><h3 className="font-semibold">Resumo</h3><p className="text-sm text-[var(--color-muted-foreground)]">{DOCUMENT_KIND_LABEL[detail.type]} · {detail.canceledAt ? "Cancelado" : STATUS[detail.editorialStatus].label} · versão {detail.version} · revisão {detail.revision}</p></section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Meta label="Cliente" value={detail.customer?.name} /><Meta label="Equipamento" value={detail.equipment?.name} /><Meta label="Responsável" value={detail.responsible?.name} /><Meta label="Emissão" value={formatDateTime(detail.issuedAt)} /><Meta label="Origem" value={detail.origin === "BUDGET" ? "Orçamento" : "Operação"} /><Meta label="Tamanho" value={formatBytes(detail.fileSize)} /></section>
        <div className="flex flex-wrap gap-2">
          {canEditReceipts && detail.type === "RECEIPT" && !detail.canceledAt && <button type="button" onClick={() => editReceipt(detail)} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"><Pencil className="h-4 w-4" /> Editar recibo</button>}
          {canDelete && detail.deletedAt && <button type="button" onClick={() => { setDeleteError(null); setToRestore(detail); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5"><ArchiveRestore className="h-4 w-4" /> Restaurar documento</button>}
          {canDelete && !detail.deletedAt && <button type="button" onClick={() => { setDeleteError(null); setToDelete(detail); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"><Trash2 className="h-4 w-4" /> Excluir documento</button>}
        </div>
        {detail.deletedAt && <p className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">Documento excluído em {formatDateTime(detail.deletedAt)}. Ele continua guardado; a visualização e o PDF seguem disponíveis para consulta, mas não pode ser gerado nem revisado até ser restaurado.</p>}
        {detail.canceledAt ? <p className="text-sm text-[var(--color-danger)]">Recibo cancelado. O lançamento financeiro foi estornado e o documento não pode ser emitido.</p> : <section><h3 className="font-semibold mb-2">Assinaturas, preview e ações</h3><DocumentViewer source={{ documentId: detail.id, type: detail.type }} title={detail.number} onRendered={() => docs.refetch()} /></section>}
      </div>}
    </Drawer>
    <ConfirmDialog
      open={toDelete !== null}
      title={`Excluir ${toDelete?.number ?? "documento"}?`}
      description={toDelete && (
        <div className="space-y-2">
          <p><strong>{DOCUMENT_KIND_LABEL[toDelete.type]}</strong>{toDelete.customer?.name ? ` de ${toDelete.customer.name}` : ""} sai da central de documentos, das revisões e do portal do cliente, mas <strong>continua guardado no sistema</strong>, com o PDF e todas as revisões, para auditoria.</p>
          <p className="text-[var(--color-muted-foreground)]">Enquanto estiver excluído, o documento não pode ser gerado de novo nem revisado.{toDelete.type === "RECEIPT" ? " O lançamento financeiro do recibo não é alterado; para estorná-lo, cancele o recibo." : ""}</p>
          <p className="rounded-[var(--radius-md)] bg-[var(--color-muted)]/60 px-3 py-2">Para recuperar, ative <strong>Mostrar só excluídos</strong> nesta tela e clique em <strong>Restaurar</strong>.</p>
        </div>
      )}
      confirmLabel="Excluir documento"
      danger
      onClose={() => setToDelete(null)}
      onConfirm={async () => {
        if (!toDelete) return;
        const target = toDelete;
        try {
          await documentsApi.deleteDocument(target.id);
          setToDelete(null);
          if (detail?.id === target.id) setDetail(null);
          setNotice(`${target.number} foi excluído. Ele continua guardado e pode ser restaurado em “Mostrar só excluídos”.`);
          docs.refetch();
        } catch (cause) {
          setToDelete(null);
          setDeleteError(cause instanceof Error ? cause.message : "Não foi possível excluir o documento.");
          throw cause;
        }
      }}
    />
    <ConfirmDialog
      open={toRestore !== null}
      title={`Restaurar ${toRestore?.number ?? "documento"}?`}
      description={toRestore?.operationDeleted
        ? <p>Este documento foi excluído <strong>junto com o atendimento</strong>. Para recuperá-lo, restaure o atendimento em Operações → Excluídas; os documentos dele voltam junto.</p>
        : <p>O documento volta à central de documentos e aos fluxos de revisão como estava antes da exclusão.</p>}
      confirmLabel="Restaurar documento"
      onClose={() => setToRestore(null)}
      onConfirm={async () => {
        if (!toRestore) return;
        const target = toRestore;
        try {
          await documentsApi.restoreDocument(target.id);
          setToRestore(null);
          if (detail?.id === target.id) setDetail(null);
          setNotice(`${target.number} foi restaurado.`);
          docs.refetch();
        } catch (cause) {
          setToRestore(null);
          setDeleteError(cause instanceof Error ? cause.message : "Não foi possível restaurar o documento.");
          throw cause;
        }
      }}
    />
    {editingReceipt && <ReceiptEditDrawer key={editingReceipt} documentId={editingReceipt} onClose={() => setEditingReceipt(null)} onSaved={(canceled) => { setEditingReceipt(null); setNotice(canceled ? "Recibo cancelado e lançamento financeiro estornado." : "Recibo atualizado e saldo financeiro ajustado. Abra o documento e gere o PDF atualizado."); docs.refetch(); }} />}
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
