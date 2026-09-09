"use client";

/**
 * OperationDetailDrawer — full lateral view of an Operation: timeline, checklist,
 * photos, observations, signature and related documents. Reuses the shared
 * OperationView (Sections → Renderers) foundation. Document previews use the
 * production Document Engine viewer.
 */
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Ban, Copy, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { StatusChip } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { ErrorState } from "@erp/ui/states";
import { AssetTimeline } from "@erp/ui/assets/asset-timeline";
import { OperationView } from "@erp/ui/operations/operation-view";
import { OPERATION_STATUS, OPERATION_TYPE_LABEL, operationCode } from "@erp/ui/operations/operation-shared";
import { DocumentViewer } from "@erp/ui/documents/document-viewer";
import { SignaturePad } from "@erp/ui/documents/signature-pad";
import { CustomerSignaturePreview } from "@erp/ui/documents/customer-signature-preview";
import { PhotoInput, type CapturedPhoto } from "@erp/ui/photo-input";
import { Gate } from "@erp/ui/auth/gate";
import { ConfirmDialog } from "@erp/ui/confirm-dialog";
import { assignmentsApi, budgetsApi, documentsApi, inventoryApi, operationApi, signaturesApi, useQuery, type Assignment, type Budget, type CreateOperationPayload, type DocumentHandoff, type InventoryItem, type OperationDetail, type OperationDocument, type OperationPart, type Product } from "@erp/api";
import type { DocumentConfiguration, SignatureMode } from "@erp/types";
import { formatCurrencyBRL, formatDateTime, formatNumber } from "@erp/utils";
import { ASSIGNMENT_STATUS_LABEL, assignmentTime } from "@erp/ui/assignments/assignment-shared";
import { AuxiliaryOperatorSelect, UserSelect } from "./entity-select";
import { BudgetWizardDrawer } from "./budget-wizard-drawer";
import { OperationCreationDrawer } from "./operation-creation-drawer";

