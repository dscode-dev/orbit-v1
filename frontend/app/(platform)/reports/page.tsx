'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardCheck,
  Check,
  FileCheck2,
  FileText,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { PageHeader } from '@platform/components/page-header';
import { Pagination } from '@platform/components/pagination';
import { OperationCreationDrawer } from '@platform/components/operation-creation-drawer';
import { DocumentHandoffInbox } from '@platform/components/document-handoff-inbox';
import {
  ApiClientError,
  budgetsApi,
  customersApi,
  documentsApi,
  equipmentsApi,
  operationApi,
  pmocApi,
  salesApi,
  signaturesApi,
  technicalCatalogsApi,
  usersApi,
  useQuery,
  type Customer,
  type CustomerAddress,
  type CustomerDetail,
  type DocumentCatalogItem,
  type DocumentConfiguration,
  type DocumentHandoff,
  type DocumentKind,
  type EquipmentSummary,
  type MaintenanceChecklistTemplate,
  type OperationDetail,
  type OperationMaintenanceType,
  type OperationSummary,
  type Paginated,
  type PmocPlan,
  type CreateOperationPayload,
  type Signature,
  type Sale,
  type TeamUser,
  type TechnicalCatalogArea,
} from '@erp/api';
import { Gate } from '@erp/ui/auth/gate';
import { useAuth } from '@erp/ui/auth/auth-provider';
import { Drawer } from '@erp/ui/drawer';
import { EmptyState } from '@erp/ui/empty-state';
import { StatusChip } from '@erp/ui/status-chip';
import { SkeletonCard } from '@erp/ui/skeletons';
import { DocumentViewer } from '@erp/ui/documents/document-viewer';
import { SignaturePad } from '@erp/ui/documents/signature-pad';
import { MultiSelect } from '@erp/ui/multi-select';
import { TechnicalCatalogSelector } from '@erp/ui/technical-catalog/technical-catalog-selector';
import { DOCUMENT_KIND_LABEL } from '@erp/types';
import {
  brlAmountInWords,
  formatBrl,
  formatDate,
  parseBrl,
  useDebounce,
  useLocalDraft,
} from '@erp/utils';

const REPORT_TYPES: Array<{
  type: DocumentKind;
  title: string;
  description: string;
  icon: typeof FileText;
}> = [
  {
    type: 'WORK_ORDER',
    title: 'Ordem de Serviço',
    description: 'Emitida exclusivamente a partir de uma Operation existente.',
    icon: ClipboardCheck,
  },
  {
    type: 'TECHNICAL_REPORT',
    title: 'Relatório de Visita Técnica',
    description: 'Visita, equipamentos, atividades, observações e assinaturas.',
    icon: FileText,
  },
  {
    type: 'TECHNICAL_OPINION',
    title: 'Laudo Técnico',
    description: 'Diagnóstico, análise, conclusão e responsabilidade técnica.',
    icon: FileCheck2,
  },
  {
    type: 'PMOC',
    title: 'PMOC',
    description: 'Plano, ambientes, checklist, medições e pendências operacionais.',
    icon: ShieldCheck,
  },
  {
    type: 'RECEIPT',
    title: 'Recibo',
    description: 'Referência, valor recebido, observações e assinatura.',
    icon: ReceiptText,
  },
];

type WorkflowForm = {
  workOrderSource: '' | 'EXISTING' | 'NEW';
  receiptSource: '' | 'MANUAL' | 'OPERATION' | 'SALE';
  saleId: string;
  operationId: string;
  customerId: string;
  addressId: string;
  equipmentId: string;
  operatorId: string;
  pmocId: string;
  pmocMode: '' | 'EXISTING' | 'NEW';
  pmocEquipmentIds: string[];
  pmocResponsible: string;
  pmocStartDate: string;
  pmocEndDate: string;
  pmocObservations: string;
  pmocCoverage: string;
  pmocPeriodicity: import('@erp/types').PmocPeriodicity;
  pmocGenerationMode: import('@erp/types').PmocGenerationMode;
  pmocDefaultOperatorId: string;
  pmocDefaultTechnicianId: string;
  pmocSignatureOverrideId: string;
  pmocExecutionRequestId: string;
  pmocRecurrenceFrequency:
    | 'DAILY'
    | 'WEEKLY'
    | 'MONTHLY'
    | 'YEARLY'
    | 'INTERVAL_DAYS'
    | 'INTERVAL_MONTHS';
  pmocRecurrenceInterval: string;
  pmocActive: boolean;
  objective: string;
  objectiveItems: string[];
  diagnosis: string;
  siteConditions: string;
  observations: string;
  analysis: string;
  recommendations: string;
  conclusion: string;
  conclusionItems: string[];
  technicalResponsible: string;
  technicalCrea: string;
  technicalSignatureId: string;
  reference: string;
  amount: string;
  receivedFrom: string;
  receiptNumber: string;
  receiptDate: string;
  receiptAmountInWords: string;
  receiptDescription: string;
  receiptWarrantyPreset: 'NONE' | '30' | '60' | '90' | '180' | '365' | 'CUSTOM';
  receiptWarrantyDays: string;
  receiptDeclaration: string;
  receiptDeclarationEdited: boolean;
  checklist: string;
  signatureData: string | null;
  customerSignerName: string;
  customerSignerRole: string;
  // RVT (TECHNICAL_REPORT): política de assinatura do cliente escolhida pelo owner.
  // COLLECT_LATER = coletar depois (documento fica pendente);
  // HIDDEN = ocultar a assinatura do cliente (somente responsável técnico).
  technicalReportCustomerSignature: 'COLLECT_LATER' | 'HIDDEN';
  photos: Array<{ dataUrl: string; caption: string }>;
  referenceMonth: string;
  referenceYear: string;
  maintenanceType: OperationMaintenanceType;
  maintenanceChecklist: Array<{
    templateId?: string;
    maintenanceType: OperationMaintenanceType;
    description: string;
    executed: boolean;
    result: 'YES' | 'NO' | 'NOT_APPLICABLE';
    equipmentId?: string;
    observations: string;
  }>;
  inspectedEquipments: Array<{
    equipmentId: string;
    sector: string;
    systemType: string;
    currentSituation: string;
  }>;
};

const defaultPmocStart = new Date();
const defaultPmocEnd = new Date(defaultPmocStart);
defaultPmocEnd.setUTCFullYear(defaultPmocEnd.getUTCFullYear() + 1);

function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const emptyForm: WorkflowForm = {
  workOrderSource: '',
  receiptSource: '',
  saleId: '',
  operationId: '',
  customerId: '',
  addressId: '',
  equipmentId: '',
  operatorId: '',
  pmocId: '',
  pmocMode: '',
  pmocEquipmentIds: [],
  pmocResponsible: '',
  pmocStartDate: defaultPmocStart.toISOString().slice(0, 10),
  pmocEndDate: defaultPmocEnd.toISOString().slice(0, 10),
  pmocObservations: '',
  pmocCoverage: '',
  pmocPeriodicity: 'MONTHLY',
  pmocGenerationMode: 'MANUAL',
  pmocDefaultOperatorId: '',
  pmocDefaultTechnicianId: '',
  pmocSignatureOverrideId: '',
  pmocExecutionRequestId: '',
  pmocRecurrenceFrequency: 'MONTHLY',
  pmocRecurrenceInterval: '1',
  pmocActive: true,
  objective: '',
  objectiveItems: [],
  diagnosis: '',
  siteConditions: '',
  observations: '',
  analysis: '',
  recommendations: '',
  conclusion: '',
  conclusionItems: [],
  technicalResponsible: '',
  technicalCrea: '',
  technicalSignatureId: '',
  reference: '',
  amount: '',
  receivedFrom: '',
  receiptNumber: '',
  receiptDate: localDateInputValue(),
  receiptAmountInWords: '',
  receiptDescription: '',
  receiptWarrantyPreset: '90',
  receiptWarrantyDays: '90',
  receiptDeclaration: '',
  receiptDeclarationEdited: false,
  checklist: '',
  signatureData: null,
  customerSignerName: '',
  customerSignerRole: '',
  technicalReportCustomerSignature: 'COLLECT_LATER',
  photos: [],
  referenceMonth: String(new Date().getMonth() + 1),
  referenceYear: String(new Date().getFullYear()),
  maintenanceType: 'SEMIANNUAL',
  maintenanceChecklist: [],
  inspectedEquipments: [],
};

function receiptWarrantyLabel(days: string): string {
  const value = Number(days);
  if (!value) return 'sem garantia';
  if (value === 365) return '1 ano';
  return `${value} ${value === 1 ? 'dia' : 'dias'}`;
}

type ReceiptCustomerIdentity = Pick<Customer, 'name' | 'tradeName' | 'cpf' | 'cnpj'>;

function formatCustomerDocument(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11)
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14)
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
  return value;
}

function receiptCustomerLabel(customer?: ReceiptCustomerIdentity | null): string {
  if (!customer) return '{CLIENTE}';
  const name = customer.tradeName?.trim() || customer.name.trim();
  if (customer.cnpj) return `${name}, CNPJ nº ${formatCustomerDocument(customer.cnpj)}`;
  if (customer.cpf) return `${name}, CPF nº ${formatCustomerDocument(customer.cpf)}`;
  return name;
}

function sentence(value: string): string {
  const normalized = value.trim().replace(/[.;,\s]+$/, '');
  return normalized ? `${normalized}.` : '';
}

function receiptDeclaration(
  form: WorkflowForm,
  customer?: ReceiptCustomerIdentity | null,
): string {
  const amount = parseBrl(form.amount);
  const customerLabel = receiptCustomerLabel(customer);
  const formattedAmount = amount === null ? '{VALOR_NUMÉRICO}' : formatBrl(amount);
  const amountInWords = form.receiptAmountInWords || '{VALOR_EXTENSO}';
  const description = form.receiptDescription.trim() || '{DESCRIÇÃO DOS SERVIÇOS}';
  const first =
    form.receiptSource === 'SALE'
      ? `Recebemos de ${customerLabel} a quantia de ${formattedAmount} (${amountInWords}), correspondente à venda realizada. Descrição da venda: ${sentence(description)}`
      : `Recebemos de ${customerLabel} a quantia de ${formattedAmount} (${amountInWords}), correspondente aos serviços prestados. Descrição dos serviços: ${sentence(description)}`;
  const second = Number(form.receiptWarrantyDays)
    ? `Damos, por este recibo, a devida quitação e garantia de ${receiptWarrantyLabel(form.receiptWarrantyDays)} ${form.receiptSource === 'SALE' ? 'sobre os produtos fornecidos' : 'sobre os serviços prestados'}, contados a partir da data deste documento.`
    : 'Damos, por este recibo, a devida quitação.';
  return `${first}\n\n${second}`;
}

export default function ReportCenterPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const [workflow, setWorkflow] = useState<{
    type: DocumentKind;
    operationId?: string;
    saleId?: string;
  } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === 'RECEIPT' && params.get('saleId'))
      setWorkflow({ type: 'RECEIPT', saleId: params.get('saleId') ?? undefined });
  }, []);
  const [selectedDocument, setSelectedDocument] = useState<DocumentCatalogItem | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<DocumentKind | ''>('');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const documents = useQuery<Paginated<DocumentCatalogItem>>(
    (signal) =>
      documentsApi.listDocuments({
        page,
        limit: 10,
        search: search || undefined,
        type: filterType || undefined,
        signal,
      }),
    [page, search, filterType, tick],
  );
  const supported = new Set(REPORT_TYPES.map((item) => item.type));
  const availableReports = REPORT_TYPES.filter(
    (item) => item.type !== 'RECEIPT' || hasRole('OWNER', 'MANAGER'),
  );
  const items = (documents.data?.items ?? []).filter((item) => supported.has(item.type));
  const metrics = useMemo(
    () => ({
      total: documents.data?.pagination.total ?? 0,
      ready: items.filter((item) => item.editorialStatus === 'READY').length,
      draft: items.filter((item) => item.editorialStatus === 'DRAFT').length,
      rendered: items.filter((item) => item.renderedAt).length,
    }),
    [documents.data, items],
  );

  return (
    <Gate
      permission="canReports"
      fallback={
        <EmptyState
          icon={FileText}
          title="Central de Relatórios indisponível"
          description="Seu perfil não possui acesso ao módulo."
        />
      }
    >
      <div className="space-y-6">
        <PageHeader
          eyebrow="Gestão"
          title="Central de Relatórios"
          description="Emita e acompanhe os documentos oficiais. Os modelos são administrados separadamente em Cadastros."
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Documentos" value={metrics.total} />
          <Metric label="Prontos" value={metrics.ready} />
          <Metric label="Rascunhos" value={metrics.draft} />
          <Metric label="Renderizados na página" value={metrics.rendered} />
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-section-title">Nova emissão</h2>
            <p className="text-caption">
              Escolha o workflow; template, branding e política de assinatura serão resolvidos pelo
              backend.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {availableReports.map(({ type: reportType, title, description, icon: Icon }) => (
              <button
                key={reportType}
                type="button"
                onClick={() => {
                  if (reportType === 'PMOC') {
                    router.push('/pmoc');
                    return;
                  }
                  if (reportType === 'TECHNICAL_REPORT') {
                    router.push('/rvt?create=1');
                    return;
                  }
                  setWorkflow({ type: reportType });
                }}
                className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-primary)]/50 hover:shadow-[var(--shadow-card)]"
              >
                <span className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 p-2 text-[var(--color-primary)]">
                  <Icon className="h-5 w-5" />
                </span>
                <strong className="mt-3 block text-sm">{title}</strong>
                <span className="mt-1 block text-xs text-[var(--color-muted-foreground)]">
                  {description}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)]">
                  <Plus className="h-3.5 w-3.5" /> Iniciar
                </span>
              </button>
            ))}
          </div>
        </section>

        <DocumentHandoffInbox />

        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-section-title">Histórico de emissões</h2>
              <p className="text-caption">Mesmos registros exibidos no repositório Documentos.</p>
            </div>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar número, cliente…"
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
              />
              <select
                value={filterType}
                onChange={(event) => {
                  setFilterType(event.target.value as DocumentKind | '');
                  setPage(1);
                }}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
              >
                <option value="">Todos os tipos</option>
                {REPORT_TYPES.map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {documents.loading ? (
            <SkeletonCard />
          ) : documents.error ? (
            <EmptyState
              icon={RefreshCw}
              title="Falha ao carregar emissões"
              description={String(documents.error)}
              action={<button onClick={documents.refetch}>Tentar novamente</button>}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhuma emissão encontrada"
              description="Inicie um workflow acima para criar o primeiro documento."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-caption">
                      <th className="px-4 py-3">Número</th>
                      <th>Tipo</th>
                      <th>Cliente</th>
                      <th>Equipamento</th>
                      <th>Status</th>
                      <th>Emissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedDocument(item)}
                        className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-muted)]/60"
                      >
                        <td className="px-4 py-3 font-medium">{item.number}</td>
                        <td>{DOCUMENT_KIND_LABEL[item.type]}</td>
                        <td>{item.customer?.name ?? '—'}</td>
                        <td>{item.equipment?.name ?? '—'}</td>
                        <td>
                          {item.editorialStatus === 'DRAFT'
                            ? 'Rascunho'
                            : item.editorialStatus === 'PENDING'
                              ? 'Pendente'
                              : item.editorialStatus === 'READY'
                                ? 'Pronto'
                                : 'Desatualizado'}
                        </td>
                        <td>{formatDate(item.renderedAt ?? item.issuedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {documents.data && (
            <Pagination
              pagination={documents.data.pagination}
              onPageChange={setPage}
              onPageSizeChange={() => undefined}
              pageSizeOptions={[10]}
            />
          )}
        </section>

        {workflow && (
          <ReportWorkflowDrawer
            type={workflow.type}
            initialOperationId={workflow.operationId}
            initialSaleId={workflow.saleId}
            onClose={() => setWorkflow(null)}
            onRendered={() => setTick((value) => value + 1)}
          />
        )}
        <Drawer
          open={Boolean(selectedDocument)}
          onClose={() => setSelectedDocument(null)}
          title={selectedDocument?.number ?? 'Documento'}
          eyebrow="Histórico da emissão"
          width="max-w-[1180px]"
        >
          {selectedDocument && (
            <div className="space-y-4">
              {selectedDocument.origin === 'OPERATION' && selectedDocument.originId && (
                <button
                  type="button"
                  onClick={() => {
                    setWorkflow({
                      type: selectedDocument.type,
                      operationId: selectedDocument.originId ?? undefined,
                    });
                    setSelectedDocument(null);
                  }}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-muted)]"
                >
                  Editar dados de origem
                </button>
              )}
              <DocumentViewer
                source={{ documentId: selectedDocument.id }}
                canRender
                canDownload
                onRendered={() => setTick((value) => value + 1)}
              />
            </div>
          )}
        </Drawer>
      </div>
    </Gate>
  );
}

