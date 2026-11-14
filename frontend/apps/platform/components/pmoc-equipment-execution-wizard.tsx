"use client";

import { useCapturedPhotos } from "@erp/ui/use-captured-photos";
import { useEffect, useMemo, useState } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, FileText, Wrench } from "lucide-react";
import {
  ApiClientError,
  documentsApi,
  pmocApi,
  usersApi,
  useQuery,
  type CreateOperationPayload,
  type EquipmentSummary,
  type PmocExecutionRequest,
  type PmocPlan,
} from "@erp/api";
import { Drawer } from "@erp/ui/drawer";
import { PhotoInput } from "@erp/ui/photo-input";

type CoveredEquipment = Pick<
  EquipmentSummary,
  "id" | "name" | "tag" | "sector" | "manufacturer" | "model" | "capacity" | "address"
>;

type Props = {
  open: boolean;
  plan: PmocPlan;
  equipment: CoveredEquipment | null;
  request: PmocExecutionRequest | null;
  prefill: CreateOperationPayload | null;
  onClose: () => void;
  onCompleted: (
    request: PmocExecutionRequest,
    documentId: string | null,
    documentNumber: string | null,
  ) => void;
};

const steps = ["Identificação", "Escopo", "Evidências", "Confirmação"] as const;
const MAX_PMOC_PHOTOS = 6;