export function OperationDetailDrawer({
  operationId,
  open,
  onClose,
  assignmentActionLabel = "Reatribuir",
  onDeleted,
  onCopied,
}: {
  operationId: string | null;
  open: boolean;
  onClose: () => void;
  assignmentActionLabel?: string;
  onDeleted?: () => void;
  onCopied?: (operation: OperationDetail) => void;
}) {
  const detail = useQuery<OperationDetail | null>(
    (signal) => (operationId ? operationApi.getOperation(operationId, { signal }) : Promise.resolve(null)),
    [operationId],
  );
  const assignmentQuery = useQuery(
    (signal) => (operationId ? assignmentsApi.listAssignments({ operationId, limit: 20, signal }) : Promise.resolve({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
    [operationId],
  );
  const [photoSources, setPhotoSources] = useState<Record<string, string>>({});
  const [previewDoc, setPreviewDoc] = useState<OperationDocument | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const op = detail.data;
  const editInitialValues = useMemo(
    () => (op ? operationInitialValues(op, false) : undefined),
    [op],
  );
  const copyInitialValues = useMemo(
    () => (op ? operationInitialValues(op, true) : undefined),
    [op],
  );
  const activeCancellation = op?.cancellations?.find((item) => item.status === "REQUESTED") ?? null;
  const isPmoc = Boolean(op?.maintenanceExecution?.plan.pmocPlan);
  const pmocConfiguration = useQuery<DocumentConfiguration | null>(
    (signal) => isPmoc ? documentsApi.getConfigurationByType("PMOC", { signal }) : Promise.resolve(null),
    [isPmoc],
  );

  // Load photo content (base64) once an operation is loaded.
  useEffect(() => {
    if (!op || op.photos.length === 0) { setPhotoSources({}); return; }
    let active = true;
    setPhotoSources({});
    op.photos.forEach((p) => {
      operationApi
        .getOperationPhoto(p.id)
        .then((c) => { if (active) setPhotoSources((prev) => ({ ...prev, [p.id]: `data:${c.mimeType};base64,${c.contentBase64}` })); })
        .catch(() => undefined);
    });
    return () => { active = false; };
  }, [op]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Operação"
      title={op ? operationCode(op.number) : "Operação"}
      width="max-w-2xl"
    >
      {detail.loading && !op ? (
        <SkeletonList rows={6} />
      ) : detail.error && !op ? (
        <ErrorState error={detail.error} onRetry={detail.refetch} />
      ) : op ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone="primary">{OPERATION_TYPE_LABEL[op.type]}</StatusChip>
            <StatusChip tone={activeCancellation ? "danger" : OPERATION_STATUS[op.status].tone} dot>{activeCancellation ? "Cancelado pelo operador" : OPERATION_STATUS[op.status].label}</StatusChip>
            <Gate roles={["OWNER", "MANAGER"]}>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {op.status !== "COMPLETED" ? (
                  <>
                    {op.status === "CANCELED" ? (
                      <button type="button" onClick={async () => {
                        try {
                          setActionError(null);
                          await operationApi.reactivateOperation(op.id);
                          await Promise.all([detail.refetch(), assignmentQuery.refetch()]);
                        } catch (cause) {
                          setActionError(cause instanceof Error ? cause.message : "Não foi possível reativar a operação.");
                        }
                      }} className="btn-secondary h-8 px-2.5 text-xs">
                        <RotateCcw className="h-3.5 w-3.5" /> Reativar
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setActionError(null); setEditOpen(true); }} className="btn-secondary h-8 px-2.5 text-xs">
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </button>
                        <button type="button" onClick={() => { setActionError(null); setConfirmCancel(true); }} className="btn-secondary h-8 px-2.5 text-xs">
                          <Ban className="h-3.5 w-3.5" /> Cancelar
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => { setActionError(null); setConfirmDelete(true); }} className="btn-secondary h-8 px-2.5 text-xs text-[var(--color-danger)]">
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => { setActionError(null); setCopyOpen(true); }} className="btn-secondary h-8 px-2.5 text-xs">
                    <Copy className="h-3.5 w-3.5" /> Copiar operação
                  </button>
                )}
              </span>
            </Gate>
          </div>

          {actionError && <p className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{actionError}</p>}

          {activeCancellation ? (
            <CancellationReviewSection operation={op} photoSources={photoSources} onRefresh={() => { detail.refetch(); assignmentQuery.refetch(); }} onOpenDocument={setPreviewDoc} />
          ) : op.status === "REVIEW" ? <ApprovalSection operation={op} onApproved={detail.refetch} /> : null}

          <DocumentReviewSection operation={op} onSaved={detail.refetch} />

          <AssignmentSection
            assignment={assignmentQuery.data?.items.find((item) => item.isPrimary) ?? null}
            auxiliaryAssignments={op.auxiliaryAssignments ?? []}
            operationStatus={op.status}
            loading={assignmentQuery.loading}
            actionLabel={assignmentActionLabel}
            onRefresh={() => { assignmentQuery.refetch(); detail.refetch(); }}
          />

          <OperationDates operation={op} assignment={assignmentQuery.data?.items.find((item) => item.isPrimary) ?? null} />

          {/* Dados do atendimento primeiro (Identificação, checklist, fotos,
              assinatura, documentos); ações e histórico na sequência. */}
          <OperationView operation={op} photoSources={photoSources} onOpenDocument={(id) => setPreviewDoc(op.documents.find((d) => d.id === id) ?? null)} />

          {isPmoc ? (
            <PmocExecutionEvidenceSection operation={op} configuration={pmocConfiguration.data} configurationLoading={pmocConfiguration.loading} onSaved={detail.refetch} />
          ) : (
            <WorkOrderSignatureSection operation={op} onSaved={detail.refetch} />
          )}

          <OperationBudgetsSection operation={op} />

          <OperationMaterialsSection operationId={op.id} />

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Timeline</h3>
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <AssetTimeline operationId={op.id} compact />
            </div>
          </section>
        </div>
      ) : null}

      <Drawer open={previewDoc !== null} onClose={() => setPreviewDoc(null)} eyebrow="Documento" title={previewDoc?.number ?? ""} width="max-w-[1280px]">
        {op && previewDoc && (
          <DocumentViewer
            source={{ documentId: previewDoc.id, operationId: op.id, type: previewDoc.type }}
            title={previewDoc.number}
            onRendered={detail.refetch}
          />
        )}
      </Drawer>

      {op && editInitialValues && (
        <OperationCreationDrawer
          open={editOpen}
          intent="edit"
          mode="operation"
          initialValues={editInitialValues}
          responsibleLabel={op.operator?.name ?? "Não informado"}
          submitOperation={(payload) => operationApi.updateOperation(op.id, editableOperationPayload(payload))}
          onClose={() => setEditOpen(false)}
          onCreated={() => detail.refetch()}
        />
      )}

      {op && copyInitialValues && (
        <OperationCreationDrawer
          open={copyOpen}
          intent="copy"
          mode="operation"
          initialValues={copyInitialValues}
          onClose={() => setCopyOpen(false)}
          onCreated={(operation) => onCopied?.(operation)}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar esta operação?"
        description="A operação será cancelada e deixará imediatamente a fila do técnico. Depois, você poderá reativá-la como rascunho e fazer uma nova atribuição."
        confirmLabel="Cancelar operação"
        danger
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          if (!op) return;
          try {
            setActionError(null);
            await operationApi.cancelOperation(op.id);
            await Promise.all([detail.refetch(), assignmentQuery.refetch()]);
            onDeleted?.();
          } catch (cause) {
            setActionError(cause instanceof Error ? cause.message : "Não foi possível cancelar a operação.");
            throw cause;
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir esta operação?"
        description="A operação e suas atribuições serão removidas definitivamente. Operações concluídas ou com vínculos históricos, documentais ou comerciais não podem ser excluídas."
        confirmLabel="Excluir operação"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!op) return;
          try {
            setActionError(null);
            await operationApi.deleteOperation(op.id);
            onDeleted?.();
            onClose();
          } catch (cause) {
            setActionError(cause instanceof Error ? cause.message : "Não foi possível excluir a operação.");
            throw cause;
          }
        }}
      />
    </Drawer>
  );
}

