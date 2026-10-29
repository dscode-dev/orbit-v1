"use client";

import { operationServiceAddressLabel } from "@erp/ui/operations/operation-shared";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Banknote, CalendarClock, Camera, CheckCircle2, ClipboardCheck, Clock, Download, FileText, Loader2, MapPin, Package, PenLine, Phone, Play, Share2, XCircle } from "lucide-react";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { SkeletonCard, SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { ErrorState } from "@erp/ui/states";
import { StatusPill } from "@erp/ui/status-pill";
import { DocumentViewer } from "@erp/ui/documents/document-viewer";
import { SignaturePad } from "@erp/ui/documents/signature-pad";
import { PhotoInput, type CapturedPhoto } from "@erp/ui/photo-input";
import { CustomerSignaturePreview } from "@erp/ui/documents/customer-signature-preview";
import { Drawer } from "@erp/ui/drawer";
import { assignmentsApi, documentsApi, inventoryApi, operationApi, useQuery, type Assignment, type DocumentRenderResult, type InventoryItem, type OperationDetail, type OperationDocument, type OperationPart, type Product } from "@erp/api";
import type { DocumentConfiguration, Signature, SignatureMode } from "@erp/types";
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_PILL,
  assignmentTime,
} from "@erp/ui/assignments/assignment-shared";
import { useServiceTypeLabel } from "@erp/ui/operations/use-service-type-label";
import { FieldReportHandoff } from "@operator/features/reports/field-report-handoff";
import { OperatorSignatureChoice } from "@operator/components/operator-signature";

const workflow = [
  { label: "Aceitar", icon: CheckCircle2 },
  { label: "Checklist", icon: ClipboardCheck },
  { label: "Fotos", icon: Camera },
  { label: "Materiais", icon: Package },
  { label: "Documentos", icon: FileText },
  { label: "Assinatura", icon: PenLine },
  { label: "Concluir", icon: CheckCircle2 },
];

export default function OperatorServiceDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const assignment = useQuery((signal) => assignmentsApi.getAssignment(params.id, { signal }), [params.id]);
  const history = useQuery(
    (signal) => assignment.data ? assignmentsApi.getAssignmentHistory(assignment.data.operationId, { signal }) : Promise.resolve([]),
    [assignment.data?.operationId],
  );
  const materials = useQuery(
    (signal) => assignment.data ? inventoryApi.listOperationMaterials(assignment.data.operationId, { signal }) : Promise.resolve([]),
    [assignment.data?.operationId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "accept" | "start" | "complete") {
    if (!assignment.data) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "accept") await assignmentsApi.acceptAssignment(assignment.data.id);
      if (action === "start") {
        await assignmentsApi.startAssignment(assignment.data.id);
        // Non-PMOC executions continue in the guided wizard (PMOC keeps the
        // specialized inline flow on this page).
        if (!assignment.data.operation.maintenanceExecution?.plan.pmocPlan) {
          router.push(`/operator/execucao/${assignment.data.id}`);
          return;
        }
      }
      if (action === "complete") await assignmentsApi.completeAssignment(assignment.data.id, "Concluído pelo operador em campo");
      assignment.refetch();
      history.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o atendimento.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 pt-4 pb-24 space-y-5">
      <Link href="/operator/services" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
        <ArrowLeft className="h-4 w-4" /> Minhas ordens
      </Link>

      {assignment.loading && !assignment.data ? (
        <SkeletonCard />
      ) : assignment.error && !assignment.data ? (
        <ErrorState error={assignment.error} onRetry={assignment.refetch} />
      ) : !assignment.data ? (
        <EmptyState icon={ClipboardCheck} title="Ordem não encontrada" description="A ordem não está mais disponível." />
      ) : (
        <AssignmentWorkflow
          assignment={assignment.data}
          history={history.data ?? []}
          historyLoading={history.loading}
          materials={materials.data ?? []}
          materialsLoading={materials.loading}
          materialsError={materials.error}
          onMaterialsRefresh={materials.refetch}
          onRefresh={async () => { await Promise.all([assignment.refetch(), history.refetch()]); }}
          error={error}
          busy={busy}
          onAction={run}
        />
      )}
    </div>
  );
}