export function PmocEquipmentExecutionWizard({
  open,
  plan,
  equipment,
  request,
  prefill,
  onClose,
  onCompleted,
}: Props) {
  const users = useQuery((signal) => usersApi.listUsers({ limit: 100, signal }), [open]);
  const [step, setStep] = useState(0);
  const [scheduledFor, setScheduledFor] = useState("");
  const [auxiliaryIds, setAuxiliaryIds] = useState<string[]>([]);
  const [photos, setPhotos] = useCapturedPhotos();
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [reportedIssue, setReportedIssue] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [generatedRequest, setGeneratedRequest] = useState<PmocExecutionRequest | null>(null);
  const [generatedDocument, setGeneratedDocument] = useState<{ id: string; number: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !prefill) return;
    setStep(0);
    setScheduledFor(toLocalDateTime(new Date()));
    setAuxiliaryIds(prefill.auxiliaryOperatorIds ?? []);
    setReportedIssue(prefill.reportedIssue ?? "");
    setServiceDescription(prefill.serviceDescription ?? "");
    setObservations(prefill.observations ?? "");
    setPhotos([]);
    setGeneratedRequest(null);
    setGeneratedDocument(null);
    setError(null);
  }, [open, prefill, request?.id, setPhotos]);

  const technician = plan.defaultTechnician;
  const availableAuxiliaries =
    users.data?.items.filter(
      (user) => user.isActive && user.role !== "VIEWER" && user.id !== plan.defaultTechnicianId,
    ) ?? [];
  const checklistGroups = useMemo(() => {
    const checklists = plan.includeChecklistInOperations ? (plan.checklists ?? []) : [];
    const grouped = new Map<string, typeof checklists>();
    checklists.forEach((item) => {
      const label =
        item.technicalCatalog.pmocUnit === "EVAPORATOR"
          ? "Unidade evaporadora"
          : item.technicalCatalog.pmocUnit === "CONDENSER"
            ? "Unidade condensadora"
            : "Procedimentos gerais";
      grouped.set(label, [...(grouped.get(label) ?? []), item]);
    });
    return [...grouped.entries()];
  }, [plan.checklists, plan.includeChecklistInOperations]);

  async function submit() {
    if (!request || !equipment || !prefill) return;
    if (!technician?.id) {
      setError("Defina um técnico responsável no PMOC antes de iniciar a execução.");
      setStep(1);
      return;
    }
    setBusy(true);
    setError(null);
    let executionGenerated = Boolean(generatedRequest);
    try {
      const generated =
        generatedRequest ??
        await (async () => {
          const encodedPhotos = photos.length
            ? await Promise.all(
                photos.map(async (photo) => ({
                  dataUrl: await fileToDataUrl(photo.file),
                  caption: photo.caption?.trim() || null,
                })),
              )
            : undefined;
          const result = await pmocApi.generateWorkOrder(
            request.id,
            {
              ...prefill,
              customerId: plan.customerId,
              equipmentId: equipment.id,
              inspectedEquipments: [
                {
                  equipmentId: equipment.id,
                  sector: equipment.sector ?? equipment.address?.name ?? equipment.name,
                },
              ],
              operatorId: technician.id,
              auxiliaryOperatorIds: auxiliaryIds,
              documentType: "PMOC",
              scheduledFor: new Date(scheduledFor).toISOString(),
              startedAt: new Date(scheduledFor).toISOString(),
              completedAt: new Date().toISOString(),
              status: "COMPLETED",
              reportedIssue: reportedIssue.trim() || undefined,
              serviceDescription: serviceDescription.trim() || undefined,
              observations: observations.trim() || undefined,
              ...(encodedPhotos ? { photos: encodedPhotos } : {}),
            },
            { allowEarly: true },
          );
          setGeneratedRequest(result);
          executionGenerated = true;
          return result;
        })();
      const operationId = generated.operationId ?? generated.generatedOperationId;
      if (!operationId) throw new Error("A Ordem de Serviço não foi vinculada à execução.");
      let document = generatedDocument;
      if (!document) {
        const created = await documentsApi.saveHandoffDraft(operationId, "PMOC");
        document = { id: created.id, number: created.number };
        setGeneratedDocument(document);
      }
      await documentsApi.renderDocument(document.id);
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setPhotos([]);
      onCompleted(generated, document.id, document.number);
    } catch (cause) {
      setError(
        executionGenerated
          ? `A execução foi concluída, mas o PDF ainda não foi gerado. Tente novamente. ${apiMessage(cause)}`
          : apiMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={busy || photoProcessing ? () => undefined : onClose}
      eyebrow={`PMOC-${String(plan.number).padStart(6, "0")}`}
      title={
        request
        ? `Executar ${String(request.equipmentExecutionNumber).padStart(3, "0")} do PMOC`
          : "Preparar execução do PMOC"
      }
      width="max-w-[980px]"
      footer={
        <>
          <button className={secondary} disabled={busy || photoProcessing} onClick={step === 0 ? onClose : () => setStep((value) => value - 1)}>
            <ChevronLeft className="h-4 w-4" /> {step === 0 ? "Cancelar" : "Voltar"}
          </button>
          {step < steps.length - 1 ? (
            <button className={primary} disabled={busy || photoProcessing} onClick={() => setStep((value) => value + 1)}>
              Continuar <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button className={primary} disabled={busy || photoProcessing || !scheduledFor} onClick={() => void submit()}>
              <Check className="h-4 w-4" />
              {busy
                ? "Gerando documento..."
                : generatedRequest
                  ? "Gerar PDF novamente"
                  : `Executar ${String(request?.equipmentExecutionNumber ?? 0).padStart(3, "0")} do PMOC`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {steps.map((label, index) => (
            <li
              key={label}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                index === step
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
              }`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">{error}</div>}

        {step === 0 && equipment && (
          <section className="space-y-4">
            <SectionTitle icon={Wrench} title="Identificação da execução" description="Dados oficiais do cliente e do equipamento selecionado." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Readonly label="Cliente" value={plan.customer?.tradeName ?? plan.customer?.name ?? "—"} />
              <Readonly label="Local do atendimento" value={addressLabel(plan, equipment)} />
              <Readonly label="Equipamento" value={equipment.name} />
              <Readonly label="Marca" value={equipment.manufacturer ?? "Não informada"} />
              <Readonly label="Modelo" value={equipment.model ?? "Não informado"} />
              <Readonly label="Setor" value={equipment.sector ?? "Não informado"} />
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5">
            <SectionTitle icon={FileText} title="Escopo da execução" description="Configuração herdada do plano PMOC para este equipamento." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Readonly
                label="Tipos de serviço"
                value={(plan.serviceTypes.length ? plan.serviceTypes : [plan.defaultOperationType]).map(operationTypeLabel).join(" · ")}
              />
              <Readonly label="Documento solicitado" value="PMOC" />
              <Readonly label="Técnico responsável" value={technician?.name ?? "Não configurado"} />
              <label className="grid gap-2 text-sm font-medium">
                Data e hora da execução
                <input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
              </label>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Auxiliar Técnico <span className="font-normal text-[var(--color-muted-foreground)]">(opcional)</span></p>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableAuxiliaries.map((user) => (
                  <label key={user.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={auxiliaryIds.includes(user.id)}
                      onChange={(event) =>
                        setAuxiliaryIds((current) =>
                          event.target.checked
                            ? [...current, user.id]
                            : current.filter((id) => id !== user.id),
                        )
                      }
                    />
                    <span><strong>{user.name}</strong><span className="block text-xs text-[var(--color-muted-foreground)]">{user.jobTitle ?? user.role}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Unidades e procedimentos definidos no PMOC</p>
              {!checklistGroups.length ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-foreground)]">Este PMOC não enviará checklist para a execução.</p>
              ) : checklistGroups.map(([group, items]) => (
                <div key={group} className="rounded-lg border border-[var(--color-border)] p-3">
                  <strong className="text-sm">{group}</strong>
                  <ul className="mt-2 grid gap-1 text-sm text-[var(--color-muted-foreground)]">
                    {items.map((item) => <li key={item.technicalCatalogId}>✓ {item.technicalCatalog.title}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <SectionTitle icon={Camera} title="Evidências" description="Fotografe agora ou selecione imagens já existentes no dispositivo." />
            <PhotoInput photos={photos} onChange={setPhotos} onProcessingChange={setPhotoProcessing} max={MAX_PMOC_PHOTOS} />
            <p className="text-sm text-[var(--color-muted-foreground)]">As evidências são opcionais e pertencem somente a esta execução e a este equipamento. A ordem escolhida será preservada no Preview e no PDF.</p>
          </section>
        )}

        {step === 3 && equipment && (
          <section className="space-y-5">
            <SectionTitle icon={Check} title="Confirmação" description="Revise os textos e confirme a execução documental deste equipamento." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Readonly label="Execução" value={String(request?.equipmentExecutionNumber ?? 0).padStart(3, "0")} />
              <Readonly label="Equipamento" value={equipment.name} />
              <Readonly label="Técnico responsável" value={technician?.name ?? "Não configurado"} />
              <Readonly label="Evidências" value={`${photos.length} de ${MAX_PMOC_PHOTOS}`} />
            </div>
            <label className="grid gap-2 text-sm font-medium">Solicitação / objetivo<textarea rows={3} value={reportedIssue} onChange={(event) => setReportedIssue(event.target.value)} /></label>
            <label className="grid gap-2 text-sm font-medium">Descrição dos serviços<textarea rows={4} value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} /></label>
            <label className="grid gap-2 text-sm font-medium">Observações<textarea rows={3} value={observations} onChange={(event) => setObservations(event.target.value)} /></label>
            <div className="rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-4 text-sm">
              Ao confirmar, o Orbit criará e concluirá a Ordem de Serviço desta execução e solicitará o Preview e o PDF pelo Document Engine oficial.
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}

function SectionTitle({ icon: Icon, title, description }: { icon: typeof Wrench; title: string; description: string }) {
  return <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><Icon className="h-4 w-4" /></span><div><h2 className="font-semibold">{title}</h2><p className="text-sm text-[var(--color-muted-foreground)]">{description}</p></div></div>;
}

function Readonly({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/35 px-3 py-2"><span className="block text-xs text-[var(--color-muted-foreground)]">{label}</span><strong className="mt-1 block text-sm">{value}</strong></div>;
}

function addressLabel(plan: PmocPlan, equipment: CoveredEquipment): string {
  if (equipment.address) {
    return [equipment.address.name, equipment.address.city].filter(Boolean).join(", ");
  }
  if (plan.defaultAddress) {
    return [
      plan.defaultAddress.name,
      plan.defaultAddress.street,
      plan.defaultAddress.number,
      plan.defaultAddress.city,
    ].filter(Boolean).join(", ");
  }
  return "Endereço padrão do cliente";
}

function operationTypeLabel(value: string): string {
  return ({
    PREVENTIVA: "Manutenção preventiva",
    CORRETIVA: "Manutenção corretiva",
    INSTALACAO: "Instalação",
    PROJETO: "Projeto / inspeção técnica",
  } as Record<string, string>)[value] ?? value;
}

function toLocalDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler uma das evidências."));
    reader.readAsDataURL(file);
  });
}

function apiMessage(cause: unknown): string {
  return cause instanceof ApiClientError
    ? cause.message
    : cause instanceof Error
      ? cause.message
      : "Não foi possível concluir a execução.";
}

const primary = "inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50";
const secondary = "inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm font-medium disabled:opacity-50";