function operationInitialValues(
  operation: OperationDetail,
  copy: boolean,
): Partial<CreateOperationPayload> {
  return {
    customerId: operation.customer?.id ?? "",
    addressId: operation.address?.id ?? null,
    equipmentId: operation.equipment?.id ?? null,
    inspectedEquipments: operation.inspectedEquipments.map((item) => ({
      equipmentId: item.equipmentId,
      sector: item.sector,
      systemType: item.systemTypeSnapshot ?? null,
      currentSituation: item.currentSituationSnapshot ?? null,
      manufacturer: item.brandSnapshot ?? item.equipment?.manufacturer ?? null,
      model: item.modelSnapshot ?? item.equipment?.model ?? null,
      capacity: item.capacitySnapshot ?? item.equipment?.capacity ?? null,
    })),
    operatorId: operation.operator?.id ?? null,
    auxiliaryOperatorIds: (operation.auxiliaryAssignments ?? [])
      .filter((item) => item.status !== "CANCELED" && item.status !== "REJECTED")
      .map((item) => item.assignedTo),
    type: operation.type,
    serviceTypes: operation.serviceTypes,
    documentType: operation.requestedDocumentType,
    status: copy ? "DRAFT" : operation.status,
    scheduledFor: operation.scheduledFor,
    checklist: operation.checklist,
    observations: operation.observations,
    reportedIssue: operation.reportedIssue,
    serviceDescription: operation.serviceDescription,
    serviceValue: operation.serviceValue == null ? undefined : Number(operation.serviceValue),
  };
}

function editableOperationPayload(
  payload: CreateOperationPayload,
): Parameters<typeof operationApi.updateOperation>[1] {
  return {
    customerId: payload.customerId,
    addressId: payload.addressId,
    equipmentId: payload.equipmentId,
    type: payload.type,
    serviceTypes: payload.serviceTypes,
    status: payload.status,
    scheduledFor: payload.scheduledFor,
    checklist: payload.checklist,
    observations: payload.observations,
    reportedIssue: payload.reportedIssue,
    serviceDescription: payload.serviceDescription,
    serviceValue: payload.serviceValue ?? null,
    inspectedEquipments: payload.inspectedEquipments,
  };
}

function CancellationReviewSection({ operation, photoSources, onRefresh, onOpenDocument }: { operation: OperationDetail; photoSources: Record<string, string>; onRefresh: () => void; onOpenDocument: (document: OperationDocument) => void }) {
  const cancellation = operation.cancellations.find((item) => item.status === "REQUESTED");
  const [reschedule, setReschedule] = useState(false);
  const [operatorId, setOperatorId] = useState(operation.operator?.id ?? "");
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!cancellation) return null;
  const document = operation.documents.find((item) => item.type === "WORK_ORDER") ?? null;

  async function render() {
    setBusy("render"); setError(null);
    try {
      await documentsApi.renderOperationDocument(operation.id, "WORK_ORDER");
      onRefresh();
      if (document) onOpenDocument(document);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar o relatório."); }
    finally { setBusy(null); }
  }
  async function applyReschedule() {
    if (!operatorId || !scheduledFor) return setError("Selecione o técnico e a nova data.");
    setBusy("reschedule"); setError(null);
    try { await operationApi.rescheduleCanceledOperation(operation.id, { assignedTo: operatorId, scheduledFor: new Date(scheduledFor).toISOString() }); setReschedule(false); onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível reagendar."); }
    finally { setBusy(null); }
  }
  async function approve() {
    if (!window.confirm("Confirmar definitivamente o cancelamento deste atendimento?")) return;
    setBusy("approve"); setError(null);
    try { await operationApi.approveOperationCancellation(operation.id); onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível aprovar o cancelamento."); }
    finally { setBusy(null); }
  }

  return <Gate roles={["OWNER", "MANAGER"]}>
    <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-4">
      <div><p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-danger)]">Cancelado pelo operador</p><p className="mt-1 text-sm">A solicitação aguarda decisão da gestão. A operação ainda não está cancelada definitivamente.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><Info label="Operador" value={cancellation.requestedBy.name} /><Info label="Solicitado em" value={formatDateTime(cancellation.requestedAt)} /><Info label="Agendamento" value={operation.scheduledFor ? formatDateTime(operation.scheduledFor) : "Não agendado"} /><Info label="Cliente" value={operation.customer?.name ?? "—"} /></div>
      <div><div className="text-[11px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Motivo impeditivo</div><p className="mt-1 whitespace-pre-wrap text-sm font-medium">{cancellation.reason}</p></div>
      {cancellation.photos.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{cancellation.photos.map((photo) => photoSources[photo.id] ? <figure key={photo.id} className="overflow-hidden rounded border border-[var(--color-border)] bg-white"><Image unoptimized src={photoSources[photo.id]} width={240} height={160} alt={photo.caption || "Evidência do cancelamento"} className="h-32 w-full object-contain" />{photo.caption && <figcaption className="p-2 text-xs">{photo.caption}</figcaption>}</figure> : null)}</div>}
      <div className="grid gap-2 sm:grid-cols-3"><button type="button" onClick={() => void render()} disabled={Boolean(busy)} className="btn-secondary">{busy === "render" ? "Gerando…" : "Gerar relatório PDF"}</button><button type="button" onClick={() => setReschedule((value) => !value)} disabled={Boolean(busy)} className="btn-secondary">Reagendar</button><button type="button" onClick={() => void approve()} disabled={Boolean(busy)} className="btn-primary">{busy === "approve" ? "Finalizando…" : "Aprovar e finalizar"}</button></div>
      {reschedule && <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3"><UserSelect value={operatorId} onChange={setOperatorId} /><label className="space-y-1"><span className="text-sm font-medium">Nova data e hora</span><input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} className={inputCls} /></label><button type="button" onClick={() => void applyReschedule()} disabled={busy === "reschedule"} className="btn-primary">{busy === "reschedule" ? "Reagendando…" : "Confirmar reagendamento"}</button></div>}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
    </section>
  </Gate>;
}

function ApprovalSection({ operation, onApproved }: { operation: OperationDetail; onApproved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await operationApi.approveOperation(operation.id);
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível aprovar o atendimento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Gate roles={["OWNER", "MANAGER"]}>
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/5 p-4 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-info)]">Aguardando aprovação</p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            O operador concluiu o atendimento em campo. Revise os dados abaixo, selecione a assinatura do <strong>técnico responsável</strong> em “Revisão dos relatórios” (ela vai para o PDF) e aprove para concluir a operação.
          </p>
        </div>
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        <button
          type="button"
          onClick={approve}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          {busy ? "Aprovando…" : "Aprovar atendimento"}
        </button>
      </section>
    </Gate>
  );
}

