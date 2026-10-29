"use client";

import { operationServiceAddressLabel } from "@erp/ui/operations/operation-shared";

/**
 * ExecucaoWizard — execução guiada de uma Operation atribuída ao operador.
 *
 * Fluxo: Checklist → Conteúdo → Evidências → Materiais → Assinatura →
 * Confirmação. Ao finalizar: salva os dados na Operation,
 * registra o handoff do documento, coleta a assinatura do cliente e conclui a
 * execução. OS e Visita Técnica são concluídas e emitidas no próprio fluxo;
 * documentos especiais atribuídos preservam a revisão da gestão.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Building2, Camera, Check, CheckCircle2, Circle, ClipboardList, FileText,
  MapPin, Package, PenLine, Send, Wrench,
} from "lucide-react";
import { WizardProgressHeader } from "@erp/ui/wizard/progress-header";
import { WizardFooter } from "@erp/ui/wizard/step-footer";
import { SkeletonCard, SkeletonList } from "@erp/ui/skeletons";
import { ErrorState } from "@erp/ui/states";
import { MultiSelect } from "@erp/ui/multi-select";
import { PhotoInput, type CapturedPhoto } from "@erp/ui/photo-input";
import { SignaturePad } from "@erp/ui/documents/signature-pad";
import {
  assignmentsApi, documentsApi, equipmentsApi, inventoryApi, operationApi, technicalCatalogsApi, usersApi, useQuery,
  type DocumentKind, type EquipmentSummary, type InventoryItem, type OperationChecklistItem,
  type OperationDetail, type OperationMaintenanceChecklistItem, type OperationMaintenanceType,
  type OperationPart, type Product,
} from "@erp/api";
import { DOCUMENT_KIND_LABEL } from "@erp/types";
import { useServiceTypeLabel } from "@erp/ui/operations/use-service-type-label";
import { OperatorSignatureChoice } from "@operator/components/operator-signature";
import { OperatorDocumentSuccessView } from "@operator/features/atendimento/atendimento-wizard";
import {
  FieldEquipmentCollection,
  type NewFieldEquipmentDraft,
} from "@operator/components/field-equipment-collection";

const STEPS = ["Checklist", "Conteúdo", "Evidências", "Materiais", "Assinatura", "Confirmar"] as const;
const CUSTOMER_SIGNATURE = new Set<DocumentKind>(["WORK_ORDER"]);
const DIRECT_COMPLETION = new Set<DocumentKind>(["WORK_ORDER", "TECHNICAL_REPORT"]);
const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]";
const RVT_MAINTENANCE_TYPES: Array<{ value: OperationMaintenanceType; label: string }> = [
  { value: "WEEKLY", label: "Semanal" },
  { value: "SEMIANNUAL", label: "Semestral" },
];
type EquipmentProfileDraft = {
  manufacturer: string;
  model: string;
  capacity: string;
};

export function ExecucaoWizard({
  assignmentId,
  surface = "operator",
  onClose,
  onCompleted,
}: {
  assignmentId: string;
  surface?: "operator" | "platform";
  onClose?: () => void;
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const assignment = useQuery((signal) => assignmentsApi.getAssignment(assignmentId, { signal }), [assignmentId]);
  const operation = useQuery(
    (signal) => assignment.data ? operationApi.getOperation(assignment.data.operationId, { signal }) : Promise.resolve(null),
    [assignment.data?.operationId],
  );

  // PMOC keeps the specialized inline flow; only STARTED executions run here.
  const redirect = Boolean(
    operation.data?.maintenanceExecution?.plan.pmocPlan ||
    (operation.data?.requestedDocumentType === "TECHNICAL_REPORT" && assignment.data && !assignment.data.isPrimary) ||
    (assignment.data && assignment.data.status !== "STARTED"),
  );
  useEffect(() => {
    if (!redirect) return;
    if (surface === "operator") router.replace(`/operator/services/${assignmentId}`);
    else onClose?.();
  }, [redirect, assignmentId, onClose, router, surface]);

  if ((assignment.loading && !assignment.data) || (operation.loading && !operation.data)) {
    return <div className="p-4"><SkeletonCard /><div className="mt-3"><SkeletonList rows={4} /></div></div>;
  }
  if (assignment.error && !assignment.data) return <div className="p-4"><ErrorState error={assignment.error} onRetry={assignment.refetch} /></div>;
  if (operation.error && !operation.data) return <div className="p-4"><ErrorState error={operation.error} onRetry={operation.refetch} /></div>;
  if (!assignment.data || !operation.data || redirect) return null;

  return (
    <ExecucaoSteps
      assignmentId={assignmentId}
      operation={operation.data}
      surface={surface}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

function ExecucaoSteps({
  assignmentId,
  operation,
  surface,
  onClose,
  onCompleted,
}: {
  assignmentId: string;
  operation: OperationDetail;
  surface: "operator" | "platform";
  onClose?: () => void;
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const managementAssigned = Boolean(operation.assignment && operation.assignment.assignedBy !== operation.assignment.assignedTo);
  const type: DocumentKind = operation.requestedDocumentType ?? "WORK_ORDER";
  const directCompletion = DIRECT_COMPLETION.has(type);
  const configuredRvt = type === "TECHNICAL_REPORT" && Boolean(operation.rvtExecution);

  const [checklist, setChecklist] = useState<OperationChecklistItem[]>(operation.checklist);
  const [maintenanceType, setMaintenanceType] = useState<OperationMaintenanceType>(operation.maintenanceType ?? "SEMIANNUAL");
  const [maintenanceChecklist, setMaintenanceChecklist] = useState<OperationMaintenanceChecklistItem[]>(
    () => operation.maintenanceChecklistItems.map((item) => configuredRvt ? { ...item, executed: true, result: "YES" } : item),
  );
  const [equipmentIds, setEquipmentIds] = useState<string[]>(
    operation.inspectedEquipments.length > 0
      ? operation.inspectedEquipments.map((item) => item.equipmentId)
      : operation.equipment ? [operation.equipment.id] : [],
  );
  const initiallyUnassigned = operation.inspectedEquipments.length === 0 && !operation.equipment;
  const [fieldInspections, setFieldInspections] = useState<OperationDetail["inspectedEquipments"]>([]);
  const [newFieldEquipments, setNewFieldEquipments] = useState<NewFieldEquipmentDraft[]>([]);
  const [issue, setIssue] = useState(operation.reportedIssue ?? "");
  const [diagnosis, setDiagnosis] = useState(operation.technicalDiagnosis ?? "");
  const [service, setService] = useState(operation.serviceDescription ?? "");
  const [recommendations, setRecommendations] = useState(operation.technicalRecommendations ?? "");
  const [observations, setObservations] = useState(operation.observations ?? "");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(operation.customerSignerName ?? "");
  const [signerRole, setSignerRole] = useState(operation.customerSignerRole ?? "");
  const configuredTechnicalSignatureId = operation.documents.find((document) => document.type === type)?.technicalSignatureId
    ?? operation.rvtExecution?.rvtPlan?.responsibleTechnician?.institutionalSignature?.id
    ?? null;
  const [technicalSignatureId, setTechnicalSignatureId] = useState<string | null>(configuredTechnicalSignatureId);
  const [auxiliaryOperatorIds, setAuxiliaryOperatorIds] = useState<string[]>(
    () => (operation.auxiliaryAssignments ?? [])
      .filter((item) => item.status !== "CANCELED" && item.status !== "REJECTED")
      .map((item) => item.assignedTo),
  );
  const [equipmentProfiles, setEquipmentProfiles] = useState<Record<string, EquipmentProfileDraft>>(
    () => {
      const entries = operation.inspectedEquipments.map((item) => [
        item.equipmentId,
        {
          manufacturer: item.equipment?.manufacturer ?? item.brandSnapshot ?? "",
          model: item.equipment?.model ?? item.modelSnapshot ?? "",
          capacity: item.equipment?.capacity ?? item.capacitySnapshot ?? "",
        },
      ] as const);
      if (operation.equipment && !entries.some(([id]) => id === operation.equipment?.id)) {
        entries.push([
          operation.equipment.id,
          {
            manufacturer: operation.equipment.manufacturer ?? "",
            model: operation.equipment.model ?? "",
            capacity: operation.equipment.capacity ?? "",
          },
        ]);
      }
      return Object.fromEntries(entries);
    },
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [completedDocument, setCompletedDocument] = useState<{ id: string; number: string } | null>(null);

  const equipments = useQuery(
    (signal) => equipmentsApi.listEquipments({ customerId: operation.customer?.id, page: 1, limit: 100, signal }),
    [operation.customer?.id],
  );
  const equipmentTypes = useQuery(
    (signal) => initiallyUnassigned ? technicalCatalogsApi.listEquipmentTypes({ signal }) : Promise.resolve([]),
    [initiallyUnassigned],
  );
  const auxiliaryUsers = useQuery(
    (signal) => surface === "platform" ? usersApi.listUsers({ page: 1, limit: 100, signal }) : Promise.resolve(null),
    [surface],
  );
  const materials = useQuery((signal) => inventoryApi.listOperationMaterials(operation.id, { signal }), [operation.id]);
  const rvtChecklistCatalog = useQuery(
    async (signal) => type === "TECHNICAL_REPORT"
      ? (await Promise.all(RVT_MAINTENANCE_TYPES.map((item) => technicalCatalogsApi.listChecklistItems("TECHNICAL_REPORT", { maintenanceType: item.value, includeGeneral: false, signal })))).flat()
      : [],
    [type],
  );
  const authorizedEquipmentIds = useMemo(
    () =>
      new Set([
        ...operation.inspectedEquipments.map((item) => item.equipmentId),
        ...(operation.equipment ? [operation.equipment.id] : []),
        ...fieldInspections.map((item) => item.equipmentId),
      ]),
    [fieldInspections, operation],
  );
  const fieldCollectionPending = initiallyUnassigned && fieldInspections.length === 0;
  const equipmentOptions = useMemo(
    () => {
      const persisted = (equipments.data?.items ?? [])
        .filter((item) => fieldCollectionPending || authorizedEquipmentIds.has(item.id))
        .map((item) => ({
          value: item.id,
          label:
            [item.manufacturer, item.model, item.capacity].filter(Boolean).join(" - ") ||
            item.name,
          description: item.sector || "Setor não informado",
        }));
      const persistedIds = new Set(persisted.map((item) => item.value));
      const collected = fieldInspections
        .filter((item) => !persistedIds.has(item.equipmentId))
        .map((item) => ({
          value: item.equipmentId,
          label:
            [item.equipment?.manufacturer ?? item.brandSnapshot, item.equipment?.model ?? item.modelSnapshot, item.equipment?.capacity ?? item.capacitySnapshot]
              .filter(Boolean)
              .join(" - ") || item.equipment?.name || "Equipamento",
          description: item.equipment?.sector || item.sector || "Setor não informado",
        }));
      return [...persisted, ...collected];
    },
    [authorizedEquipmentIds, equipments.data, fieldCollectionPending, fieldInspections],
  );
  const requiredEquipmentProfileFields = useMemo(
    () =>
      Object.fromEntries(
        [...authorizedEquipmentIds].map((id) => {
          const inspected = operation.inspectedEquipments.find((item) => item.equipmentId === id);
          const fieldInspection = fieldInspections.find((item) => item.equipmentId === id);
          const primary = operation.equipment?.id === id ? operation.equipment : null;
          const profile = {
            manufacturer: fieldInspection?.equipment?.manufacturer ?? fieldInspection?.brandSnapshot ?? inspected?.equipment?.manufacturer ?? inspected?.brandSnapshot ?? primary?.manufacturer ?? "",
            model: fieldInspection?.equipment?.model ?? fieldInspection?.modelSnapshot ?? inspected?.equipment?.model ?? inspected?.modelSnapshot ?? primary?.model ?? "",
            capacity: fieldInspection?.equipment?.capacity ?? fieldInspection?.capacitySnapshot ?? inspected?.equipment?.capacity ?? inspected?.capacitySnapshot ?? primary?.capacity ?? "",
          };
          return [
            id,
            (Object.keys(profile) as Array<keyof EquipmentProfileDraft>).filter(
              (field) => !profile[field]?.trim(),
            ),
          ];
        }),
      ) as Record<string, Array<keyof EquipmentProfileDraft>>,
    [authorizedEquipmentIds, fieldInspections, operation],
  );
  const incompleteEquipmentIds = useMemo(
    () =>
      equipmentIds.filter((id) => (requiredEquipmentProfileFields[id]?.length ?? 0) > 0),
    [equipmentIds, requiredEquipmentProfileFields],
  );
  const equipmentProfilesComplete = incompleteEquipmentIds.every((id) =>
    requiredEquipmentProfileFields[id].every(
      (field) => Boolean(equipmentProfiles[id]?.[field]?.trim()),
    ),
  );
  const fieldEquipmentDraftsValid = newFieldEquipments.every((item) =>
    Boolean(item.equipmentTypeCatalogId && item.manufacturer?.trim() && item.model?.trim() && item.capacity?.trim()),
  );
  const fieldEquipmentSelectionValid = !fieldCollectionPending ||
    (equipmentIds.length + newFieldEquipments.length > 0 &&
      equipmentIds.length + newFieldEquipments.length <= 20 &&
      fieldEquipmentDraftsValid);

  useEffect(() => {
    if (type !== "TECHNICAL_REPORT" || rvtChecklistCatalog.loading) return;
    setMaintenanceChecklist((current) => {
      const persisted = new Map(
        current.map((item) => [`${item.maintenanceType}:${item.description.trim().toLocaleLowerCase("pt-BR")}`, item]),
      );
      return (rvtChecklistCatalog.data ?? []).map((catalogItem) => {
        const itemType = catalogItem.maintenanceType ?? "SEMIANNUAL";
        const existing = persisted.get(`${itemType}:${catalogItem.title.trim().toLocaleLowerCase("pt-BR")}`);
        if (existing) {
          return itemType === maintenanceType
            ? existing
            : { ...existing, executed: false, result: "NO" as const };
        }
        const selected = itemType === maintenanceType;
        return {
          maintenanceType: itemType,
          description: catalogItem.title,
          executed: selected,
          result: selected ? "YES" as const : "NO" as const,
          observations: catalogItem.description,
        };
      });
    });
  }, [maintenanceType, rvtChecklistCatalog.data, rvtChecklistCatalog.loading, type]);

  function selectRvtMaintenanceType(value: OperationMaintenanceType) {
    setMaintenanceChecklist((current) => current.map((item) => ({
      ...item,
      executed: item.maintenanceType === value,
      result: item.maintenanceType === value ? "YES" : "NO",
    })));
    setMaintenanceType(value);
  }

  const signatureRequired = CUSTOMER_SIGNATURE.has(type) && !operation.signatureCaptured;
  const technicalSignatureRequired = directCompletion;
  const canFinish = (!technicalSignatureRequired || Boolean(technicalSignatureId)) && (!signatureRequired || (Boolean(signature) && signerName.trim().length > 0));
  const isLast = step === STEPS.length - 1;
  const canAdvance =
    (step !== 1 || (equipmentProfilesComplete && fieldEquipmentSelectionValid)) &&
    (step !== 4 || ((!technicalSignatureRequired || Boolean(technicalSignatureId)) && (!signatureRequired || (Boolean(signature) && signerName.trim().length > 0))));

  function back() {
    if (step === 0) {
      if (surface === "platform") onClose?.();
      else router.push(`/operator/services/${assignmentId}`);
    }
    else setStep((s) => s - 1);
  }

  async function next() {
    if (!isLast) {
      if (step === 1 && fieldCollectionPending) {
        setSubmitting(true); setSubmitError(null);
        try {
          const updated = await operationApi.addFieldEquipments(operation.id, {
            existingEquipmentIds: equipmentIds,
            newEquipments: newFieldEquipments.map((item) => ({
              equipmentTypeCatalogId: item.equipmentTypeCatalogId,
              sector: item.sector?.trim() || undefined,
              tag: item.tag?.trim() || undefined,
              manufacturer: item.manufacturer?.trim() || undefined,
              model: item.model?.trim() || undefined,
              serialNumber: item.serialNumber?.trim() || undefined,
              capacity: item.capacity?.trim() || undefined,
              voltage: item.voltage?.trim() || undefined,
              observations: item.observations?.trim() || undefined,
            })),
          });
          setFieldInspections(updated.inspectedEquipments);
          setEquipmentIds(updated.inspectedEquipments.map((item) => item.equipmentId));
          setEquipmentProfiles((current) => Object.fromEntries(updated.inspectedEquipments.map((item) => [
            item.equipmentId,
            {
              manufacturer: item.equipment?.manufacturer ?? item.brandSnapshot ?? current[item.equipmentId]?.manufacturer ?? "",
              model: item.equipment?.model ?? item.modelSnapshot ?? current[item.equipmentId]?.model ?? "",
              capacity: item.equipment?.capacity ?? item.capacitySnapshot ?? current[item.equipmentId]?.capacity ?? "",
            },
          ])));
          setNewFieldEquipments([]);
          if (updated.inspectedEquipments.some((item) =>
            !item.equipment?.manufacturer?.trim() ||
            !item.equipment?.model?.trim() ||
            !item.equipment?.capacity?.trim(),
          )) {
            setSubmitError("Complete marca, modelo e capacidade dos equipamentos selecionados antes de continuar.");
            return;
          }
        } catch (err) {
          setSubmitError(err instanceof Error ? err.message : "Não foi possível cadastrar os equipamentos do atendimento.");
          return;
        } finally { setSubmitting(false); }
      }
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const customerSignedAt = signature ? new Date().toISOString() : null;
      const equipmentMap = new Map((equipments.data?.items ?? []).map((item) => [item.id, item] as [string, EquipmentSummary]));
      for (const item of fieldInspections) {
        if (item.equipment) equipmentMap.set(item.equipmentId, item.equipment as EquipmentSummary);
      }
      await operationApi.updateOperation(operation.id, {
        ...(surface === "platform" ? { auxiliaryOperatorIds } : {}),
        checklist,
        maintenanceType: type === "TECHNICAL_REPORT" ? maintenanceType : null,
        maintenanceChecklist: type === "TECHNICAL_REPORT"
          ? maintenanceChecklist.map((item) => ({
              ...(item.equipmentId ? { equipmentId: item.equipmentId } : {}),
              maintenanceType: item.maintenanceType,
              description: item.description,
              executed: item.executed,
              ...(item.result ? { result: item.result } : {}),
              ...(item.observations != null ? { observations: item.observations } : {}),
            }))
          : [],
        reportedIssue: issue,
        technicalDiagnosis: diagnosis,
        serviceDescription: service,
        technicalRecommendations: recommendations,
        observations,
        inspectedEquipments: equipmentIds.map((id) => {
          const existing = operation.inspectedEquipments.find((item) => item.equipmentId === id);
          const equipment = equipmentMap.get(id);
          const profile = equipmentProfiles[id];
          return {
            equipmentId: id,
            sector: existing?.sector ?? equipment?.sector ?? equipment?.address?.name ?? equipment?.name ?? "Não informado",
            manufacturer: profile?.manufacturer.trim() || undefined,
            model: profile?.model.trim() || undefined,
            capacity: profile?.capacity.trim() || undefined,
          };
        }),
        photos: await Promise.all(photos.map(async (photo) => ({ dataUrl: await fileToDataUrl(photo.file), caption: photo.caption || photo.name }))),
        // A assinatura também é persistida na Operation (igual ao fluxo
        // self-service): é ela que o drawer da Platform e a Identificação exibem.
        ...(signature
          ? {
              signatureData: signature,
              customerSignerName: signerName.trim(),
              customerSignerRole: signerRole.trim() || null,
              signedAt: customerSignedAt,
            }
          : {}),
      });
      let handoff = await documentsApi.saveHandoffDraft(operation.id, type);
      if (technicalSignatureRequired && !configuredTechnicalSignatureId) {
        if (!technicalSignatureId) throw new Error("Selecione sua assinatura técnica para esta atividade.");
        handoff = await documentsApi.selectHandoffTechnicalSignature(handoff.id, technicalSignatureId);
      }
      if (signature) {
        if (!signerName.trim()) throw new Error("Informe o nome de quem assinou.");
        handoff = await documentsApi.collectCustomerSignature(handoff.id, {
          signerName: signerName.trim(),
          signerRole: signerRole.trim() || undefined,
          signatureData: signature,
          collectedAt: customerSignedAt ?? new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Recife",
        });
      }
      await documentsApi.submitHandoff(handoff.id);
      await assignmentsApi.completeAssignment(assignmentId, "Atendimento concluído pelo operador em campo");
      if (directCompletion) {
        await documentsApi.finalizeHandoffReview(handoff.id);
        await documentsApi.renderDocument(handoff.id);
        setCompletedDocument({
          id: handoff.id,
          number:
            handoff.number ??
            operation.documents.find((document) => document.id === handoff.id)?.number ??
            `RVT-${String(operation.number).padStart(6, "0")}`,
        });
      }
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Não foi possível concluir o atendimento.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    if (surface === "platform") {
      return (
        <div className="grid min-h-[420px] place-items-center p-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[var(--color-success)]/12 text-[var(--color-success)]">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h2 className="mt-4 text-section-title">RVT concluído</h2>
            <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
              A execução foi concluída e o documento oficial foi gerado pelo Document Engine.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => router.push("/documentos")} className="h-11 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]">
                Abrir documentos
              </button>
              <button type="button" onClick={() => { onCompleted?.(); onClose?.(); }} className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-muted)]">
                Voltar ao RVT
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (directCompletion && completedDocument) {
      return (
        <OperatorDocumentSuccessView
          documentId={completedDocument.id}
          documentNumber={completedDocument.number}
          documentType={type}
          onDone={() => router.push("/operator")}
          onDocuments={() => router.push("/operator/documents")}
          onNew={() => router.push("/operator/atendimento")}
        />
      );
    }
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/12 grid place-items-center text-[var(--color-success)]">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <h1 className="text-section-title mt-4">Atendimento concluído</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
            {directCompletion
              ? "O atendimento foi concluído e o PDF oficial já está disponível. A gestão foi notificada."
              : "Os dados foram enviados para revisão da gestão."}
          </p>
          <div className="mt-6 space-y-2">
            {directCompletion && <button type="button" onClick={() => router.push("/operator/documents")} className="w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] h-12 text-sm font-semibold active:scale-[0.99]">Baixar ou compartilhar PDF</button>}
            <button type="button" onClick={() => router.push(`/operator/services/${assignmentId}`)} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] h-12 text-sm font-medium hover:bg-[var(--color-muted)]">Ver atendimento</button>
            <button type="button" onClick={() => router.push("/operator/services")} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] h-12 text-sm font-medium hover:bg-[var(--color-muted)]">Minhas ordens</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col overflow-hidden ${surface === "platform" ? "h-full min-h-0" : "min-h-dvh"}`}>
      <WizardProgressHeader
        title={STEPS[step]}
        current={step}
        total={STEPS.length}
        onBack={back}
        onClose={() => surface === "platform" ? onClose?.() : router.push(`/operator/services/${assignmentId}`)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {step === 0 && (
          type === "TECHNICAL_REPORT" ? (
            <AssignedRvtChecklistStep
              maintenanceType={maintenanceType}
              onMaintenanceType={selectRvtMaintenanceType}
              items={maintenanceChecklist}
              loading={rvtChecklistCatalog.loading}
              onToggle={(index) => setMaintenanceChecklist((current) => current.map((item, currentIndex) => currentIndex === index && item.maintenanceType === maintenanceType ? { ...item, executed: !item.executed, result: item.executed ? "NO" : "YES" } : item))}
            />
          ) : (
            <ChecklistStep
              items={checklist}
              onToggle={(i) => setChecklist((arr) => arr.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)))}
              onNote={(i, note) => setChecklist((arr) => arr.map((it, idx) => (idx === i ? { ...it, note } : it)))}
            />
          )
        )}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm">
              <span className="text-caption block">Documento do atendimento</span>
              <span className="font-medium">{DOCUMENT_KIND_LABEL[type]}</span>
              {managementAssigned && <span className="block text-[11px] text-[var(--color-muted-foreground)]">Definido pela gestão para este atendimento.</span>}
            </div>
            <MultiSelect label="Equipamentos envolvidos" value={equipmentIds} onChange={setEquipmentIds} options={equipmentOptions} placeholder="Selecionar equipamentos" />
            {fieldCollectionPending && (
              <FieldEquipmentCollection
                drafts={newFieldEquipments}
                equipmentTypes={equipmentTypes.data ?? []}
                equipmentTypesLoading={equipmentTypes.loading}
                onAdd={(draft) => setNewFieldEquipments((current) => [...current, draft])}
                onRemove={(localId) => setNewFieldEquipments((current) => current.filter((item) => item.localId !== localId))}
              />
            )}
            {incompleteEquipmentIds.length > 0 && (
              <EquipmentProfileCompletion
                equipmentIds={incompleteEquipmentIds}
                equipmentOptions={equipmentOptions}
                requiredFields={requiredEquipmentProfileFields}
                profiles={equipmentProfiles}
                onChange={(equipmentId, field, value) => {
                  setSubmitError(null);
                  setEquipmentProfiles((current) => ({
                    ...current,
                    [equipmentId]: {
                      manufacturer: current[equipmentId]?.manufacturer ?? "",
                      model: current[equipmentId]?.model ?? "",
                      capacity: current[equipmentId]?.capacity ?? "",
                      [field]: value,
                    },
                  }));
                }}
              />
            )}
            {type === "TECHNICAL_REPORT" ? <>
              {surface === "platform" && (
                <MultiSelect
                  label="Auxiliar Técnico (opcional)"
                  value={auxiliaryOperatorIds}
                  onChange={setAuxiliaryOperatorIds}
                  options={(auxiliaryUsers.data?.items ?? [])
                    .filter((user) => user.isActive && user.id !== operation.operator?.id)
                    .map((user) => ({
                      value: user.id,
                      label: user.name,
                      description: `${user.role} · somente acompanhamento`,
                    }))}
                  placeholder="Selecionar auxiliares"
                  emptyMessage="Nenhum outro usuário operacional disponível."
                />
              )}
              <TextArea label="Observações" value={observations} onChange={setObservations} />
              <TextArea label="Recomendações técnicas (opcional)" value={recommendations} onChange={setRecommendations} />
            </> : <>
              <TextArea label={type === "WORK_ORDER" ? "Defeito ou solicitação" : "Necessidade identificada"} value={issue} onChange={setIssue} />
              {type !== "WORK_ORDER" && <TextArea label="Condições encontradas / diagnóstico" value={diagnosis} onChange={setDiagnosis} />}
              <TextArea label={type === "WORK_ORDER" ? "Serviços previstos ou executados" : type === "BUDGET" ? "Serviços e peças sugeridos" : "Atividades executadas"} value={service} onChange={setService} />
              {type !== "WORK_ORDER" && <TextArea label="Recomendações" value={recommendations} onChange={setRecommendations} />}
              <TextArea label={type === "WORK_ORDER" ? "Observações" : "Observações de campo"} value={observations} onChange={setObservations} />
            </>}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">Registre as evidências do serviço. Fotos já enviadas permanecem na operação.</p>
            <PhotoInput photos={photos} onChange={setPhotos} max={16} existingCount={operation.photos.length} disabled={submitting} />
          </div>
        )}
        {step === 3 && (
          <MateriaisStep operationId={operation.id} materials={materials.data ?? []} loading={materials.loading} error={materials.error} onRefresh={materials.refetch} />
        )}
        {step === 4 && (
          <div className="space-y-5">
            {technicalSignatureRequired && (configuredTechnicalSignatureId ? <div className="rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"><strong>Assinatura técnica definida</strong><p className="text-caption">Esta execução utilizará a assinatura do responsável técnico configurado no RVT.</p></div> : <OperatorSignatureChoice selectedId={technicalSignatureId} onSelect={setTechnicalSignatureId} />)}
            <RevisaoStep
              operation={operation}
              type={type}
              checklist={checklist}
              maintenanceType={maintenanceType}
              maintenanceChecklist={maintenanceChecklist}
              equipmentLabels={equipmentIds.map((id) => equipmentOptions.find((o) => o.value === id)?.label ?? "").filter(Boolean)}
              texts={[
                ["Problema relatado", issue],
                ["Diagnóstico", diagnosis],
                ["Atividades realizadas", service],
                ["Recomendações", recommendations],
                ["Observações", observations],
              ]}
              photos={photos}
              materials={materials.data ?? []}
              signatureRequired={signatureRequired}
              signatureCaptured={Boolean(operation.signatureCaptured || signature)}
              signerName={signerName}
              signerRole={signerRole}
              onSignerName={setSignerName}
              onSignerRole={setSignerRole}
              onSignature={setSignature}
            />
          </div>
        )}
        {step === 5 && (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-4 text-sm text-[var(--color-success)]">
              <CheckCircle2 className="mb-2 h-6 w-6" />
              <strong className="block">Coleta conferida</strong>
              <span className="mt-1 block">
                {directCompletion
                  ? `${DOCUMENT_KIND_LABEL[type]} será concluído e o PDF oficial será gerado agora.`
                  : `${DOCUMENT_KIND_LABEL[type]} será concluído e encaminhado para revisão da gestão.`}
              </span>
            </div>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Cliente, equipamentos, checklist, conteúdo, evidências, materiais e assinatura foram apresentados para conferência no passo anterior.
            </p>
          </div>
        )}
        {submitError && (
          <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{submitError}</p>
        )}
      </div>

      <WizardFooter
        onBack={back}
        onNext={next}
        nextLabel={isLast ? (directCompletion ? "Concluir e gerar PDF" : "Concluir e enviar para revisão") : "Continuar"}
        nextDisabled={!canAdvance || (isLast && !canFinish)}
        loading={submitting}
        isLast={isLast}
        nextIcon={isLast ? <Send className="h-4 w-4" /> : undefined}
      />
    </div>
  );
}

/* ---------- Steps ---------- */