function ReportWorkflowDrawer({
  type,
  initialOperationId,
  initialSaleId,
  onClose,
  onRendered,
}: {
  type: DocumentKind;
  initialOperationId?: string;
  initialSaleId?: string;
  onClose: () => void;
  onRendered: () => void;
}) {
  const { hasRole, session } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WorkflowForm>(emptyForm);
  const [operation, setOperation] = useState<OperationDetail | null>(null);
  const [handoff, setHandoff] = useState<DocumentHandoff | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  const [equipments, setEquipments] = useState<EquipmentSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [creatingPmoc, setCreatingPmoc] = useState(false);
  const [pmocWorkOrderOpen, setPmocWorkOrderOpen] = useState(false);
  const [pmocWorkOrderPrefill, setPmocWorkOrderPrefill] = useState<CreateOperationPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Rascunho local: protege o formulário de perdas por fechamento acidental.
  // Desligado quando o fluxo já nasce vinculado a uma OS/venda (pré-preenchido).
  const draftEnabled = !initialOperationId && !initialSaleId;
  const draft = useLocalDraft<WorkflowForm>(`reports:new:${type}`, draftEnabled);
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null);
  const [draftMaterialized, setDraftMaterialized] = useState(false);
  const customers = useQuery<Paginated<Customer>>(
    (signal) => customersApi.listCustomers({ page: 1, limit: 100, signal }),
    [],
  );
  const users = useQuery<Paginated<TeamUser>>(
    (signal) => usersApi.listUsers({ page: 1, limit: 100, signal }),
    [],
  );
  const operations = useQuery<Paginated<OperationSummary>>(
    (signal) => operationApi.listOperations({ page: 1, limit: 100, status: 'COMPLETED', signal }),
    [],
  );
  const sales = useQuery<Paginated<Sale>>(
    (signal) => salesApi.listSales({ page: 1, limit: 100, status: 'COMPLETED', signal }),
    [],
  );
  const pmocs = useQuery<Paginated<PmocPlan>>(
    (signal) => pmocApi.listPmoc({ page: 1, limit: 100, active: true, signal }),
    [],
  );
  // RVTs disponíveis para reaproveitar os dados ao criar uma OS.
  const rvts = useQuery(
    (signal) => documentsApi.listDocuments({ type: 'TECHNICAL_REPORT', limit: 40, signal }),
    [],
  );
  const configuration = useQuery<DocumentConfiguration>(
    (signal) => documentsApi.getConfigurationByType(type, { signal }),
    [type],
  );
  const signatures = useQuery<Paginated<Signature>>(
    (signal) => signaturesApi.listSignatures({ page: 1, limit: 100, active: true, signal }),
    [],
  );
  const checklistTemplates = useQuery<MaintenanceChecklistTemplate[]>(
    async (signal) => {
      if (type !== 'TECHNICAL_REPORT' && type !== 'PMOC') return [];
      const page = await technicalCatalogsApi.list({
        page: 1,
        limit: 100,
        type: 'CHECKLIST',
        active: true,
        maintenanceType: type === 'PMOC' ? form.maintenanceType : undefined,
        workflow: type === 'TECHNICAL_REPORT' ? 'TECHNICAL_REPORT' : 'PMOC',
        includeGeneral: type === 'PMOC',
        sortBy: 'sortOrder',
        order: 'asc',
        signal,
      });
      return page.items.map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        maintenanceType: item.maintenanceType!,
        description: item.title,
        active: item.active,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
    },
    [form.maintenanceType, type],
  );
  const isWorkOrder = type === 'WORK_ORDER';

  useEffect(() => {
    // Recibo e RVT usam a assinatura do responsável técnico institucional — pré-seleciona
    // a padrão da organização quando ainda não houver escolha manual.
    if ((type !== 'RECEIPT' && type !== 'TECHNICAL_REPORT') || form.technicalSignatureId) return;
    const available = signatures.data?.items ?? [];
    const selected =
      available.find((item) => item.isDefault && item.active) ??
      (available.filter((item) => item.active).length === 1
        ? available.find((item) => item.active)
        : undefined);
    if (selected) set('technicalSignatureId', selected.id);
  }, [type, signatures.data, form.technicalSignatureId]);

  useEffect(() => {
    if (type !== 'TECHNICAL_REPORT' || !checklistTemplates.data?.length) return;
    const official = checklistTemplates.data.filter(
      (item) => item.maintenanceType === 'WEEKLY' || item.maintenanceType === 'SEMIANNUAL',
    );
    setForm((current) => {
      const keys = new Set(
        current.maintenanceChecklist.map(
          (item) => `${item.maintenanceType}:${item.templateId ?? item.description}`,
        ),
      );
      const missing = official.filter(
        (item) => !keys.has(`${item.maintenanceType}:${item.id}`),
      );
      if (!missing.length) return current;
      return {
        ...current,
        maintenanceChecklist: [
          ...current.maintenanceChecklist,
          ...missing.map((item) => ({
            templateId: item.id,
            maintenanceType: item.maintenanceType,
            description: item.description,
            executed: false,
            result: 'NO' as const,
            observations: '',
          })),
        ],
      };
    });
  }, [checklistTemplates.data, type]);

  useEffect(() => {
    if (
      type !== 'RECEIPT' ||
      form.receiptDeclarationEdited ||
      !form.receiptSource ||
      (form.customerId && !selectedCustomer)
    )
      return;
    set('receiptDeclaration', receiptDeclaration(form, selectedCustomer));
    // Wait for the complete customer record so the automatic text never persists placeholders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    form.receiptSource,
    form.receiptDeclarationEdited,
    form.receiptDescription,
    form.receiptAmountInWords,
    form.receiptWarrantyDays,
    form.amount,
    form.customerId,
    selectedCustomer,
  ]);

  // Restaura o rascunho local uma vez, ao abrir o fluxo em branco.
  useEffect(() => {
    if (!draftEnabled || draftMaterialized) return;
    const stored = draft.read();
    if (stored) {
      setForm(stored.value);
      setRecoveredAt(stored.savedAt);
      draft.markSavedAt(stored.savedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave: persiste o formulário (debounced) enquanto houver conteúdo.
  const debouncedForm = useDebounce(form, 800);
  useEffect(() => {
    if (!draftEnabled || draftMaterialized) return;
    if (JSON.stringify(debouncedForm) === JSON.stringify(emptyForm)) return;
    draft.save(debouncedForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedForm, draftEnabled, draftMaterialized]);

  useEffect(() => {
    if (initialOperationId) void selectOperation(initialOperationId);
    // Initial source is immutable for the drawer lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOperationId]);

  useEffect(() => {
    if (initialSaleId && type === 'RECEIPT') void selectSale(initialSaleId);
    // The linked sale is immutable for this drawer lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSaleId, type]);

  useEffect(() => {
    if (!form.customerId) {
      setAddresses([]);
      setEquipments([]);
      setSelectedCustomer(null);
      return;
    }
    const controller = new AbortController();
    Promise.all([
      customersApi.getCustomer(form.customerId, { signal: controller.signal }),
      equipmentsApi.listEquipments({
        customerId: form.customerId,
        page: 1,
        limit: 100,
        signal: controller.signal,
      }),
    ])
      .then(([customer, equipmentPage]) => {
        setSelectedCustomer(customer);
        setAddresses(customer.addresses);
        setEquipments(equipmentPage.items);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [form.customerId]);

  function set<K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectWorkOrderSource(source: 'EXISTING' | 'NEW') {
    setOperation(null);
    setError(null);
    setForm({ ...emptyForm, workOrderSource: source });
  }

  // Cria uma OS nova pré-preenchida a partir de um RVT (usa a operação de origem).
  async function prefillWorkOrderFromRvt(operationId: string) {
    setOperation(null);
    setError(null);
    try {
      const detail = await operationApi.getOperation(operationId);
      setForm({
        ...emptyForm,
        workOrderSource: 'NEW',
        customerId: detail.customer?.id ?? '',
        addressId: detail.address?.id ?? '',
        operatorId: detail.operator?.id ?? '',
        equipmentId: detail.equipment?.id ?? detail.inspectedEquipments?.[0]?.equipmentId ?? '',
        observations: detail.observations ?? '',
      });
    } catch (cause) {
      setError(message(cause));
    }
  }

  // Cria uma OS nova pré-preenchida a partir de um plano de PMOC.
  // Resolve (ou cria) a execução pendente do plano e usa seu prefill.
  async function prefillWorkOrderFromPmoc(planId: string) {
    setOperation(null);
    setError(null);
    try {
      const plan = await pmocApi.getPmoc(planId);
      let request = plan.executionRequests?.find(
        (item) => item.status === 'PENDING' || item.status === 'FAILED',
      );
      request ??= await pmocApi.createExecutionRequest(planId, {
        notes: 'Solicitação manual criada pela Central de Relatórios.',
      });
      const prefill = await pmocApi.getExecutionRequestPrefill(request.id);
      setForm({
        ...emptyForm,
        workOrderSource: 'NEW',
        customerId: prefill.customerId ?? '',
        addressId: prefill.addressId ?? '',
        operatorId: prefill.operatorId ?? '',
        equipmentId: prefill.equipmentId ?? prefill.inspectedEquipments?.[0]?.equipmentId ?? '',
        observations: prefill.observations ?? '',
      });
    } catch (cause) {
      setError(message(cause));
    }
  }

  function selectReceiptSource(source: 'MANUAL' | 'OPERATION' | 'SALE') {
    setOperation(null);
    setHandoff(null);
    setError(null);
    setForm({
      ...emptyForm,
      receiptSource: source,
      operatorId: source === 'MANUAL' ? (session?.user.id ?? '') : '',
    });
  }

  async function selectSale(id: string) {
    set('saleId', id);
    if (!id) return;
    setError(null);
    try {
      const prefill = await salesApi.getReceiptPrefill(id);
      const amount = Number(prefill.amount);
      setForm((current) => {
        const next: WorkflowForm = {
          ...current,
          receiptSource: 'SALE',
          saleId: prefill.saleId,
          customerId: prefill.customer.id,
          addressId: prefill.address?.id ?? '',
          receiptNumber: prefill.receiptNumber,
          receiptDate: prefill.issuedAt.slice(0, 10),
          amount: amount.toFixed(2).replace('.', ','),
          receiptAmountInWords: brlAmountInWords(amount),
          receiptDescription: prefill.description || prefill.service,
          receiptWarrantyPreset: 'CUSTOM',
          receiptWarrantyDays: prefill.warrantyDays ? String(prefill.warrantyDays) : '',
          receiptDeclaration: '',
          receiptDeclarationEdited: false,
        };
        return {
          ...next,
          receiptDeclaration: receiptDeclaration(next, prefill.customer),
        };
      });
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function selectOperation(id: string) {
    set('operationId', id);
    setError(null);
    if (!id) {
      setOperation(null);
      return;
    }
    try {
      const detail = await operationApi.getOperation(id);
      const receiptBudget =
        type === 'RECEIPT'
          ? (
              await budgetsApi.listOperationBudgets(id, {
                page: 1,
                limit: 20,
                status: 'APPROVED',
              })
            ).items[0]
          : null;
      // O valor do Recibo vem do valor do serviço da própria OS; se a OS não
      // tiver valor, usa o total de um orçamento aprovado vinculado.
      const serviceValue =
        detail.serviceValue != null && detail.serviceValue !== "" ? Number(detail.serviceValue) : null;
      const receiptAmount =
        serviceValue && serviceValue > 0
          ? serviceValue
          : receiptBudget
            ? Number(receiptBudget.total)
            : null;
      const receiptDescription =
        [detail.serviceDescription, detail.observations].filter(Boolean).join('\n') || '';
      setOperation(detail);
      setForm((current) => ({
        ...current,
        workOrderSource: 'EXISTING',
        customerId: detail.customer?.id ?? '',
        addressId: detail.address?.id ?? '',
        equipmentId: detail.equipment?.id ?? '',
        operatorId: detail.operator?.id ?? '',
        ...(type === 'RECEIPT'
          ? {
              receiptSource: 'OPERATION' as const,
              receiptNumber:
                detail.receiptNumber ?? `REC-${String(detail.number).padStart(6, '0')}`,
              // A emissão do Recibo é um novo ato documental. A data da OS serve
              // apenas como origem dos dados e nunca como data de emissão.
              receiptDate: localDateInputValue(),
              amount: receiptAmount === null ? '' : receiptAmount.toFixed(2).replace('.', ','),
              receiptAmountInWords: receiptAmount === null ? '' : brlAmountInWords(receiptAmount),
              receiptDescription:
                detail.receiptDescription ||
                receiptDescription ||
                detail.receiptService ||
                'Serviços técnicos prestados',
              receiptWarrantyPreset: '90' as const,
              receiptWarrantyDays: '90',
              receiptDeclaration: '',
              receiptDeclarationEdited: false,
            }
          : {}),
        objective: detail.reportedIssue ?? '',
        diagnosis: detail.technicalDiagnosis ?? '',
        observations: detail.observations ?? '',
        analysis: detail.serviceDescription ?? '',
        recommendations: detail.technicalRecommendations ?? '',
        ...(type === 'TECHNICAL_OPINION'
          ? {
              objective: detail.technicalOpinionObjective ?? '',
              objectiveItems: detail.technicalOpinionObjectiveItems ?? [],
              siteConditions: detail.technicalOpinionConditions ?? '',
              analysis: detail.technicalOpinionAnalysis ?? '',
              conclusion: detail.technicalOpinionConclusion ?? '',
              conclusionItems: detail.technicalOpinionConclusionItems ?? [],
              recommendations: detail.technicalOpinionRecommendations ?? '',
              technicalResponsible: detail.technicalOpinionResponsible ?? '',
              technicalCrea: detail.technicalOpinionCrea ?? '',
            }
          : {}),
        checklist: detail.checklist
          .map(
            (item) =>
              `${item.done ? '[x]' : '[ ]'} ${item.label}${item.note ? ` | ${item.note}` : ''}`,
          )
          .join('\n'),
        referenceMonth: detail.referenceMonth
          ? String(detail.referenceMonth)
          : current.referenceMonth,
        referenceYear: detail.referenceYear ? String(detail.referenceYear) : current.referenceYear,
        maintenanceType: detail.maintenanceType ?? current.maintenanceType,
        maintenanceChecklist: detail.maintenanceChecklistItems.map((item) => ({
          equipmentId: item.equipmentId ?? undefined,
          maintenanceType: item.maintenanceType,
          description: item.description,
          executed: item.executed,
          result: item.result ?? (item.executed ? 'YES' : 'NO'),
          observations: item.observations ?? '',
        })),
        inspectedEquipments: detail.inspectedEquipments.map((item) => ({
          equipmentId: item.equipmentId,
          sector: item.sector,
          systemType: item.systemTypeSnapshot ?? '',
          currentSituation: item.currentSituationSnapshot ?? '',
        })),
      }));
    } catch (cause) {
      setError(message(cause));
    }
  }

  function applyPmocPlan(plan: PmocPlan) {
    const recurrence = plan.maintenancePlan?.recurrenceRule as
      | { frequency?: WorkflowForm['pmocRecurrenceFrequency']; interval?: number }
      | undefined;
    setForm((current) => ({
      ...current,
      pmocId: plan.id,
      pmocMode: 'EXISTING',
      pmocEquipmentIds: plan.equipments?.length
        ? plan.equipments.map((item) => item.equipmentId)
        : [plan.equipmentId],
      pmocResponsible: plan.responsibleTechnician,
      pmocStartDate: plan.startDate.slice(0, 10),
      pmocEndDate: plan.endDate.slice(0, 10),
      pmocObservations: plan.observations ?? '',
      pmocCoverage: plan.coverage ?? '',
      pmocPeriodicity: plan.periodicity,
      pmocGenerationMode: plan.generationMode,
      pmocDefaultOperatorId: plan.defaultOperatorId ?? '',
      pmocDefaultTechnicianId: plan.defaultTechnicianId ?? '',
      pmocSignatureOverrideId: plan.signatureOverrideId ?? '',
      pmocExecutionRequestId:
        plan.executionRequests?.find(
          (item) => item.status === 'PENDING' || item.status === 'FAILED',
        )?.id ??
        plan.executionRequests?.find((item) => item.status === 'GENERATED')?.id ??
        '',
      pmocRecurrenceFrequency: recurrence?.frequency ?? 'MONTHLY',
      pmocRecurrenceInterval: String(recurrence?.interval ?? 1),
      pmocActive: plan.active,
      customerId: plan.customerId,
      equipmentId: plan.equipmentId,
      inspectedEquipments: (plan.equipments?.length
        ? plan.equipments
        : [{ equipmentId: plan.equipmentId, equipment: plan.equipment }]
      ).map((item) => ({
        equipmentId: item.equipmentId,
        sector: item.equipment?.name ?? 'Não informado',
        systemType: '',
        currentSituation: '',
      })),
      objective: `Execução do plano PMOC ${plan.maintenancePlan?.name ?? plan.contractNumber ?? plan.id}`,
      observations: plan.observations ?? current.observations,
    }));
    const generated = plan.executionRequests?.find(
      (item) => item.status === 'GENERATED' && item.operationId,
    );
    if (generated?.operationId) {
      void operationApi
        .getOperation(generated.operationId)
        .then(setOperation)
        .catch(() => undefined);
    } else {
      setOperation(null);
    }
  }

  async function selectPmoc(id: string) {
    set('pmocId', id);
    if (!id) return;
    try {
      const plan = pmocs.data?.items.find((item) => item.id === id) ?? (await pmocApi.getPmoc(id));
      applyPmocPlan(plan);
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function createPmocPlan() {
    setCreatingPmoc(true);
    setError(null);
    try {
      if (!form.customerId || !form.operatorId)
        throw new Error('Selecione o cliente e o responsável pela futura Ordem de Serviço.');
      if (form.pmocEquipmentIds.length === 0)
        throw new Error('Selecione ao menos um equipamento controlado pelo PMOC.');
      if (!form.pmocResponsible.trim()) throw new Error('Informe o responsável técnico do PMOC.');
      const activeCoverage = await pmocApi.getActiveCoverage(form.customerId);
      if (
        activeCoverage.hasActiveCoverage &&
        !window.confirm(
          `Este cliente já possui cobertura PMOC ativa:\n\n${activeCoverage.conflicts
            .map(
              (item) =>
                `PMOC-${String(item.number).padStart(6, '0')} · ${item.name} · até ${formatDate(item.endDate)}`,
            )
            .join('\n')}\n\nDeseja realmente criar outro PMOC?`,
        )
      )
        return;
      const created = await pmocApi.createPmoc({
        customerId: form.customerId,
        confirmActiveCoverage: activeCoverage.hasActiveCoverage || undefined,
        equipmentId: form.pmocEquipmentIds[0],
        equipmentIds: form.pmocEquipmentIds,
        responsibleTechnician: form.pmocResponsible,
        coverage: form.pmocCoverage || undefined,
        periodicity: form.pmocPeriodicity,
        generationMode: form.pmocGenerationMode,
        defaultOperatorId: form.pmocDefaultOperatorId || undefined,
        defaultTechnicianId: form.pmocDefaultTechnicianId || undefined,
        signatureOverrideId: form.pmocSignatureOverrideId || undefined,
        startDate: form.pmocStartDate,
        endDate: form.pmocEndDate,
        observations: form.pmocObservations || undefined,
        priority: 'HIGH',
        recurrenceRule:
          form.pmocPeriodicity === 'CUSTOM'
            ? {
                frequency: form.pmocRecurrenceFrequency,
                interval: Number(form.pmocRecurrenceInterval || 1),
              }
            : undefined,
        active: form.pmocActive,
      });
      applyPmocPlan(created);
      pmocs.refetch();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setCreatingPmoc(false);
    }
  }

  async function updatePmocPlan() {
    if (!form.pmocId) return;
    setCreatingPmoc(true);
    setError(null);
    try {
      const updated = await pmocApi.updatePmoc(form.pmocId, {
        equipmentIds: form.pmocEquipmentIds,
        responsibleTechnician: form.pmocResponsible,
        coverage: form.pmocCoverage || null,
        periodicity: form.pmocPeriodicity,
        generationMode: form.pmocGenerationMode,
        defaultOperatorId: form.pmocDefaultOperatorId || null,
        defaultTechnicianId: form.pmocDefaultTechnicianId || null,
        signatureOverrideId: form.pmocSignatureOverrideId || null,
        startDate: form.pmocStartDate,
        endDate: form.pmocEndDate,
        observations: form.pmocObservations || null,
        recurrenceRule:
          form.pmocPeriodicity === 'CUSTOM'
            ? {
                frequency: form.pmocRecurrenceFrequency,
                interval: Number(form.pmocRecurrenceInterval || 1),
              }
            : undefined,
        active: form.pmocActive,
      });
      applyPmocPlan(updated);
      pmocs.refetch();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setCreatingPmoc(false);
    }
  }

  async function deletePmocPlan() {
    if (!form.pmocId) return;
    if (!window.confirm('Deseja realmente remover este plano PMOC?')) return;
    setCreatingPmoc(true);
    setError(null);
    try {
      await pmocApi.deletePmoc(form.pmocId);
      setForm((current) => ({
        ...current,
        pmocId: '',
        pmocMode: '',
        customerId: '',
        equipmentId: '',
        pmocEquipmentIds: [],
        inspectedEquipments: [],
      }));
      pmocs.refetch();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setCreatingPmoc(false);
    }
  }

  async function openPmocWorkOrderWizard() {
    if (!form.pmocId) return;
    setCreatingPmoc(true);
    setError(null);
    try {
      const plan = await pmocApi.getPmoc(form.pmocId);
      const generated = plan.executionRequests?.find(
        (item) => item.status === 'GENERATED' && item.operationId,
      );
      if (generated?.operationId) {
        const detail = await operationApi.getOperation(generated.operationId);
        setOperation(detail);
        set('operationId', detail.id);
        return;
      }
      let request = plan.executionRequests?.find(
        (item) => item.status === 'PENDING' || item.status === 'FAILED',
      );
      request ??= await pmocApi.createExecutionRequest(form.pmocId, {
        notes: 'Solicitação manual criada pela Central de Relatórios.',
      });
      const prefill = await pmocApi.getExecutionRequestPrefill(request.id);
      set('pmocExecutionRequestId', request.id);
      setPmocWorkOrderPrefill(prefill);
      setPmocWorkOrderOpen(true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setCreatingPmoc(false);
    }
  }

  async function submitPmocWorkOrder(payload: CreateOperationPayload): Promise<OperationDetail> {
    if (!form.pmocExecutionRequestId) {
      throw new Error('A solicitação de execução do PMOC não foi encontrada.');
    }
    const request = await pmocApi.generateWorkOrder(form.pmocExecutionRequestId, payload);
    if (!request.operationId) throw new Error('A Ordem de Serviço não foi vinculada pelo backend.');
    const detail = await operationApi.getOperation(request.operationId);
    setOperation(detail);
    set('operationId', detail.id);
    setPmocWorkOrderOpen(false);
    await pmocs.refetch();
    return detail;
  }

  async function createChecklistTemplate(description: string) {
    const created = await technicalCatalogsApi.create({
      type: 'CHECKLIST',
      title: description,
      description: null,
      tags:
        type === 'TECHNICAL_REPORT'
          ? ['rvt', 'manutencao', form.maintenanceType.toLowerCase()]
          : ['manutencao'],
      areas: ['GENERAL', 'HVAC'],
      workflows:
        type === 'TECHNICAL_REPORT' ? ['TECHNICAL_REPORT'] : ['WORK_ORDER', 'PMOC'],
      maintenanceType: form.maintenanceType,
      active: true,
    });
    await checklistTemplates.refetch();
    return {
      id: created.id,
      organizationId: created.organizationId,
      maintenanceType: created.maintenanceType!,
      description: created.title,
      active: created.active,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async function preparePreview() {
    setBusy(true);
    setError(null);
    try {
      let detail = operation;
      if (type === 'RECEIPT') {
        if (!form.receiptSource) throw new Error('Escolha a origem do Recibo.');
        if (form.receiptSource === 'OPERATION' && !form.operationId)
          throw new Error('Selecione uma Ordem de Serviço concluída.');
        if (form.receiptSource === 'SALE' && !form.saleId)
          throw new Error('Selecione uma venda concluída.');
        if (!form.customerId || !form.addressId)
          throw new Error('Cliente e endereço são obrigatórios.');
        if (!form.receiptDate || parseBrl(form.amount) === null)
          throw new Error('Informe uma data e um valor monetário válido.');
        if (
          !form.receiptAmountInWords.trim() ||
          !form.receiptDescription.trim() ||
          !form.receiptDeclaration.trim()
        )
          throw new Error('Preencha os dados e a declaração do Recibo.');
        if (!form.technicalSignatureId)
          throw new Error('Selecione a assinatura do responsável técnico.');
        if (form.receiptSource === 'OPERATION') {
          detail = detail ?? (await operationApi.getOperation(form.operationId));
          if (detail.status !== 'COMPLETED')
            throw new Error('Somente Ordens de Serviço concluídas podem originar um Recibo.');
        }
        const content = contentFor(type, form);
        if (detail) detail = await operationApi.updateOperation(detail.id, content);
        else {
          detail = await operationApi.createOperation({
            customerId: form.customerId,
            sourceSaleId: form.receiptSource === 'SALE' ? form.saleId : null,
            addressId: form.addressId,
            equipmentId: null,
            operatorId: form.operatorId || session?.user.id,
            type: 'PROJETO',
            documentType: 'RECEIPT',
            status: 'DRAFT',
            ...content,
          });
        }
      } else if (isWorkOrder && form.workOrderSource === 'EXISTING') {
        if (!form.operationId)
          throw new Error('Selecione uma Operation para emitir a Ordem de Serviço.');
        detail = detail ?? (await operationApi.getOperation(form.operationId));
      } else {
        if (isWorkOrder && form.workOrderSource !== 'NEW')
          throw new Error('Escolha se deseja usar uma Operation ou criar a OS do zero.');
        if (!form.customerId || !form.operatorId)
          throw new Error('Cliente e responsável são obrigatórios.');
        if (type === 'TECHNICAL_OPINION') {
          if (!form.technicalResponsible.trim() || !form.technicalCrea.trim())
            throw new Error('Responsável Técnico e CREA/registro profissional são obrigatórios.');
          if (form.inspectedEquipments.length === 0)
            throw new Error('Selecione ao menos um equipamento para o Laudo Técnico.');
          if (!form.objective.trim() || !form.conclusion.trim())
            throw new Error(
              'Informe o esclarecimento principal do técnico para o objetivo e a conclusão.',
            );
          if (
            form.inspectedEquipments.some(
              (item) =>
                !item.sector.trim() || !item.systemType.trim() || !item.currentSituation.trim(),
            )
          )
            throw new Error(
              'Informe tipo de sistema, local de instalação e situação atual de todos os equipamentos.',
            );
        }
        if (type === 'PMOC') {
          if (!form.pmocId) throw new Error('Selecione um plano PMOC ativo.');
          if (!detail)
            throw new Error('Gere ou abra a Ordem de Serviço vinculada antes de continuar.');
          if (form.inspectedEquipments.length === 0)
            throw new Error('Selecione ao menos um equipamento controlado pelo PMOC.');
          if (form.signatureData && !form.customerSignerName.trim())
            throw new Error('Informe o nome do cliente ou responsável que assinou o PMOC.');
        }
        const content = contentFor(type, form);
        if (detail) {
          detail = await operationApi.updateOperation(detail.id, content);
        } else {
          detail = await operationApi.createOperation({
            customerId: form.customerId,
            addressId: form.addressId || null,
            equipmentId:
              (type === 'WORK_ORDER' || type === 'TECHNICAL_OPINION'
                ? form.inspectedEquipments[0]?.equipmentId
                : null) ||
              form.equipmentId ||
              null,
            operatorId: form.operatorId,
            type: operationTypeFor(type),
            documentType: type,
            status: 'DRAFT',
            ...content,
          });
        }
      }
      setOperation(detail);
      set('operationId', detail.id);
      let documentDraft = await documentsApi.saveHandoffDraft(detail.id, type);
      if (form.signatureData && form.customerSignerName.trim()) {
        documentDraft = await documentsApi.collectCustomerSignature(documentDraft.id, {
          signerName: form.customerSignerName.trim(),
          signerRole: form.customerSignerRole.trim() || undefined,
          signatureData: form.signatureData,
          collectedAt: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife',
        });
      }
      if (form.technicalSignatureId) {
        documentDraft = await documentsApi.selectHandoffTechnicalSignature(
          documentDraft.id,
          form.technicalSignatureId,
        );
      }
      // RVT: quando o owner opta por ocultar a assinatura do cliente, o documento
      // não exige coleta e o bloco do cliente não vai ao PDF (apenas oculta).
      if (type === 'TECHNICAL_REPORT') {
        documentDraft = await documentsApi.setCustomerSignatureVisibility(
          documentDraft.id,
          form.technicalReportCustomerSignature === 'HIDDEN',
        );
      }
      setHandoff(documentDraft);
      setStep(type === 'RECEIPT' ? 4 : 3);
      // O registro já existe no backend — o rascunho local não é mais necessário.
      // Desativa também o autosave; sem isso, o próximo debounce recriava a chave apagada.
      setDraftMaterialized(true);
      draft.clear();
      setRecoveredAt(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const steps =
    type === 'RECEIPT'
      ? ['Origem', 'Dados do recibo', 'Garantia', 'Assinatura técnica', 'Preview']
      : [
          'Origem',
          'Conteúdo',
          type === 'TECHNICAL_OPINION' ? 'Assinatura' : 'Evidências',
          'Preview',
        ];
  const previewStep = steps.length - 1;
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={DOCUMENT_KIND_LABEL[type]}
        eyebrow="Workflow documental"
        width="max-w-[1240px]"
        footer={
          <>
            <button
              type="button"
              onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm"
            >
              {step > 0 ? 'Voltar' : 'Cancelar'}
            </button>
            {draftEnabled && step < previewStep && (
              <button
                type="button"
                onClick={() => {
                  draft.save(form);
                  onClose();
                }}
                className="mr-auto inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm hover:bg-[var(--color-muted)]"
                title="Salva o que já foi preenchido para continuar depois neste dispositivo."
              >
                Salvar rascunho
                {draft.savedAt && (
                  <span className="text-caption">
                    salvo{' '}
                    {new Date(draft.savedAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </button>
            )}
            {step < previewStep - 1 && (
              <button
                type="button"
                disabled={
                  creatingPmoc ||
                  (type === 'RECEIPT' && step === 0 && !form.receiptSource) ||
                  (type === 'PMOC' && step === 0 && (!form.pmocId || !operation))
                }
                onClick={() => setStep(step + 1)}
                className="h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm text-[var(--color-primary-foreground)] disabled:opacity-50"
              >
                Continuar
              </button>
            )}
            {step === previewStep - 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={preparePreview}
                className="h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm text-[var(--color-primary-foreground)] disabled:opacity-50"
              >
                {busy ? 'Preparando…' : 'Gerar preview'}
              </button>
            )}
          </>
        }
      >
        <div
          className={`mb-5 grid gap-2 ${type === 'RECEIPT' ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-4'}`}
        >
          {steps.map((label, index) => (
            <div
              key={label}
              className={`rounded-[var(--radius-md)] px-3 py-2 text-center text-xs ${index === step ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : index < step ? 'bg-emerald-500/10 text-emerald-700' : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'}`}
            >
              {index + 1}. {label}
            </div>
          ))}
        </div>
        {error && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {recoveredAt && step < previewStep && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <span>
              Rascunho recuperado — salvo em{' '}
              {new Date(recoveredAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
              .
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setForm(emptyForm);
                  setStep(0);
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
        {configuration.loading ? (
          <SkeletonCard />
        ) : configuration.error ? (
          <div className="rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Não existe configuração ativa para este tipo. O backend impedirá a emissão.
          </div>
        ) : (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-xs">
            <strong>Template automático:</strong>{' '}
            {configuration.data?.defaultTemplate?.name ?? 'Não configurado'} ·{' '}
            <strong>Assinatura:</strong>{' '}
            {configuration.data?.defaultTemplate?.signatureMode ?? 'NONE'}
          </div>
        )}
        {step === 0 && (
          <OriginStep
            type={type}
            form={form}
            customers={customers.data?.items ?? []}
            users={users.data?.items ?? []}
            operations={operations.data?.items ?? []}
            sales={sales.data?.items ?? []}
            pmocs={pmocs.data?.items ?? []}
            signatures={signatures.data?.items ?? []}
            addresses={addresses}
            equipments={equipments}
            selectedCustomer={selectedCustomer}
            onSet={set}
            rvts={rvts.data?.items ?? []}
            onPrefillWorkOrderFromRvt={prefillWorkOrderFromRvt}
            onPrefillWorkOrderFromPmoc={prefillWorkOrderFromPmoc}
            onWorkOrderSource={selectWorkOrderSource}
            onReceiptSource={selectReceiptSource}
            onOperation={selectOperation}
            onSale={selectSale}
            onPmoc={selectPmoc}
            canCreatePmoc={hasRole('OWNER', 'MANAGER')}
            creatingPmoc={creatingPmoc}
            onCreatePmoc={createPmocPlan}
            onUpdatePmoc={updatePmocPlan}
            onDeletePmoc={deletePmocPlan}
            onGeneratePmocWorkOrder={openPmocWorkOrderWizard}
            pmocOperation={operation}
          />
        )}
        {type === 'RECEIPT' && step === 1 && (
          <ReceiptDataStep
            form={form}
            customers={customers.data?.items ?? []}
            addresses={addresses}
            customer={selectedCustomer}
            onSet={set}
          />
        )}
        {type === 'RECEIPT' && step === 2 && (
          <ReceiptWarrantyStep
            form={form}
            customer={selectedCustomer}
            onSet={set}
          />
        )}
        {type === 'RECEIPT' && step === 3 && (
          <ReceiptSignatureStep form={form} signatures={signatures.data?.items ?? []} onSet={set} />
        )}
        {type !== 'RECEIPT' && step === 1 && (
          <ContentStep
            type={type}
            form={form}
            equipments={equipments}
            signatures={signatures.data?.items ?? []}
            checklistTemplates={checklistTemplates.data ?? []}
            checklistTemplatesLoading={checklistTemplates.loading}
            canManageChecklist={hasRole('OWNER', 'MANAGER')}
            onCreateChecklist={createChecklistTemplate}
            onSet={set}
          />
        )}
        {type !== 'RECEIPT' && step === 2 && (
          <EvidenceStep
            type={type}
            form={form}
            signatures={signatures.data?.items ?? []}
            onSet={set}
          />
        )}
        {step === previewStep && operation && (
          <div className="space-y-4">
            {handoff && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <div>
                  <strong>
                    {handoff.editorialStatus === 'DRAFT'
                      ? 'Rascunho'
                      : handoff.editorialStatus === 'PENDING'
                        ? 'Revisão pendente'
                        : handoff.editorialStatus === 'READY'
                          ? 'Pronto para emissão'
                          : 'Desatualizado'}
                  </strong>
                  <p className="text-caption">
                    A criação manual utiliza o mesmo ciclo editorial das coletas do Operator.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm"
                    onClick={async () => {
                      try {
                        setHandoff(await documentsApi.startHandoffReview(handoff.id));
                      } catch (cause) {
                        setError(message(cause));
                      }
                    }}
                  >
                    Salvar como pendente
                  </button>
                  <button
                    className="h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm text-[var(--color-primary-foreground)]"
                    onClick={async () => {
                      try {
                        await documentsApi.startHandoffReview(handoff.id);
                        setHandoff(await documentsApi.finalizeHandoffReview(handoff.id));
                        setDraftMaterialized(true);
                        draft.clear();
                        setRecoveredAt(null);
                      } catch (cause) {
                        setError(message(cause));
                      }
                    }}
                  >
                    Finalizar revisão
                  </button>
                </div>
              </div>
            )}
            <DocumentViewer
              source={
                handoff
                  ? { documentId: handoff.id, operationId: operation.id, type }
                  : { operationId: operation.id, type }
              }
              canRender={handoff?.editorialStatus === 'READY'}
              canDownload
              onRendered={() => {
                setDraftMaterialized(true);
                draft.clear();
                setRecoveredAt(null);
                onRendered();
              }}
            />
          </div>
        )}
      </Drawer>
      <OperationCreationDrawer
        open={pmocWorkOrderOpen}
        mode="work-order"
        initialValues={pmocWorkOrderPrefill ?? undefined}
        submitOperation={submitPmocWorkOrder}
        submitLabel="Confirmar e gerar OS"
        contextNotice="Dados preenchidos a partir do PMOC e da execução programada. Revise e confirme; a Ordem de Serviço ficará disponível para gerenciamento normalmente."
        onClose={() => setPmocWorkOrderOpen(false)}
      />
    </>
  );
}

function OriginStep({
  type,
  form,
  customers,
  users,
  operations,
  sales,
  pmocs,
  signatures,
  addresses,
  equipments,
  selectedCustomer,
  onSet,
  rvts,
  onPrefillWorkOrderFromRvt,
  onPrefillWorkOrderFromPmoc,
  onWorkOrderSource,
  onReceiptSource,
  onOperation,
  onSale,
  onPmoc,
  canCreatePmoc,
  creatingPmoc,
  onCreatePmoc,
  onUpdatePmoc,
  onDeletePmoc,
  onGeneratePmocWorkOrder,
  pmocOperation,
}: {
  type: DocumentKind;
  form: WorkflowForm;
  customers: Customer[];
  users: TeamUser[];
  operations: OperationSummary[];
  sales: Sale[];
  pmocs: PmocPlan[];
  signatures: Signature[];
  addresses: CustomerAddress[];
  equipments: EquipmentSummary[];
  selectedCustomer: CustomerDetail | null;
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
  rvts: DocumentCatalogItem[];
  onPrefillWorkOrderFromRvt: (operationId: string) => void;
  onPrefillWorkOrderFromPmoc: (planId: string) => void;
  onWorkOrderSource: (source: 'EXISTING' | 'NEW') => void;
  onReceiptSource: (source: 'MANUAL' | 'OPERATION' | 'SALE') => void;
  onOperation: (id: string) => void;
  onSale: (id: string) => void;
  onPmoc: (id: string) => void;
  canCreatePmoc: boolean;
  creatingPmoc: boolean;
  onCreatePmoc: () => void;
  onUpdatePmoc: () => void;
  onDeletePmoc: () => void;
  onGeneratePmocWorkOrder: () => void;
  pmocOperation: OperationDetail | null;
}) {
  // Origem "extra" da OS: preencher a partir de um RVT ou de um PMOC.
  // Ambos convertem o formulário para o modo NEW já pré-preenchido.
  const [woMode, setWoMode] = useState<'' | 'RVT' | 'PMOC'>('');
  const [woRvtId, setWoRvtId] = useState('');
  const [woPmocId, setWoPmocId] = useState('');

  if (type === 'RECEIPT') {
    const completedWorkOrders = operations.filter(
      (item) => item.status === 'COMPLETED' && item.requestedDocumentType === 'WORK_ORDER',
    );
    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => onReceiptSource('MANUAL')}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${form.receiptSource === 'MANUAL' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">Preenchimento manual</strong>
            <span className="mt-1 block text-caption">
              Cria um Recibo administrativo independente, com todos os campos editáveis.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onReceiptSource('OPERATION')}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${form.receiptSource === 'OPERATION' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">A partir de Ordem de Serviço</strong>
            <span className="mt-1 block text-caption">
              Preenche cliente, endereço, serviço, data e valor disponível; tudo permanece editável.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onReceiptSource('SALE')}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${form.receiptSource === 'SALE' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">A partir de uma venda</strong>
            <span className="mt-1 block text-caption">
              Usa produtos, valor, data e garantia registrados para o cliente.
            </span>
          </button>
        </div>
        {form.receiptSource === 'OPERATION' && (
          <Field label="Ordem de Serviço concluída">
            <select
              value={form.operationId}
              onChange={(event) => void onOperation(event.target.value)}
            >
              <option value="">Selecione…</option>
              {completedWorkOrders.map((item) => (
                <option key={item.id} value={item.id}>
                  OS-{String(item.number).padStart(6, '0')} · {item.customer?.name ?? 'Cliente'}
                </option>
              ))}
            </select>
            {completedWorkOrders.length === 0 && (
              <span className="text-caption">
                Nenhuma Ordem de Serviço concluída foi encontrada.
              </span>
            )}
          </Field>
        )}
        {form.receiptSource === 'MANUAL' && (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-sm">
            Os dados do cliente e do recibo serão informados na próxima etapa.
          </p>
        )}
        {form.receiptSource === 'SALE' && (
          <Field label="Venda concluída">
            <select value={form.saleId} onChange={(event) => void onSale(event.target.value)}>
              <option value="">Selecione…</option>
              {sales.map((sale) => (
                <option key={sale.id} value={sale.id}>
                  V-{String(sale.number).padStart(6, '0')} ·{' '}
                  {sale.customer.tradeName ?? sale.customer.name} · {formatBrl(Number(sale.total))}
                </option>
              ))}
            </select>
            {sales.length === 0 && (
              <span className="text-caption">Nenhuma venda concluída foi encontrada.</span>
            )}
          </Field>
        )}
        {!form.receiptSource && (
          <p className="text-caption">Selecione uma origem para continuar.</p>
        )}
      </div>
    );
  }
  if (type === 'WORK_ORDER')
    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setWoMode('');
              onWorkOrderSource('EXISTING');
            }}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${form.workOrderSource === 'EXISTING' && !woMode ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">Usar Operation existente</strong>
            <span className="mt-1 block text-caption">
              Aproveita cliente, equipamentos, execução, fotos e assinatura já registrados.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setWoMode('');
              onWorkOrderSource('NEW');
            }}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${form.workOrderSource === 'NEW' && !woMode ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">Criar ordem do zero</strong>
            <span className="mt-1 block text-caption">
              Cria uma Operation rascunho oficial e permite preencher todos os dados da OS.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setWoMode('RVT')}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${woMode === 'RVT' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">A partir de um RVT</strong>
            <span className="mt-1 block text-caption">
              Extrai cliente, endereço e equipamentos do Relatório de Visita Técnica; tudo permanece
              editável.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setWoMode('PMOC')}
            className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${woMode === 'PMOC' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
          >
            <strong className="block text-sm">A partir de um PMOC</strong>
            <span className="mt-1 block text-caption">
              Usa a próxima execução pendente do plano para pré-preencher a OS; tudo permanece
              editável.
            </span>
          </button>
        </div>
        {woMode === 'RVT' && (
          <Field label="RVT registrado">
            <select
              value={woRvtId}
              onChange={(event) => {
                const value = event.target.value;
                setWoRvtId(value);
                const item = rvts.find((doc) => doc.id === value);
                if (item?.originId) onPrefillWorkOrderFromRvt(item.originId);
              }}
            >
              <option value="">Selecione…</option>
              {rvts.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.originId}>
                  {item.number} · {item.customer?.name ?? 'Cliente'}
                  {item.equipment?.name ? ` · ${item.equipment.name}` : ''}
                </option>
              ))}
            </select>
            {rvts.length === 0 && (
              <span className="text-caption">Nenhum RVT registrado foi encontrado.</span>
            )}
            {woRvtId && (
              <span className="text-caption">
                Dados do RVT aplicados na OS abaixo. Revise e complete antes de continuar.
              </span>
            )}
          </Field>
        )}
        {woMode === 'PMOC' && (
          <Field label="Plano PMOC">
            <select
              value={woPmocId}
              onChange={(event) => {
                const value = event.target.value;
                setWoPmocId(value);
                if (value) onPrefillWorkOrderFromPmoc(value);
              }}
            >
              <option value="">Selecione…</option>
              {pmocs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.maintenancePlan?.name ??
                    `PMOC-${String(item.number).padStart(6, '0')}`}
                </option>
              ))}
            </select>
            {pmocs.length === 0 && (
              <span className="text-caption">Nenhum plano PMOC ativo foi encontrado.</span>
            )}
            {woPmocId && (
              <span className="text-caption">
                Execução do PMOC aplicada na OS abaixo. Revise e complete antes de continuar.
              </span>
            )}
          </Field>
        )}
        {form.workOrderSource === 'EXISTING' && !woMode && (
          <Field label="Operation oficial">
            <select
              value={form.operationId}
              onChange={(event) => void onOperation(event.target.value)}
            >
              <option value="">Selecione…</option>
              {operations.map((item) => (
                <option key={item.id} value={item.id}>
                  OP-{String(item.number).padStart(6, '0')} · {item.customer?.name ?? 'Cliente'}
                </option>
              ))}
            </select>
          </Field>
        )}
        {form.workOrderSource === 'NEW' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Cliente">
              <select
                value={form.customerId}
                onChange={(event) => {
                  onSet('customerId', event.target.value);
                  onSet('addressId', '');
                  onSet('equipmentId', '');
                  onSet('inspectedEquipments', []);
                }}
              >
                <option value="">Selecione…</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.tradeName ?? item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Endereço">
              <select
                value={form.addressId}
                onChange={(event) => onSet('addressId', event.target.value)}
              >
                <option value="">Endereço principal</option>
                {addresses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name ?? 'Endereço'} · {item.street ?? 'logradouro não informado'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Responsável">
              <select
                value={form.operatorId}
                onChange={(event) => onSet('operatorId', event.target.value)}
              >
                <option value="">Selecione…</option>
                {users
                  .filter((item) => item.isActive)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.role}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        )}
        {!form.workOrderSource && (
          <p className="text-caption">Selecione uma das origens para continuar.</p>
        )}
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {type === 'PMOC' && (
          <div className="order-last space-y-4 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  onSet('pmocMode', 'NEW');
                  onSet('pmocId', '');
                }}
                disabled={!canCreatePmoc}
                className={`rounded-[var(--radius-lg)] border p-4 text-left transition disabled:opacity-50 ${form.pmocMode === 'NEW' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}
              >
                <strong className="block text-sm">Criar novo PMOC</strong>
                <span className="mt-1 block text-caption">
                  Cadastra o plano; ao continuar, o sistema cria a Operation e a OS oficial.
                </span>
              </button>
              <button
                type="button"
                onClick={() => onSet('pmocMode', 'EXISTING')}
                className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${form.pmocMode === 'EXISTING' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}
              >
                <strong className="block text-sm">Selecionar PMOC existente</strong>
                <span className="mt-1 block text-caption">
                  Seleciona, ajusta, desativa ou remove um plano já cadastrado.
                </span>
              </button>
            </div>

            {form.pmocMode === 'EXISTING' && (
              <Field label="Plano PMOC">
                <select value={form.pmocId} onChange={(event) => void onPmoc(event.target.value)}>
                  <option value="">Selecione…</option>
                  {pmocs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.maintenancePlan?.name ?? `PMOC-${String(item.number).padStart(6, '0')}`}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {form.pmocMode === 'EXISTING' && pmocs.length === 0 && (
              <p className="rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                Nenhum plano PMOC ativo foi encontrado. Utilize “Criar novo PMOC”.
              </p>
            )}

            {(form.pmocMode === 'NEW' || (form.pmocMode === 'EXISTING' && form.pmocId)) && (
              <div className="grid gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 md:grid-cols-2">
                <Field label="Responsável técnico do PMOC">
                  <input
                    value={form.pmocResponsible}
                    maxLength={150}
                    onChange={(event) => onSet('pmocResponsible', event.target.value)}
                  />
                </Field>
                <Field label="Periodicidade oficial">
                  <select
                    value={form.pmocPeriodicity}
                    onChange={(event) =>
                      onSet(
                        'pmocPeriodicity',
                        event.target.value as WorkflowForm['pmocPeriodicity'],
                      )
                    }
                  >
                    <option value="WEEKLY">Semanal</option>
                    <option value="BIWEEKLY">Quinzenal</option>
                    <option value="MONTHLY">Mensal</option>
                    <option value="BIMONTHLY">Bimestral</option>
                    <option value="QUARTERLY">Trimestral</option>
                    <option value="FOUR_MONTHLY">Quadrimestral</option>
                    <option value="SEMIANNUAL">Semestral</option>
                    <option value="YEARLY">Anual</option>
                    <option value="CUSTOM">Personalizada</option>
                  </select>
                </Field>
                <MultiSelect
                  label="Equipamentos controlados"
                  options={equipments.map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: item.tag ?? undefined,
                  }))}
                  value={form.pmocEquipmentIds}
                  onChange={(value) => onSet('pmocEquipmentIds', value)}
                  emptyMessage="Selecione primeiro um cliente com equipamentos ativos."
                />
                <Field label="Modo de geração da OS">
                  <select
                    value={form.pmocGenerationMode}
                    onChange={(event) =>
                      onSet(
                        'pmocGenerationMode',
                        event.target.value as WorkflowForm['pmocGenerationMode'],
                      )
                    }
                  >
                    <option value="MANUAL">Manual — revisar antes de gerar</option>
                    <option value="AUTO">Automática — conforme programação</option>
                    <option value="PAUSED">Pausada</option>
                  </select>
                </Field>
                <Field label="Operador padrão (opcional)">
                  <select
                    value={form.pmocDefaultOperatorId}
                    onChange={(event) => onSet('pmocDefaultOperatorId', event.target.value)}
                  >
                    <option value="">Definir na geração</option>
                    {users
                      .filter((item) => item.isActive && item.role !== 'VIEWER')
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.role}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Técnico padrão (opcional)">
                  <select
                    value={form.pmocDefaultTechnicianId}
                    onChange={(event) => onSet('pmocDefaultTechnicianId', event.target.value)}
                  >
                    <option value="">Sem técnico padrão</option>
                    {users
                      .filter((item) => item.isActive && item.role !== 'VIEWER')
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.role}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Assinatura override (opcional)">
                  <select
                    value={form.pmocSignatureOverrideId}
                    onChange={(event) => onSet('pmocSignatureOverrideId', event.target.value)}
                  >
                    <option value="">Política oficial do Template</option>
                    {signatures
                      .filter((item) => item.active)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Início da vigência">
                  <input
                    type="date"
                    value={form.pmocStartDate}
                    onChange={(event) => onSet('pmocStartDate', event.target.value)}
                  />
                </Field>
                <Field label="Fim da vigência">
                  <input
                    type="date"
                    value={form.pmocEndDate}
                    onChange={(event) => onSet('pmocEndDate', event.target.value)}
                  />
                </Field>
                {form.pmocPeriodicity === 'CUSTOM' && (
                  <Field label="Recorrência personalizada">
                    <select
                      value={form.pmocRecurrenceFrequency}
                      onChange={(event) =>
                        onSet(
                          'pmocRecurrenceFrequency',
                          event.target.value as WorkflowForm['pmocRecurrenceFrequency'],
                        )
                      }
                    >
                      <option value="DAILY">Diária</option>
                      <option value="WEEKLY">Semanal</option>
                      <option value="MONTHLY">Mensal</option>
                      <option value="YEARLY">Anual</option>
                      <option value="INTERVAL_DAYS">Intervalo em dias</option>
                      <option value="INTERVAL_MONTHS">Intervalo em meses</option>
                    </select>
                  </Field>
                )}
                {form.pmocPeriodicity === 'CUSTOM' && (
                  <Field label="Intervalo">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={form.pmocRecurrenceInterval}
                      onChange={(event) => onSet('pmocRecurrenceInterval', event.target.value)}
                    />
                  </Field>
                )}
                <div className="md:col-span-2">
                  <Field label="Cobertura do plano">
                    <textarea
                      value={form.pmocCoverage}
                      maxLength={5000}
                      rows={3}
                      onChange={(event) => onSet('pmocCoverage', event.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Observações do plano">
                  <input
                    value={form.pmocObservations}
                    maxLength={5000}
                    onChange={(event) => onSet('pmocObservations', event.target.value)}
                  />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.pmocActive}
                    onChange={(event) => onSet('pmocActive', event.target.checked)}
                  />
                  Plano ativo
                </label>
                {canCreatePmoc && (
                  <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
                    {form.pmocMode === 'EXISTING' && (
                      <button
                        type="button"
                        disabled={creatingPmoc}
                        onClick={onDeletePmoc}
                        className="h-9 rounded-[var(--radius-md)] border border-red-500/40 px-4 text-sm text-red-700 disabled:opacity-50"
                      >
                        Remover plano
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={creatingPmoc}
                      onClick={form.pmocMode === 'NEW' ? onCreatePmoc : onUpdatePmoc}
                      className="h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
                    >
                      {creatingPmoc
                        ? 'Salvando…'
                        : form.pmocMode === 'NEW'
                          ? 'Criar PMOC'
                          : 'Salvar ajustes'}
                    </button>
                    {form.pmocMode === 'EXISTING' && form.pmocId && (
                      <button
                        type="button"
                        disabled={creatingPmoc || form.pmocGenerationMode === 'PAUSED'}
                        onClick={onGeneratePmocWorkOrder}
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary)] disabled:opacity-50"
                      >
                        {pmocOperation ? 'Abrir Ordem de Serviço' : 'Gerar Ordem de Serviço'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <Field label="Cliente">
          <select
            value={form.customerId}
            disabled={type === 'PMOC' && form.pmocMode === 'EXISTING' && Boolean(form.pmocId)}
            onChange={(event) => {
              onSet('customerId', event.target.value);
              onSet('addressId', '');
              onSet('equipmentId', '');
              onSet('pmocEquipmentIds', []);
              onSet('inspectedEquipments', []);
            }}
          >
            <option value="">Selecione…</option>
            {customers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.tradeName ?? item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Endereço">
          <select
            value={form.addressId}
            onChange={(event) => onSet('addressId', event.target.value)}
          >
            <option value="">Endereço principal</option>
            {addresses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name ?? 'Endereço'} · {item.street ?? 'logradouro não informado'}
              </option>
            ))}
          </select>
        </Field>
        {type !== 'TECHNICAL_REPORT' && type !== 'TECHNICAL_OPINION' && type !== 'PMOC' && (
          <Field label="Equipamento">
            <select
              value={form.equipmentId}
              onChange={(event) => onSet('equipmentId', event.target.value)}
            >
              <option value="">Sem equipamento</option>
              {equipments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.tag}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Responsável">
          <select
            value={form.operatorId}
            onChange={(event) => {
              onSet('operatorId', event.target.value);
              if (type === 'PMOC' && form.pmocMode === 'NEW') {
                const selected = users.find((item) => item.id === event.target.value);
                if (selected) {
                  onSet('pmocResponsible', selected.name);
                  onSet('pmocDefaultOperatorId', selected.id);
                }
              }
            }}
          >
            <option value="">Selecione…</option>
            {users
              .filter((item) => item.isActive)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.role}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {type === 'TECHNICAL_OPINION' && selectedCustomer && (
        <RequesterSummary customer={selectedCustomer} addressId={form.addressId} />
      )}
    </div>
  );
}

function RequesterSummary({
  customer,
  addressId,
}: {
  customer: CustomerDetail;
  addressId: string;
}) {
  const contact = customer.contacts.find((item) => item.isPrimary) ?? customer.contacts[0] ?? null;
  const address =
    customer.addresses.find((item) => item.id === addressId) ??
    customer.addresses.find((item) => item.isPrimary) ??
    customer.addresses[0] ??
    null;
  const addressText = address
    ? [
        address.street,
        address.number,
        address.complement,
        address.district,
        address.city && address.state ? `${address.city}/${address.state}` : address.city,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Não informado';
  const contactText = [
    contact?.name,
    contact?.role,
    contact?.phone ?? customer.phone,
    contact?.email ?? customer.email,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4">
      <h3 className="text-sm font-semibold">Dados do solicitante no Laudo</h3>
      <p className="mt-1 text-caption">
        Informações carregadas do cadastro do cliente e utilizadas pelo Preview e PDF.
      </p>
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-caption">Razão Social</dt>
          <dd>{customer.name}</dd>
        </div>
        <div>
          <dt className="text-caption">Documento (CNPJ/CPF)</dt>
          <dd>{customer.cnpj ?? customer.cpf ?? 'Não informado'}</dd>
        </div>
        <div>
          <dt className="text-caption">Contato</dt>
          <dd>{contactText || 'Não informado'}</dd>
        </div>
        <div>
          <dt className="text-caption">Endereço</dt>
          <dd>{addressText}</dd>
        </div>
      </dl>
    </section>
  );
}

function ReceiptDataStep({
  form,
  customers,
  addresses,
  customer,
  onSet,
}: {
  form: WorkflowForm;
  customers: Customer[];
  addresses: CustomerAddress[];
  customer: CustomerDetail | null;
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
}) {
  function updateAmount(value: string) {
    const amount = parseBrl(value);
    const words = amount === null ? form.receiptAmountInWords : brlAmountInWords(amount);
    onSet('amount', value);
    if (amount !== null) onSet('receiptAmountInWords', words);
    if (!form.receiptDeclarationEdited) {
      onSet(
        'receiptDeclaration',
        receiptDeclaration({ ...form, amount: value, receiptAmountInWords: words }, customer),
      );
    }
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Text
          label="Número"
          value={form.receiptNumber}
          onChange={(value) => onSet('receiptNumber', value)}
        />
        <Field label="Data">
          <input
            type="date"
            value={form.receiptDate}
            onChange={(event) => onSet('receiptDate', event.target.value)}
          />
        </Field>
        <Field label="Cliente">
          <select
            value={form.customerId}
            onChange={(event) => {
              const selected = customers.find((item) => item.id === event.target.value);
              onSet('customerId', event.target.value);
              onSet('addressId', '');
              if (!form.receiptDeclarationEdited) {
                onSet(
                  'receiptDeclaration',
                  receiptDeclaration(form, selected),
                );
              }
            }}
          >
            <option value="">Selecione…</option>
            {customers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.tradeName ?? item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Endereço">
          <select
            value={form.addressId}
            onChange={(event) => onSet('addressId', event.target.value)}
          >
            <option value="">Selecione…</option>
            {addresses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name ?? 'Endereço'} · {item.street}
              </option>
            ))}
          </select>
        </Field>
        <Text label="Valor" value={form.amount} onChange={updateAmount} inputMode="decimal" />
        <Text
          label="Valor por extenso"
          value={form.receiptAmountInWords}
          onChange={(value) => {
            onSet('receiptAmountInWords', value);
            if (!form.receiptDeclarationEdited)
              onSet(
                'receiptDeclaration',
                receiptDeclaration({ ...form, receiptAmountInWords: value }, customer),
              );
          }}
        />
        <div className="md:col-span-2">
          <Area
            label={form.receiptSource === 'SALE' ? 'Descrição da venda' : 'Descrição dos serviços'}
            value={form.receiptDescription}
            onChange={(value) => {
              onSet('receiptDescription', value);
              if (!form.receiptDeclarationEdited)
                onSet(
                  'receiptDeclaration',
                  receiptDeclaration({ ...form, receiptDescription: value }, customer),
                );
            }}
          />
        </div>
      </div>
      <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Texto da declaração</h3>
            <p className="text-caption">Gerado automaticamente e livremente editável.</p>
          </div>
          <button
            type="button"
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm"
            onClick={() => {
              onSet('receiptDeclarationEdited', false);
              onSet('receiptDeclaration', receiptDeclaration(form, customer));
            }}
          >
            Restaurar texto automático
          </button>
        </div>
        <Area
          label="Declaração final"
          value={form.receiptDeclaration}
          onChange={(value) => {
            onSet('receiptDeclaration', value);
            onSet('receiptDeclarationEdited', true);
          }}
        />
      </section>
    </div>
  );
}

function ReceiptWarrantyStep({
  form,
  customer,
  onSet,
}: {
  form: WorkflowForm;
  customer: CustomerDetail | null;
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
}) {
  const options: Array<[WorkflowForm['receiptWarrantyPreset'], string]> = [
    ['NONE', 'Sem garantia'],
    ['30', '30 dias'],
    ['60', '60 dias'],
    ['90', '90 dias'],
    ['180', '180 dias'],
    ['365', '1 ano'],
    ['CUSTOM', 'Personalizado'],
  ];
  function select(preset: WorkflowForm['receiptWarrantyPreset']) {
    const days = preset === 'NONE' ? '' : preset === 'CUSTOM' ? form.receiptWarrantyDays : preset;
    const next = { ...form, receiptWarrantyPreset: preset, receiptWarrantyDays: days };
    onSet('receiptWarrantyPreset', preset);
    onSet('receiptWarrantyDays', days);
    if (!form.receiptDeclarationEdited)
      onSet('receiptDeclaration', receiptDeclaration(next, customer));
  }
  return (
    <div className="space-y-4">
      <Field label="Prazo da garantia">
        <select
          value={form.receiptWarrantyPreset}
          onChange={(event) => select(event.target.value as WorkflowForm['receiptWarrantyPreset'])}
        >
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {form.receiptWarrantyPreset === 'CUSTOM' && (
        <Field label="Prazo personalizado em dias">
          <input
            type="number"
            min={1}
            max={3650}
            value={form.receiptWarrantyDays}
            onChange={(event) => {
              onSet('receiptWarrantyDays', event.target.value);
              if (!form.receiptDeclarationEdited)
                onSet(
                  'receiptDeclaration',
                  receiptDeclaration(
                    { ...form, receiptWarrantyDays: event.target.value },
                    customer,
                  ),
                );
            }}
          />
        </Field>
      )}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4">
        <p className="text-sm font-medium">Declaração resultante</p>
        <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-muted-foreground)]">
          {form.receiptDeclaration || receiptDeclaration(form, customer)}
        </p>
      </div>
    </div>
  );
}

function ReceiptSignatureStep({
  form,
  signatures,
  onSet,
}: {
  form: WorkflowForm;
  signatures: Signature[];
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Responsável técnico</h3>
        <p className="text-caption">
          A escolha vale somente para este Recibo. Nenhuma assinatura do cliente será solicitada.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {signatures
          .filter((item) => item.active)
          .map((signature) => (
            <ReceiptSignatureOption
              key={signature.id}
              signature={signature}
              selected={form.technicalSignatureId === signature.id}
              onSelect={() => onSet('technicalSignatureId', signature.id)}
            />
          ))}
      </div>
      {signatures.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="Nenhuma assinatura ativa"
          description="Cadastre uma assinatura institucional antes de emitir o Recibo."
        />
      )}
    </div>
  );
}

function ReceiptSignatureOption({
  signature,
  selected,
  onSelect,
}: {
  signature: Signature;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = useQuery(
    (signal) => signaturesApi.downloadSignatureImage(signature.id, { signal }),
    [signature.id],
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${selected ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
    >
      <div className="grid h-20 place-items-center rounded-md bg-white p-2">
        {image.data ? (
          <img // eslint-disable-line @next/next/no-img-element
            src={`data:${image.data.mimeType};base64,${image.data.contentBase64}`}
            alt={`Assinatura de ${signature.name}`}
            className="max-h-16 max-w-full object-contain"
          />
        ) : (
          <span className="text-caption">Carregando assinatura…</span>
        )}
      </div>
      <p className="mt-3 font-semibold">{signature.name}</p>
      <p className="text-sm text-[var(--color-muted-foreground)]">{signature.title}</p>
      {signature.professionalCouncil && (
        <p className="text-caption">{signature.professionalCouncil}</p>
      )}
      {signature.isDefault && (
        <span className="mt-2 inline-flex rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700">
          Assinatura padrão
        </span>
      )}
    </button>
  );
}

function ContentStep({
  type,
  form,
  equipments,
  signatures,
  checklistTemplates,
  checklistTemplatesLoading,
  canManageChecklist,
  onCreateChecklist,
  onSet,
}: {
  type: DocumentKind;
  form: WorkflowForm;
  equipments: EquipmentSummary[];
  signatures: Signature[];
  checklistTemplates: MaintenanceChecklistTemplate[];
  checklistTemplatesLoading: boolean;
  canManageChecklist: boolean;
  onCreateChecklist: (description: string) => Promise<MaintenanceChecklistTemplate>;
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
}) {
  const [newChecklistDescription, setNewChecklistDescription] = useState('');
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const contextualAreas = technicalCatalogAreas(
    equipments.filter((equipment) =>
      form.inspectedEquipments.some((selected) => selected.equipmentId === equipment.id),
    ),
  );

  const selectedChecklistItems = form.maintenanceChecklist.filter(
    (item) => item.maintenanceType === form.maintenanceType,
  );
  const selectedChecklistTemplateIds = checklistTemplates
    .filter((template) =>
      selectedChecklistItems.some(
        (item) =>
          item.templateId === template.id ||
          (!item.templateId && item.description === template.description),
      ),
    )
    .map((template) => template.id);

  function selectChecklistTemplates(templateIds: string[]) {
    const selectedIds = new Set(templateIds);
    const customItems = selectedChecklistItems.filter(
      (item) =>
        !checklistTemplates.some(
          (template) =>
            template.id === item.templateId ||
            (!item.templateId && template.description === item.description),
        ),
    );
    const catalogItems = checklistTemplates
      .filter((template) => selectedIds.has(template.id))
      .map((template) => {
        const current = selectedChecklistItems.find(
          (item) => item.templateId === template.id || item.description === template.description,
        );
        return (
          current ?? {
            templateId: template.id,
            maintenanceType: template.maintenanceType,
            description: template.description,
            executed: false,
            result: 'NO' as const,
            observations: '',
          }
        );
      });
    onSet('maintenanceChecklist', [...customItems, ...catalogItems]);
  }

  async function createChecklist() {
    const description = newChecklistDescription.trim();
    if (description.length < 3) return;
    setCreatingChecklist(true);
    setChecklistError(null);
    try {
      const created = await onCreateChecklist(description);
      onSet('maintenanceChecklist', [
        ...form.maintenanceChecklist,
        {
          templateId: created.id,
          maintenanceType: created.maintenanceType,
          description: created.description,
          executed: false,
          result: 'NO',
          observations: '',
        },
      ]);
      setNewChecklistDescription('');
    } catch (cause) {
      setChecklistError(message(cause));
    } finally {
      setCreatingChecklist(false);
    }
  }

  if (type === 'WORK_ORDER') {
    if (form.workOrderSource === 'EXISTING')
      return (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4">
          <strong className="text-sm">Dados carregados da Operation</strong>
          <p className="mt-1 text-caption">
            A ordem utilizará os dados operacionais persistidos, incluindo equipamentos, checklist,
            fotos e assinatura. Para corrigi-los, edite a Operation de origem.
          </p>
        </div>
      );
    return (
      <div className="space-y-5">
        <InspectedEquipmentSelector form={form} equipments={equipments} onSet={onSet} />
        <Area
          label="Defeito ou solicitação informada"
          value={form.objective}
          onChange={(value) => onSet('objective', value)}
        />
        <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold">Serviços executados / Checklist da execução</h3>
            <p className="text-caption">
              Informe o resumo técnico e, quando necessário, detalhe uma atividade por linha.
            </p>
          </div>
          <Area
            label="Resumo dos serviços executados"
            value={form.analysis}
            onChange={(value) => onSet('analysis', value)}
          />
          <Area
            label="Atividades do checklist — uma por linha"
            value={form.checklist}
            onChange={(value) => onSet('checklist', value)}
          />
        </section>
        <Area
          label="Observações e resultado operacional"
          value={form.observations}
          onChange={(value) => onSet('observations', value)}
        />
      </div>
    );
  }
  if (type === 'RECEIPT')
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Text
          label="Referência"
          value={form.reference}
          onChange={(value) => onSet('reference', value)}
        />
        <Text
          label="Valor recebido"
          value={form.amount}
          onChange={(value) => onSet('amount', value)}
          inputMode="decimal"
        />
        <Text
          label="Recebido de"
          value={form.receivedFrom}
          onChange={(value) => onSet('receivedFrom', value)}
        />
        <Area
          label="Observações"
          value={form.observations}
          onChange={(value) => onSet('observations', value)}
        />
      </div>
    );
  if (type === 'TECHNICAL_OPINION')
    return (
      <div className="space-y-5">
        <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold">Responsabilidade técnica</h3>
            <p className="text-caption">
              Estes dados identificam o profissional responsável no Preview e no PDF do Laudo.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Responsável Técnico">
              <select
                value={form.technicalSignatureId}
                onChange={(event) => {
                  const signature = signatures.find((item) => item.id === event.target.value);
                  onSet('technicalSignatureId', event.target.value);
                  onSet('technicalResponsible', signature?.name ?? '');
                  onSet('technicalCrea', signature?.professionalCouncil ?? 'Não consta');
                }}
              >
                <option value="">Selecione uma assinatura institucional…</option>
                {signatures.map((signature) => (
                  <option key={signature.id} value={signature.id}>
                    {[signature.name, signature.title, signature.department]
                      .filter(Boolean)
                      .join(' · ')}
                  </option>
                ))}
              </select>
            </Field>
            <Text
              label="CREA / Registro profissional"
              value={form.technicalCrea}
              onChange={(value) => onSet('technicalCrea', value)}
            />
          </div>
        </section>
        <InspectedEquipmentSelector
          form={form}
          equipments={equipments}
          technicalOpinion
          onSet={onSet}
        />
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Objetivo</h3>
          <TechnicalCatalogSelector
            type="OBJECTIVE"
            areas={contextualAreas}
            workflow="TECHNICAL_OPINION"
            label="Objetivo"
            values={form.objectiveItems}
            onChange={(values) => onSet('objectiveItems', values)}
          />
          <Area
            label="Esclarecimento técnico sobre o objetivo"
            value={form.objective}
            onChange={(value) => onSet('objective', value)}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            O texto acima será o conteúdo principal; os itens selecionados serão exibidos abaixo em
            uma lista complementar.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Condições observadas</h3>
          <TechnicalCatalogSelector
            type="SITE_CONDITION"
            areas={contextualAreas}
            workflow="TECHNICAL_OPINION"
            label="Condição"
            values={catalogLines(form.siteConditions)}
            onChange={(values) => onSet('siteConditions', values.join('\n'))}
          />
          <Area
            label="Condições — edição textual completa"
            value={form.siteConditions}
            onChange={(value) => onSet('siteConditions', value)}
          />
        </section>
        <Area
          label="Análise técnica"
          value={form.analysis}
          onChange={(value) => onSet('analysis', value)}
        />
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Recomendações</h3>
          <TechnicalCatalogSelector
            type="RECOMMENDATION"
            areas={contextualAreas}
            workflow="TECHNICAL_OPINION"
            label="Recomendação"
            values={catalogLines(form.recommendations)}
            onChange={(values) => onSet('recommendations', values.join('\n'))}
          />
          <Area
            label="Recomendações — edição textual completa"
            value={form.recommendations}
            onChange={(value) => onSet('recommendations', value)}
          />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Conclusão</h3>
          <TechnicalCatalogSelector
            type="CONCLUSION"
            areas={contextualAreas}
            workflow="TECHNICAL_OPINION"
            label="Conclusão"
            values={form.conclusionItems}
            onChange={(values) => onSet('conclusionItems', values)}
          />
          <Area
            label="Conclusão e esclarecimento do responsável técnico"
            value={form.conclusion}
            onChange={(value) => onSet('conclusion', value)}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            A conclusão livre é obrigatória e permanece em destaque antes dos itens predefinidos.
          </p>
        </section>
      </div>
    );
  if (type === 'PMOC')
    return (
      <div className="space-y-5">
        <InspectedEquipmentSelector form={form} equipments={equipments} onSet={onSet} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Periodicidade da execução">
            <select
              value={form.maintenanceType}
              onChange={(event) => {
                onSet('maintenanceType', event.target.value as OperationMaintenanceType);
                onSet('maintenanceChecklist', []);
              }}
            >
              <option value="WEEKLY">Semanal</option>
              <option value="MONTHLY">Mensal</option>
              <option value="QUARTERLY">Trimestral</option>
              <option value="SEMIANNUAL">Semestral</option>
              <option value="ANNUAL">Anual</option>
              <option value="CORRECTIVE">Corretiva</option>
            </select>
          </Field>
          <MultiSelect
            label="Procedimentos do catálogo PMOC"
            options={checklistTemplates.map((template) => ({
              value: template.id,
              label: template.description,
            }))}
            value={selectedChecklistTemplateIds}
            onChange={selectChecklistTemplates}
            placeholder={
              checklistTemplatesLoading ? 'Carregando procedimentos…' : 'Selecionar procedimentos'
            }
            emptyMessage="Nenhum procedimento cadastrado para esta periodicidade."
          />
        </div>
        <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold">Checklist por equipamento</h3>
            <p className="text-caption">
              Cada resultado é persistido como snapshot da execução. Selecione Sim, Não ou N.A. e
              registre a observação quando necessário.
            </p>
          </div>
          {selectedChecklistItems.map((item, index) => (
            <div
              key={item.templateId ?? `${item.description}-${index}`}
              className="grid gap-2 rounded-[var(--radius-md)] bg-[var(--color-muted)]/50 p-3 md:grid-cols-[1.2fr_1.6fr_130px_1.3fr_auto] md:items-center"
            >
              <select
                aria-label={`Equipamento de ${item.description}`}
                value={item.equipmentId ?? ''}
                onChange={(event) =>
                  onSet(
                    'maintenanceChecklist',
                    selectedChecklistItems.map((current, currentIndex) =>
                      currentIndex === index
                        ? { ...current, equipmentId: event.target.value || undefined }
                        : current,
                    ),
                  )
                }
              >
                <option value="">Procedimento geral</option>
                {form.inspectedEquipments.map((selected) => {
                  const equipment = equipments.find(
                    (candidate) => candidate.id === selected.equipmentId,
                  );
                  return (
                    <option key={selected.equipmentId} value={selected.equipmentId}>
                      {equipment?.name ?? selected.equipmentId}
                    </option>
                  );
                })}
              </select>
              <span className="text-sm">{item.description}</span>
              <select
                aria-label={`Resultado de ${item.description}`}
                value={item.result}
                onChange={(event) =>
                  onSet(
                    'maintenanceChecklist',
                    selectedChecklistItems.map((current, currentIndex) =>
                      currentIndex === index
                        ? {
                            ...current,
                            result: event.target.value as 'YES' | 'NO' | 'NOT_APPLICABLE',
                            executed: event.target.value === 'YES',
                          }
                        : current,
                    ),
                  )
                }
              >
                <option value="YES">Sim</option>
                <option value="NO">Não</option>
                <option value="NOT_APPLICABLE">N.A.</option>
              </select>
              <input
                value={item.observations}
                maxLength={2000}
                onChange={(event) =>
                  onSet(
                    'maintenanceChecklist',
                    selectedChecklistItems.map((current, currentIndex) =>
                      currentIndex === index
                        ? { ...current, observations: event.target.value }
                        : current,
                    ),
                  )
                }
                placeholder="Observação"
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
              />
              <button
                type="button"
                aria-label={`Remover ${item.description}`}
                onClick={() =>
                  onSet(
                    'maintenanceChecklist',
                    selectedChecklistItems.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
                className="rounded-md p-2 text-[var(--color-muted-foreground)] hover:text-[var(--color-danger)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>
        <Area
          label="Objetivo e detalhes da execução"
          value={form.objective}
          onChange={(value) => onSet('objective', value)}
        />
        <Area
          label="Observações e conclusão"
          value={form.observations}
          onChange={(value) => onSet('observations', value)}
        />
      </div>
    );
  if (type === 'TECHNICAL_REPORT') {
    const groups = [
      { value: 'WEEKLY' as const, label: 'Semanal' },
      { value: 'SEMIANNUAL' as const, label: 'Semestral' },
    ];
    return (
      <div className="space-y-5">
        <Field label="Tipo de manutenção realizado">
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <button
                key={group.value}
                type="button"
                onClick={() => onSet('maintenanceType', group.value)}
                className={`flex items-center justify-between rounded-[var(--radius-lg)] border p-4 text-left ${form.maintenanceType === group.value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}
              >
                <span><strong className="block">{group.label}</strong><span className="text-caption">O relatório exibirá os dois grupos e marcará este como realizado.</span></span>
                {form.maintenanceType === group.value && <Check className="h-5 w-5 text-[var(--color-primary)]" />}
              </button>
            ))}
          </div>
        </Field>
        <InspectedEquipmentSelector form={form} equipments={equipments} onSet={onSet} />
        <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold">Checklists predefinidos</h3>
            <p className="text-caption">Semana e Semestral são persistidos juntos. Marque somente os itens executados nesta visita.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((group) => {
              const templates = checklistTemplates.filter((item) => item.maintenanceType === group.value);
              const items = form.maintenanceChecklist.filter((item) => item.maintenanceType === group.value);
              const selectedIds = templates.filter((template) => items.some((item) => item.templateId === template.id)).map((item) => item.id);
              return <section key={group.value} className={`space-y-3 rounded-[var(--radius-lg)] border p-3 ${form.maintenanceType === group.value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}>
                <div className="flex items-center justify-between"><h4 className="font-semibold">{group.label}</h4>{form.maintenanceType === group.value && <StatusChip tone="success">Tipo realizado</StatusChip>}</div>
                <MultiSelect
                  label={`Itens ${group.label.toLowerCase()}`}
                  options={templates.map((item) => ({ value: item.id, label: item.description }))}
                  value={selectedIds}
                  onChange={(ids) => {
                    const keepOtherGroups = form.maintenanceChecklist.filter((item) => item.maintenanceType !== group.value);
                    const current = new Map(items.map((item) => [item.templateId, item]));
                    const next = templates.filter((item) => ids.includes(item.id)).map((item) => current.get(item.id) ?? ({ templateId: item.id, maintenanceType: group.value, description: item.description, executed: false, result: 'NO' as const, observations: '' }));
                    onSet('maintenanceChecklist', [...keepOtherGroups, ...next]);
                  }}
                  placeholder={checklistTemplatesLoading ? 'Carregando itens…' : 'Selecionar itens'}
                  emptyMessage="Nenhum item cadastrado para este tipo."
                />
                {items.map((item) => {
                  const globalIndex = form.maintenanceChecklist.indexOf(item);
                  return <label key={item.templateId ?? `${group.value}-${globalIndex}`} className="flex gap-3 rounded-md bg-[var(--color-card)] p-3 text-sm">
                    <input type="checkbox" checked={item.executed} onChange={(event) => onSet('maintenanceChecklist', form.maintenanceChecklist.map((current, index) => index === globalIndex ? { ...current, executed: event.target.checked, result: event.target.checked ? 'YES' : 'NO' } : current))} />
                    <span>{item.description}</span>
                  </label>;
                })}
              </section>;
            })}
          </div>
          {canManageChecklist && <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input value={newChecklistDescription} maxLength={500} onChange={(event) => setNewChecklistDescription(event.target.value)} placeholder={`Novo item ${form.maintenanceType === 'WEEKLY' ? 'semanal' : 'semestral'}`} className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm" />
            <button type="button" disabled={creatingChecklist || newChecklistDescription.trim().length < 3} onClick={() => void createChecklist()} className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm disabled:opacity-50"><Plus className="h-4 w-4" /> {creatingChecklist ? 'Adicionando…' : 'Adicionar ao catálogo'}</button>
          </div>}
          {checklistError && <p className="text-sm text-[var(--color-danger)]">{checklistError}</p>}
        </section>
        <Area label="Observações" value={form.observations} onChange={(value) => onSet('observations', value)} />
        <section className="space-y-2">
          <TechnicalCatalogSelector type="RECOMMENDATION" label="Recomendação" areas={contextualAreas} workflow="TECHNICAL_REPORT" values={catalogLines(form.recommendations)} onChange={(values) => onSet('recommendations', values.join('\n'))} />
          <Area label="Recomendações técnicas (opcional)" value={form.recommendations} onChange={(value) => onSet('recommendations', value)} />
        </section>
        <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold">Assinaturas do relatório</h3>
            <p className="text-caption">Defina o responsável técnico e como tratar a assinatura do cliente neste RVT.</p>
          </div>
          <Field label="Responsável técnico (assinatura)">
            <select
              value={form.technicalSignatureId}
              onChange={(event) => onSet('technicalSignatureId', event.target.value)}
            >
              <option value="">Selecione uma assinatura institucional…</option>
              {signatures.map((signature) => (
                <option key={signature.id} value={signature.id}>
                  {[signature.name, signature.title, signature.department].filter(Boolean).join(' · ')}
                  {signature.isDefault ? ' · padrão' : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Assinatura do cliente</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => onSet('technicalReportCustomerSignature', 'COLLECT_LATER')}
                className={`rounded-[var(--radius-lg)] border p-3 text-left transition ${form.technicalReportCustomerSignature === 'COLLECT_LATER' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
              >
                <strong className="block text-sm">Coletar depois</strong>
                <span className="mt-1 block text-caption">O documento fica pendente até a assinatura do cliente ser coletada.</span>
              </button>
              <button
                type="button"
                onClick={() => onSet('technicalReportCustomerSignature', 'HIDDEN')}
                className={`rounded-[var(--radius-lg)] border p-3 text-left transition ${form.technicalReportCustomerSignature === 'HIDDEN' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'}`}
              >
                <strong className="block text-sm">Ocultar assinatura do cliente</strong>
                <span className="mt-1 block text-caption">Somente o responsável técnico assina. O relatório pode ser finalizado agora.</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Area
        label="Objetivo da visita"
        value={form.objective}
        onChange={(value) => onSet('objective', value)}
      />
      <Area
        label="Observações"
        value={form.observations}
        onChange={(value) => onSet('observations', value)}
      />
    </div>
  );
}

function InspectedEquipmentSelector({
  form,
  equipments,
  technicalOpinion = false,
  onSet,
}: {
  form: WorkflowForm;
  equipments: EquipmentSummary[];
  technicalOpinion?: boolean;
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
}) {
  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div>
        <h3 className="text-sm font-semibold">Equipamentos incluídos</h3>
        <p className="text-caption">
          Selecione os ativos que formarão a tabela do documento. A busca suporta clientes com
          muitos equipamentos.
        </p>
      </div>
      <MultiSelect
        label="Selecionar equipamentos"
        options={equipments.map((equipment) => ({
          value: equipment.id,
          label: `${equipment.name} · ${equipment.tag || 'sem tag'}`,
          description: [equipment.manufacturer, equipment.model, equipment.capacity]
            .filter(Boolean)
            .join(' · '),
        }))}
        value={form.inspectedEquipments.map((item) => item.equipmentId)}
        onChange={(equipmentIds) =>
          onSet(
            'inspectedEquipments',
            equipmentIds.map((equipmentId) => {
              const current = form.inspectedEquipments.find(
                (item) => item.equipmentId === equipmentId,
              );
              const equipment = equipments.find((item) => item.id === equipmentId);
              return (
                current ?? {
                  equipmentId,
                  sector: equipment?.address?.name || equipment?.name || 'Não informado',
                  systemType: technicalOpinion ? equipmentTypeLabel(equipment?.type) : '',
                  currentSituation: '',
                }
              );
            }),
          )
        }
        placeholder={
          equipments.length ? 'Buscar e selecionar equipamentos' : 'Cliente sem equipamentos'
        }
        emptyMessage="Nenhum equipamento encontrado para este cliente."
      />
      {form.inspectedEquipments.map((item) => {
        const equipment = equipments.find((candidate) => candidate.id === item.equipmentId);
        if (!equipment) return null;
        return (
          <div
            key={item.equipmentId}
            className={`grid gap-3 rounded-[var(--radius-md)] bg-[var(--color-muted)]/50 p-3 ${
              technicalOpinion ? 'md:grid-cols-2' : 'md:grid-cols-[1fr_260px_auto] md:items-center'
            }`}
          >
            <span className={`text-sm ${technicalOpinion ? 'md:col-span-2' : ''}`}>
              <strong>{equipment.name}</strong> · {equipment.manufacturer ?? 'Marca não informada'}{' '}
              · {equipment.model ?? 'Modelo não informado'}
            </span>
            {technicalOpinion && (
              <input
                aria-label={`Tipo de sistema de ${equipment.name}`}
                value={item.systemType}
                onChange={(event) =>
                  onSet(
                    'inspectedEquipments',
                    form.inspectedEquipments.map((current) =>
                      current.equipmentId === item.equipmentId
                        ? { ...current, systemType: event.target.value }
                        : current,
                    ),
                  )
                }
                placeholder="Tipo de sistema"
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
              />
            )}
            <input
              aria-label={`Setor de ${equipment.name}`}
              value={item.sector}
              onChange={(event) =>
                onSet(
                  'inspectedEquipments',
                  form.inspectedEquipments.map((current) =>
                    current.equipmentId === item.equipmentId
                      ? { ...current, sector: event.target.value }
                      : current,
                  ),
                )
              }
              placeholder={technicalOpinion ? 'Local de instalação' : 'Setor/ambiente'}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
            />
            {technicalOpinion && (
              <input
                aria-label={`Situação atual de ${equipment.name}`}
                value={item.currentSituation}
                onChange={(event) =>
                  onSet(
                    'inspectedEquipments',
                    form.inspectedEquipments.map((current) =>
                      current.equipmentId === item.equipmentId
                        ? { ...current, currentSituation: event.target.value }
                        : current,
                    ),
                  )
                }
                placeholder="Situação atual"
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
              />
            )}
            <button
              type="button"
              aria-label={`Remover ${equipment.name}`}
              onClick={() =>
                onSet(
                  'inspectedEquipments',
                  form.inspectedEquipments.filter(
                    (current) => current.equipmentId !== item.equipmentId,
                  ),
                )
              }
              className={`rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-card)] hover:text-[var(--color-danger)] ${technicalOpinion ? 'justify-self-end' : ''}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </section>
  );
}

function EvidenceStep({
  type,
  form,
  signatures,
  onSet,
}: {
  type: DocumentKind;
  form: WorkflowForm;
  signatures: Signature[];
  onSet: <K extends keyof WorkflowForm>(key: K, value: WorkflowForm[K]) => void;
}) {
  const customerSignatureRequired = ['WORK_ORDER', 'TECHNICAL_REPORT', 'BUDGET', 'PMOC'].includes(
    type,
  );
  return (
    <div className="space-y-5">
      {type !== 'WORK_ORDER' && (
        <Area
          label="Checklist — uma atividade por linha"
          value={form.checklist}
          onChange={(value) => onSet('checklist', value)}
        />
      )}
      {type !== 'RECEIPT' && (
        <Field label={type === 'PMOC' ? 'Fotos do PMOC' : 'Evidências fotográficas'}>
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []).slice(0, 10);
              const photos = await Promise.all(
                files.map(async (file) => ({
                  dataUrl: await fileDataUrl(file),
                  caption: file.name,
                })),
              );
              onSet('photos', photos);
            }}
          />
          <span className="text-caption">{form.photos.length} foto(s) selecionada(s).</span>
        </Field>
      )}
      {customerSignatureRequired && (
        <div>
          <p className="mb-2 text-sm font-medium">Assinatura do cliente</p>
          {type === 'PMOC' && (
            <div className="mb-3 grid gap-3 md:grid-cols-2">
              <Text
                label="Nome do cliente/responsável"
                value={form.customerSignerName}
                onChange={(value) => onSet('customerSignerName', value)}
              />
              <Text
                label="Função ou vínculo"
                value={form.customerSignerRole}
                onChange={(value) => onSet('customerSignerRole', value)}
              />
            </div>
          )}
          <SignaturePad
            onChange={(value) => onSet('signatureData', value)}
            onConfirm={(value) => onSet('signatureData', value)}
          />
        </div>
      )}
      <Field label="Assinatura do responsável técnico">
        <select
          value={form.technicalSignatureId}
          onChange={(event) => onSet('technicalSignatureId', event.target.value)}
        >
          <option value="">Selecione uma assinatura cadastrada…</option>
          {signatures.map((signature) => (
            <option key={signature.id} value={signature.id}>
              {signature.name} · {signature.title}
              {signature.isDefault ? ' · padrão' : ''}
            </option>
          ))}
        </select>
        <span className="text-caption">
          Obrigatória para finalização. A escolha vale somente para este documento.
        </span>
      </Field>
    </div>
  );
}

function contentFor(type: DocumentKind, form: WorkflowForm) {
  const checklist = form.checklist
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      label: line
        .replace(/^\[[ xX]\]\s*/, '')
        .split('|')[0]
        .trim(),
      done: !line.startsWith('[ ]'),
      note: line.split('|')[1]?.trim() || undefined,
    }));
  const common = {
    checklist,
    photos: type === 'RECEIPT' ? [] : form.photos,
    signatureData: form.signatureData,
    customerSignerName: form.signatureData ? form.customerSignerName || undefined : undefined,
    customerSignerRole: form.signatureData ? form.customerSignerRole || undefined : undefined,
    signedAt: form.signatureData ? new Date().toISOString() : undefined,
  };
  if (type === 'RECEIPT')
    return {
      checklist: [],
      photos: [],
      signatureData: null,
      customerSignerName: null,
      customerSignerRole: null,
      receiptNumber: form.receiptNumber.trim() || null,
      receiptIssuedAt: form.receiptDate,
      receiptAmount: parseBrl(form.amount),
      receiptAmountInWords: form.receiptAmountInWords.trim(),
      receiptDescription: form.receiptDescription.trim(),
      receiptWarrantyDays: Number(form.receiptWarrantyDays) || null,
      receiptDeclaration: form.receiptDeclaration.trim(),
    };
  if (type === 'TECHNICAL_OPINION')
    return {
      ...common,
      checklist: [],
      photos: [],
      technicalOpinionObjective: form.objective,
      technicalOpinionObjectiveItems: form.objectiveItems,
      technicalOpinionConditions: form.siteConditions,
      technicalOpinionAnalysis: form.analysis,
      technicalOpinionConclusion: form.conclusion,
      technicalOpinionConclusionItems: form.conclusionItems,
      technicalOpinionRecommendations: form.recommendations,
      technicalOpinionResponsible: form.technicalResponsible,
      technicalOpinionCrea: form.technicalCrea,
      inspectedEquipments: form.inspectedEquipments,
    };
  if (type === 'TECHNICAL_REPORT')
    return {
      ...common,
      reportedIssue: form.objective,
      technicalDiagnosis: form.diagnosis,
      serviceDescription: form.analysis,
      technicalRecommendations: form.recommendations,
      observations: form.observations,
      referenceMonth: Number(form.referenceMonth),
      referenceYear: Number(form.referenceYear),
      maintenanceType: form.maintenanceType,
      maintenanceChecklist: form.maintenanceChecklist.map((item) => ({
        maintenanceType: item.maintenanceType,
        description: item.description,
        executed: item.executed,
        observations: item.observations || undefined,
      })),
      inspectedEquipments: form.inspectedEquipments,
    };
  if (type === 'WORK_ORDER')
    return {
      ...common,
      reportedIssue: form.objective,
      serviceDescription: form.analysis,
      observations: form.observations,
      inspectedEquipments: form.inspectedEquipments,
    };
  if (type === 'PMOC')
    return {
      ...common,
      serviceDescription: form.objective,
      observations: form.observations,
      maintenanceType: form.maintenanceType,
      inspectedEquipments: form.inspectedEquipments,
      maintenanceChecklist: form.maintenanceChecklist.map((item) => ({
        equipmentId: item.equipmentId,
        maintenanceType: item.maintenanceType,
        description: item.description,
        executed: item.result === 'YES',
        result: item.result,
        observations: item.observations || undefined,
      })),
    };
  return {
    ...common,
    reportedIssue: form.objective,
    serviceDescription: undefined,
    observations: form.observations,
  };
}

function operationTypeFor(
  type: DocumentKind,
): 'PREVENTIVA' | 'CORRETIVA' | 'INSTALACAO' | 'PROJETO' {
  return type === 'PMOC' ? 'PREVENTIVA' : type === 'TECHNICAL_OPINION' ? 'CORRETIVA' : 'PROJETO';
}
function catalogLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*[-•*]\s*/u, '').trim())
    .filter(Boolean);
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
function equipmentTypeLabel(type?: EquipmentSummary['type']): string {
  if (!type) return '';
  const labels: Record<EquipmentSummary['type'], string> = {
    SPLIT: 'Split',
    CONDENSER: 'Unidade condensadora',
    EVAPORATOR: 'Unidade evaporadora',
    CHILLER: 'Chiller',
    AIR_HANDLER: 'Unidade de tratamento de ar',
    SOLAR_INVERTER: 'Inversor solar',
    ELECTRICAL_PANEL: 'Painel elétrico',
    GENERATOR: 'Gerador',
    OTHER: 'Outro sistema',
  };
  return labels[type];
}
function message(cause: unknown) {
  return cause instanceof ApiClientError || cause instanceof Error
    ? cause.message
    : 'Não foi possível preparar o documento.';
}
function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <span className="text-caption">{label}</span>
      <strong className="mt-1 block text-2xl">{value}</strong>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium [&_input]:h-10 [&_input]:rounded-[var(--radius-md)] [&_input]:border [&_input]:border-[var(--color-border)] [&_input]:bg-[var(--color-card)] [&_input]:px-3 [&_select]:h-10 [&_select]:rounded-[var(--radius-md)] [&_select]:border [&_select]:border-[var(--color-border)] [&_select]:bg-[var(--color-card)] [&_select]:px-3">
      {label}
      {children}
    </label>
  );
}
function Text({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: 'decimal';
}) {
  return (
    <Field label={label}>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm"
      />
    </label>
  );
}