const EDITORIAL_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  PENDING: "Aguardando finalização",
  READY: "Pronto — PDF liberado",
  STALE: "Desatualizado — finalize novamente",
};

/**
 * Revisão documental da operação: o responsável (OWNER/MANAGER) seleciona qual
 * assinatura de técnico responsável vai para o relatório e finaliza a revisão.
 * Sem isso o PDF fica bloqueado ("Finalize a revisão antes de gerar o PDF").
 * Visível sempre que houver documento enviado — cobre também operações já
 * concluídas com documentos pendentes de finalização.
 */
function DocumentReviewSection({ operation, onSaved }: { operation: OperationDetail; onSaved: () => void }) {
  const handoffs = useQuery<Array<DocumentHandoff | null>>(
    (signal) =>
      Promise.all(
        operation.documents.map((doc) => documentsApi.getHandoff(doc.id, { signal }).catch(() => null)),
      ),
    [operation.documents.map((doc) => doc.id).join(",")],
  );
  const signatures = useQuery(
    (signal) => signaturesApi.listSignatures({ active: true, limit: 100, signal }),
    [],
  );

  const submitted = (handoffs.data ?? []).filter(
    (h): h is DocumentHandoff => Boolean(h?.submittedAt),
  );
  if (submitted.length === 0) return null;

  const availableSignatures = (signatures.data?.items ?? []).filter((s) => s.hasImage);
  const pending = submitted.filter((h) => h.editorialStatus !== "READY");

  return (
    <Gate roles={["OWNER", "MANAGER"]}>
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Revisão dos relatórios</h3>
        <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {pending.length > 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Selecione a assinatura do <strong>técnico responsável</strong> que vai para o relatório (ela também aparece na Identificação) e finalize para liberar o PDF.
            </p>
          )}
          {submitted.map((handoff) => (
            <HandoffReviewRow
              key={handoff.id}
              handoff={handoff}
              signatures={availableSignatures}
              signaturesLoading={signatures.loading}
              onSaved={() => { handoffs.refetch(); onSaved(); }}
            />
          ))}
        </div>
      </section>
    </Gate>
  );
}

