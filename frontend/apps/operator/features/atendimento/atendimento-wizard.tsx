'use client';

/**
 * AtendimentoWizard — the full field-service flow:
 * Cliente → Escopo → Execução → Checklist → Conteúdo → Evidências →
 * Assinatura → Confirmação.
 *
 * Reads clients/equipments from the real backend and persists the complete
 * Operation → Assignment → Handoff flow through the official APIs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Building2,
  CalendarClock,
  MapPin,
  Wrench,
  ClipboardList,
  Check,
  CheckCircle2,
  Camera,
  PenLine,
  FileText,
  Send,
  ChevronRight,
  Circle,
  QrCode,
  X,
  FileSearch,
  ShieldCheck,
  FilePlus2,
  Download,
  Share2,
} from 'lucide-react';
import { WizardProgressHeader } from '@erp/ui/wizard/progress-header';
import { WizardFooter } from '@erp/ui/wizard/step-footer';
import { SearchInput } from '@erp/ui/search-input';
import { StatusChip } from '@erp/ui/status-chip';
import { StatusPill } from '@erp/ui/status-pill';
import { SkeletonList } from '@erp/ui/skeletons';
import { EmptyState } from '@erp/ui/empty-state';
import { ErrorState } from '@erp/ui/states';
import { MultiSelect } from '@erp/ui/multi-select';
import { PhotoInput, type CapturedPhoto } from '@erp/ui/photo-input';
import { SignaturePad } from '@erp/ui/documents/signature-pad';
import { TechnicalCatalogSelector } from '@erp/ui/technical-catalog/technical-catalog-selector';
import { QrScanner } from '@erp/ui/qr-scanner';
import {
  cepApi,
  customersApi,
  rvtApi,
  documentsApi,
  equipmentsApi,
  operationApi,
  pmocApi,
  serviceTypesApi,
  technicalCatalogsApi,
  useQuery,
  ApiClientError,
  type Customer,
  type CustomerAddress,
  type CustomerDetail,
  type DocumentCatalogItem,
  type EquipmentSummary,
  type EquipmentDetail,
  type TechnicalCatalog,
  type TechnicalCatalogArea,
  type DocumentKind,
  type OperationMaintenanceChecklistItem,
  type OperationMaintenanceType,
  type CreateOperationPayload,
  type PmocPlan,
  type PmocExecutionRequest,
  type WalkInCustomerResult,
  type RvtPlan,
} from '@erp/api';
import { DOCUMENT_KIND_LABEL } from '@erp/types';
import { useAuth } from '@erp/ui/auth/auth-provider';
import { PmocEquipmentExecutionWizard } from '@platform/components/pmoc-equipment-execution-wizard';
import { EQUIPMENT_STATUS_LABEL, EQUIPMENT_STATUS_PILL } from '@platform/equipment-display';
import { useDebounce } from '@erp/utils';
import { SERVICE_TYPES, serviceTypeLabel, type ServiceTypeKey } from '../../lib/service-types';
import { createOperationFromDraft, workOrderNumber } from '../../lib/atendimento';
import { OperatorSignatureChoice } from '../../components/operator-signature';
import { FieldEquipmentCollection, type NewFieldEquipmentDraft } from '../../components/field-equipment-collection';

const STEPS = [
  'Cliente',
  'Escopo',
  'Execução',
  'Checklist',
  'Conteúdo',
  'Evidências',
  'Assinatura',
  'Confirmar',
] as const;

const FIELD_DOCUMENT_TYPES: DocumentKind[] = [
  'WORK_ORDER',
  'TECHNICAL_REPORT',
];
type ChecklistItem = { catalogId: string; label: string; done: boolean; note?: string };
type EquipmentProfileDraft = {
  manufacturer: string;
  model: string;
  capacity: string;
};
type OsOrigin = 'scratch' | 'rvt' | 'pmoc';
type WalkInForm = {
  personType: 'PERSON' | 'COMPANY';
  name: string;
  document: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  contactName: string;
  contactPhone: string;
};
const EMPTY_WALK_IN: WalkInForm = {
  personType: 'COMPANY', name: '', document: '', zipCode: '', street: '', number: '',
  complement: '', district: '', city: '', state: '', contactName: '', contactPhone: '',
};
function walkInValid(w: WalkInForm, equipmentDrafts: NewFieldEquipmentDraft[]): boolean {
  // CPF/CNPJ é opcional; ao menos um equipamento tecnicamente identificado é obrigatório.
  return Boolean(
    w.name.trim() && w.street.trim() && w.number.trim() &&
    w.district.trim() && w.city.trim() && w.state.trim().length === 2 &&
    w.contactName.trim() && w.contactPhone.trim() &&
    equipmentDrafts.length > 0 && equipmentDrafts.length <= 20 &&
    equipmentDrafts.every((item) =>
      item.equipmentTypeCatalogId && item.manufacturer?.trim() && item.model?.trim() && item.capacity?.trim(),
    ),
  );
}
function walkInAddressLabel(w: WalkInForm): string {
  return [w.street, w.number, w.district, w.city].filter((part) => part.trim()).join(', ') || 'Endereço do atendimento';
}
type OsPrefill = {
  address: { id: string; label: string } | null;
  serviceType: ServiceTypeKey | null;
  reportedIssue?: string;
  serviceDescription?: string;
  observations?: string;
  equipments: EquipmentSummary[];
};
const RVT_MAINTENANCE_TYPES: Array<{ value: OperationMaintenanceType; label: string }> = [
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'SEMIANNUAL', label: 'Semestral' },
];

export function AtendimentoWizard({
  initialCustomerId,
  initialEquipmentId,
}: {
  initialCustomerId?: string;
  initialEquipmentId?: string;
} = {}) {
  const router = useRouter();
  const { session, can } = useAuth();
  const isOwner = session?.role === 'OWNER';
  const [documentType, setDocumentType] = useState<DocumentKind | null>(null);
  const [rvtMode, setRvtMode] = useState<'standalone' | 'configured' | null>(null);
  const [pmocDoc, setPmocDoc] = useState<{ documentId: string; documentNumber: string } | null>(null);
  const [step, setStep] = useState(0);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [address, setAddress] = useState<{ id: string; label: string } | null>(null);
  const [equipments, setEquipments] = useState<EquipmentSummary[]>([]);
  const [equipmentProfiles, setEquipmentProfiles] = useState<Record<string, EquipmentProfileDraft>>({});
  const [serviceType, setServiceType] = useState<ServiceTypeKey | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [maintenanceType, setMaintenanceType] = useState<OperationMaintenanceType>('SEMIANNUAL');
  const [maintenanceChecklist, setMaintenanceChecklist] = useState<OperationMaintenanceChecklistItem[]>([]);
  const [reportedIssue, setReportedIssue] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [observations, setObservations] = useState('');
  const [objectives, setObjectives] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [conclusions, setConclusions] = useState<string[]>([]);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [technicalSignatureId, setTechnicalSignatureId] = useState<string | null>(null);
  // OS a partir de RVT/PMOC: origem escolhida logo após selecionar o cliente.
  const [osOrigin, setOsOrigin] = useState<OsOrigin | null>(null);
  const [originOpen, setOriginOpen] = useState(false);
  // OS avulso: cadastro de cliente novo direto em campo (fica em Revisão).
  const [walkInMode, setWalkInMode] = useState(false);
  const [walk, setWalk] = useState<WalkInForm>(EMPTY_WALK_IN);
  const [walkInEquipments, setWalkInEquipments] = useState<NewFieldEquipmentDraft[]>([]);
  // Guarda o cadastro já criado para um retry não recriar o cliente (CNPJ/CPF único).
  const [walkInCreated, setWalkInCreated] = useState<WalkInCustomerResult | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ operationId: string; documentId: string; documentNumber: string; documentType: DocumentKind } | null>(
    null,
  );
  const [startedAt] = useState(() => new Date().toISOString());

  const walkInEquipmentTypes = useQuery(
    (signal) => walkInMode ? technicalCatalogsApi.listEquipmentTypes({ signal }) : Promise.resolve([]),
    [walkInMode],
  );

  // Prefill from QR / "Iniciar atendimento" deep links.
  useEffect(() => {
    let active = true;
    (async () => {
      if (initialEquipmentId) {
        const eq = await equipmentsApi.getEquipment(initialEquipmentId).catch(() => null);
        if (!active || !eq) return;
        setEquipments([eq]);
        if (eq.address)
          setAddress({
            id: eq.address.id,
            label: eq.address.name ?? eq.address.city ?? 'Endereço',
          });
        if (eq.customer) {
          const c = await customersApi.getCustomer(eq.customer.id).catch(() => null);
          if (active && c) {
            setCustomer(c);
            setStep(2); // pula para Execução
          }
        }
      } else if (initialCustomerId) {
        const c = await customersApi.getCustomer(initialCustomerId).catch(() => null);
        if (active && c) {
          setCustomer(c);
          setStep(0); // mantém Cliente para escolher o endereço
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [initialEquipmentId, initialCustomerId]);

  useEffect(() => {
    setEquipmentProfiles((current) => {
      const next = { ...current };
      for (const equipment of equipments) {
        next[equipment.id] ??= {
          manufacturer: equipment.manufacturer ?? '',
          model: equipment.model ?? '',
          capacity: equipment.capacity ?? '',
        };
      }
      return next;
    });
  }, [equipments]);

  const equipmentProfilesComplete = equipments.every((equipment) => {
    const profile = equipmentProfiles[equipment.id] ?? {
      manufacturer: equipment.manufacturer ?? '',
      model: equipment.model ?? '',
      capacity: equipment.capacity ?? '',
    };
    return Boolean(
      profile.manufacturer.trim() &&
      profile.model.trim() &&
      profile.capacity.trim(),
    );
  });

  function pickServiceType(key: ServiceTypeKey) {
    setServiceType(key);
  }

  // Checklist real de Catálogos Técnicos (type CHECKLIST) para o documento em
  // andamento — substitui o checklist mock por tipo de serviço.
  const checklistCatalog = useQuery(
    (signal) =>
      documentType === 'WORK_ORDER'
        ? technicalCatalogsApi.listChecklistItems(technicalCatalogsApi.documentWorkflow(documentType), { signal })
        : Promise.resolve([]),
    [documentType],
  );
  const rvtChecklistCatalog = useQuery(
    async (signal) =>
      documentType === 'TECHNICAL_REPORT'
        ? (
            await Promise.all(
              RVT_MAINTENANCE_TYPES.map((item) =>
                technicalCatalogsApi.listChecklistItems('TECHNICAL_REPORT', {
                  maintenanceType: item.value,
                  includeGeneral: false,
                  signal,
                }),
              ),
            )
          ).flat()
        : [],
    [documentType],
  );
  useEffect(() => {
    if (documentType !== 'TECHNICAL_REPORT' || rvtChecklistCatalog.loading) return;
    setMaintenanceChecklist((current) => {
      if (current.length) return current;
      return (rvtChecklistCatalog.data ?? []).map((item) => ({
        maintenanceType: item.maintenanceType ?? 'SEMIANNUAL',
        description: item.title,
        executed: false,
        result: 'NO',
        observations: item.description,
      }));
    });
  }, [documentType, rvtChecklistCatalog.data, rvtChecklistCatalog.loading]);

  const canNext = useMemo(() => {
    switch (step) {
      case 0:
        return walkInMode ? walkInValid(walk, walkInEquipments) : !!customer && (documentType !== 'TECHNICAL_REPORT' || !!address);
      case 1:
        return equipmentProfilesComplete && (documentType !== 'TECHNICAL_REPORT' || equipments.length > 0);
      case 2:
        return !!serviceType;
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      case 6:
        return !!technicalSignatureId && (documentType === 'TECHNICAL_REPORT' ? (!signature || signerName.trim().length > 0) : !!signature && signerName.trim().length > 0);
      case 7:
        return true;
      default:
        return false;
    }
  }, [step, customer, address, serviceType, signature, signerName, technicalSignatureId, walkInMode, walk, walkInEquipments, equipmentProfilesComplete, equipments.length, documentType]);

  function back() {
    if (step === 0) router.push('/operator');
    // OS avulso pula o passo de seleção: os novos equipamentos já são coletados no cadastro.
    else if (step === 2 && walkInMode) setStep(0);
    else setStep((s) => s - 1);
  }

  function applyPrefill(data: OsPrefill) {
    if (data.address) setAddress(data.address);
    if (data.serviceType) setServiceType(data.serviceType);
    if (data.reportedIssue) setReportedIssue(data.reportedIssue);
    if (data.serviceDescription) setServiceDescription(data.serviceDescription);
    if (data.observations) setObservations(data.observations);
    if (data.equipments.length) setEquipments(data.equipments);
  }

  async function next() {
    // OS: após escolher a empresa, oferece criar do zero ou a partir de RVT/PMOC.
    if (step === 0 && documentType === 'WORK_ORDER' && !walkInMode && customer && osOrigin === null) {
      setOriginOpen(true);
      return;
    }
    // OS avulso: do cadastro do cliente vai direto para o Tipo (pula Equipamento).
    if (step === 0 && walkInMode) {
      setStep(2);
      return;
    }
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    // Resumo → cria a Operation real (gera a OS em rascunho no backend).
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!documentType) return;
      // OS avulso: registra cliente novo (Revisão) + endereço + contato + equipamentos.
      let customerId = customer?.id ?? null;
      let addressId = address?.id ?? null;
      let inspectedEquipments: Array<{
        equipmentId: string;
        sector: string;
        manufacturer?: string;
        model?: string;
        capacity?: string;
      }> = equipments.map((item) => ({
        equipmentId: item.id,
        sector: item.sector ?? item.address?.name ?? address?.label ?? item.name,
        manufacturer: equipmentProfiles[item.id]?.manufacturer.trim() || undefined,
        model: equipmentProfiles[item.id]?.model.trim() || undefined,
        capacity: equipmentProfiles[item.id]?.capacity.trim() || undefined,
      }));
      let equipmentId = equipments[0]?.id ?? null;
      if (walkInMode) {
        const created =
          walkInCreated ??
          (await customersApi.createWalkInCustomer({
            type: walk.personType,
            name: walk.name.trim(),
            document: walk.document.trim() || undefined,
            address: {
              zipCode: walk.zipCode.trim() || undefined,
              street: walk.street.trim(),
              number: walk.number.trim(),
              complement: walk.complement.trim() || undefined,
              district: walk.district.trim(),
              city: walk.city.trim(),
              state: walk.state.trim().toUpperCase(),
            },
            contact: { name: walk.contactName.trim(), phone: walk.contactPhone.trim() },
            equipments: walkInEquipments.map((item) => ({
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
          }));
        setWalkInCreated(created);
        customerId = created.customerId;
        addressId = created.addressId;
        equipmentId = created.equipmentId;
        inspectedEquipments = created.equipments.map((item, index) => {
          const draft = walkInEquipments[index];
          return {
            equipmentId: item.id,
            sector: item.sector || created.addressLabel || item.name,
            manufacturer: draft?.manufacturer?.trim() || undefined,
            model: draft?.model?.trim() || undefined,
            capacity: draft?.capacity?.trim() || undefined,
          };
        });
      }
      const submission = await createOperationFromDraft({
        documentType,
        customerId,
        addressId,
        equipmentId,
        inspectedEquipments,
        serviceType,
        checklist,
        maintenanceType,
        maintenanceChecklist,
        reportedIssue,
        serviceDescription,
        observations,
        objective: objectives,
        conditions,
        recommendations,
        conclusion: conclusions,
        photos,
        signature,
        signerName,
        signerRole,
        signedAt,
        technicalSignatureId,
        startedAt,
      });
      setResult({
        operationId: submission.operation.id,
        documentId: submission.handoff.id,
        documentNumber: submission.handoff.number ?? workOrderNumber(submission.operation) ?? `OP-${submission.operation.number}`,
        documentType,
      });
    } catch (err) {
      setSubmitError(
        err instanceof ApiClientError
          ? err.message
          : 'Não foi possível registrar o atendimento. Tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Sem permissão de Relatórios, o operador não inicia atendimentos (que geram
  // relatórios) — apenas visualiza a agenda. Bloqueio de UI (o backend também exige).
  // Só restringe operadores; owner/manager (que podem usar o app) têm acesso pleno.
  if (session && session.role === 'OPERATOR' && !can('canReports')) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold">Acesso somente à agenda</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Seu perfil não tem a permissão de Relatórios. Você pode visualizar agendamentos e
            ordens, mas não iniciar atendimentos que geram relatórios (OS, Visita Técnica).
          </p>
          <button
            type="button"
            onClick={() => router.push('/operator')}
            className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 text-sm font-semibold text-[var(--color-primary-foreground)]"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <OperatorDocumentSuccessView
        documentId={result.documentId}
        documentNumber={result.documentNumber}
        documentType={result.documentType}
        onDone={() => router.push('/operator')}
        onDocuments={() => router.push('/operator/documents')}
        onNew={() => window.location.reload()}
      />
    );
  }

  // Execução PMOC concluída no mobile: compartilhar/baixar o PDF oficial.
  if (pmocDoc) {
    return (
      <OperatorDocumentSuccessView
        documentId={pmocDoc.documentId}
        documentNumber={pmocDoc.documentNumber}
        documentType="PMOC"
        onDone={() => router.push('/operator')}
        onDocuments={() => router.push('/operator/documents')}
        onNew={() => window.location.reload()}
      />
    );
  }

  if (!documentType) {
    return (
      <>
        <AttendanceTypeStep
          onSelect={setDocumentType}
          onClose={() => router.push('/operator')}
          canCreatePmoc={Boolean(isOwner)}
          onCreatePmoc={() => setDocumentType('PMOC')}
        />
      </>
    );
  }

  // OWNER inicia no mobile uma execução de um PMOC já configurado.
  if (documentType === 'PMOC') {
    return <PmocStartStep onBack={() => setDocumentType(null)} onCompleted={setPmocDoc} />;
  }

  if (documentType === 'TECHNICAL_REPORT' && rvtMode === null) {
    return <RvtStartModeStep onBack={() => setDocumentType(null)} onStandalone={() => setRvtMode('standalone')} />;
  }

  // OS: escolha da origem (do zero / a partir de RVT / a partir de PMOC).
  if (originOpen && customer && documentType === 'WORK_ORDER') {
    return (
      <OSOriginStep
        customer={customer}
        onBack={() => setOriginOpen(false)}
        onScratch={() => {
          setOsOrigin('scratch');
          setOriginOpen(false);
          setStep(1);
        }}
        onPrefill={(origin, data) => {
          applyPrefill(data);
          setOsOrigin(origin);
          setOriginOpen(false);
          setStep(1);
        }}
      />
    );
  }

  const isLast = step === STEPS.length - 1;

  // Para o resumo/confirmação: OS avulso ainda não tem cliente/equipamento reais.
  const displayCustomer = walkInMode
    ? ({ id: '', name: walk.name || 'Cliente novo' } as unknown as Customer)
    : customer;
  const displayAddress = walkInMode ? { id: '', label: walkInAddressLabel(walk) } : address;
  const displayEquipments = walkInMode
    ? walkInEquipments.map((item, index) => ({
        id: item.localId,
        name: [item.manufacturer, item.model, item.capacity].map((value) => value?.trim()).filter(Boolean).join(' - ') || `Equipamento ${index + 1}`,
      } as unknown as EquipmentSummary))
    : equipments;

  return (
    <div className="flex flex-col min-h-dvh">
      <WizardProgressHeader
        title={`${DOCUMENT_KIND_LABEL[documentType]} · ${STEPS[step]}`}
        current={step}
        total={STEPS.length}
        onBack={back}
        onClose={() => router.push('/operator')}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {step === 0 && (
          walkInMode ? (
            <WalkInStep
              value={walk}
              onChange={setWalk}
              onCancel={() => setWalkInMode(false)}
              equipments={walkInEquipments}
              equipmentTypes={walkInEquipmentTypes.data ?? []}
              equipmentTypesLoading={walkInEquipmentTypes.loading}
              onAddEquipment={(draft) => setWalkInEquipments((current) => [...current, draft])}
              onRemoveEquipment={(localId) => setWalkInEquipments((current) => current.filter((item) => item.localId !== localId))}
            />
          ) : (
            <div className="space-y-5">
              <ClienteStep
                selected={customer}
                onSelect={(c) => {
                  setCustomer(c);
                  setAddress(null);
                  setEquipments([]);
                  setEquipmentProfiles({});
                  setOsOrigin(null);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setWalkInMode(true);
                  setWalkInEquipments([]);
                  setCustomer(null);
                  setAddress(null);
                  setEquipments([]);
                  setEquipmentProfiles({});
                  setOsOrigin('scratch');
                }}
                className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 p-3.5 text-left active:scale-[0.99]"
              >
                <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><Building2 className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">OS avulso — cliente novo</span><span className="block text-caption">Cadastre o cliente em campo (fica em Revisão)</span></span>
                <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              </button>
              {customer && (
                <section className="space-y-2 border-t border-[var(--color-border)] pt-4">
                  <h2 className="text-sm font-semibold">Local do atendimento</h2>
                  <EnderecoStep customerId={customer.id} selected={address} onSelect={setAddress} />
                </section>
              )}
            </div>
          )
        )}
        {step === 1 && customer && (
          <EquipamentoStep
            customerId={customer.id}
            selected={equipments}
            onChange={setEquipments}
            profiles={equipmentProfiles}
            onProfileChange={(equipmentId, field, value) =>
              setEquipmentProfiles((current) => ({
                ...current,
                [equipmentId]: {
                  manufacturer: current[equipmentId]?.manufacturer ?? '',
                  model: current[equipmentId]?.model ?? '',
                  capacity: current[equipmentId]?.capacity ?? '',
                  [field]: value,
                },
              }))
            }
            onScanSelect={(eq) => {
              setEquipments((current) =>
                current.some((item) => item.id === eq.id) ? current : [...current, eq],
              );
              if (eq.manufacturer && eq.model && eq.capacity) setStep(2);
            }}
          />
        )}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm">
              <span className="block text-caption">Documento</span>
              <strong>{DOCUMENT_KIND_LABEL[documentType]}</strong>
              <span className="mt-1 block text-caption">O atendimento será executado por você e iniciado agora.</span>
            </div>
            <TipoStep selected={serviceType} onSelect={pickServiceType} />
          </div>
        )}
        {step === 3 && (
          documentType === 'TECHNICAL_REPORT' ? (
            <RvtMaintenanceChecklistStep
              maintenanceType={maintenanceType}
              onMaintenanceType={setMaintenanceType}
              items={maintenanceChecklist}
              loading={rvtChecklistCatalog.loading}
              onToggle={(index) => setMaintenanceChecklist((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, executed: !item.executed, result: item.executed ? 'NO' : 'YES' } : item))}
            />
          ) : (
            <ChecklistStep
              catalog={checklistCatalog.data ?? []}
              selected={checklist}
              loading={checklistCatalog.loading}
              onChange={setChecklist}
            />
          )
        )}
        {step === 4 && (
          <NotesStep
            documentType={documentType}
            reportedIssue={reportedIssue}
            onReportedIssue={setReportedIssue}
            serviceDescription={serviceDescription}
            onServiceDescription={setServiceDescription}
            observations={observations}
            onObservations={setObservations}
            objectives={objectives}
            onObjectivesChange={setObjectives}
            conditions={conditions}
            onConditionsChange={setConditions}
            recommendations={recommendations}
            onRecommendationsChange={setRecommendations}
            conclusions={conclusions}
            onConclusionsChange={setConclusions}
            areas={technicalCatalogAreas(equipments)}
          />
        )}
        {step === 5 && <FotosStep photos={photos} onChange={setPhotos} />}
        {step === 6 && (
          <div className="space-y-5">
            <OperatorSignatureChoice selectedId={technicalSignatureId} onSelect={setTechnicalSignatureId} />
            <ResumoStep
              customer={displayCustomer}
              address={displayAddress}
              equipments={displayEquipments}
              serviceType={serviceType}
              checklist={checklist}
              maintenanceType={maintenanceType}
              maintenanceChecklist={maintenanceChecklist}
              reportedIssue={reportedIssue}
              serviceDescription={serviceDescription}
              observations={observations}
              photoCount={photos.length}
              signed={false}
              documentType={documentType}
              variant="signature"
              showSignature={false}
            />
            <AssinaturaStep signerName={signerName} signerRole={signerRole} signedAt={signedAt} onSignerName={setSignerName} onSignerRole={setSignerRole} onChange={(value) => { setSignature(value); setSignedAt(value ? new Date().toISOString() : null); }} />
          </div>
        )}
        {step === 7 && (
          <ResumoStep
            customer={displayCustomer}
            address={displayAddress}
            equipments={displayEquipments}
            serviceType={serviceType}
            checklist={checklist}
            maintenanceType={maintenanceType}
            maintenanceChecklist={maintenanceChecklist}
            reportedIssue={reportedIssue}
            serviceDescription={serviceDescription}
            observations={observations}
            photoCount={photos.length}
            signed={!!signature}
            signerName={signerName}
            signerRole={signerRole}
            signedAt={signedAt}
            technicalSignatureSelected={Boolean(technicalSignatureId)}
            documentType={documentType}
            variant="confirmation"
          />
        )}
        {submitError && (
          <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {submitError}
          </p>
        )}
      </div>

      <WizardFooter
        onBack={back}
        onNext={next}
        nextLabel={isLast ? 'Concluir e gerar PDF' : 'Continuar'}
        nextDisabled={!canNext}
        loading={submitting}
        isLast={isLast}
        nextIcon={isLast ? <Send className="h-4 w-4" /> : undefined}
      />
    </div>
  );
}

/* ---------- Steps ---------- */

