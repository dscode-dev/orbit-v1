"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardList, FileText, Loader2, ShieldCheck, X } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { MultiSelect } from "@erp/ui/multi-select";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { StatusChip } from "@erp/ui/status-chip";
import { TechnicalCatalogSelector } from "@erp/ui/technical-catalog/technical-catalog-selector";
import {
  ApiClientError,
  customersApi,
  documentsApi,
  equipmentsApi,
  operationApi,
  pmocApi,
  technicalCatalogsApi,
  useQuery,
  type CreateOperationPayload,
  type DocumentCatalogItem,
  type DocumentKind,
  type OperationDetail,
  type OperationType,
  type PmocExecutionRequest,
  type PmocPlan,
} from "@erp/api";
import { DOCUMENT_KIND_LABEL } from "@erp/types";
import { useDebounce, useLocalDraft } from "@erp/utils";
import {
  AuxiliaryOperatorSelect,
  CustomerAddressSelect,
  CustomerSelect,
  DateTimePicker,
  Field,
  ServiceTypeSelect,
  UserSelect,
  inputCls,
} from "./entity-select";

type Mode = "operation" | "schedule" | "service" | "work-order";
type Step = 0 | 1 | 2 | 3 | 4;
// Snapshot serializável do formulário para o rascunho local (OS avulsa).
type OperationDraftSnapshot = {
  step: Step;
  customerId: string;
  addressId: string;
  equipmentId: string;
  equipmentIds: string[];
  operatorId: string;
  type: OperationType;
  documentType: DocumentKind;
  date: string;
  time: string;
  checklist: string[];
  observations: string;
  reportedIssue: string;
  serviceDescription: string;
  serviceValue: string;
  maintenanceReminderIntervalMonths: number;
};
type PmocOperationDraft = {
  plan: PmocPlan;
  request: PmocExecutionRequest;
  prefill: CreateOperationPayload;
};

const STEPS = ["Cliente", "Escopo", "Execução", "Checklist", "Confirmar"];

const ATTENDANCE_DOCUMENT_TYPES: DocumentKind[] = [
  "WORK_ORDER",
  "TECHNICAL_REPORT",
  "TECHNICAL_OPINION",
  "BUDGET",
];

const REMINDER_INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 12, 18, 24] as const;

const MODE_COPY: Record<Mode, { eyebrow: string; title: string; description: string; success: string }> = {
  operation: {
    eyebrow: "Operação",
    title: "Nova operação",
    description: "Cadastre um novo atendimento operacional. A Ordem de Serviço será preparada automaticamente.",
    success: "Operação criada com sucesso.",
  },
  schedule: {
    eyebrow: "Agenda",
    title: "Novo agendamento",
    description: "Programe um atendimento e defina o operador responsável.",
    success: "Agendamento registrado com sucesso.",
  },
  service: {
    eyebrow: "Serviços",
    title: "Novo serviço",
    description: "Cadastre o serviço com cliente, escopo e responsável.",
    success: "Serviço criado com sucesso.",
  },
  "work-order": {
    eyebrow: "Ordem de Serviço",
    title: "Nova OS",
    description: "Preencha os dados necessários para criar e gerenciar a Ordem de Serviço.",
    success: "Ordem de Serviço preparada com sucesso.",
  },
};