function EquipmentProfileCompletion({
  equipmentIds,
  equipmentOptions,
  requiredFields,
  profiles,
  onChange,
}: {
  equipmentIds: string[];
  equipmentOptions: Array<{ value: string; label: string; description?: string }>;
  requiredFields: Record<string, Array<keyof EquipmentProfileDraft>>;
  profiles: Record<string, EquipmentProfileDraft>;
  onChange: (
    equipmentId: string,
    field: keyof EquipmentProfileDraft,
    value: string,
  ) => void;
}) {
  const labels: Record<keyof EquipmentProfileDraft, string> = {
    manufacturer: "Marca",
    model: "Modelo",
    capacity: "Capacidade",
  };
  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/5 p-3">
      <div>
        <h2 className="font-semibold">Complete os dados dos equipamentos</h2>
        <p className="text-caption">
          As informações serão atualizadas no cadastro do cliente e utilizadas nesta Ordem de Serviço.
        </p>
      </div>
      {equipmentIds.map((equipmentId) => {
        const option = equipmentOptions.find((item) => item.value === equipmentId);
        return (
          <div
            key={equipmentId}
            className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3"
          >
            <div>
              <p className="text-sm font-medium">{option?.label ?? "Equipamento"}</p>
              <p className="text-caption">{option?.description ?? "Setor não informado"}</p>
            </div>
            {requiredFields[equipmentId].map((field) => (
              <label key={field} className="block space-y-1 text-sm">
                <span className="font-medium">{labels[field]} *</span>
                <input
                  value={profiles[equipmentId]?.[field] ?? ""}
                  onChange={(event) => onChange(equipmentId, field, event.target.value)}
                  className={inputCls}
                  maxLength={field === "capacity" ? 80 : 120}
                  placeholder={`Informe ${labels[field].toLowerCase()}`}
                  required
                />
              </label>
            ))}
          </div>
        );
      })}
      {!equipmentIds.every((id) =>
        requiredFields[id].every((field) => Boolean(profiles[id]?.[field]?.trim())),
      ) && (
        <p className="text-xs font-medium text-[var(--color-warning)]">
          Preencha os campos obrigatórios para continuar.
        </p>
      )}
    </section>
  );
}