function AttendanceTypeStep({ onSelect, onClose, canCreatePmoc = false, onCreatePmoc }: { onSelect: (type: DocumentKind) => void; onClose: () => void; canCreatePmoc?: boolean; onCreatePmoc?: () => void }) {
  return (
    <div className="min-h-dvh px-4 py-5">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-caption uppercase tracking-wider">Nova atividade</p>
            <h1 className="text-[22px] font-semibold tracking-tight">O que você vai realizar?</h1>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Você pode iniciar uma Ordem de Serviço ou Visita Técnica mesmo sem atribuição. Ao concluir, o PDF oficial será gerado.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-[var(--color-border)]"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-2">
          {FIELD_DOCUMENT_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => onSelect(type)} className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left active:scale-[0.99]">
              <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><FileText className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">{DOCUMENT_KIND_LABEL[type]}</span><span className="block text-xs text-[var(--color-muted-foreground)]">Registrar uma nova atividade de campo</span></span>
              <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
            </button>
          ))}
          {canCreatePmoc && (
            <button type="button" onClick={onCreatePmoc} className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left active:scale-[0.99]">
              <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><CalendarClock className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">Executar PMOC</span><span className="block text-xs text-[var(--color-muted-foreground)]">Atender um equipamento de um plano já configurado</span></span>
              <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RvtStartModeStep({ onBack, onStandalone }: { onBack: () => void; onStandalone: () => void }) {
  const router = useRouter();
  const { session } = useAuth();
  const [planId, setPlanId] = useState(''); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const plans = useQuery((signal) => rvtApi.listPlans({ status: 'ACTIVE', limit: 100, signal }), []);
  const executions = useQuery((signal) => planId ? rvtApi.listExecutions(planId, { limit: 100, signal }) : Promise.resolve({ items: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }), [planId]);
  const available = (executions.data?.items ?? []).filter((item) => !item.operationId && item.status !== 'CANCELED' && (!item.assignedOperatorId || item.assignedOperatorId === session?.user.id));
  async function start(id: string) { setBusy(id); setError(null); try { const operation = await rvtApi.prepareExecution(id); if (!operation.assignment?.id) throw new Error('A execução foi preparada, mas a atribuição não foi localizada.'); router.push(`/operator/services/${operation.assignment.id}`); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a visita.'); } finally { setBusy(null); } }
  return <div className="min-h-dvh px-4 py-5"><div className="mx-auto max-w-lg space-y-5"><header className="flex items-start gap-3"><button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border"><ChevronRight className="h-4 w-4 rotate-180" /></button><div><p className="text-caption uppercase tracking-wider">Relatório de Visita Técnica</p><h1 className="text-[22px] font-semibold">Como deseja iniciar?</h1><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Use uma programação existente ou registre uma visita avulsa.</p></div></header>
    <button type="button" onClick={onStandalone} className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border bg-[var(--color-card)] p-4 text-left"><span className="grid h-11 w-11 place-items-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><FilePlus2 className="h-5 w-5" /></span><span className="flex-1"><strong className="block">RVT avulso</strong><span className="text-caption">Preencher do zero; a configuração e a primeira execução serão registradas ao concluir.</span></span><ChevronRight className="h-5 w-5" /></button>
    <section className="space-y-3 rounded-[var(--radius-lg)] border bg-[var(--color-card)] p-4"><div><strong>RVT configurado</strong><p className="text-caption">Selecione a programação e uma ocorrência disponível.</p></div>{plans.loading ? <SkeletonList rows={3} /> : plans.error ? <ErrorState error={plans.error} onRetry={plans.refetch} /> : <select className="w-full rounded-md border bg-transparent px-3 py-3 text-sm" value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">Selecione uma configuração</option>{plans.data?.items.map((plan: RvtPlan) => <option key={plan.id} value={plan.id}>RVT-{String(plan.number).padStart(5, '0')} · {plan.name}</option>)}</select>}
      {planId && (executions.loading ? <SkeletonList rows={3} /> : available.length ? <div className="space-y-2">{available.map((execution) => <button key={execution.id} disabled={Boolean(busy)} onClick={() => void start(execution.id)} className="flex w-full items-center justify-between rounded-md border p-3 text-left disabled:opacity-50"><span><strong className="block text-sm">Execução #{String(execution.executionNumber).padStart(3, '0')}</strong><span className="text-caption">Prevista para {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(execution.scheduledAt))}</span></span>{busy === execution.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}</button>)}</div> : <EmptyState icon={CheckCircle2} title="Sem execuções disponíveis" description="Não há ocorrência pendente disponível para este usuário." />)}
    </section>{error && <p className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}</div></div>;
}

function PmocStartStep({
  onBack,
  onCompleted,
}: {
  onBack: () => void;
  onCompleted: (document: { documentId: string; documentNumber: string }) => void;
}) {
  const [planId, setPlanId] = useState('');
  const [tick, setTick] = useState(0);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentSummary | null>(null);
  const [executionRequest, setExecutionRequest] = useState<PmocExecutionRequest | null>(null);
  const [prefill, setPrefill] = useState<CreateOperationPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plans = useQuery((signal) => pmocApi.listPmoc({ active: true, limit: 100, signal }), []);
  const plan = useQuery<PmocPlan | null>(
    (signal) => planId ? pmocApi.getPmoc(planId, { signal }) : Promise.resolve(null),
    [planId, tick],
  );
  const requests = useQuery(
    (signal) => planId
      ? pmocApi.listExecutionRequests(planId, { limit: 100, signal })
      : Promise.resolve({ items: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
    [planId, tick],
  );
  const equipments = (
    plan.data?.equipments?.map((item) => item.equipment) ??
    (plan.data?.equipment ? [plan.data.equipment] : [])
  ) as EquipmentSummary[];

  async function start(equipment: EquipmentSummary) {
    if (!plan.data) return;
    setBusy(equipment.id);
    setError(null);
    try {
      const reusable = (requests.data?.items ?? []).find(
        (request) =>
          request.equipmentId === equipment.id &&
          !request.operationId &&
          (request.status === 'PENDING' || request.status === 'FAILED'),
      );
      const request =
        reusable ??
        await pmocApi.createExecutionRequest(plan.data.id, {
          equipmentId: equipment.id,
          scheduledFor: new Date().toISOString(),
          notes: `Execução iniciada no aplicativo para ${equipment.name}.`,
        });
      const prefill = await pmocApi.getExecutionRequestPrefill(request.id);
      setSelectedEquipment(equipment);
      setExecutionRequest(request);
      setPrefill(prefill);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar esta execução PMOC.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-5">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="flex items-start gap-3"><button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--color-border)]"><ChevronRight className="h-4 w-4 rotate-180" /></button><div><p className="text-caption uppercase tracking-wider">Nova atividade</p><h1 className="text-[22px] font-semibold">Executar PMOC</h1><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Escolha um plano configurado e depois o equipamento que será atendido individualmente.</p></div></header>
        {plans.loading && !plans.data ? <SkeletonList rows={4} /> : plans.error && !plans.data ? <ErrorState error={plans.error} onRetry={plans.refetch} /> : (
          <label className="block space-y-1 text-sm"><span className="font-medium">Plano PMOC</span><select className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-3" value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">Selecione um plano ativo</option>{(plans.data?.items ?? []).map((plan: PmocPlan) => <option key={plan.id} value={plan.id}>PMOC-{String(plan.number).padStart(6, '0')} · {plan.customer?.name ?? plan.maintenancePlan?.name ?? 'Plano PMOC'}</option>)}</select></label>
        )}
        {error && <p className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
        {planId && (plan.loading && !plan.data ? <SkeletonList rows={4} /> : plan.error && !plan.data ? <ErrorState error={plan.error} onRetry={plan.refetch} /> : equipments.length === 0 ? <EmptyState icon={FileSearch} title="Nenhum equipamento coberto" description="Configure os equipamentos deste PMOC na Platform antes da execução." /> : <div className="space-y-3"><div><h2 className="font-semibold">Equipamentos cobertos</h2><p className="text-xs text-[var(--color-muted-foreground)]">Cada equipamento gera sua própria execução, evidências e documento PMOC.</p></div>{equipments.map((equipment) => {
          const latest = (requests.data?.items ?? []).filter((request) => request.equipmentId === equipment.id).sort((left, right) => right.equipmentExecutionNumber - left.equipmentExecutionNumber)[0];
          const progress = plan.data?.overview?.equipmentExecutions.find((item) => item.equipmentId === equipment.id);
          const unavailable = !progress?.hasOpenExecutions;
          return <button key={equipment.id} type="button" disabled={Boolean(busy) || unavailable} onClick={() => void start(equipment)} className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left disabled:opacity-60"><span className="min-w-0"><span className="block truncate font-semibold">{equipment.name}</span><span className="block truncate text-xs text-[var(--color-muted-foreground)]">{[equipment.sector, equipment.manufacturer, equipment.model, equipment.capacity].filter(Boolean).join(' · ') || 'Sem detalhes técnicos'}</span>{progress && <span className={`mt-1 block text-xs ${progress.coverageEnded && progress.hasOpenExecutions ? 'text-[var(--color-danger)]' : 'text-[var(--color-primary)]'}`}>{progress.completedExecutions}/{progress.expectedExecutions} execuções concluídas{progress.coverageEnded && progress.hasOpenExecutions ? ` · cobertura encerrada, ${progress.remainingExecutions} pendente(s)` : ''}</span>}{latest && <span className="block text-xs text-[var(--color-muted-foreground)]">Última execução {String(latest.equipmentExecutionNumber).padStart(3, '0')} · {pmocExecutionLabel(latest.status)}</span>}</span>{busy === equipment.id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : unavailable ? <Check className="h-5 w-5 shrink-0 text-[var(--color-success)]" /> : <ChevronRight className="h-5 w-5 shrink-0" />}</button>;
        })}</div>)}
      </div>
      {plan.data && (
        <PmocEquipmentExecutionWizard
          open={Boolean(selectedEquipment && executionRequest && prefill)}
          plan={plan.data}
          equipment={selectedEquipment}
          request={executionRequest}
          prefill={prefill}
          onClose={() => { setSelectedEquipment(null); setExecutionRequest(null); setPrefill(null); setTick((value) => value + 1); }}
          onCompleted={(request, documentId, documentNumber) => {
            setTick((value) => value + 1);
            if (!documentId) {
              setError('A execução foi concluída, mas o documento ainda precisa ser gerado em Documentos.');
              setSelectedEquipment(null);
              setExecutionRequest(null);
              setPrefill(null);
              return;
            }
            onCompleted({
              documentId,
              documentNumber: documentNumber ?? `PMOC-${String(request.equipmentExecutionNumber).padStart(3, '0')}`,
            });
          }}
        />
      )}
    </div>
  );
}

function pmocExecutionLabel(status: PmocExecutionRequest['status']): string {
  return ({
    PENDING: 'Disponível',
    GENERATING_OS: 'Em preparação',
    GENERATED: 'Concluída',
    FAILED: 'Requer atenção',
    CANCELLED: 'Cancelada',
  } as Record<PmocExecutionRequest['status'], string>)[status];
}

/* ---------- OS a partir de RVT / PMOC ---------- */

function addressLabelOf(a: CustomerAddress): string {
  return (
    [a.street, a.number, a.district, a.city].filter(Boolean).join(', ') || a.name || 'Endereço'
  );
}

async function fetchEquipmentSummaries(ids: string[]): Promise<EquipmentSummary[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const results = await Promise.all(
    unique.map((id) => equipmentsApi.getEquipment(id).catch(() => null)),
  );
  return results.filter((equipment): equipment is EquipmentDetail => Boolean(equipment));
}

async function buildRvtPrefill(item: DocumentCatalogItem): Promise<OsPrefill> {
  if (!item.originId) throw new Error('Este RVT não possui uma operação de origem.');
  const operation = await operationApi.getOperation(item.originId);
  const equipmentIds = [
    ...operation.inspectedEquipments.map((equipment) => equipment.equipmentId),
    ...(operation.equipment ? [operation.equipment.id] : []),
  ];
  return {
    address: operation.address
      ? { id: operation.address.id, label: addressLabelOf(operation.address) }
      : null,
    serviceType: operation.type as ServiceTypeKey,
    reportedIssue: operation.reportedIssue ?? undefined,
    serviceDescription: operation.serviceDescription ?? undefined,
    observations: operation.observations ?? undefined,
    equipments: await fetchEquipmentSummaries(equipmentIds),
  };
}

async function buildPmocPrefill(planId: string): Promise<OsPrefill> {
  const plan = await pmocApi.getPmoc(planId);
  const equipments = plan.equipments?.map((item) => item.equipment) ?? (plan.equipment ? [plan.equipment] : []);
  return {
    address: plan.defaultAddress
      ? { id: plan.defaultAddress.id, label: addressLabelOf(plan.defaultAddress) }
      : null,
    serviceType: plan.defaultOperationType as ServiceTypeKey,
    serviceDescription: plan.coverage ?? undefined,
    observations: plan.defaultOperationObservations ?? undefined,
    equipments: await fetchEquipmentSummaries(equipments.map((equipment) => equipment.id)),
  };
}

function OSOriginStep({
  customer,
  onBack,
  onScratch,
  onPrefill,
}: {
  customer: Customer;
  onBack: () => void;
  onScratch: () => void;
  onPrefill: (origin: OsOrigin, data: OsPrefill) => void;
}) {
  const [mode, setMode] = useState<'choose' | 'rvt' | 'pmoc'>('choose');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rvts = useQuery(
    (signal) =>
      mode === 'rvt'
        ? documentsApi.listDocuments({ type: 'TECHNICAL_REPORT', customerId: customer.id, limit: 20, signal })
        : Promise.resolve(null),
    [mode, customer.id],
  );
  const pmocs = useQuery(
    (signal) =>
      mode === 'pmoc'
        ? pmocApi.listPmoc({ customerId: customer.id, active: true, limit: 20, signal })
        : Promise.resolve(null),
    [mode, customer.id],
  );

  async function pick(id: string, build: () => Promise<OsPrefill>, origin: OsOrigin) {
    setBusyId(id);
    setError(null);
    try {
      onPrefill(origin, await build());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados do documento.');
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-5">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => (mode === 'choose' ? onBack() : setMode('choose'))}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--color-border)]"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
          <div>
            <p className="text-caption uppercase tracking-wider">Nova Ordem de Serviço</p>
            <h1 className="text-[22px] font-semibold">
              {mode === 'choose' ? 'Como criar esta OS?' : mode === 'rvt' ? 'Escolha um RVT' : 'Escolha um PMOC'}
            </h1>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {mode === 'choose'
                ? `Cliente: ${customer.name}. Você pode reaproveitar os dados de um RVT ou PMOC deste cliente.`
                : 'Os dados do documento serão pré-preenchidos no atendimento. Você poderá ajustar em seguida.'}
            </p>
          </div>
        </header>

        {error && (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {mode === 'choose' && (
          <div className="space-y-2">
            <OriginCard icon={<FilePlus2 className="h-5 w-5" />} title="Criar do zero" subtitle="Preencha o atendimento manualmente" onClick={onScratch} />
            <OriginCard icon={<FileText className="h-5 w-5" />} title="A partir de um RVT" subtitle="Reaproveitar um Relatório de Visita Técnica" onClick={() => setMode('rvt')} />
            <OriginCard icon={<ShieldCheck className="h-5 w-5" />} title="A partir de um PMOC" subtitle="Reaproveitar um plano PMOC ativo" onClick={() => setMode('pmoc')} />
          </div>
        )}

        {mode === 'rvt' && (
          rvts.loading && !rvts.data ? <SkeletonList rows={4} />
            : rvts.error && !rvts.data ? <ErrorState error={rvts.error} onRetry={rvts.refetch} />
            : (rvts.data?.items.length ?? 0) === 0 ? <EmptyState icon={FileSearch} title="Nenhum RVT" description="Este cliente ainda não possui Relatórios de Visita Técnica." />
            : <div className="space-y-2">{(rvts.data?.items ?? []).map((item) => (
                <OriginPick
                  key={item.id}
                  busy={busyId === item.id}
                  disabled={Boolean(busyId)}
                  title={item.number}
                  subtitle={`${item.equipment?.name ?? 'Sem equipamento'} · ${new Date(item.createdAt).toLocaleDateString('pt-BR')}`}
                  onClick={() => void pick(item.id, () => buildRvtPrefill(item), 'rvt')}
                />
              ))}</div>
        )}

        {mode === 'pmoc' && (
          pmocs.loading && !pmocs.data ? <SkeletonList rows={4} />
            : pmocs.error && !pmocs.data ? <ErrorState error={pmocs.error} onRetry={pmocs.refetch} />
            : (pmocs.data?.items.length ?? 0) === 0 ? <EmptyState icon={FileSearch} title="Nenhum PMOC ativo" description="Este cliente não possui planos PMOC ativos." />
            : <div className="space-y-2">{(pmocs.data?.items ?? []).map((plan) => (
                <OriginPick
                  key={plan.id}
                  busy={busyId === plan.id}
                  disabled={Boolean(busyId)}
                  title={`PMOC-${String(plan.number).padStart(6, '0')}`}
                  subtitle={plan.maintenancePlan?.name ?? plan.customer?.name ?? 'Plano PMOC'}
                  onClick={() => void pick(plan.id, () => buildPmocPrefill(plan.id), 'pmoc')}
                />
              ))}</div>
        )}
      </div>
    </div>
  );
}

function OriginCard({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left active:scale-[0.99]">
      <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="block text-xs text-[var(--color-muted-foreground)]">{subtitle}</span></span>
      <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
    </button>
  );
}

function OriginPick({ title, subtitle, busy, disabled, onClick }: { title: string; subtitle: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left disabled:opacity-60">
      <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="block truncate text-xs text-[var(--color-muted-foreground)]">{subtitle}</span></span>
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );
}

function WalkInStep({
  value,
  onChange,
  onCancel,
  equipments,
  equipmentTypes,
  equipmentTypesLoading,
  onAddEquipment,
  onRemoveEquipment,
}: {
  value: WalkInForm;
  onChange: (v: WalkInForm) => void;
  onCancel: () => void;
  equipments: NewFieldEquipmentDraft[];
  equipmentTypes: TechnicalCatalog[];
  equipmentTypesLoading: boolean;
  onAddEquipment: (draft: NewFieldEquipmentDraft) => void;
  onRemoveEquipment: (localId: string) => void;
}) {
  const setField = (key: keyof Omit<WalkInForm, 'personType'>, v: string) => onChange({ ...value, [key]: v });
  const [cepBusy, setCepBusy] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);

  async function lookupCep() {
    const digits = value.zipCode.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepBusy(true);
    setCepError(null);
    try {
      const result = await cepApi.lookupCep(digits);
      // Preenche automaticamente o que veio do CEP, preservando o que já existir.
      onChange({
        ...value,
        zipCode: result.zipCode,
        street: result.street || value.street,
        district: result.district || value.district,
        city: result.city || value.city,
        state: result.state || value.state,
      });
    } catch (cause) {
      setCepError(cause instanceof Error ? cause.message : 'Não foi possível consultar o CEP.');
    } finally {
      setCepBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Cliente novo (OS avulso)</h2>
          <p className="text-caption">O cadastro fica em <strong>Revisão</strong> para a gestão concluir depois — não bloqueia o atendimento, a OS nem o relatório.</p>
        </div>
        <button type="button" onClick={onCancel} className="shrink-0 text-xs font-medium text-[var(--color-primary)]">Usar existente</button>
      </div>

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['COMPANY', 'PERSON'] as const).map((t) => (
            <button key={t} type="button" onClick={() => onChange({ ...value, personType: t })} className={`rounded-[var(--radius-md)] border p-2.5 text-sm font-medium ${value.personType === t ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}>
              {t === 'COMPANY' ? 'Empresa (CNPJ)' : 'Pessoa (CPF)'}
            </button>
          ))}
        </div>
        <WalkField label="Nome / Razão social *" value={value.name} onChange={(v) => setField('name', v)} />
        <WalkField label={value.personType === 'COMPANY' ? 'CNPJ *' : 'CPF'} value={value.document} onChange={(v) => setField('document', v)} />
      </section>

      <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold">Endereço</h3>
        <div className="grid grid-cols-3 gap-2">
          <WalkField
            label="CEP"
            value={value.zipCode}
            onChange={(v) => setField('zipCode', v)}
            onBlur={() => void lookupCep()}
            placeholder="00000-000"
            hint={cepBusy ? <span className="text-[11px] text-[var(--color-muted-foreground)]">Buscando endereço…</span> : cepError ? <span className="text-[11px] text-[var(--color-warning)]">{cepError}</span> : undefined}
          />
          <WalkField className="col-span-2" label="Cidade *" value={value.city} onChange={(v) => setField('city', v)} />
        </div>
        <p className="text-[11px] text-[var(--color-muted-foreground)]">Digite o CEP para preencher o endereço automaticamente.</p>
        <WalkField label="Logradouro *" value={value.street} onChange={(v) => setField('street', v)} />
        <div className="grid grid-cols-3 gap-2">
          <WalkField label="Número *" value={value.number} onChange={(v) => setField('number', v)} />
          <WalkField className="col-span-2" label="Bairro *" value={value.district} onChange={(v) => setField('district', v)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <WalkField className="col-span-2" label="Complemento" value={value.complement} onChange={(v) => setField('complement', v)} />
          <WalkField label="UF *" value={value.state} onChange={(v) => setField('state', v.toUpperCase().slice(0, 2))} />
        </div>
      </section>

      <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold">Contato</h3>
        <WalkField label="Nome do contato *" value={value.contactName} onChange={(v) => setField('contactName', v)} />
        <WalkField label="Telefone *" value={value.contactPhone} onChange={(v) => setField('contactPhone', v)} />
      </section>

      <div className="border-t border-[var(--color-border)] pt-4">
        <FieldEquipmentCollection
          drafts={equipments}
          equipmentTypes={equipmentTypes}
          equipmentTypesLoading={equipmentTypesLoading}
          onAdd={onAddEquipment}
          onRemove={onRemoveEquipment}
          title="Equipamentos do atendimento"
          description="Adicione todos os equipamentos encontrados no local. Eles serão cadastrados para o novo cliente e incluídos nesta Ordem de Serviço."
        />
      </div>
    </div>
  );
}

function WalkField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  hint?: React.ReactNode;
}) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-11 text-sm outline-none focus:border-[var(--color-primary)]" />
      {hint}
    </label>
  );
}

function ClienteStep({
  selected,
  onSelect,
}: {
  selected: Customer | null;
  onSelect: (c: Customer) => void;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const list = useQuery(
    (signal) => customersApi.listCustomers({ limit: 12, search: debounced || undefined, signal }),
    [debounced],
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Busque por nome, telefone ou CNPJ.
      </p>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar cliente…"
        className="w-full"
      />
      {list.loading && !list.data ? (
        <SkeletonList rows={5} />
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState icon={Building2} title="Nenhum cliente" description="Ajuste a busca." />
      ) : (
        <ul className="space-y-2">
          {(list.data?.items ?? []).map((c) => (
            <li key={c.id}>
              <PickRow
                active={selected?.id === c.id}
                onClick={() => onSelect(c)}
                icon={<Building2 className="h-4 w-4" />}
                title={c.name}
                subtitle={c.cnpj ?? c.cpf ?? c.phone ?? '—'}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EnderecoStep({
  customerId,
  selected,
  onSelect,
}: {
  customerId: string;
  selected: { id: string; label: string } | null;
  onSelect: (a: { id: string; label: string }) => void;
}) {
  const detail = useQuery<CustomerDetail>(
    (signal) => customersApi.getCustomer(customerId, { signal }),
    [customerId],
  );
  if (detail.loading && !detail.data) return <SkeletonList rows={3} />;
  if (detail.error && !detail.data)
    return <ErrorState error={detail.error} onRetry={detail.refetch} />;
  const addresses = detail.data?.addresses ?? [];
  if (addresses.length === 0)
    return (
      <EmptyState
        icon={MapPin}
        title="Sem endereços"
        description="Este cliente não possui endereços cadastrados."
      />
    );
  return (
    <ul className="space-y-2">
      {addresses.map((a) => {
        const label =
          [a.street, a.number, a.district, a.city].filter(Boolean).join(', ') ||
          a.name ||
          'Endereço';
        return (
          <li key={a.id}>
            <PickRow
              active={selected?.id === a.id}
              onClick={() => onSelect({ id: a.id, label })}
              icon={<MapPin className="h-4 w-4" />}
              title={a.name ?? 'Endereço'}
              subtitle={label}
              badge={a.isPrimary ? 'Principal' : undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}

function EquipamentoStep({
  customerId,
  selected,
  onChange,
  onScanSelect,
  profiles,
  onProfileChange,
}: {
  customerId: string;
  selected: EquipmentSummary[];
  onChange: (equipments: EquipmentSummary[]) => void;
  onScanSelect: (e: EquipmentSummary) => void;
  profiles: Record<string, EquipmentProfileDraft>;
  onProfileChange: (
    equipmentId: string,
    field: keyof EquipmentProfileDraft,
    value: string,
  ) => void;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<EquipmentDetail | null>(null);
  const list = useQuery(
    (signal) =>
      equipmentsApi.listEquipments({
        customerId,
        limit: 100,
        search: debounced || undefined,
        signal,
      }),
    [customerId, debounced],
  );

  async function handleScan(text: string) {
    setScanOpen(false);
    setScanning(true);
    setScanError(null);
    try {
      const eq = await equipmentsApi.lookupByQr(text.trim());
      setScanned(eq);
    } catch (err) {
      setScanError(
        err instanceof ApiClientError && err.code === 'EQUIPMENT_NOT_FOUND'
          ? 'Nenhum equipamento encontrado para este QR Code.'
          : err instanceof ApiClientError && err.status === 400
            ? 'QR Code inválido.'
            : 'Não foi possível ler o QR Code. Tente novamente.',
      );
    } finally {
      setScanning(false);
    }
  }

  // After scan + confirm, equipment is auto-selected and the wizard advances.
  if (scanned) {
    return (
      <ScannedEquipmentCard
        equipment={scanned}
        onConfirm={() => {
          onScanSelect(scanned);
          setScanned(null);
        }}
        onCancel={() => setScanned(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          setScanError(null);
          setScanOpen(true);
        }}
        disabled={scanning}
        className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] h-12 text-sm font-semibold active:scale-[0.99] disabled:opacity-60"
      >
        {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-5 w-5" />}
        Escanear QR Code
      </button>
      {scanError && (
        <p className="text-[12px] text-[var(--color-danger)] text-center">{scanError}</p>
      )}

      <div className="flex items-center gap-2 text-caption">
        <span className="h-px flex-1 bg-[var(--color-border)]" /> ou busque{' '}
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar equipamento…"
        className="w-full"
      />
      <p className="text-caption">
        Selecione todos os equipamentos atendidos. Nenhum seletor adicional será aberto.
      </p>

      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={handleScan} />

      {list.loading && !list.data ? (
        <SkeletonList rows={4} />
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={Wrench} title="Nenhum equipamento" />
      ) : (
        <ul className="space-y-2">
          {(list.data?.items ?? []).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    selected.some((item) => item.id === e.id)
                      ? selected.filter((item) => item.id !== e.id)
                      : [...selected, e],
                  )
                }
                className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] border p-3.5 text-left active:scale-[0.99] ${selected.some((item) => item.id === e.id) ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}
              >
                <span
                  className={`grid h-6 w-6 place-items-center rounded border ${selected.some((item) => item.id === e.id) ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'border-[var(--color-border)]'}`}
                >
                  {selected.some((item) => item.id === e.id) && <Check className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {[e.manufacturer, e.model, e.capacity].filter(Boolean).join(' - ') || e.name}
                  </strong>
                  <span className="block truncate text-caption">
                    {e.sector || 'Setor não informado'}
                  </span>
                </span>
                {e.status === 'MAINTENANCE' && <StatusChip tone="warning">Manutenção</StatusChip>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected
        .filter((equipment) => !equipment.manufacturer || !equipment.model || !equipment.capacity)
        .map((equipment) => {
          const missing = (
            [
              ['manufacturer', 'Marca'],
              ['model', 'Modelo'],
              ['capacity', 'Capacidade'],
            ] as const
          ).filter(([field]) => !equipment[field]);
          return (
            <section
              key={equipment.id}
              className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/5 p-3"
            >
              <div>
                <h3 className="text-sm font-semibold">
                  Complete os dados de {equipment.name}
                </h3>
                <p className="text-caption">
                  Estes dados atualizarão o equipamento e serão utilizados na OS.
                </p>
              </div>
              {missing.map(([field, label]) => (
                <label key={field} className="block space-y-1 text-sm">
                  <span className="font-medium">{label} *</span>
                  <input
                    value={profiles[equipment.id]?.[field] ?? ''}
                    onChange={(event) =>
                      onProfileChange(equipment.id, field, event.target.value)
                    }
                    maxLength={field === 'capacity' ? 80 : 120}
                    placeholder={`Informe ${label.toLowerCase()}`}
                    className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 outline-none focus:border-[var(--color-primary)]"
                    required
                  />
                </label>
              ))}
            </section>
          );
        })}
    </div>
  );
}

function ScannedEquipmentCard({
  equipment,
  onConfirm,
  onCancel,
}: {
  equipment: EquipmentDetail;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    const att = equipment.attachments?.find((a) => a.category === 'PHOTO');
    if (!att) return;
    let active = true;
    equipmentsApi
      .getEquipmentAttachment(att.id)
      .then((c) => {
        if (active) setPhoto(`data:${c.mimeType};base64,${c.contentBase64}`);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [equipment]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]">
        <CheckCircle2 className="h-4 w-4 shrink-0" /> Equipamento lido com sucesso
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={equipment.name} className="h-40 w-full object-cover" />
        )}
        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-section-title leading-tight">{equipment.name}</h2>
            <StatusPill
              status={EQUIPMENT_STATUS_PILL[equipment.status]}
              label={EQUIPMENT_STATUS_LABEL[equipment.status]}
            />
          </div>
          <Row label="Cliente" value={equipment.customer?.name} />
          <Row label="Endereço" value={equipment.address?.name ?? equipment.address?.city} />
          <Row label="Patrimônio" value={equipment.tag} />
          <Row label="Nº de série" value={equipment.serialNumber} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 h-12 text-sm font-medium hover:bg-[var(--color-muted)]"
        >
          <X className="h-4 w-4" /> Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] h-12 text-sm font-semibold active:scale-[0.99]"
        >
          <Check className="h-4 w-4" /> Confirmar e continuar
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 border-b last:border-0 border-[var(--color-border)]/60">
      <span className="text-caption">{label}</span>
      <span className="text-sm text-right">{value || '—'}</span>
    </div>
  );
}

function TipoStep({
  selected,
  onSelect,
}: {
  selected: ServiceTypeKey | null;
  onSelect: (k: ServiceTypeKey) => void;
}) {
  // Opções vêm do catálogo editável; fallback aos tipos do sistema ao carregar.
  const catalog = useQuery((signal) => serviceTypesApi.list({ activeOnly: true, signal }), []);
  const options = (catalog.data?.items ?? []).length
    ? (catalog.data?.items ?? []).map((item) => ({
        key: item.key,
        label: item.label,
        description: SERVICE_TYPES.find((t) => t.key === item.key)?.description ?? '',
      }))
    : SERVICE_TYPES;
  return (
    <div className="space-y-2">
      {options.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={`w-full text-left rounded-[var(--radius-md)] border p-4 transition active:scale-[0.99] ${selected === t.key ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{t.label}</span>
            {selected === t.key && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
          </div>
          {t.description && <p className="text-caption mt-0.5">{t.description}</p>}
        </button>
      ))}
    </div>
  );
}

function ChecklistStep({
  catalog,
  selected,
  loading,
  onChange,
}: {
  catalog: TechnicalCatalog[];
  selected: ChecklistItem[];
  loading?: boolean;
  onChange: (items: ChecklistItem[]) => void;
}) {
  if (loading) return <SkeletonList rows={5} />;
  if (catalog.length === 0)
    return (
      <EmptyState
        icon={ClipboardList}
        title="Sem checklist para este documento"
        description="Nenhum item de checklist está cadastrado em Catálogos Técnicos para este tipo de atendimento. Você pode seguir para a próxima etapa."
      />
    );

  const selectedIds = selected.map((item) => item.catalogId);

  function select(catalogIds: string[]) {
    const current = new Map(selected.map((item) => [item.catalogId, item]));
    onChange(
      catalogIds.flatMap((catalogId) => {
        const item = catalog.find((candidate) => candidate.id === catalogId);
        if (!item) return [];
        return [
          current.get(catalogId) ?? {
            catalogId: item.id,
            label: item.title,
            note: item.description ?? undefined,
            // No atendimento iniciado pelo próprio operador, selecionar significa
            // declarar que a atividade já foi executada.
            done: true,
          },
        ];
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Checklist executado</h2>
        <p className="mt-1 text-caption">
          Etapa opcional. Selecione apenas as atividades que você realizou neste atendimento. Os
          itens escolhidos serão registrados como concluídos na Ordem de Serviço.
        </p>
      </div>
      <MultiSelect
        label="Itens predefinidos"
        options={catalog.map((item) => ({
          value: item.id,
          label: item.title,
          description: item.description ?? undefined,
        }))}
        value={selectedIds}
        onChange={select}
        placeholder="Selecionar atividades realizadas"
        emptyMessage="Nenhum item correspondente foi encontrado."
      />
      {selected.length > 0 && (
        <ul className="space-y-2" aria-label="Atividades selecionadas e concluídas">
          {selected.map((item) => (
            <li
              key={item.catalogId}
              className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/5 p-3.5"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-success)]" />
              <span className="text-sm">
                <span className="block font-medium">{item.label}</span>
                <span className="text-caption">Atividade realizada</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {selected.length === 0 && (
        <p className="rounded-[var(--radius-md)] bg-[var(--color-muted)] px-3 py-2 text-caption">
          Nenhum item selecionado. Você pode continuar sem adicionar checklist.
        </p>
      )}
    </div>
  );
}

function RvtMaintenanceChecklistStep({
  maintenanceType,
  onMaintenanceType,
  items,
  loading,
  onToggle,
}: {
  maintenanceType: OperationMaintenanceType;
  onMaintenanceType: (value: OperationMaintenanceType) => void;
  items: OperationMaintenanceChecklistItem[];
  loading: boolean;
  onToggle: (index: number) => void;
}) {
  if (loading) return <SkeletonList rows={6} />;
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div><h2 className="font-semibold">Tipo de manutenção</h2><p className="text-caption">Os dois tipos aparecerão no documento. Selecione o realizado nesta visita.</p></div>
        <div className="grid grid-cols-2 gap-3">
          {RVT_MAINTENANCE_TYPES.map((type) => <button key={type.value} type="button" onClick={() => onMaintenanceType(type.value)} className={`flex min-h-16 items-center justify-between rounded-[var(--radius-lg)] border p-3 text-left ${maintenanceType === type.value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}><span className="font-medium">{type.label}</span>{maintenanceType === type.value && <Check className="h-5 w-5 text-[var(--color-primary)]" />}</button>)}
        </div>
      </section>
      {RVT_MAINTENANCE_TYPES.map((type) => {
        const indexed = items.map((item, index) => ({ item, index })).filter(({ item }) => item.maintenanceType === type.value);
        return <section key={type.value} className={`space-y-2 rounded-[var(--radius-lg)] border p-3 ${maintenanceType === type.value ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}>
          <div className="flex items-center justify-between"><h3 className="font-semibold">Checklist {type.label.toLowerCase()}</h3>{maintenanceType === type.value && <StatusChip tone="success">Selecionado</StatusChip>}</div>
          {indexed.length === 0 ? <p className="text-caption">Nenhum item cadastrado no Catálogo Técnico.</p> : <ul className="space-y-2">{indexed.map(({ item, index }) => <li key={`${type.value}-${index}`}><button type="button" onClick={() => onToggle(index)} className="flex w-full items-center gap-3 rounded-md bg-[var(--color-card)] p-3 text-left">{item.executed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success)]" /> : <Circle className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />}<span className="text-sm">{item.description}</span></button></li>)}</ul>}
        </section>;
      })}
    </div>
  );
}

function NotesStep({
  documentType,
  reportedIssue,
  onReportedIssue,
  serviceDescription,
  onServiceDescription,
  observations,
  onObservations,
  recommendations,
  onRecommendationsChange,
  areas,
}: {
  documentType: DocumentKind;
  reportedIssue: string;
  onReportedIssue: (value: string) => void;
  serviceDescription: string;
  onServiceDescription: (value: string) => void;
  observations: string;
  onObservations: (value: string) => void;
  objectives: string[];
  onObjectivesChange: (values: string[]) => void;
  conditions: string[];
  onConditionsChange: (values: string[]) => void;
  recommendations: string[];
  onRecommendationsChange: (values: string[]) => void;
  conclusions: string[];
  onConclusionsChange: (values: string[]) => void;
  areas: TechnicalCatalogArea[];
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Relato do atendimento</h2>
        {documentType === 'WORK_ORDER' && <>
          <MobileTextArea label="Defeito ou solicitação" value={reportedIssue} onChange={onReportedIssue} placeholder="Descreva o que foi informado pelo cliente." />
          <MobileTextArea label="Serviços previstos ou executados" value={serviceDescription} onChange={onServiceDescription} placeholder="Descreva os serviços e verificações realizados." />
        </>}
        <MobileTextArea
          label="Observações"
          value={observations}
          onChange={onObservations}
          placeholder="Registre o resultado, pendências e orientações ao cliente."
        />
      </section>
      {documentType === 'TECHNICAL_REPORT' && <>
        <section className="space-y-2 border-t border-[var(--color-border)] pt-4">
          <h2 className="text-sm font-semibold">Recomendações técnicas <span className="font-normal text-[var(--color-muted-foreground)]">(opcional)</span></h2>
          <TechnicalCatalogSelector type="RECOMMENDATION" areas={areas} workflow="TECHNICAL_REPORT" label="Recomendação" values={recommendations} onChange={onRecommendationsChange} compact />
          <MobileTextArea label="Texto das recomendações" value={recommendations.join('\n')} onChange={(value) => onRecommendationsChange(value.split('\n').filter(Boolean))} placeholder="Inclua orientações técnicas quando necessário." />
        </section>
      </>}
    </div>
  );
}

function MobileTextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} placeholder={placeholder} className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-3 text-sm outline-none focus:border-[var(--color-primary)]" />
    </label>
  );
}

function technicalCatalogAreas(equipments: EquipmentSummary[]): TechnicalCatalogArea[] {
  const areas = new Set<TechnicalCatalogArea>();
  for (const equipment of equipments) {
    if (['SPLIT', 'CHILLER', 'CONDENSER', 'EVAPORATOR', 'AIR_HANDLER'].includes(equipment.type)) {
      areas.add('HVAC');
      areas.add('REFRIGERATION');
    } else if (['ELECTRICAL_PANEL', 'GENERATOR', 'SOLAR_INVERTER'].includes(equipment.type)) {
      areas.add('ELECTRICAL');
    }
  }
  return areas.size > 0 ? [...areas] : ['GENERAL'];
}

function FotosStep({
  photos,
  onChange,
}: {
  photos: CapturedPhoto[];
  onChange: (p: CapturedPhoto[]) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Registre o serviço com fotos (opcional).
      </p>
      <PhotoInput photos={photos} onChange={onChange} />
    </div>
  );
}

function AssinaturaStep({
  signerName,
  signerRole,
  signedAt,
  onSignerName,
  onSignerRole,
  onChange,
}: {
  signerName: string;
  signerRole: string;
  signedAt: string | null;
  onSignerName: (v: string) => void;
  onSignerRole: (v: string) => void;
  onChange: (s: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Identifique quem assina pelo cliente e colete a assinatura. Esses dados vão para o relatório final.
      </p>
      <input
        value={signerName}
        onChange={(e) => onSignerName(e.target.value)}
        placeholder="Nome do cliente/responsável que assina *"
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-11 text-sm outline-none focus:border-[var(--color-primary)]"
      />
      <input
        value={signerRole}
        onChange={(e) => onSignerRole(e.target.value)}
        placeholder="Função ou vínculo (opcional)"
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-11 text-sm outline-none focus:border-[var(--color-primary)]"
      />
      <SignaturePad onChange={onChange} onConfirm={onChange} />
      {!signerName.trim() && <p className="text-[11px] text-[var(--color-warning)]">Informe o nome de quem assina para continuar.</p>}
      {signedAt && <p className="rounded-[var(--radius-md)] bg-[var(--color-success)]/10 px-3 py-2 text-xs text-[var(--color-success)]">Assinatura coletada em {new Date(signedAt).toLocaleString('pt-BR')}.</p>}
    </div>
  );
}

function ResumoStep({
  customer,
  address,
  equipments,
  serviceType,
  checklist,
  maintenanceType,
  maintenanceChecklist,
  reportedIssue,
  serviceDescription,
  observations,
  photoCount,
  signed,
  signerName,
  signerRole,
  signedAt,
  technicalSignatureSelected = false,
  documentType,
  variant = 'confirmation',
  showSignature = true,
}: {
  customer: Customer | null;
  address: { id: string; label: string } | null;
  equipments: EquipmentSummary[];
  serviceType: ServiceTypeKey | null;
  checklist: ChecklistItem[];
  maintenanceType: OperationMaintenanceType;
  maintenanceChecklist: OperationMaintenanceChecklistItem[];
  reportedIssue: string;
  serviceDescription: string;
  observations: string;
  photoCount: number;
  signed: boolean;
  signerName?: string;
  signerRole?: string;
  signedAt?: string | null;
  technicalSignatureSelected?: boolean;
  documentType: DocumentKind;
  variant?: 'signature' | 'confirmation';
  showSignature?: boolean;
}) {
  const displayedChecklist = documentType === 'TECHNICAL_REPORT' ? maintenanceChecklist : checklist;
  const done = displayedChecklist.filter((item) => 'executed' in item ? item.executed : item.done).length;
  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/10 px-3 py-2 text-sm text-[var(--color-info)] flex items-start gap-2">
        <FileText className="h-4 w-4 mt-0.5 shrink-0" />
        {variant === 'signature'
          ? 'Confira com o cliente os dados abaixo antes de coletar a assinatura.'
          : 'Confira os dados finais. Ao concluir, o PDF oficial será gerado e ficará disponível para baixar ou compartilhar.'}
      </div>
      <SummaryRow icon={<Building2 className="h-4 w-4" />} label="Cliente" value={customer?.name} />
      <SummaryRow icon={<FileText className="h-4 w-4" />} label="Documento" value={DOCUMENT_KIND_LABEL[documentType]} />
      <SummaryRow icon={<MapPin className="h-4 w-4" />} label="Endereço" value={address?.label} />
      <SummaryRow
        icon={<Wrench className="h-4 w-4" />}
        label="Equipamentos"
        value={
          equipments.length ? equipments.map((item) => item.name).join(', ') : 'Sem equipamento'
        }
      />
      <SummaryRow
        icon={<ClipboardList className="h-4 w-4" />}
        label="Tipo"
        value={serviceType ? serviceTypeLabel(serviceType) : undefined}
      />
      <SummaryRow
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Checklist"
        value={`${done}/${displayedChecklist.length} concluídos${documentType === 'TECHNICAL_REPORT' ? ` · ${maintenanceType === 'WEEKLY' ? 'Semanal' : 'Semestral'}` : ''}`}
      />
      <SummaryRow icon={<Camera className="h-4 w-4" />} label="Fotos" value={`${photoCount}`} />
      {showSignature && (
        <SummaryRow
          icon={<PenLine className="h-4 w-4" />}
          label="Assinatura técnica"
          value={technicalSignatureSelected ? 'Minha assinatura selecionada' : 'Pendente'}
          tone={technicalSignatureSelected ? 'success' : 'warning'}
        />
      )}
      {showSignature && (
        <SummaryRow
          icon={<PenLine className="h-4 w-4" />}
          label="Assinatura"
          value={signed ? `Coletada · ${signerName?.trim() ?? ''}${signerRole?.trim() ? ` (${signerRole.trim()})` : ''}${signedAt ? ` · ${new Date(signedAt).toLocaleString('pt-BR')}` : ''}` : 'Pendente'}
          tone={signed ? 'success' : 'warning'}
        />
      )}
      {(reportedIssue || serviceDescription || observations) && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
          <div className="text-caption uppercase tracking-wider mb-2">{documentType === 'WORK_ORDER' ? 'Conteúdo da Ordem de Serviço' : 'Conteúdo do Relatório de Visita Técnica'}</div>
          {reportedIssue && <p className="text-sm whitespace-pre-wrap"><strong>Solicitação:</strong> {reportedIssue}</p>}
          {serviceDescription && <p className="mt-2 text-sm whitespace-pre-wrap"><strong>Serviços:</strong> {serviceDescription}</p>}
          {observations && <p className="mt-2 text-sm whitespace-pre-wrap"><strong>Resultado:</strong> {observations}</p>}
        </div>
      )}
    </div>
  );
}

function triggerDownload(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function OperatorDocumentSuccessView({
  documentId,
  documentNumber,
  documentType,
  onDone,
  onDocuments,
  onNew,
}: {
  documentId: string;
  documentNumber: string;
  documentType: DocumentKind;
  onDone: () => void;
  onDocuments: () => void;
  onNew: () => void;
}) {
  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchPdf(): Promise<File> {
    const { blob, filename } = await documentsApi.downloadDocument(documentId);
    return new File([blob], filename ?? `${documentNumber}.pdf`, { type: 'application/pdf' });
  }

  async function share() {
    setBusy('share');
    setError(null);
    try {
      const file = await fetchPdf();
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], title: documentNumber, text: `${DOCUMENT_KIND_LABEL[documentType]} ${documentNumber}` });
      } else {
        triggerDownload(file);
        setError('Este navegador não abre o compartilhamento nativo; o PDF foi baixado para compartilhar manualmente.');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof ApiClientError ? cause.message : 'Não foi possível obter o PDF. Tente novamente ou abra em Documentos.');
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy('download');
    setError(null);
    try {
      triggerDownload(await fetchPdf());
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Não foi possível baixar o PDF. Tente novamente ou abra em Documentos.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center p-6 text-center">
      <div className="max-w-xs">
        <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/12 grid place-items-center text-[var(--color-success)]">
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h1 className="text-section-title mt-4">Atendimento concluído</h1>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 px-3 py-1 text-sm font-medium text-[var(--color-primary)]">
          <FileText className="h-4 w-4" /> {documentNumber}
        </p>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
          {DOCUMENT_KIND_LABEL[documentType]} concluído e PDF oficial gerado. Compartilhe ou baixe agora mesmo com o cliente.
        </p>
        {error && (
          <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-left text-xs text-[var(--color-warning)]">{error}</p>
        )}
        <div className="mt-6 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void share()}
              disabled={busy !== null}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] h-12 text-sm font-semibold active:scale-[0.99] disabled:opacity-60"
            >
              {busy === 'share' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Compartilhar
            </button>
            <button
              type="button"
              onClick={() => void download()}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 h-12 text-sm font-medium hover:bg-[var(--color-muted)] disabled:opacity-60"
            >
              {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar
            </button>
          </div>
          <button
            type="button"
            onClick={onDocuments}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] h-12 text-sm font-medium hover:bg-[var(--color-muted)]"
          >
            Ver em Documentos
          </button>
          <button
            type="button"
            onClick={onNew}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] h-12 text-sm font-medium hover:bg-[var(--color-muted)]"
          >
            Novo atendimento
          </button>
          <button
            type="button"
            onClick={onDone}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] h-12 text-sm font-medium hover:bg-[var(--color-muted)]"
          >
            Voltar ao início
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */

function PickRow({
  active,
  onClick,
  icon,
  title,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 rounded-[var(--radius-md)] border p-3.5 transition active:scale-[0.99] ${active ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
    >
      <span className="h-9 w-9 rounded-[var(--radius-md)] bg-[var(--color-muted)] grid place-items-center text-[var(--color-muted-foreground)] shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium truncate">{title}</span>
        <span className="block text-caption truncate">{subtitle}</span>
      </span>
      {badge && <StatusChip tone="warning">{badge}</StatusChip>}
      {active ? (
        <Check className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
      ) : (
        <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)] shrink-0" />
      )}
    </button>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <span className="text-[var(--color-muted-foreground)]">{icon}</span>
      <span className="text-caption w-24 shrink-0">{label}</span>
      <span
        className={`text-sm font-medium flex-1 text-right truncate ${tone === 'success' ? 'text-[var(--color-success)]' : tone === 'warning' ? 'text-[var(--color-warning)]' : ''}`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}