function HandoffReviewRow({
  handoff,
  signatures,
  signaturesLoading,
  onSaved,
}: {
  handoff: DocumentHandoff;
  signatures: Array<{ id: string; name: string; title: string; isDefault: boolean }>;
  signaturesLoading: boolean;
  onSaved: () => void;
}) {
  const [signatureId, setSignatureId] = useState(
    handoff.technicalSignature?.id ?? signatures.find((s) => s.isDefault)?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signatureId && signatures.length > 0) {
      setSignatureId(handoff.technicalSignature?.id ?? signatures.find((s) => s.isDefault)?.id ?? signatures[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatures, handoff.technicalSignature?.id]);

  const ready = handoff.editorialStatus === "READY";

  async function finalize() {
    if (!signatureId) { setError("Selecione a assinatura do técnico responsável."); return; }
    setBusy(true);
    setError(null);
    try {
      await documentsApi.startHandoffReview(handoff.id);
      await documentsApi.selectHandoffTechnicalSignature(handoff.id, signatureId);
      await documentsApi.finalizeHandoffReview(handoff.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível finalizar a revisão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{handoff.number}</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">{handoff.type} · revisão {handoff.revision}</p>
        </div>
        <StatusChip tone={ready ? "success" : "warning"} dot>{EDITORIAL_LABEL[handoff.editorialStatus] ?? handoff.editorialStatus}</StatusChip>
      </div>
      {ready && handoff.technicalSignature ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Técnico responsável: <strong className="text-[var(--color-foreground)]">{handoff.technicalSignature.name}</strong>
          {handoff.technicalSignature.title ? ` · ${handoff.technicalSignature.title}` : ""}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={signatureId}
              onChange={(e) => setSignatureId(e.target.value)}
              className="h-9 flex-1 min-w-[220px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-sm outline-none focus:border-[var(--color-primary)]"
              aria-label="Assinatura do técnico responsável"
            >
              {signaturesLoading && <option value="">Carregando assinaturas…</option>}
              {!signaturesLoading && signatures.length === 0 && <option value="">Nenhuma assinatura cadastrada com imagem</option>}
              {signatures.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.title ? ` — ${s.title}` : ""}{s.isDefault ? " (padrão)" : ""}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={finalize}
              disabled={busy || !signatureId}
              className="h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
            >
              {busy ? "Finalizando…" : "Aplicar assinatura e finalizar"}
            </button>
          </div>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          {signatures.length === 0 && !signaturesLoading && (
            <p className="text-xs text-[var(--color-warning)]">Cadastre assinaturas do responsável técnico (com imagem) em Configurações para finalizar relatórios.</p>
          )}
        </>
      )}
    </div>
  );
}

function OperationDates({ operation, assignment }: { operation: OperationDetail; assignment: Assignment | null }) {
  const dates = [
    ["Criado em", formatDateTime(operation.createdAt)],
    ["Agendado para", operation.scheduledFor ? formatDateTime(operation.scheduledFor) : "Não agendado"],
    ...(assignment?.acceptedAt ? [["Aceito em", formatDateTime(assignment.acceptedAt)]] : []),
    ...(operation.startedAt ? [["Iniciado em", formatDateTime(operation.startedAt)]] : []),
    ...(operation.completedAt ? [["Concluído em", formatDateTime(operation.completedAt)]] : []),
    ...(operation.signedAt ? [["Assinado em", formatDateTime(operation.signedAt)]] : []),
  ];
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Datas</h3>
      <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:grid-cols-2">
        {dates.map(([label, value]) => (
          <div key={label} className={label === "Agendado para" ? "rounded-[var(--radius-md)] bg-[var(--color-primary)]/8 p-2 -m-2" : ""}>
            <Info label={label} value={value} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PmocExecutionEvidenceSection({ operation, configuration, configurationLoading, onSaved }: { operation: OperationDetail; configuration: DocumentConfiguration | null | undefined; configurationLoading: boolean; onSaved: () => void }) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(operation.customerSignerName ?? "");
  const [signerRole, setSignerRole] = useState(operation.customerSignerRole ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const mode: SignatureMode | null = configuration?.defaultTemplate?.signatureMode ?? null;
  const collects = mode === "COLLECTED" || mode === "HYBRID";

  async function save() {
    setSaving(true);
    setError(null);
    setFeedback(null);
    setPhotos((current) => current.map((photo) => ({ ...photo, status: "saving" })));
    try {
      const encoded = await Promise.all(photos.map(async (photo) => ({
        dataUrl: await fileDataUrl(photo.file),
        caption: photo.caption?.trim() || null,
      })));
      await operationApi.updateOperation(operation.id, {
        photos: encoded,
        ...(collects && signature ? {
          signatureData: signature,
          customerSignerName: signerName.trim(),
          customerSignerRole: signerRole.trim() || null,
          signedAt: new Date().toISOString(),
        } : {}),
      });
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setPhotos([]);
      setSignature(null);
      setFeedback("Evidências salvas. O preview foi atualizado e qualquer PDF anterior ficou desatualizado.");
      onSaved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar as evidências.";
      setPhotos((current) => current.map((photo) => ({ ...photo, status: "error", error: message })));
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return <Gate roles={["OWNER", "MANAGER", "OPERATOR"]}>
    <section className="space-y-3">
      <div><h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Evidências e assinatura do PMOC</h3><p className="mt-1 text-xs text-[var(--color-muted-foreground)]">O preenchimento pode ser salvo parcialmente. Quatro imagens são obrigatórias apenas para concluir e emitir o documento final.</p></div>
      <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <PhotoInput photos={photos} onChange={setPhotos} max={16} existingCount={operation.photos.length} requiredMinimum={4} disabled={saving} />
        {configurationLoading && <SkeletonList rows={2} />}
        {!configurationLoading && mode === "FIXED" && <p className="rounded-[var(--radius-md)] bg-[var(--color-muted)] px-3 py-2 text-sm">A assinatura institucional configurada no modelo será aplicada automaticamente.</p>}
        {!configurationLoading && collects && <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"><p className="text-sm font-medium">Assinatura do cliente</p><div className="grid gap-2 sm:grid-cols-2"><input value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Nome do cliente/responsável" className={inputCls} /><input value={signerRole} onChange={(event) => setSignerRole(event.target.value)} placeholder="Função ou vínculo" className={inputCls} /></div><SignaturePad onChange={setSignature} onConfirm={setSignature} /></div>}
        {!configurationLoading && !mode && <p className="text-sm text-[var(--color-danger)]">Não foi possível resolver a política do modelo PMOC.</p>}
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        {feedback && <p className="text-sm text-[var(--color-success)]">{feedback}</p>}
        <button type="button" onClick={() => void save()} disabled={saving || configurationLoading || (photos.length === 0 && !signature) || (Boolean(signature) && !signerName.trim())} className="h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50">{saving ? "Salvando…" : "Salvar evidências do PMOC"}</button>
      </div>
    </section>
  </Gate>;
}

function WorkOrderSignatureSection({ operation, onSaved }: { operation: OperationDetail; onSaved: () => void }) {
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(operation.customerSignerName ?? "");
  const [signerRole, setSignerRole] = useState(operation.customerSignerRole ?? "");
  const [replacing, setReplacing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captured = Boolean(operation.signatureCaptured);
  // O registro oficial (imagem + quem coletou) vive no handoff do documento.
  const signedDocument =
    operation.documents.find((d) => d.type === operation.requestedDocumentType) ??
    operation.documents.find((d) => d.type === "WORK_ORDER") ??
    operation.documents[0] ?? null;
  const handoff = useQuery(
    (signal) =>
      captured && signedDocument
        ? documentsApi.getHandoff(signedDocument.id, { signal }).catch(() => null)
        : Promise.resolve(null),
    [captured, signedDocument?.id],
  );

  useEffect(() => {
    setSignerName(operation.customerSignerName ?? "");
    setSignerRole(operation.customerSignerRole ?? "");
  }, [operation.customerSignerName, operation.customerSignerRole]);

  async function save(value = signature) {
    if (!value || saving) return;
    if (!signerName.trim()) {
      setError("Informe o nome de quem assinou.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await operationApi.updateOperation(operation.id, {
        signatureData: value,
        customerSignerName: signerName.trim(),
        customerSignerRole: signerRole.trim() || null,
        signedAt: new Date().toISOString(),
      });
      setSignature(null);
      setReplacing(false);
      await Promise.resolve(onSaved());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a assinatura.");
    } finally {
      setSaving(false);
    }
  }

  const customerSignature = handoff.data?.customerSignature ?? null;

  return (
    <Gate roles={["OWNER", "MANAGER", "OPERATOR"]}>
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Assinatura do cliente</h3>
        <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {captured && !replacing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Assinado por" value={`${customerSignature?.name ?? operation.customerSignerName ?? "Não identificado"}${(customerSignature?.role ?? operation.customerSignerRole) ? ` · ${customerSignature?.role ?? operation.customerSignerRole}` : ""}`} />
                <Info label="Assinada em" value={operation.signedAt ? formatDateTime(operation.signedAt) : customerSignature ? formatDateTime(customerSignature.collectedAt) : "—"} />
                {customerSignature?.collectedBy && <Info label="Coletada por" value={customerSignature.collectedBy.name} />}
              </div>
              {handoff.data && customerSignature ? (
                <CustomerSignaturePreview documentId={handoff.data.id} name={customerSignature.name} />
              ) : handoff.loading ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">Carregando assinatura…</p>
              ) : (
                <p className="text-sm text-[var(--color-success)]">Assinatura coletada e protegida pelo backend.</p>
              )}
              <button type="button" onClick={() => setReplacing(true)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-muted)]">
                Substituir assinatura
              </button>
            </>
          ) : (
            <>
              {replacing && <p className="text-sm text-[var(--color-warning)]">A nova assinatura substituirá a atual e invalidará PDFs anteriores.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Nome do cliente/responsável *" className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--color-primary)]" />
                <input value={signerRole} onChange={(e) => setSignerRole(e.target.value)} placeholder="Função ou vínculo (opcional)" className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--color-primary)]" />
              </div>
              <SignaturePad onChange={setSignature} onConfirm={setSignature} />
              {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void save()} disabled={!signature || !signerName.trim() || saving} className="h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50">
                  {saving ? "Salvando assinatura…" : "Salvar assinatura"}
                </button>
                {replacing && (
                  <button type="button" onClick={() => { setReplacing(false); setSignature(null); setError(null); }} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-muted)]">
                    Cancelar
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Os dados do signatário acompanham a assinatura no relatório final. PDFs anteriores ficam bloqueados como desatualizados.</p>
            </>
          )}
        </div>
      </section>
    </Gate>
  );
}

function AssignmentSection({
  assignment,
  auxiliaryAssignments,
  operationStatus,
  loading,
  actionLabel,
  onRefresh,
}: {
  assignment: Assignment | null;
  auxiliaryAssignments: NonNullable<OperationDetail["auxiliaryAssignments"]>;
  operationStatus: OperationDetail["status"];
  loading: boolean;
  actionLabel: string;
  onRefresh: () => void;
}) {
  const [operatorId, setOperatorId] = useState("");
  const [auxiliaryOperatorIds, setAuxiliaryOperatorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setOperatorId(assignment?.assignedTo ?? "");
    setAuxiliaryOperatorIds(
      auxiliaryAssignments
        .filter((item) => item.status !== "CANCELED" && item.status !== "REJECTED")
        .map((item) => item.assignedTo),
    );
    setError(null);
  }, [assignment?.assignedTo, auxiliaryAssignments]);

  async function reassign() {
    if (!assignment || !operatorId) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await assignmentsApi.reassignAssignment(assignment.id, {
        assignedTo: operatorId,
        auxiliaryOperatorIds: auxiliaryOperatorIds.filter((id) => id !== operatorId),
      });
      setFeedback(
        auxiliaryOperatorIds.length > 0
          ? "Responsável e auxiliares técnicos atribuídos com sucesso."
          : "Responsável atribuído com sucesso.",
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reatribuir.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Responsável pelo atendimento</h3>
        {assignment && <StatusChip tone="info">{ASSIGNMENT_STATUS_LABEL[assignment.status]}</StatusChip>}
      </div>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        {loading && !assignment ? (
          <SkeletonList rows={2} />
        ) : !assignment ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum operador foi designado para este atendimento.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="Responsável" value={assignment.assignee.name} />
              <Info label="Atribuído em" value={assignmentTime(assignment.assignedAt)} />
              <Info label="Status" value={ASSIGNMENT_STATUS_LABEL[assignment.status]} />
            </div>
            <AssignmentHistory operationId={assignment.operationId} />
            <Gate roles={["OWNER", "MANAGER"]}>
              {operationStatus === "CANCELED" ? (
                <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm text-[var(--color-muted-foreground)]">
                  Reative a operação para definir uma nova atribuição.
                </p>
              ) : <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <UserSelect value={operatorId} onChange={setOperatorId} />
                <AuxiliaryOperatorSelect value={auxiliaryOperatorIds} onChange={setAuxiliaryOperatorIds} excludeId={operatorId || undefined} />
                {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
                {feedback && <p role="status" className="text-xs font-medium text-[var(--color-success)]">{feedback}</p>}
                <button onClick={reassign} disabled={saving || !operatorId} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50">
                  {saving ? "Salvando atribuição…" : actionLabel}
                </button>
              </div>}
            </Gate>
          </div>
        )}
      </div>
    </section>
  );
}

function AssignmentHistory({ operationId }: { operationId: string }) {
  const history = useQuery((signal) => assignmentsApi.getAssignmentHistory(operationId, { signal }), [operationId]);
  if (history.loading && !history.data) return <SkeletonList rows={2} />;
  if (history.error && !history.data) return <ErrorState error={history.error} onRetry={history.refetch} />;
  const items = history.data ?? [];
  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex gap-2 text-xs text-[var(--color-muted-foreground)]">
          <span className="mt-1 h-2 w-2 rounded-full bg-[var(--color-primary)]" />
          <span>
            <span className="font-medium text-[var(--color-foreground)]">{item.actor.name}</span>{" "}
            {item.event.toLowerCase().replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString("pt-BR")}
            {item.notes ? <span className="block">{item.notes}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function OperationBudgetsSection({ operation }: { operation: OperationDetail }) {
  const budgets = useQuery((signal) => budgetsApi.listOperationBudgets(operation.id, { limit: 20, signal }), [operation.id]);
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Orçamentos</h3>
        <Gate roles={["OWNER", "MANAGER"]}>
          <button onClick={() => setOpen(true)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 h-8 text-xs hover:bg-[var(--color-muted)]">
            Novo orçamento
          </button>
        </Gate>
      </div>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        {budgets.loading && !budgets.data ? (
          <SkeletonList rows={3} />
        ) : budgets.error && !budgets.data ? (
          <ErrorState error={budgets.error} onRetry={budgets.refetch} />
        ) : (budgets.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum orçamento vinculado a esta Operation.</p>
        ) : (
          <ul className="space-y-2">
            {(budgets.data?.items ?? []).map((budget) => (
              <li key={budget.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">ORC-{String(budget.number).padStart(6, "0")} · {budget.title}</span>
                  <span className="block text-[11px] text-[var(--color-muted-foreground)]">Vence em {new Date(budget.expirationDate).toLocaleDateString("pt-BR")}</span>
                </span>
                <span className="flex items-center gap-2">
                  <BudgetMiniStatus status={budget.status} />
                  <span className="font-mono text-sm">{formatCurrencyBRL(Number(budget.total))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BudgetWizardDrawer
        open={open}
        onClose={() => setOpen(false)}
        initialOperationId={operation.id}
        onSaved={() => {
          setOpen(false);
          budgets.refetch();
        }}
      />
    </section>
  );
}

function BudgetMiniStatus({ status }: { status: Budget["status"] }) {
  const label: Record<Budget["status"], string> = { DRAFT: "Rascunho", PENDING: "Pendente", APPROVED: "Aprovado", REJECTED: "Rejeitado", EXPIRED: "Vencido", CANCELED: "Cancelado" };
  const tone: Record<Budget["status"], "neutral" | "warning" | "success" | "danger"> = { DRAFT: "neutral", PENDING: "warning", APPROVED: "success", REJECTED: "danger", EXPIRED: "danger", CANCELED: "neutral" };
  return <StatusChip tone={tone[status]}>{label[status]}</StatusChip>;
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler a imagem"));
    reader.readAsDataURL(file);
  });
}

function OperationMaterialsSection({ operationId }: { operationId: string }) {
  const materials = useQuery((signal) => inventoryApi.listOperationMaterials(operationId, { signal }), [operationId]);
  const products = useQuery((signal) => inventoryApi.listProducts({ limit: 100, active: true, purchasable: true, signal }), []);
  const inventory = useQuery((signal) => inventoryApi.listInventory({ limit: 100, signal }), []);
  const [open, setOpen] = useState(false);

  async function remove(part: OperationPart) {
    if (!confirm(`Remover ${part.product.name} da operação?`)) return;
    await inventoryApi.deleteOperationMaterial(operationId, part.id);
    materials.refetch();
    inventory.refetch();
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Materiais utilizados</h3>
        <Gate roles={["OWNER", "MANAGER", "OPERATOR"]}>
          <button onClick={() => setOpen(true)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 h-8 text-xs hover:bg-[var(--color-muted)]">
            Adicionar material
          </button>
        </Gate>
      </div>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        {materials.loading && !materials.data ? (
          <SkeletonList rows={3} />
        ) : materials.error && !materials.data ? (
          <ErrorState error={materials.error} onRetry={materials.refetch} />
        ) : (materials.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum material consumido nesta operação.</p>
        ) : (
          <ul className="space-y-2">
            {(materials.data ?? []).map((part) => (
              <li key={part.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{part.product.name}</span>
                  <span className="block text-[11px] text-[var(--color-muted-foreground)]">{part.product.sku} · {part.notes ?? "sem observação"}</span>
                </span>
                <span className="font-mono text-sm tabular-nums">{formatNumber(Number(part.quantity))} {part.product.unit}</span>
                <Gate roles={["OWNER", "MANAGER"]}>
                  <button onClick={() => remove(part)} className="text-xs text-[var(--color-danger)] hover:underline">remover</button>
                </Gate>
              </li>
            ))}
          </ul>
        )}
      </div>
      <MaterialFormDrawer
        open={open}
        onClose={() => setOpen(false)}
        operationId={operationId}
        products={products.data?.items ?? []}
        inventory={inventory.data?.items ?? []}
        onSaved={() => {
          setOpen(false);
          materials.refetch();
          inventory.refetch();
        }}
      />
    </section>
  );
}

function MaterialFormDrawer({
  open,
  onClose,
  operationId,
  products,
  inventory,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  operationId: string;
  products: Product[];
  inventory: InventoryItem[];
  onSaved: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filteredItems = inventory.filter((item) => item.productId === productId);

  useEffect(() => {
    if (!open) return;
    const firstProduct = products[0]?.id ?? "";
    setProductId(firstProduct);
    setInventoryItemId(inventory.find((item) => item.productId === firstProduct)?.id ?? "");
    setQuantity("");
    setNotes("");
    setError(null);
  }, [open, products, inventory]);

  useEffect(() => {
    if (!productId) return;
    setInventoryItemId((current) => filteredItems.some((item) => item.id === current) ? current : filteredItems[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function submit() {
    setError(null);
    try {
      await inventoryApi.addOperationMaterial(operationId, {
        productId,
        inventoryItemId,
        quantity: Number(quantity),
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar material.");
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Materiais"
      title="Adicionar material"
      width="max-w-lg"
      footer={
        <>
          <button onClick={onClose} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]">Cancelar</button>
          <button onClick={submit} disabled={!productId || !inventoryItemId || !quantity} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50">Adicionar</button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
        <Field label="Produto">
          <select value={productId} onChange={(event) => setProductId(event.target.value)} className={inputCls}>
            {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
          </select>
        </Field>
        <Field label="Item de estoque">
          <select value={inventoryItemId} onChange={(event) => setInventoryItemId(event.target.value)} className={inputCls}>
            {filteredItems.map((item) => <option key={item.id} value={item.id}>{item.location ?? "Sem localização"} · disponível {formatNumber(Number(item.availableQuantity))}</option>)}
          </select>
        </Field>
        <Field label="Quantidade">
          <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputCls} min="0.001" step="0.001" />
        </Field>
        <Field label="Observações">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${inputCls} min-h-20 py-2`} />
        </Field>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}

const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";