function AssignmentWorkflow({
  assignment,
  history,
  historyLoading,
  materials,
  materialsLoading,
  materialsError,
  onMaterialsRefresh,
  onRefresh,
  error,
  busy,
  onAction,
}: {
  assignment: Assignment;
  history: Awaited<ReturnType<typeof assignmentsApi.getAssignmentHistory>>;
  historyLoading: boolean;
  materials: OperationPart[];
  materialsLoading: boolean;
  materialsError: Error | null;
  onMaterialsRefresh: () => void;
  onRefresh: () => Promise<void>;
  error: string | null;
  busy: string | null;
  onAction: (action: "accept" | "start" | "complete") => void;
}) {
  const { role, can } = useAuth();
  // Sem permissão de Relatórios, o operador só visualiza a OS — não pode
  // aceitar/iniciar/concluir (ações que geram/avançam o relatório). Só restringe
  // operadores; owner/manager têm acesso pleno.
  const canReports = role !== "OPERATOR" || can("canReports");
  const op = assignment.operation;
  const serviceTypeLabel = useServiceTypeLabel();
  const readOnlyRvtAuxiliary = op.requestedDocumentType === "TECHNICAL_REPORT" && !assignment.isPrimary;
  const operation = useQuery((signal) => operationApi.getOperation(op.id, { signal }), [op.id]);
  const [document, setDocument] = useState<OperationDocument | null>(null);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [cancellationResult, setCancellationResult] = useState<DocumentRenderResult | null>(null);
  const isPmoc = Boolean(op.maintenanceExecution?.plan.pmocPlan);
  const pmocConfiguration = useQuery<DocumentConfiguration | null>(
    (signal) => isPmoc ? documentsApi.getConfigurationByType("PMOC", { signal }) : Promise.resolve(null),
    [isPmoc],
  );
  const address = operationServiceAddressLabel(op.address);
  const pmoc = op.maintenanceExecution?.plan.pmocPlan;
  const pmocExecution = op.maintenanceExecution?.pmocExecutionRequest;
  const pmocSignatureMode = pmocConfiguration.data?.defaultTemplate?.signatureMode ?? null;
  const pmocTechnicalSignature = pmocConfiguration.data?.defaultTemplate?.institutionalSignatures?.[0]?.signature
    ?? pmocConfiguration.data?.defaultTemplate?.signature
    ?? null;
  const visibleWorkflow = isPmoc && (pmocSignatureMode === "NONE" || pmocSignatureMode === "FIXED")
    ? workflow.filter((item) => item.label !== "Assinatura")
    : workflow;

  if (cancellationResult) {
    return <CancellationSuccessView document={cancellationResult} />;
  }
  return (
    <>
      <header className="space-y-3">
        <StatusPill status={ASSIGNMENT_STATUS_PILL[assignment.status]} label={ASSIGNMENT_STATUS_LABEL[assignment.status]} />
        <div>
          <h1 className="text-section-title leading-tight">{op.customer?.name ?? "Cliente não informado"}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            OP-{String(op.number).padStart(6, "0")} · {op.equipment?.name ?? "Sem equipamento"}
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--color-primary)]">{op.scheduledFor ? assignmentTime(op.scheduledFor) : "Não agendado"}</p>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Criada em {assignmentTime(op.createdAt)}</p>
        </div>
      </header>

      {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}

      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <InfoRow icon={MapPin} label={op.secondaryServiceType ? "Endereço do serviço primário" : "Endereço"} value={address} />
        <InfoRow icon={MapPin} label="Complemento" value={op.address?.complement || "Não informado"} />
        <InfoRow icon={MapPin} label="Ponto de referência" value={op.address?.referencePoint || "Não informado"} />
        <InfoRow icon={Phone} label="Telefone do cliente" value={op.customer?.phone || op.customer?.secondaryPhone || "Não informado"} />
        <InfoRow icon={Package} label="Equipamentos" value={operation.data?.inspectedEquipments.map((item) => item.equipment?.name).filter(Boolean).join(", ") || pmoc?.equipments.map((item) => item.equipment.name).join(", ") || op.equipment?.name || "Sem equipamento vinculado"} />
        {op.secondaryServiceType && <>
          <InfoRow icon={ClipboardCheck} label="Serviço primário" value={serviceTypeLabel(op.type)} />
          <InfoRow icon={ClipboardCheck} label="Serviço secundário" value={serviceTypeLabel(op.secondaryServiceType)} />
          <InfoRow icon={MapPin} label="Endereço do serviço secundário" value={operationServiceAddressLabel(op.secondaryAddress)} />
        </>}
        <InfoRow icon={ClipboardCheck} label="Tipos de serviço" value={(op.serviceTypes?.length ? op.serviceTypes : [op.type]).map(serviceTypeLabel).join(" · ")} />
        {op.serviceValue !== null && op.serviceValue !== undefined && (
          <InfoRow
            icon={Banknote}
            label="Valor do serviço"
            value={Number(op.serviceValue).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          />
        )}
        <InfoRow icon={Clock} label="Data do agendamento" value={op.scheduledFor ? assignmentTime(op.scheduledFor) : "Não agendado"} />
      </section>

      {pmoc && (
        <section className="rounded-[var(--radius-xl)] border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/5 p-4 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">Plano PMOC</p>
            <h2 className="mt-1 font-semibold">PMOC-{String(pmoc.number).padStart(6, "0")} · Execução {String(pmocExecution?.executionNumber ?? 0).padStart(3, "0")}</h2>
          </div>
          <InfoRow icon={CalendarClock} label="Periodicidade" value={periodicityLabel(pmoc.periodicity)} />
          <InfoRow icon={ClipboardCheck} label="Responsável técnico" value={pmoc.responsibleTechnician} />
          <InfoRow icon={Package} label="Equipamentos cobertos" value={pmoc.equipments.map((item) => item.equipment.name).join(", ") || "Equipamento principal"} />
          {pmocSignatureMode === "COLLECTED" || pmocSignatureMode === "HYBRID" ? (
            <InfoRow icon={PenLine} label="Assinatura do cliente" value={operation.data?.signatureCaptured ? "Coletada" : "Pendente para esta execução"} />
          ) : null}
          <InfoRow icon={FileText} label="Documento PMOC" value={op.documents.some((item) => item.type === "PMOC") ? "Disponível na seção Documentos" : "Será emitido após o preenchimento"} />
        </section>
      )}

      {readOnlyRvtAuxiliary && (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/10 px-3 py-2 text-sm text-[var(--color-info)]">
          Você está vinculado como Auxiliar Técnico. Os dados desta visita estão disponíveis para acompanhamento, mas a execução e o documento pertencem ao técnico principal.
        </p>
      )}
      {!readOnlyRvtAuxiliary && !canReports && assignment.status !== "COMPLETED" && (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
          Seu perfil tem acesso apenas à agenda. Você pode visualizar esta ordem, mas iniciar o atendimento (que gera relatório) requer a permissão de Relatórios.
        </p>
      )}
      {canReports && !readOnlyRvtAuxiliary && (
        <section className="grid gap-2">
          {assignment.status === "ASSIGNED" && (
            <BigButton icon={CheckCircle2} label="Aceitar ordem" busy={busy === "accept"} onClick={() => onAction("accept")} />
          )}
          {assignment.status === "ACCEPTED" && <BigButton icon={Play} label="Iniciar atendimento" busy={busy === "start"} onClick={() => onAction("start")} />}
          {assignment.status === "STARTED" && (isPmoc ? (
            <><BigButton icon={CheckCircle2} label="Concluir atendimento" busy={busy === "complete"} disabled={(operation.data?.photos.length ?? 0) < 4} onClick={() => onAction("complete")} />{(operation.data?.photos.length ?? 0) < 4 && <p className="text-center text-xs text-[var(--color-warning)]">Registre ao menos quatro imagens do procedimento antes de concluir.</p>}</>
          ) : (
            <Link href={`/operator/execucao/${assignment.id}`} className="inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-xl)] bg-[var(--color-primary)] px-4 text-base font-semibold text-white shadow-[var(--shadow-hover)] active:scale-[0.99]">
              <Play className="h-5 w-5" /> Continuar atendimento
            </Link>
          ))}
          {(["ASSIGNED", "ACCEPTED", "STARTED", "PAUSED"] as const).includes(assignment.status as "ASSIGNED" | "ACCEPTED" | "STARTED" | "PAUSED") && (
            <button type="button" onClick={() => setCancellationOpen(true)} className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 text-sm font-semibold text-[var(--color-danger)]">
              <XCircle className="h-5 w-5" /> Cancelar atendimento
            </button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Checklist do atendimento</h2>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {op.checklist.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum checklist definido para este atendimento.</p>
          ) : (
            <ul className="space-y-2">
              {op.checklist.map((item, index) => (
                <li key={`${item.label}-${index}`} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 grid h-5 w-5 place-items-center rounded-full border ${item.done ? "border-[var(--color-success)] bg-[var(--color-success)] text-white" : "border-[var(--color-border)]"}`}>
                    {item.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span>
                    <span className="font-medium">{item.label}</span>
                    {item.note ? <span className="block text-xs text-[var(--color-muted-foreground)]">{item.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {operation.data?.maintenanceExecution?.plan.pmocPlan && (
        <PmocFieldExecution operation={operation.data} signatureMode={pmocSignatureMode} technicalSignature={pmocTechnicalSignature} configurationLoading={pmocConfiguration.loading} onSaved={operation.refetch} />
      )}

      {/* Non-PMOC data collection happens in the execution wizard; the inline
          handoff form remains only for the specialized PMOC flow. */}
      {operation.data && isPmoc && (assignment.status === "ACCEPTED" || assignment.status === "STARTED" || assignment.status === "COMPLETED") && (
        <FieldReportHandoff operation={operation.data} onSaved={operation.refetch} />
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Materiais utilizados</h2>
          {assignment.status === "STARTED" && <OperatorMaterialButton operationId={op.id} onSaved={onMaterialsRefresh} />}
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {materialsLoading && materials.length === 0 ? (
            <SkeletonList rows={2} />
          ) : materialsError && materials.length === 0 ? (
            <ErrorState error={materialsError} onRetry={onMaterialsRefresh} />
          ) : materials.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Nenhum material consumido. {assignment.status === "STARTED" ? "Use “Adicionar” quando houver consumo em campo." : "Materiais podem ser lançados após iniciar a execução."}
            </p>
          ) : (
            <ul className="space-y-2">
              {materials.map((part) => (
                <li key={part.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 font-medium truncate">{part.product.name}</span>
                    <span className="font-mono tabular-nums">{Number(part.quantity).toLocaleString("pt-BR")} {part.product.unit}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{part.product.sku} · {part.inventoryItem.location ?? "sem localização"}{part.notes ? ` · ${part.notes}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Documentos do atendimento</h2>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {op.documents.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum documento disponível para este atendimento.</p>
          ) : (
            <div className="grid gap-2">
              {op.documents.map((doc) => (
                <button key={doc.id} onClick={() => setDocument(doc)} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-3 text-left text-sm active:scale-[0.99]">
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{doc.number}</span>
                    <span className="block text-xs text-[var(--color-muted-foreground)]">{doc.type} · {doc.status}</span>
                  </span>
                  <FileText className="h-5 w-5 text-[var(--color-primary)]" />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Recursos de campo</h2>
        <div className="grid grid-cols-2 gap-2">
          {visibleWorkflow.map(({ label, icon: Icon }) => (
            <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <Icon className="mb-2 h-5 w-5 text-[var(--color-primary)]" />
              <div className="text-sm font-medium">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Fotos e assinatura são preservadas na Operation principal. Coleta offline e assinatura eletrônica avançada ficam fora da V1.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Histórico do atendimento</h2>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {historyLoading && history.length === 0 ? (
            <SkeletonList rows={3} />
          ) : history.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Sem eventos registrados.</p>
          ) : (
            <ol className="space-y-3">
              {history.map((item) => (
                <li key={item.id} className="flex gap-3 text-sm">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
                  <span>
                    <span className="font-medium">{item.event}</span>
                    <span className="block text-xs text-[var(--color-muted-foreground)]">
                      {item.actor.name} · {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </span>
                    {item.notes && <span className="block text-xs text-[var(--color-muted-foreground)]">{item.notes}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {document && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-3">
          <div className="mx-auto max-w-[1280px] rounded-[var(--radius-xl)] bg-[var(--color-background)] p-3 shadow-[var(--shadow-hover)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-caption">Documento oficial</p>
                <h2 className="font-semibold">{document.number}</h2>
              </div>
              <button onClick={() => setDocument(null)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm">Fechar</button>
            </div>
            <DocumentViewer source={{ documentId: document.id, operationId: op.id, type: document.type }} title={document.number} />
          </div>
        </div>
      )}
      {operation.data && <OperationCancellationWizard
        open={cancellationOpen}
        operation={operation.data}
        onClose={() => setCancellationOpen(false)}
        onCompleted={async (rendered) => {
          setCancellationOpen(false);
          await Promise.all([onRefresh(), operation.refetch()]);
          setCancellationResult(rendered);
        }}
      />}
    </>
  );
}

function OperationCancellationWizard({ open, operation, onClose, onCompleted }: { open: boolean; operation: OperationDetail; onClose: () => void; onCompleted: (document: DocumentRenderResult) => Promise<void> }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [reason, setReason] = useState("");
  const [technicalSignatureId, setTechnicalSignatureId] = useState<string | null>(null);
  const [customerSignature, setCustomerSignature] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerRole, setCustomerRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    if (!reason.trim()) return setError("Informe o motivo impeditivo do cancelamento.");
    if (!technicalSignatureId) return setError("Confirme sua assinatura técnica ativa.");
    if (customerSignature && !customerName.trim()) return setError("Informe o nome do cliente que assinou.");
    setBusy(true); setError(null);
    try {
      await operationApi.requestOperationCancellation(operation.id, {
        reason: reason.trim(),
        technicalSignatureId,
        customerSignatureData: customerSignature ?? undefined,
        customerSignerName: customerSignature ? customerName.trim() : undefined,
        customerSignerRole: customerSignature ? customerRole.trim() || undefined : undefined,
        customerSignedAt: customerSignature ? new Date().toISOString() : undefined,
        photos: await Promise.all(photos.map(async (photo) => ({ dataUrl: await fileDataUrl(photo.file), caption: photo.caption?.trim() || null }))),
      });
      const rendered = await documentsApi.renderOperationDocument(operation.id, "WORK_ORDER");
      await onCompleted(rendered);
      setStep(1); setPhotos([]); setReason(""); setCustomerSignature(null); setCustomerName(""); setCustomerRole("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir o cancelamento.");
    } finally { setBusy(false); }
  }

  return (
    <Drawer open={open} onClose={busy ? () => undefined : onClose} eyebrow={`OP-${String(operation.number).padStart(6, "0")}`} title="Cancelar atendimento" width="max-w-2xl" footer={
      <div className="flex w-full gap-2">
        {step === 2 && <button type="button" onClick={() => setStep(1)} disabled={busy} className="btn-secondary flex-1">Voltar</button>}
        {step === 1 ? <button type="button" onClick={() => setStep(2)} className="btn-primary flex-1">Continuar</button> : <button type="button" onClick={() => void finish()} disabled={busy} className="btn-primary flex-1">{busy ? "Finalizando…" : "Confirmar cancelamento"}</button>}
      </div>
    }>
      <div className="space-y-5">
        <div className="flex gap-2 text-xs"><StatusPill status={step === 1 ? "info" : "pending"} label="1 · Evidências" /><StatusPill status={step === 2 ? "info" : "pending"} label="2 · Motivo e assinaturas" /></div>
        {step === 1 ? <section className="space-y-3"><div><h3 className="font-semibold">Evidências do impedimento</h3><p className="text-caption">Adicione até seis fotos. Elas serão incluídas no relatório de cancelamento.</p></div><PhotoInput photos={photos} onChange={setPhotos} max={6} /></section> : <div className="space-y-5">
          <label className="space-y-1"><span className="text-sm font-medium">Motivo do cancelamento *</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={4000} rows={5} placeholder="Ex.: cliente não se encontrava no local…" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent p-3 text-sm" /></label>
          <section className="space-y-2"><h3 className="text-sm font-semibold">Assinatura do técnico</h3><OperatorSignatureChoice selectedId={technicalSignatureId} onSelect={setTechnicalSignatureId} /></section>
          <section className="space-y-3"><div><h3 className="text-sm font-semibold">Assinatura do cliente (opcional)</h3><p className="text-caption">Pode ficar sem assinatura quando o cliente não estiver no local.</p></div>{customerSignature && <div className="grid gap-2 sm:grid-cols-2"><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nome do cliente" className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm" /><input value={customerRole} onChange={(event) => setCustomerRole(event.target.value)} placeholder="Função ou vínculo (opcional)" className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm" /></div>}<SignaturePad onChange={(value) => { if (!value) setCustomerSignature(null); }} onConfirm={setCustomerSignature} /></section>
        </div>}
        {error && <p className="rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
      </div>
    </Drawer>
  );
}

function CancellationSuccessView({ document }: { document: DocumentRenderResult }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchPdf(): Promise<File> {
    const { blob, filename } = await documentsApi.downloadDocument(document.id);
    return new File([blob], filename ?? `${document.number}.pdf`, { type: "application/pdf" });
  }

  async function download() {
    setBusy("download"); setError(null);
    try { triggerFileDownload(await fetchPdf()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o relatório."); }
    finally { setBusy(null); }
  }

  async function share() {
    setBusy("share"); setError(null);
    try {
      const file = await fetchPdf();
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], title: document.number, text: `Relatório de cancelamento ${document.number}` });
      } else {
        triggerFileDownload(file);
        setError("O compartilhamento nativo não está disponível. O PDF foi baixado para envio manual.");
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Não foi possível compartilhar o relatório.");
    } finally { setBusy(null); }
  }

  return (
    <div className="min-h-[70dvh] grid place-items-center p-6 text-center">
      <div className="w-full max-w-xs">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[var(--color-success)]/12 text-[var(--color-success)]"><CheckCircle2 className="h-9 w-9" /></div>
        <h1 className="mt-4 text-section-title">Cancelamento registrado</h1>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 px-3 py-1 text-sm font-medium text-[var(--color-primary)]"><FileText className="h-4 w-4" /> {document.number}</p>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">O relatório oficial foi gerado e o cancelamento foi enviado para decisão da gestão.</p>
        {error && <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-left text-xs text-[var(--color-warning)]">{error}</p>}
        <div className="mt-6 space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => void share()} disabled={busy !== null} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60">{busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Compartilhar</button>
            <button type="button" onClick={() => void download()} disabled={busy !== null} className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm font-medium disabled:opacity-60">{busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar</button>
          </div>
          <button type="button" onClick={() => router.push("/operator/documents")} className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium">Ver em Documentos</button>
          <button type="button" onClick={() => router.push("/operator/services")} className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium">Minhas ordens</button>
          <button type="button" onClick={() => router.push("/operator")} className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium">Voltar ao início</button>
        </div>
      </div>
    </div>
  );
}

function triggerFileDownload(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = window.document.createElement("a");
  anchor.href = url; anchor.download = file.name;
  window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function PmocFieldExecution({ operation, signatureMode, technicalSignature, configurationLoading, onSaved }: { operation: OperationDetail; signatureMode: SignatureMode | null; technicalSignature: Signature | null; configurationLoading: boolean; onSaved: () => void }) {
  const [items, setItems] = useState(operation.maintenanceChecklistItems);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(operation.customerSignerName ?? "");
  const [signerRole, setSignerRole] = useState(operation.customerSignerRole ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Awaited<ReturnType<typeof documentsApi.saveHandoffDraft>> | null>(null);
  const [captureOpen, setCaptureOpen] = useState(!operation.signatureCaptured);
  const collectsClientSignature = signatureMode === "COLLECTED" || signatureMode === "HYBRID";
  const pmoc = operation.maintenanceExecution?.plan.pmocPlan;
  const pmocDocument = operation.documents.find((item) => item.type === "PMOC") ?? null;

  const existingHandoff = useQuery(
    (signal) => pmocDocument ? documentsApi.getHandoff(pmocDocument.id, { signal }) : Promise.resolve(null),
    [pmocDocument?.id],
  );

  useEffect(() => {
    if (existingHandoff.data) {
      setHandoff(existingHandoff.data);
      setSignerName(existingHandoff.data.customerSignature?.name ?? operation.customerSignerName ?? "");
      setSignerRole(existingHandoff.data.customerSignature?.role ?? operation.customerSignerRole ?? "");
      setCaptureOpen(!existingHandoff.data.customerSignature);
    }
  }, [existingHandoff.data, operation.customerSignerName, operation.customerSignerRole]);

  async function save() {
    setBusy(true);
    setFeedback(null);
    setPhotos((current) => current.map((photo) => ({ ...photo, status: "saving" })));
    try {
      const encodedPhotos = await Promise.all(photos.map(async (photo) => ({ dataUrl: await fileDataUrl(photo.file), caption: photo.caption?.trim() || photo.name })));
      await operationApi.updateOperation(operation.id, {
        maintenanceChecklist: items.map((item) => ({
          equipmentId: item.equipmentId,
          maintenanceType: item.maintenanceType,
          description: item.description,
          result: item.result ?? (item.executed ? "YES" : "NO"),
          executed: (item.result ?? (item.executed ? "YES" : "NO")) === "YES",
          observations: item.observations,
        })),
        photos: encodedPhotos,
      });
      let currentHandoff = handoff;
      if (collectsClientSignature && signature) {
        if (!signerName.trim()) throw new Error("Informe o nome de quem assinou.");
        currentHandoff = currentHandoff ?? await documentsApi.saveHandoffDraft(operation.id, "PMOC");
        currentHandoff = await documentsApi.collectCustomerSignature(currentHandoff.id, {
          signerName: signerName.trim(),
          signerRole: signerRole.trim() || undefined,
          signatureData: signature,
          collectedAt: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Recife",
        });
        setHandoff(currentHandoff);
        setSignature(null);
        setCaptureOpen(false);
      }
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setPhotos([]);
      setFeedback("Execução PMOC salva. O Preview foi invalidado e refletirá os novos dados.");
      onSaved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar o PMOC.";
      setPhotos((current) => current.map((photo) => ({ ...photo, status: "error", error: message })));
      setFeedback(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--color-primary)]/30 bg-[var(--color-card)] p-4">
      <div><p className="text-caption">Atendimento programado</p><h2 className="font-semibold">PMOC em campo</h2><p className="text-xs text-[var(--color-muted-foreground)]">Preencha os procedimentos por equipamento e registre as evidências do atendimento.</p></div>
      <div className="space-y-3">
        {items.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum procedimento foi preparado para esta execução.</p> : items.map((item, index) => (
          <div key={item.id ?? index} className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <p className="text-sm font-medium">{item.equipment?.name ?? "Procedimento geral"}</p>
            <p className="text-sm">{item.description}</p>
            <div className="grid grid-cols-3 gap-2">
              {([['YES','Sim'],['NO','Não'],['NOT_APPLICABLE','N.A.']] as const).map(([value,label]) => <button key={value} type="button" onClick={() => setItems((current) => current.map((candidate, currentIndex) => currentIndex === index ? { ...candidate, result: value, executed: value === 'YES' } : candidate))} className={`h-10 rounded-[var(--radius-md)] border text-sm font-medium ${(item.result ?? (item.executed ? 'YES' : 'NO')) === value ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}`}>{label}</button>)}
            </div>
            <input value={item.observations ?? ""} onChange={(event) => setItems((current) => current.map((candidate, currentIndex) => currentIndex === index ? { ...candidate, observations: event.target.value } : candidate))} placeholder="Observação do procedimento" className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm" />
          </div>
        ))}
      </div>
      <section className="space-y-3">
        <div><p className="text-sm font-medium">Evidências fotográficas</p><p className="text-xs text-[var(--color-muted-foreground)]">As imagens existentes e as novas fotos pertencem a esta execução do PMOC.</p></div>
        {operation.photos.length > 0 ? <div className="grid grid-cols-2 gap-2">{operation.photos.map((photo) => <OperatorEvidence key={photo.id} photo={photo} />)}</div> : <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3 text-center text-xs text-[var(--color-muted-foreground)]">Nenhuma foto registrada ainda.</p>}
        <PhotoInput photos={photos} onChange={setPhotos} max={16} existingCount={operation.photos.length} requiredMinimum={4} disabled={busy} />
      </section>
      {configurationLoading ? <SkeletonCard /> : <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
        <div><p className="text-sm font-semibold">Responsável técnico pelo PMOC</p><p className="text-xs text-[var(--color-muted-foreground)]">Não confundir com o operador que realiza a coleta em campo.</p></div>
        <InfoRow icon={ClipboardCheck} label="Técnico responsável" value={pmoc?.responsibleTechnician ?? "Não informado"} />
        {handoff?.technicalSignature || technicalSignature ? <div className="rounded-[var(--radius-md)] bg-[var(--color-muted)] p-3 text-sm"><strong>{(handoff?.technicalSignature ?? technicalSignature)?.name}</strong><span className="block text-xs text-[var(--color-muted-foreground)]">{[(handoff?.technicalSignature ?? technicalSignature)?.title, (handoff?.technicalSignature ?? technicalSignature)?.professionalCouncil, (handoff?.technicalSignature ?? technicalSignature)?.registrationNumber, (handoff?.technicalSignature ?? technicalSignature)?.department].filter(Boolean).join(" · ")}</span></div> : signatureMode === "FIXED" || signatureMode === "HYBRID" ? <p className="text-xs text-[var(--color-warning)]">A assinatura técnica será resolvida pela configuração oficial do documento.</p> : <p className="text-xs text-[var(--color-muted-foreground)]">O modelo atual identifica o técnico, mas não insere assinatura institucional.</p>}
      </section>}
      {collectsClientSignature && <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
        <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">Assinatura do cliente</p><p className="text-xs text-[var(--color-muted-foreground)]">{handoff?.customerSignature ? "Assinatura já coletada." : "Aguardando coleta."}</p></div><button type="button" className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs font-medium" onClick={() => setCaptureOpen((value) => !value)}>{handoff?.customerSignature ? "Substituir" : captureOpen ? "Fechar" : "Assinar"}</button></div>
        {handoff?.customerSignature && <><CustomerSignaturePreview documentId={handoff.id} name={handoff.customerSignature.name} /><div className="grid gap-2"><InfoRow icon={PenLine} label="Cliente" value={handoff.customerSignature.name} /><InfoRow icon={Clock} label="Coletada em" value={new Date(handoff.customerSignature.collectedAt).toLocaleString("pt-BR")} /><InfoRow icon={ClipboardCheck} label="Coletada por" value={handoff.customerSignature.collectedBy?.name ?? handoff.collectedBy?.name ?? operation.operator?.name ?? "Não identificado"} /></div></>}
        {captureOpen && <div className="space-y-3"><div className="grid gap-2"><input value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Nome do cliente/responsável" className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm" /><input value={signerRole} onChange={(event) => setSignerRole(event.target.value)} placeholder="Função ou vínculo" className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm" /></div><SignaturePad onChange={setSignature} onConfirm={setSignature} /></div>}
        <InfoRow icon={ClipboardCheck} label="Operador da coleta" value={handoff?.collectedBy?.name ?? operation.operator?.name ?? "Operador atual"} />
      </section>}
      {!configurationLoading && !collectsClientSignature && signatureMode === "FIXED" ? <p className="rounded-[var(--radius-md)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-muted-foreground)]">A assinatura institucional definida no modelo será aplicada automaticamente. Não há coleta de assinatura do cliente nesta política.</p> : !configurationLoading && !signatureMode ? <p className="text-sm text-[var(--color-danger)]">Não foi possível consultar a política de assinatura do modelo PMOC.</p> : null}
      {feedback && <p className="text-sm text-[var(--color-muted-foreground)]">{feedback}</p>}
      <button type="button" disabled={busy || configurationLoading || (collectsClientSignature && Boolean(signature) && !signerName.trim())} onClick={() => void save()} className="h-12 w-full rounded-[var(--radius-lg)] bg-[var(--color-primary)] text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar atendimento PMOC"}</button>
    </section>
  );
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler a foto"));
    reader.readAsDataURL(file);
  });
}

function OperatorEvidence({ photo }: { photo: OperationDetail["photos"][number] }) {
  const image = useQuery((signal) => operationApi.getOperationPhoto(photo.id, { signal }), [photo.id]);
  const source = image.data ? `data:${image.data.mimeType};base64,${image.data.contentBase64}` : null;
  return (
    <figure className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="grid aspect-square place-items-center bg-white">
        {source ? <Image unoptimized src={source} width={320} height={320} alt={photo.caption || "Evidência do PMOC"} className="h-full w-full object-contain" /> : <span className="p-2 text-center text-[11px] text-[var(--color-muted-foreground)]">Carregando foto…</span>}
      </div>
      <figcaption className="space-y-1 p-2 text-[11px]">
        <strong className="block text-xs">{photo.caption || "Sem legenda"}</strong>
        <span className="block text-[var(--color-muted-foreground)]">{photo.createdBy?.name ?? "Responsável não identificado"}</span>
        <span className="block text-[var(--color-muted-foreground)]">{new Date(photo.createdAt).toLocaleString("pt-BR")}</span>
      </figcaption>
    </figure>
  );
}

function periodicityLabel(value: string): string {
  return ({ MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral", SEMIANNUAL: "Semestral", ANNUAL: "Anual", CUSTOM: "Personalizada" } as Record<string, string>)[value] ?? "Conforme programação";
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</span>
        <span className="block break-words">{value}</span>
      </span>
    </div>
  );
}

function OperatorMaterialButton({ operationId, onSaved }: { operationId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm font-medium">
        Adicionar
      </button>
      {open && <OperatorMaterialPanel operationId={operationId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />}
    </>
  );
}

function OperatorMaterialPanel({ operationId, onClose, onSaved }: { operationId: string; onClose: () => void; onSaved: () => void }) {
  const products = useQuery((signal) => inventoryApi.listProducts({ limit: 100, active: true, signal }), []);
  const inventory = useQuery((signal) => inventoryApi.listInventory({ limit: 100, active: true, signal }), []);
  const [productId, setProductId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productItems = inventory.data?.items.filter((item: InventoryItem) => item.productId === productId) ?? [];

  useEffect(() => {
    const first = products.data?.items[0]?.id ?? "";
    if (!productId && first) setProductId(first);
  }, [productId, products.data]);

  useEffect(() => {
    setInventoryItemId((current) => productItems.some((item) => item.id === current) ? current : productItems[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, inventory.data]);

  async function submit() {
    setSaving(true);
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
      setError(err instanceof Error ? err.message : "Não foi possível registrar o material.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3">
      <div className="w-full rounded-t-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-background)] p-4 shadow-[var(--shadow-hover)]">
        <div className="mb-3">
          <p className="text-caption">Inventário oficial</p>
          <h2 className="text-lg font-semibold">Adicionar material</h2>
        </div>
        {(products.loading || inventory.loading) && !products.data ? <SkeletonList rows={3} /> : null}
        {products.error && !products.data ? <ErrorState error={products.error} onRetry={products.refetch} /> : null}
        {inventory.error && !inventory.data ? <ErrorState error={inventory.error} onRetry={inventory.refetch} /> : null}
        {error && <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
        <div className="space-y-3">
          <Field label="Produto">
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className={inputCls}>
              {(products.data?.items ?? []).map((product: Product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
            </select>
          </Field>
          <Field label="Item de estoque">
            <select value={inventoryItemId} onChange={(event) => setInventoryItemId(event.target.value)} className={inputCls}>
              {productItems.map((item) => <option key={item.id} value={item.id}>{item.location ?? "Sem localização"} · disponível {Number(item.availableQuantity).toLocaleString("pt-BR")}</option>)}
            </select>
          </Field>
          <Field label="Quantidade">
            <input type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputCls} />
          </Field>
          <Field label="Observação">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${inputCls} min-h-20 py-2`} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="h-11 rounded-[var(--radius-lg)] border border-[var(--color-border)] text-sm font-semibold">Cancelar</button>
          <button onClick={submit} disabled={saving || !productId || !inventoryItemId || Number(quantity) <= 0} className="h-11 rounded-[var(--radius-lg)] bg-[var(--color-primary)] text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Registrando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}

function BigButton({ icon: Icon, label, busy, disabled = false, onClick }: { icon: typeof CheckCircle2; label: string; busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy || disabled} className="inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-xl)] bg-[var(--color-primary)] px-4 text-base font-semibold text-white shadow-[var(--shadow-hover)] disabled:opacity-50">
      <Icon className="h-5 w-5" /> {busy ? "Atualizando…" : label}
    </button>
  );
}

const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-11 text-sm outline-none focus:border-[var(--color-primary)]";