function AssignedRvtChecklistStep({ maintenanceType, onMaintenanceType, items, loading, onToggle }: {
  maintenanceType: OperationMaintenanceType;
  onMaintenanceType: (value: OperationMaintenanceType) => void;
  items: OperationMaintenanceChecklistItem[];
  loading: boolean;
  onToggle: (index: number) => void;
}) {
  if (loading) return <SkeletonList rows={6} />;
  return <div className="space-y-5">
    <section className="space-y-3"><div><h2 className="font-semibold">Tipo de manutenção</h2><p className="text-caption">Selecione o tipo realizado. Ambos permanecerão visíveis no relatório.</p></div><div className="grid grid-cols-2 gap-3">{RVT_MAINTENANCE_TYPES.map((type) => <button key={type.value} type="button" onClick={() => onMaintenanceType(type.value)} className={`flex min-h-16 items-center justify-between rounded-[var(--radius-lg)] border p-3 ${maintenanceType === type.value ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)]"}`}><span className="font-medium">{type.label}</span>{maintenanceType === type.value && <Check className="h-5 w-5 text-[var(--color-primary)]" />}</button>)}</div></section>
    {RVT_MAINTENANCE_TYPES.map((type) => { const selected = maintenanceType === type.value; const indexed = items.map((item, index) => ({ item, index })).filter(({ item }) => item.maintenanceType === type.value); return <section key={type.value} className={`space-y-2 rounded-[var(--radius-lg)] border p-3 ${selected ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"}`}><div className="flex items-center justify-between"><h3 className="font-semibold">Checklist {type.label.toLowerCase()}</h3>{selected && <span className="rounded-full bg-[var(--color-success)]/10 px-2 py-1 text-xs text-[var(--color-success)]">Selecionado</span>}</div>{indexed.length === 0 ? <p className="text-caption">Nenhum item cadastrado.</p> : indexed.map(({ item, index }) => <button key={`${type.value}-${index}`} type="button" disabled={!selected} onClick={() => onToggle(index)} className="flex w-full items-center gap-3 rounded-md bg-[var(--color-card)] p-3 text-left disabled:cursor-default disabled:opacity-70">{selected && item.executed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success)]" /> : <Circle className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />}<span className="text-sm">{item.description}</span></button>)}</section>; })}
  </div>;
}

function ChecklistStep({ items, onToggle, onNote }: { items: OperationChecklistItem[]; onToggle: (i: number) => void; onNote: (i: number, note: string) => void }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum checklist definido para este atendimento. Avance para a coleta de dados.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--color-muted-foreground)]">Marque cada item executado e registre observações quando necessário.</p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-2">
            <button type="button" onClick={() => onToggle(i)} className="w-full flex items-center gap-3 text-left active:scale-[0.99]">
              {it.done ? <CheckCircle2 className="h-5 w-5 text-[var(--color-success)] shrink-0" /> : <Circle className="h-5 w-5 text-[var(--color-muted-foreground)] shrink-0" />}
              <span className={`text-sm ${it.done ? "" : "text-[var(--color-muted-foreground)]"}`}>{it.label}</span>
            </button>
            <input value={it.note ?? ""} onChange={(e) => onNote(i, e.target.value)} placeholder="Observação do item (opcional)" className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--color-primary)]" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MateriaisStep({ operationId, materials, loading, error, onRefresh }: { operationId: string; materials: OperationPart[]; loading: boolean; error: Error | null; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">Registre os materiais consumidos no atendimento (opcional).</p>
      {loading && materials.length === 0 ? (
        <SkeletonList rows={2} />
      ) : error && materials.length === 0 ? (
        <ErrorState error={error} onRetry={onRefresh} />
      ) : materials.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3 text-center text-sm text-[var(--color-muted-foreground)]">Nenhum material registrado.</p>
      ) : (
        <ul className="space-y-2">
          {materials.map((part) => (
            <li key={part.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 font-medium truncate">{part.product.name}</span>
                <span className="font-mono tabular-nums">{Number(part.quantity).toLocaleString("pt-BR")} {part.product.unit}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{part.product.sku}{part.notes ? ` · ${part.notes}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <MaterialForm operationId={operationId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onRefresh(); }} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-muted)]">
          Adicionar material
        </button>
      )}
    </div>
  );
}

function MaterialForm({ operationId, onClose, onSaved }: { operationId: string; onClose: () => void; onSaved: () => void }) {
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
    setInventoryItemId((current) => (productItems.some((item) => item.id === current) ? current : productItems[0]?.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, inventory.data]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await inventoryApi.addOperationMaterial(operationId, { productId, inventoryItemId, quantity: Number(quantity), notes: notes || null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar o material.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      <label className="block space-y-1 text-sm"><span className="font-medium">Produto</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
          {(products.data?.items ?? []).map((product: Product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm"><span className="font-medium">Item de estoque</span>
        <select value={inventoryItemId} onChange={(e) => setInventoryItemId(e.target.value)} className={inputCls}>
          {productItems.map((item) => <option key={item.id} value={item.id}>{item.location ?? "Sem localização"} · disponível {Number(item.availableQuantity).toLocaleString("pt-BR")}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm"><span className="font-medium">Quantidade</span>
        <input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
      </label>
      <label className="block space-y-1 text-sm"><span className="font-medium">Observação</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving || !productId || !inventoryItemId || Number(quantity) <= 0} className="h-11 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50">
          {saving ? "Registrando…" : "Registrar"}
        </button>
      </div>
    </div>
  );
}

function RevisaoStep({
  operation, type, checklist, maintenanceType, maintenanceChecklist, equipmentLabels, texts, photos, materials,
  signatureRequired, signatureCaptured, signerName, signerRole, onSignerName, onSignerRole, onSignature,
}: {
  operation: OperationDetail;
  type: DocumentKind;
  checklist: OperationChecklistItem[];
  maintenanceType: OperationMaintenanceType;
  maintenanceChecklist: OperationMaintenanceChecklistItem[];
  equipmentLabels: string[];
  texts: Array<[string, string]>;
  photos: CapturedPhoto[];
  materials: OperationPart[];
  signatureRequired: boolean;
  signatureCaptured: boolean;
  signerName: string;
  signerRole: string;
  onSignerName: (v: string) => void;
  onSignerRole: (v: string) => void;
  onSignature: (v: string | null) => void;
}) {
  const serviceTypeLabel = useServiceTypeLabel();
  const reviewChecklist = type === "TECHNICAL_REPORT"
    ? maintenanceChecklist.map((item) => ({
        label: `${item.maintenanceType === "WEEKLY" ? "Semanal" : "Semestral"} · ${item.description}`,
        done: item.executed,
        note: item.observations,
      }))
    : checklist;
  const done = reviewChecklist.filter((c) => c.done).length;
  const address = operationServiceAddressLabel(operation.address);
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/10 px-3 py-2 text-sm text-[var(--color-info)] flex items-start gap-2">
        <FileText className="h-4 w-4 mt-0.5 shrink-0" />
        Confira com o cliente tudo o que foi realizado. A assinatura confirma o aceite do atendimento.
      </div>

      <ReviewCard title="Identificação" icon={<Building2 className="h-4 w-4" />}>
        <ReviewRow label="Operação" value={`OP-${String(operation.number).padStart(6, "0")}`} />
        <ReviewRow label="Cliente" value={operation.customer?.name ?? "—"} />
        <ReviewRow label={operation.secondaryServiceType ? "Endereço do serviço primário" : "Endereço"} value={address} icon={<MapPin className="h-3.5 w-3.5" />} />
        {operation.secondaryServiceType && <>
          <ReviewRow label="Serviço primário" value={serviceTypeLabel(operation.type)} />
          <ReviewRow label="Serviço secundário" value={serviceTypeLabel(operation.secondaryServiceType)} />
          <ReviewRow label="Endereço do serviço secundário" value={operationServiceAddressLabel(operation.secondaryAddress)} icon={<MapPin className="h-3.5 w-3.5" />} />
        </>}
        <ReviewRow label="Tipos de serviço" value={(operation.serviceTypes?.length ? operation.serviceTypes : [operation.type]).map(serviceTypeLabel).join(" · ")} />
        <ReviewRow label="Documento" value={DOCUMENT_KIND_LABEL[type]} />
        <ReviewRow label="Operador" value={operation.operator?.name ?? "—"} />
      </ReviewCard>

      <ReviewCard title={`Equipamentos (${equipmentLabels.length})`} icon={<Wrench className="h-4 w-4" />}>
        {equipmentLabels.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">Sem equipamentos vinculados.</p> : (
          <ul className="space-y-1">{equipmentLabels.map((label) => <li key={label} className="text-sm">{label}</li>)}</ul>
        )}
      </ReviewCard>

      <ReviewCard title={`Checklist (${done}/${reviewChecklist.length})`} icon={<ClipboardList className="h-4 w-4" />}>
        {type === "TECHNICAL_REPORT" && <p className="mb-2 text-xs font-medium text-[var(--color-primary)]">Tipo realizado: {maintenanceType === "WEEKLY" ? "Semanal" : "Semestral"}</p>}
        {reviewChecklist.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">Sem checklist.</p> : (
          <ul className="space-y-1.5">
            {reviewChecklist.map((it, i) => (
              <li key={`${it.label}-${i}`} className="flex items-start gap-2 text-sm">
                {it.done ? <Check className="h-4 w-4 text-[var(--color-success)] shrink-0 mt-0.5" /> : <Circle className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" />}
                <span>
                  {it.label}
                  {it.note ? <span className="block text-[11px] text-[var(--color-muted-foreground)]">{it.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ReviewCard>

      <ReviewCard title="Relato do atendimento" icon={<FileText className="h-4 w-4" />}>
        {texts.filter(([, value]) => value.trim()).length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Nenhuma informação registrada.</p>
        ) : (
          texts.filter(([, value]) => value.trim()).map(([label, value]) => (
            <div key={label} className="py-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</span>
              <p className="text-sm whitespace-pre-wrap">{value}</p>
            </div>
          ))
        )}
      </ReviewCard>

      <ReviewCard title={`Fotos (${operation.photos.length + photos.length})`} icon={<Camera className="h-4 w-4" />}>
        {operation.photos.length + photos.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Nenhuma foto registrada.</p>
        ) : (
          <>
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo) => (
                  <div key={photo.id} className="aspect-square overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
                    <Image unoptimized src={photo.url} width={160} height={160} alt={photo.name} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            {operation.photos.length > 0 && <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">{operation.photos.length} foto(s) já enviadas anteriormente.</p>}
          </>
        )}
      </ReviewCard>

      <ReviewCard title={`Materiais (${materials.length})`} icon={<Package className="h-4 w-4" />}>
        {materials.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum material consumido.</p> : (
          <ul className="space-y-1">
            {materials.map((part) => (
              <li key={part.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{part.product.name}</span>
                <span className="font-mono tabular-nums text-xs">{Number(part.quantity).toLocaleString("pt-BR")} {part.product.unit}</span>
              </li>
            ))}
          </ul>
        )}
      </ReviewCard>

      <ReviewCard title="Assinatura do cliente" icon={<PenLine className="h-4 w-4" />}>
        {signatureCaptured ? (
          <p className="text-sm text-[var(--color-success)]">Assinatura já coletada para este atendimento.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {signatureRequired ? "Após o check das informações acima, colete a assinatura do cliente para confirmar o aceite." : "Assinatura opcional para este tipo de documento."}
            </p>
            <input value={signerName} onChange={(e) => onSignerName(e.target.value)} placeholder="Nome do cliente/responsável" className={inputCls} />
            <input value={signerRole} onChange={(e) => onSignerRole(e.target.value)} placeholder="Função ou vínculo (opcional)" className={inputCls} />
            {/* Só coleta ao pressionar "Confirmar assinatura"; o traço em si não
                salva. onChange apenas limpa a assinatura quando o pad é esvaziado. */}
            <SignaturePad onChange={(value) => { if (!value) onSignature(null); }} onConfirm={onSignature} />
          </div>
        )}
      </ReviewCard>
    </div>
  );
}

/* ---------- shared bits ---------- */

function ReviewCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{icon} {title}</h3>
      {children}
    </section>
  );
}

function ReviewRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 border-b last:border-0 border-[var(--color-border)]/60 text-sm">
      <span className="text-caption inline-flex items-center gap-1">{icon}{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea className={`${inputCls} min-h-20 resize-y`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={20000} />
    </label>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.readAsDataURL(file);
  });
}