export function OperationCreationDrawer({
  open,
  mode = "operation",
  onClose,
  onCreated,
  initialValues,
  submitOperation,
  submitLabel,
  contextNotice,
  lockCustomer = false,
  intent = "create",
  responsibleLabel,
}: {
  open: boolean;
  mode?: Mode;
  onClose: () => void;
  onCreated?: (operation: OperationDetail) => void;
  initialValues?: Partial<CreateOperationPayload>;
  submitOperation?: (payload: CreateOperationPayload) => Promise<OperationDetail>;
  submitLabel?: string;
  contextNotice?: string;
  lockCustomer?: boolean;
  intent?: "create" | "edit" | "copy";
  responsibleLabel?: string;
}) {
  const baseCopy = MODE_COPY[mode];
  const copy = intent === "edit"
    ? { ...baseCopy, eyebrow: "Operação", title: "Editar operação", description: "Atualize os dados da operação antes da conclusão.", success: "Operação atualizada com sucesso." }
    : intent === "copy"
      ? { ...baseCopy, eyebrow: "Operação", title: "Copiar operação", description: "Revise os dados copiados antes de criar o novo atendimento.", success: "Cópia criada com sucesso." }
      : baseCopy;
  const [step, setStep] = useState<Step>(0);
  const [customerId, setCustomerId] = useState("");
  const [addressId, setAddressId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [auxiliaryOperatorIds, setAuxiliaryOperatorIds] = useState<string[]>([]);
  const [type, setType] = useState<OperationType>("PREVENTIVA");
  const [documentType, setDocumentType] = useState<DocumentKind>("WORK_ORDER");
  const [status, setStatus] = useState<CreateOperationPayload["status"]>("DRAFT");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [observations, setObservations] = useState("");
  const [reportedIssue, setReportedIssue] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceValue, setServiceValue] = useState("");
  const [maintenanceReminderIntervalMonths, setMaintenanceReminderIntervalMonths] = useState(6);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<OperationDetail | null>(null);
  // Origem da operação: avulsa (manual), a partir de um PMOC ou de um RVT.
  const [source, setSource] = useState<"manual" | "pmoc" | "rvt">("manual");
  const [pmocDraft, setPmocDraft] = useState<PmocOperationDraft | null>(null);
  const [rvtPrefill, setRvtPrefill] = useState<Partial<CreateOperationPayload> | null>(null);
  const activeInitialValues = pmocDraft?.prefill ?? rvtPrefill ?? initialValues;
  const customer = useQuery(
    (signal) =>
      customerId ? customersApi.getCustomer(customerId, { signal }) : Promise.resolve(null),
    [customerId],
  );
  const equipments = useQuery(
    (signal) => customerId
      ? equipmentsApi.listEquipments({ customerId, limit: 100, signal })
      : Promise.resolve(null),
    [customerId],
  );

  // Rascunho local: só na criação de OS avulsa do zero (mode operation, sem prefill).
  const draftEnabled = intent === "create" && mode === "operation" && !initialValues;
  const draft = useLocalDraft<OperationDraftSnapshot>("operation-avulsa", draftEnabled);
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null);

  // Memoizado para manter a referência estável enquanto os campos não mudam
  // (evita reiniciar o debounce do autosave a cada render).
  const snapshot = useMemo<OperationDraftSnapshot>(
    () => ({
      step,
      customerId,
      addressId,
      equipmentId,
      equipmentIds,
      operatorId,
      type,
      documentType,
      date,
      time,
      checklist,
      observations,
      reportedIssue,
      serviceDescription,
      serviceValue,
      maintenanceReminderIntervalMonths,
    }),
    [
      step,
      customerId,
      addressId,
      equipmentId,
      equipmentIds,
      operatorId,
      type,
      documentType,
      date,
      time,
      checklist,
      observations,
      reportedIssue,
      serviceDescription,
      serviceValue,
      maintenanceReminderIntervalMonths,
    ],
  );
  const draftDirty =
    Boolean(customerId || observations.trim() || reportedIssue.trim() || serviceDescription.trim() || serviceValue.trim()) ||
    equipmentIds.length > 0 ||
    checklist.length > 0;

  function applySnapshot(value: OperationDraftSnapshot) {
    setStep(value.step);
    setCustomerId(value.customerId);
    setAddressId(value.addressId);
    setEquipmentId(value.equipmentId);
    setEquipmentIds(value.equipmentIds);
    setOperatorId(value.operatorId);
    setAuxiliaryOperatorIds(activeInitialValues?.auxiliaryOperatorIds ?? []);
    setType(value.type);
    setDocumentType(value.documentType);
    setDate(value.date);
    setTime(value.time);
    setChecklist(value.checklist);
    setObservations(value.observations);
    setReportedIssue(value.reportedIssue);
    setServiceDescription(value.serviceDescription);
    setServiceValue(value.serviceValue ?? "");
    setMaintenanceReminderIntervalMonths(value.maintenanceReminderIntervalMonths ?? 6);
  }

  useEffect(() => {
    if (!open) {
      setPmocDraft(null);
      setRvtPrefill(null);
      setSource("manual");
      setRecoveredAt(null);
      return;
    }
    setStep(0);
    setCustomerId(activeInitialValues?.customerId ?? "");
    setAddressId(activeInitialValues?.addressId ?? "");
    setEquipmentId(activeInitialValues?.equipmentId ?? activeInitialValues?.inspectedEquipments?.[0]?.equipmentId ?? "");
    setEquipmentIds(
      activeInitialValues?.inspectedEquipments?.map((item) => item.equipmentId) ??
        (activeInitialValues?.equipmentId ? [activeInitialValues.equipmentId] : []),
    );
    setOperatorId(activeInitialValues?.operatorId ?? "");
    setAuxiliaryOperatorIds([]);
    setType(activeInitialValues?.type ?? "PREVENTIVA");
    setDocumentType(activeInitialValues?.documentType ?? "WORK_ORDER");
    setStatus(activeInitialValues?.status ?? "DRAFT");
    const schedule = activeInitialValues?.scheduledFor ? localDateTime(activeInitialValues.scheduledFor) : null;
    setDate(schedule?.date ?? "");
    setTime(schedule?.time ?? "");
    setChecklist(activeInitialValues?.checklist?.map((item) => item.label) ?? []);
    setObservations(activeInitialValues?.observations ?? "");
    setReportedIssue(activeInitialValues?.reportedIssue ?? "");
    setServiceDescription(activeInitialValues?.serviceDescription ?? "");
    setServiceValue(
      activeInitialValues?.serviceValue !== undefined
        ? String(activeInitialValues.serviceValue)
        : "",
    );
    setMaintenanceReminderIntervalMonths(activeInitialValues?.maintenanceReminderIntervalMonths ?? 6);
    setSaving(false);
    setError(null);
    setCreated(null);
  }, [activeInitialValues, open, pmocDraft]);

  // Restaura o rascunho local ao abrir (roda após o reset acima, sobrescrevendo-o).
  useEffect(() => {
    if (!open || !draftEnabled) return;
    const stored = draft.read();
    if (stored?.value) {
      applySnapshot(stored.value);
      setRecoveredAt(stored.savedAt);
      draft.markSavedAt(stored.savedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Autosave (debounced) enquanto a OS avulsa tem conteúdo e não foi criada.
  const debouncedSnapshot = useDebounce(snapshot, 800);
  useEffect(() => {
    if (!open || !draftEnabled || source !== "manual" || created) return;
    if (!draftDirty) return;
    draft.save(debouncedSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSnapshot, open, draftEnabled, source, created]);

  const scheduledFor = useMemo(() => {
    if (!date || !time) return null;
    return new Date(`${date}T${time}:00`).toISOString();
  }, [date, time]);
  const documentTypeLocked = activeInitialValues?.documentType === "PMOC";
  const isPmocOperation = Boolean(pmocDraft || documentTypeLocked);
  const reminderEligible =
    (type === "PREVENTIVA" || type === "INSTALACAO") && documentType !== "PMOC";
  // Origem PMOC disponível ao criar uma operação/agendamento (não em contexto já travado em PMOC).
  const canChooseSource = intent === "create" && !documentTypeLocked && !initialValues && (mode === "operation" || mode === "schedule");

  const canNext =
    step === 0 ? Boolean(customerId)
    : step === 1 ? true
    : step === 2 ? Boolean(type) && (mode === "schedule" ? Boolean(scheduledFor) : true)
    : true; // checklist é opcional (depende do que houver em Catálogos Técnicos)

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload: CreateOperationPayload = {
        ...activeInitialValues,
        customerId,
        addressId: addressId || null,
        equipmentId: equipmentId || null,
        inspectedEquipments: equipmentIds.map((id) => {
          const existing = activeInitialValues?.inspectedEquipments?.find((item) => item.equipmentId === id);
          const equipment = equipments.data?.items.find((item) => item.id === id);
          return {
            equipmentId: id,
            sector: existing?.sector ?? equipment?.name ?? "Equipamento selecionado",
            systemType: existing?.systemType ?? null,
            currentSituation: existing?.currentSituation ?? null,
            manufacturer: existing?.manufacturer ?? equipment?.manufacturer ?? null,
            model: existing?.model ?? equipment?.model ?? null,
            capacity: existing?.capacity ?? equipment?.capacity ?? null,
          };
        }),
        type,
        documentType,
        // Nasce como rascunho; a atribuição ao operador leva a operação para
        // "Pendente" no backend, e só o início da execução muda para
        // "Em andamento".
        status: status ?? "DRAFT",
        scheduledFor,
        operatorId: operatorId || null,
        auxiliaryOperatorIds: auxiliaryOperatorIds.filter((id) => id && id !== operatorId),
        checklist: checklist.map((label) => {
          const existing = activeInitialValues?.checklist?.find((item) => item.label === label);
          return {
            label,
            done: intent === "copy" ? false : (existing?.done ?? false),
            ...(intent === "copy" || !existing?.note ? {} : { note: existing.note }),
          };
        }),
        observations: observations || null,
        reportedIssue: reportedIssue || null,
        serviceDescription: serviceDescription || null,
        ...(serviceValue.trim() ? { serviceValue: Number(serviceValue) } : {}),
        ...(reminderEligible ? { maintenanceReminderIntervalMonths } : {}),
      };
      let operation: OperationDetail;
      if (pmocDraft) {
        const generate = async (allowEarly = false) => {
          const generated = await pmocApi.generateWorkOrder(pmocDraft.request.id, payload, {
            allowEarly,
          });
          const operationId = generated.operationId ?? generated.generatedOperationId;
          if (!operationId) throw new Error("A Ordem de Serviço foi gerada, mas não foi localizada.");
          return operationApi.getOperation(operationId);
        };
        try {
          operation = await generate();
        } catch (cause) {
          if (
            cause instanceof ApiClientError &&
            cause.code === "PMOC_EXECUTION_TOO_EARLY" &&
            window.confirm(`${cause.message}\n\nDeseja confirmar o adiantamento desta execução?`)
          ) {
            operation = await generate(true);
          } else {
            throw cause;
          }
        }
      } else {
        operation = submitOperation
          ? await submitOperation(payload)
          : await operationApi.createOperation(payload);
      }
      setCreated(operation);
      // A operação foi criada no backend — o rascunho local não é mais necessário.
      draft.clear();
      setRecoveredAt(null);
      onCreated?.(operation);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível criar a operação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={copy.eyebrow}
      title={copy.title}
      width="max-w-2xl"
      footer={
        created ? (
          <button onClick={onClose} className={primaryBtn}>Concluir</button>
        ) : source === "pmoc" && !pmocDraft ? (
          <button onClick={onClose} className={secondaryBtn}>Fechar</button>
        ) : (
          <>
            <button onClick={step === 0 ? onClose : () => setStep((s) => Math.max(0, s - 1) as Step)} className={secondaryBtn}>
              {step === 0 ? "Cancelar" : <><ChevronLeft className="h-4 w-4" /> Voltar</>}
            </button>
            {draftEnabled && source === "manual" && (
              <button
                type="button"
                onClick={() => {
                  draft.save(snapshot);
                  onClose();
                }}
                className={`${secondaryBtn} mr-auto`}
                title="Salva o que já foi preenchido para continuar depois neste dispositivo."
              >
                Salvar rascunho
                {draft.savedAt && (
                  <span className="text-caption">
                    · {new Date(draft.savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </button>
            )}
            {step < 4 ? (
              <button onClick={() => setStep((s) => Math.min(4, s + 1) as Step)} disabled={!canNext} className={primaryBtn}>
                Avançar <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={submit} disabled={saving || !canNext} className={primaryBtn}>
                {saving ? (intent === "edit" ? "Salvando…" : "Criando…") : (pmocDraft ? "Criar Ordem de Serviço" : (submitLabel ?? (intent === "edit" ? "Salvar alterações" : intent === "copy" ? "Criar cópia" : "Criar")))}
              </button>
            )}
          </>
        )
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--color-muted-foreground)]">{copy.description}</p>
        {recoveredAt && !created && source === "manual" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
            <span>
              Rascunho recuperado — salvo em{" "}
              {new Date(recoveredAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  applySnapshot({
                    step: 0,
                    customerId: "",
                    addressId: "",
                    equipmentId: "",
                    equipmentIds: [],
                    operatorId: "",
                    type: "PREVENTIVA",
                    documentType: "WORK_ORDER",
                    date: "",
                    time: "",
                    checklist: [],
                    observations: "",
                    reportedIssue: "",
                    serviceDescription: "",
                    serviceValue: "",
                    maintenanceReminderIntervalMonths: 6,
                  });
                  draft.clear();
                  setRecoveredAt(null);
                }}
                className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-xs"
              >
                Descartar rascunho
              </button>
              <button
                type="button"
                onClick={() => setRecoveredAt(null)}
                className="rounded-[var(--radius-md)] p-1 hover:bg-black/5"
                aria-label="Ocultar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {!created && canChooseSource && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SourceCard active={source === "pmoc"} onClick={() => { setRvtPrefill(null); setSource("pmoc"); }} icon={ShieldCheck} title="A partir de um PMOC" description="Revise os dados do plano antes de criar a OS." />
            <SourceCard active={source === "rvt"} onClick={() => { setPmocDraft(null); setSource("rvt"); }} icon={FileText} title="A partir de um RVT" description="Reaproveite os dados de um Relatório de Visita Técnica." />
            <SourceCard
              active={source === "manual"}
              onClick={() => {
                setPmocDraft(null);
                setRvtPrefill(null);
                setSource("manual");
              }}
              icon={ClipboardList}
              title="Operação avulsa"
              description="Cadastre um atendimento do zero."
            />
          </div>
        )}
        {contextNotice && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/5 px-3 py-2 text-sm">
            {contextNotice}
          </div>
        )}
        {operatorId && source === "manual" && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/10 px-3 py-2 text-sm text-[var(--color-info)]">
            O atendimento será encaminhado ao operador selecionado e todo o histórico será preservado.
          </div>
        )}
        {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
        {created ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-5 text-[var(--color-success)]">
            <div className="flex items-center gap-2 font-semibold"><Check className="h-5 w-5" /> {copy.success}</div>
            <p className="mt-2 text-sm">Atendimento #{String(created.number).padStart(6, "0")}. A Ordem de Serviço fica disponível na área de documentos.</p>
          </div>
        ) : source === "pmoc" && !pmocDraft ? (
          <PmocOperationSource
            onReview={(plan, request, prefill) => {
              setPmocDraft({ plan, request, prefill });
              setError(null);
            }}
          />
        ) : source === "rvt" && !rvtPrefill ? (
          <RvtOperationSource
            customerId={initialValues?.customerId}
            onReview={(prefill) => {
              setRvtPrefill(prefill);
              setError(null);
            }}
          />
        ) : (
          <>
            {pmocDraft && (
              <PmocSourceSummary
                draft={pmocDraft}
                customerName={customer.data?.tradeName ?? customer.data?.name}
                equipmentNames={(equipments.data?.items ?? [])
                  .filter((item) => equipmentIds.includes(item.id))
                  .map((item) => item.name)}
                onChange={() => setPmocDraft(null)}
              />
            )}
            {rvtPrefill && (
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/5 px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-[var(--color-primary)]" /> Dados pré-preenchidos a partir de um RVT.</span>
                <button type="button" onClick={() => { setRvtPrefill(null); setSource("rvt"); }} className="text-xs font-medium text-[var(--color-primary)] hover:underline">Trocar</button>
              </div>
            )}
            <Stepper step={step} />
            {step === 0 && (
              <div className="space-y-3">
                {isPmocOperation ? (
                  <ReadonlyPmocCustomer
                    customerName={customer.data?.tradeName ?? customer.data?.name}
                    address={customer.data?.addresses.find((item) => item.id === addressId)}
                    description="Cliente e local são herdados do PMOC para preservar a cobertura contratada."
                  />
                ) : lockCustomer ? (
                  <>
                    <ReadonlyField
                      label="Cliente"
                      value={customer.data?.tradeName ?? customer.data?.name ?? "Carregando…"}
                    />
                    <CustomerAddressSelect
                      customerId={customerId}
                      value={addressId}
                      onChange={setAddressId}
                    />
                    <p className="text-caption">
                      Cliente definido pela página atual. Selecione apenas o local do atendimento.
                    </p>
                  </>
                ) : (
                  <>
                    <CustomerSelect value={customerId} onChange={(id) => { setCustomerId(id); setAddressId(""); setEquipmentId(""); setEquipmentIds([]); }} />
                    <CustomerAddressSelect customerId={customerId} value={addressId} onChange={setAddressId} />
                  </>
                )}
              </div>
            )}
            {step === 1 && (
              <div className="space-y-3">
                {isPmocOperation ? (
                  <ReadonlyPmocEquipments
                    equipmentIds={equipmentIds}
                    equipments={equipments.data?.items ?? []}
                  />
                ) : (
                  <>
                    <MultiSelect
                      label="Equipamentos da Ordem de Serviço"
                      value={equipmentIds}
                      onChange={(ids) => { setEquipmentIds(ids); setEquipmentId(ids[0] ?? ""); }}
                      options={(equipments.data?.items ?? []).map((equipment) => ({
                        value: equipment.id,
                        label:
                          [equipment.manufacturer, equipment.model, equipment.capacity]
                            .filter(Boolean)
                            .join(" - ") || equipment.name,
                        description: equipment.sector || "Setor não informado",
                      }))}
                      placeholder={customerId ? "Selecione um ou mais equipamentos" : "Selecione primeiro o cliente"}
                      emptyMessage="Nenhum equipamento ativo disponível para este cliente."
                    />
                    <p className="text-caption">Todos os equipamentos selecionados serão preservados na OS, no Operator e no documento. O primeiro permanece como equipamento principal para compatibilidade.</p>
                  </>
                )}
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <ServiceTypeSelect value={type} onChange={setType} />
                <Field label="Lembrete da próxima manutenção">
                  <select
                    value={maintenanceReminderIntervalMonths}
                    onChange={(event) => setMaintenanceReminderIntervalMonths(Number(event.target.value))}
                    className={inputCls}
                    disabled={!reminderEligible}
                  >
                    {REMINDER_INTERVAL_OPTIONS.map((months) => (
                      <option key={months} value={months}>
                        {months === 1 ? "1 mês" : `${months} meses`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-caption">
                    {reminderEligible
                      ? "Opcional. A próxima manutenção será lembrada após o período escolhido; o padrão é 6 meses."
                      : "Disponível somente para operações de Preventiva ou Instalação."}
                  </p>
                </Field>
                <Field label="Valor do serviço">
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--color-muted-foreground)]">
                      R$
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="999999999.99"
                      step="0.01"
                      inputMode="decimal"
                      value={serviceValue}
                      onChange={(event) => setServiceValue(event.target.value)}
                      className={`${inputCls} pl-10`}
                      placeholder="0,00"
                    />
                  </div>
                  <p className="mt-1 text-caption">
                    Informação operacional visível ao técnico responsável. Não será exibida no Preview ou PDF.
                  </p>
                </Field>
                <Field label="Documento solicitado">
                  <select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentKind)} className={inputCls} disabled={documentTypeLocked || intent === "edit"}>
                    {(documentTypeLocked ? (["PMOC"] as DocumentKind[]) : ATTENDANCE_DOCUMENT_TYPES).map((item) => (
                      <option key={item} value={item}>{DOCUMENT_KIND_LABEL[item]}</option>
                    ))}
                  </select>
                </Field>
                <p className="text-caption">
                  {isPmocOperation
                    ? "A OS permanecerá vinculada a esta execução do PMOC. Selecione o técnico que receberá o atendimento no Operator."
                    : "PMOC continua sendo atribuído pelo plano oficial. Os demais atendimentos usarão o documento selecionado."}
                </p>
                {intent === "edit" ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
                    <ReadonlyField label="Responsável pelo atendimento" value={responsibleLabel || "Definido na atribuição atual"} />
                    <p className="mt-2 text-caption">Para trocar o responsável ou os auxiliares, utilize a seção de atribuição nos detalhes da operação.</p>
                  </div>
                ) : (
                  <>
                    <UserSelect value={operatorId} onChange={setOperatorId} />
                    <AuxiliaryOperatorSelect value={auxiliaryOperatorIds} onChange={setAuxiliaryOperatorIds} excludeId={operatorId || undefined} />
                  </>
                )}
                <DateTimePicker date={date} time={time} onDate={setDate} onTime={setTime} />
                {intent === "edit" && (
                  <Field label="Status da operação">
                    <select value={status} onChange={(event) => setStatus(event.target.value as CreateOperationPayload["status"])} className={inputCls}>
                      <option value="DRAFT">Rascunho</option>
                      <option value="PENDING">Pendente</option>
                      <option value="IN_PROGRESS">Em andamento</option>
                      <option value="REVIEW">Em revisão</option>
                      <option value="COMPLETED">Concluída</option>
                    </select>
                  </Field>
                )}
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <p className="text-caption">
                  {isPmocOperation
                    ? "Revise os procedimentos herdados do PMOC. Cada item selecionado será entregue ao técnico para execução em todos os equipamentos cobertos."
                    : <>Selecione os checks que o operador deverá seguir. Os itens vêm de <strong>Catálogos Técnicos</strong> para o documento <strong>{DOCUMENT_KIND_LABEL[documentType]}</strong>; você também pode adicionar itens personalizados.</>}
                </p>
                <TechnicalCatalogSelector
                  type="CHECKLIST"
                  workflow={technicalCatalogsApi.documentWorkflow(documentType)}
                  label="Item de checklist"
                  values={checklist}
                  onChange={setChecklist}
                />
              </div>
            )}
            {step === 4 && (
              <div className="space-y-3">
                <Field label="Defeito ou solicitação"><textarea value={reportedIssue} onChange={(event) => setReportedIssue(event.target.value)} className={`${inputCls} min-h-24 py-2`} autoFocus /></Field>
                <Field label="Serviços previstos ou executados"><textarea value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} className={`${inputCls} min-h-28 py-2`} placeholder="Um item por linha" /></Field>
                <Field label="Observações"><textarea value={observations} onChange={(event) => setObservations(event.target.value)} className={`${inputCls} min-h-24 py-2`} /></Field>
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm">
                  <div><strong>Cliente:</strong> {customerId ? "selecionado" : "—"}</div>
                  <div><strong>Tipo:</strong> {type}</div>
                  <div><strong>Valor do serviço:</strong> {serviceValue.trim() ? Number(serviceValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Não informado"}</div>
                  <div><strong>Documento:</strong> {DOCUMENT_KIND_LABEL[documentType]}</div>
                  <div><strong>Agenda:</strong> {scheduledFor ? new Date(scheduledFor).toLocaleString("pt-BR") : "não definida"}</div>
                  <div><strong>Checklist:</strong> {checklist.length} item(ns)</div>
                  <div><strong>Equipamentos:</strong> {equipmentIds.length}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, index) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${index <= step ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"}`}>{index + 1}</span>
          <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">{label}</span>
        </div>
      ))}
    </div>
  );
}

const primaryBtn = "inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50";
const secondaryBtn = "inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]";

function localDateTime(value: string): { date: string; time: string } {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/* ---------- Origem da operação ---------- */

function PmocSourceSummary({
  draft,
  customerName,
  equipmentNames,
  onChange,
}: {
  draft: PmocOperationDraft;
  customerName?: string;
  equipmentNames: string[];
  onChange: () => void;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Origem PMOC</p>
          <p className="mt-1 font-semibold">
            PMOC-{String(draft.plan.number).padStart(6, "0")} · Execução {String(draft.request.executionNumber).padStart(3, "0")}
          </p>
        </div>
        <button type="button" onClick={onChange} className={secondaryBtn}>Trocar execução</button>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-muted-foreground)]">Cliente</dt><dd>{customerName ?? "Carregando…"}</dd></div>
        <div><dt className="text-[var(--color-muted-foreground)]">Data prevista</dt><dd>{new Date(draft.request.scheduledFor).toLocaleString("pt-BR")}</dd></div>
        <div><dt className="text-[var(--color-muted-foreground)]">Equipamentos cobertos</dt><dd>{equipmentNames.length || draft.prefill.inspectedEquipments?.length || 0}</dd></div>
        <div><dt className="text-[var(--color-muted-foreground)]">Procedimentos enviados</dt><dd>{draft.prefill.checklist?.length ?? 0}</dd></div>
      </dl>
    </div>
  );
}

function ReadonlyPmocCustomer({
  customerName,
  address,
  description,
}: {
  customerName?: string;
  address?: {
    name: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
  };
  description: string;
}) {
  const addressText = address
    ? [address.name, [address.street, address.number].filter(Boolean).join(", "), address.district, address.city, address.state]
        .filter(Boolean)
        .join(" · ")
    : "Endereço principal definido no PMOC";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ReadonlyField label="Cliente" value={customerName ?? "Carregando…"} />
      <ReadonlyField label="Local do atendimento" value={addressText} />
      <p className="text-caption sm:col-span-2">{description}</p>
    </div>
  );
}

function ReadonlyPmocEquipments({
  equipmentIds,
  equipments,
}: {
  equipmentIds: string[];
  equipments: Array<{
    id: string;
    name: string;
    tag: string | null;
    type: string;
    sector: string | null;
    manufacturer: string | null;
    model: string | null;
    capacity: string | null;
  }>;
}) {
  const selected = equipmentIds.map((id) => equipments.find((equipment) => equipment.id === id));
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Equipamentos cobertos pelo PMOC</p>
      <div className="space-y-2">
        {selected.map((equipment, index) => (
          <div key={equipment?.id ?? equipmentIds[index]} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/35 px-3 py-2">
            <p className="text-sm font-medium">
              {equipment
                ? [equipment.manufacturer, equipment.model, equipment.capacity]
                    .filter(Boolean)
                    .join(" - ") || equipment.name
                : `Equipamento ${index + 1}`}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {equipment?.sector || "Setor não informado"}
            </p>
          </div>
        ))}
      </div>
      <p className="text-caption">A cobertura pertence ao PMOC e não pode ser removida nesta OS. Os equipamentos seguirão para o Operator e para o documento final.</p>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{label}</p>
      <div className="min-h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/45 px-3 py-2 text-sm">{value}</div>
    </div>
  );
}

function SourceCard({ active, onClick, icon: Icon, title, description }: { active: boolean; onClick: () => void; icon: typeof ShieldCheck; title: string; description: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-[var(--radius-lg)] border p-3 text-left transition ${active ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"}`}
    >
      <span className={`inline-flex items-center gap-2 text-sm font-semibold ${active ? "text-[var(--color-primary)]" : ""}`}><Icon className="h-4 w-4" /> {title}</span>
      <span className="text-[11px] text-[var(--color-muted-foreground)]">{description}</span>
    </button>
  );
}

const EARLY_THRESHOLD_DAYS = 10;

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/**
 * Seleciona uma execução programada e carrega o prefill oficial. A OS somente é
 * gerada depois da revisão no wizard principal.
 */
/** Monta o prefill de uma nova OS a partir da operação que originou um RVT. */
function buildRvtPrefillFromOperation(op: OperationDetail): Partial<CreateOperationPayload> {
  const inspected = (op.inspectedEquipments ?? []).map((item) => ({ equipmentId: item.equipmentId, sector: item.sector }));
  return {
    customerId: op.customer?.id,
    addressId: op.address?.id ?? undefined,
    equipmentId: op.equipment?.id ?? op.inspectedEquipments?.[0]?.equipmentId,
    inspectedEquipments: inspected.length > 0 ? inspected : undefined,
    type: op.type,
    reportedIssue: op.reportedIssue ?? undefined,
    serviceDescription: op.serviceDescription ?? undefined,
    observations: op.observations ?? undefined,
    documentType: "WORK_ORDER",
  };
}

function RvtOperationSource({
  onReview,
  customerId,
}: {
  onReview: (prefill: Partial<CreateOperationPayload>) => void;
  customerId?: string;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(search, 300);
  const rvts = useQuery(
    (signal) =>
      documentsApi.listDocuments({ type: "TECHNICAL_REPORT", customerId, search: debounced || undefined, limit: 30, signal }),
    [customerId, debounced],
  );

  async function review(item: DocumentCatalogItem) {
    if (!item.originId) {
      setError("Este RVT não possui uma operação de origem para reaproveitar.");
      return;
    }
    setBusy(item.id);
    setError(null);
    try {
      const op = await operationApi.getOperation(item.originId);
      onReview(buildRvtPrefillFromOperation(op));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Não foi possível carregar os dados do RVT.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
      <Field label="Buscar RVT">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cliente, equipamento, número…" className={inputCls} />
      </Field>
      {rvts.loading && !rvts.data ? (
        <SkeletonList rows={4} />
      ) : (rvts.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={FileText} title="Nenhum RVT" description="Nenhum Relatório de Visita Técnica encontrado para reaproveitar." />
      ) : (
        <ul className="space-y-2">
          {(rvts.data?.items ?? []).map((item) => (
            <li key={item.id}>
              <button type="button" disabled={Boolean(busy)} onClick={() => void review(item)} className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left transition hover:bg-[var(--color-muted)] disabled:opacity-60">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.number}</span>
                  <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{item.customer?.name ?? "Cliente"}{item.equipment ? ` · ${item.equipment.name}` : ""} · {new Date(item.createdAt).toLocaleDateString("pt-BR")}</span>
                </span>
                {busy === item.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PmocOperationSource({
  onReview,
}: {
  onReview: (plan: PmocPlan, request: PmocExecutionRequest, prefill: CreateOperationPayload) => void;
}) {
  const [planId, setPlanId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plans = useQuery<PmocPlan[]>(
    (signal) => pmocApi.listPmoc({ active: true, limit: 100, signal }).then((r) => r.items),
    [],
  );
  const requests = useQuery<PmocExecutionRequest[]>(
    (signal) => (planId ? pmocApi.listExecutionRequests(planId, { status: "PENDING", limit: 100, signal }).then((r) => r.items) : Promise.resolve([])),
    [planId],
  );

  async function review(request: PmocExecutionRequest) {
    setBusy(request.id);
    setError(null);
    try {
      const prefill = await pmocApi.getExecutionRequestPrefill(request.id);
      const plan = (plans.data ?? []).find((item) => item.id === planId);
      if (!plan) throw new Error("O PMOC selecionado não foi localizado.");
      onReview(plan, request, prefill);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Não foi possível carregar os dados desta execução.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
      {plans.loading && !plans.data ? (
        <SkeletonList rows={3} />
      ) : (
        <Field label="Plano PMOC">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={inputCls}>
            <option value="">Selecione um plano ativo</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>PMOC-{String(plan.number).padStart(6, "0")} · {plan.customer?.tradeName ?? plan.customer?.name ?? plan.maintenancePlan?.name ?? "Plano PMOC"}</option>
            ))}
          </select>
        </Field>
      )}

      {planId && (
        <div className="space-y-1.5">
            <span className="text-sm font-medium">Execuções pendentes</span>
            {requests.loading && !requests.data ? (
              <SkeletonList rows={3} />
            ) : (requests.data ?? []).length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nenhuma execução pendente" description="As próximas execuções aparecerão conforme a programação do PMOC." />
            ) : (
              <ul className="space-y-2">
                {(requests.data ?? []).map((request) => {
                  const early = daysUntil(request.scheduledFor) > EARLY_THRESHOLD_DAYS;
                  return (
                    <li key={request.id}>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void review(request)} className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left transition hover:bg-[var(--color-muted)] disabled:opacity-60">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">Execução {String(request.executionNumber).padStart(3, "0")}</span>
                          <span className="block text-xs text-[var(--color-muted-foreground)]">Prevista para {new Date(request.scheduledFor).toLocaleDateString("pt-BR")}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {early && <StatusChip tone="warning">Adiantada</StatusChip>}
                          {busy === request.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
      )}
    </div>
  );
}
