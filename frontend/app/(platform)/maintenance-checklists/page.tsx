'use client';

import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@platform/components/page-header';
import { Pagination } from '@platform/components/pagination';
import { ServiceTypesPanel } from '@platform/components/service-types-panel';
import {
  technicalCatalogsApi,
  useQuery,
  type OperationMaintenanceType,
  type Paginated,
  type PmocChecklistUnit,
  type TechnicalCatalog,
  type TechnicalCatalogArea,
  type TechnicalCatalogTaxonomy,
  type TechnicalCatalogType,
  type TechnicalCatalogTypeDescriptor,
  type TechnicalCatalogWorkflow,
} from '@erp/api';
import { Gate } from '@erp/ui/auth/gate';
import { useAuth } from '@erp/ui/auth/auth-provider';
import { ConfirmDialog } from '@erp/ui/confirm-dialog';
import { Drawer } from '@erp/ui/drawer';
import { EmptyState } from '@erp/ui/empty-state';
import { SkeletonCard } from '@erp/ui/skeletons';
import { StatusChip } from '@erp/ui/status-chip';

const MAINTENANCE_TYPES: Array<{ value: OperationMaintenanceType; label: string }> = [
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'SEMIANNUAL', label: 'Semestral' },
  { value: 'ANNUAL', label: 'Anual' },
  { value: 'CORRECTIVE', label: 'Corretiva' },
];
const RVT_MAINTENANCE_TYPES = MAINTENANCE_TYPES.filter(
  (item) => item.value === 'WEEKLY' || item.value === 'SEMIANNUAL',
);
const PMOC_UNITS: Array<{ value: PmocChecklistUnit; label: string }> = [
  { value: 'EVAPORATOR', label: 'Unidade Evaporadora' },
  { value: 'CONDENSER', label: 'Unidade Condensadora' },
];
type CatalogTab = TechnicalCatalogType | 'RVT_CHECKLIST' | 'PMOC_CHECKLIST' | 'SERVICE_TYPE';

export default function TechnicalCatalogsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('OWNER', 'MANAGER');
  const [selectedType, setSelectedType] = useState<CatalogTab | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [maintenanceType, setMaintenanceType] = useState<OperationMaintenanceType | ''>('');
  const [pmocUnit, setPmocUnit] = useState<PmocChecklistUnit>('EVAPORATOR');
  const [area, setArea] = useState<TechnicalCatalogArea | ''>('');
  const [workflow, setWorkflow] = useState<TechnicalCatalogWorkflow | ''>('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [sortBy, setSortBy] = useState<'sortOrder' | 'title' | 'updatedAt'>('sortOrder');
  const [editor, setEditor] = useState<TechnicalCatalog | 'create' | null>(null);
  const [removing, setRemoving] = useState<TechnicalCatalog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const types = useQuery<TechnicalCatalogTypeDescriptor[]>(
    (signal) => technicalCatalogsApi.types({ signal }),
    [],
  );
  const taxonomy = useQuery<TechnicalCatalogTaxonomy>(
    (signal) => technicalCatalogsApi.taxonomy({ signal }),
    [],
  );
  useEffect(() => {
    if (selectedType || !types.data?.length) return;
    const requested = new URLSearchParams(window.location.search).get('type');
    const matched =
      requested === 'RVT_CHECKLIST'
        ? 'RVT_CHECKLIST'
        : requested === 'PMOC_CHECKLIST'
          ? 'PMOC_CHECKLIST'
          : types.data.find((item) => item.value === requested)?.value;
    setSelectedType(matched ?? types.data[0].value);
  }, [selectedType, types.data]);
  const isRvtChecklist = selectedType === 'RVT_CHECKLIST';
  const isPmocChecklist = selectedType === 'PMOC_CHECKLIST';
  const isEquipmentType = selectedType === 'EQUIPMENT_TYPE';
  const isBudgetMaterial = selectedType === 'BUDGET_MATERIAL_DESCRIPTION';
  const isSimpleCatalog = isEquipmentType || isBudgetMaterial;
  // 'SERVICE_TYPE' não é um TechnicalCatalogType (tem painel próprio); vira
  // undefined aqui para não vazar para as APIs/filtros de catálogo técnico.
  const effectiveType: TechnicalCatalogType | undefined =
    isRvtChecklist || isPmocChecklist
      ? 'CHECKLIST'
      : selectedType && selectedType !== 'SERVICE_TYPE'
        ? (selectedType as TechnicalCatalogType)
        : undefined;
  const catalogs = useQuery<Paginated<TechnicalCatalog>>(
    (signal) =>
      selectedType === 'SERVICE_TYPE'
        ? Promise.resolve({
            items: [],
            pagination: { page: 1, limit, total: 0, totalPages: 0 },
          } as unknown as Paginated<TechnicalCatalog>)
        : technicalCatalogsApi.list({
        page,
        limit,
        search: search || undefined,
        type: effectiveType ?? undefined,
        maintenanceType:
          effectiveType === 'CHECKLIST' && !isPmocChecklist && maintenanceType
            ? maintenanceType
            : undefined,
        pmocUnit: isPmocChecklist ? pmocUnit : undefined,
        areas: area ? [area] : undefined,
        workflow:
          isRvtChecklist
            ? 'TECHNICAL_REPORT'
            : isPmocChecklist
              ? 'PMOC'
              : selectedType === 'CHECKLIST'
                ? undefined
                : workflow || undefined,
        workflowsAny:
          selectedType === 'CHECKLIST' && !workflow ? ['WORK_ORDER', 'PMOC'] : undefined,
        includeGeneral: selectedType === 'CHECKLIST' && !workflow,
        active: active ? active === 'true' : undefined,
        sortBy,
        order: 'asc',
        signal,
      }),
    [
      page,
      limit,
      search,
      selectedType,
      effectiveType,
      isRvtChecklist,
      isPmocChecklist,
      maintenanceType,
      pmocUnit,
      area,
      workflow,
      active,
      sortBy,
      tick,
    ],
  );

  function changed(text: string) {
    setNotice(text);
    setTick((value) => value + 1);
    window.setTimeout(() => setNotice(null), 2500);
  }

  async function move(item: TechnicalCatalog, direction: -1 | 1) {
    const items = catalogs.data?.items ?? [];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = items[index + direction];
    if (!target || !effectiveType) return;
    await technicalCatalogsApi.reorder(effectiveType, [
      { id: item.id, sortOrder: target.sortOrder },
      { id: target.id, sortOrder: item.sortOrder },
    ]);
    changed('Ordem atualizada.');
  }

  return (
    <Gate
      roles={['OWNER', 'MANAGER', 'VIEWER']}
      fallback={
        <PageHeader eyebrow="Cadastros" title="Catálogos Técnicos" description="Acesso restrito." />
      }
    >
      <div className="space-y-6">
        <PageHeader
          eyebrow="Cadastros"
          title="Catálogos Técnicos"
          description="Bibliotecas reutilizáveis para checklists, documentos e fluxos operacionais."
          actions={
            canEdit && selectedType && selectedType !== 'SERVICE_TYPE' ? (
              <button
                type="button"
                onClick={() => setEditor('create')}
                className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)]"
              >
                <Plus className="h-4 w-4" /> Novo item
              </button>
            ) : (
              <StatusChip tone="info">Somente leitura</StatusChip>
            )
          }
        />
        <div className="flex gap-2 overflow-x-auto border-b border-[var(--color-border)] pb-2">
          {(types.data ?? []).flatMap((type) => [
            <button
              key={type.value}
              type="button"
              onClick={() => {
                setSelectedType(type.value);
                setPage(1);
                setMaintenanceType('');
                setWorkflow('');
              }}
              className={`whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm ${selectedType === type.value ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-muted)]'}`}
            >
              {type.label}
            </button>,
            ...(type.value === 'CHECKLIST'
              ? [
                  <button
                    key="RVT_CHECKLIST"
                    type="button"
                    onClick={() => {
                      setSelectedType('RVT_CHECKLIST');
                      setPage(1);
                      setMaintenanceType('');
                      setWorkflow('');
                    }}
                    className={`whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm ${isRvtChecklist ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-muted)]'}`}
                  >
                    Checklist do RVT
                  </button>,
                  <button
                    key="PMOC_CHECKLIST"
                    type="button"
                    onClick={() => {
                      setSelectedType('PMOC_CHECKLIST');
                      setPage(1);
                      setMaintenanceType('');
                      setWorkflow('');
                    }}
                    className={`whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm ${isPmocChecklist ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-muted)]'}`}
                  >
                    Checklist PMOC
                  </button>,
                ]
              : []),
          ])}
          <button
            key="SERVICE_TYPE"
            type="button"
            onClick={() => {
              setSelectedType('SERVICE_TYPE');
              setPage(1);
              setMaintenanceType('');
              setWorkflow('');
            }}
            className={`whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm ${selectedType === 'SERVICE_TYPE' ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-muted)]'}`}
          >
            Tipo de Serviço
          </button>
        </div>
        {selectedType === 'SERVICE_TYPE' ? (
          <ServiceTypesPanel canEdit={canEdit} />
        ) : (
        <>
        {notice && (
          <div className="rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}
        {selectedType === 'CHECKLIST' && (
          <div className="rounded-[var(--radius-lg)] border border-blue-500/25 bg-blue-500/5 p-4 text-sm">
            <strong>Checklist operacional de OS e PMOC</strong>
            <p className="mt-1 text-[var(--color-muted-foreground)]">
              Cadastre aqui somente atividades enviadas para Ordens de Serviço e planos PMOC.
            </p>
          </div>
        )}
        {isRvtChecklist && (
          <div className="rounded-[var(--radius-lg)] border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm">
            <strong>Checklist exclusivo do Relatório de Visita Técnica</strong>
            <p className="mt-1 text-[var(--color-muted-foreground)]">
              Itens Semanais e Semestrais consumidos exclusivamente pelos wizards de RVT da
              Platform e do Operator.
            </p>
          </div>
        )}
        {isPmocChecklist && (
          <div className="rounded-[var(--radius-lg)] border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
            <strong>Checklist do Procedimento do PMOC (Lei nº 13.589/2018)</strong>
            <p className="mt-1 text-[var(--color-muted-foreground)]">
              Procedimentos fixos por unidade (Evaporadora e Condensadora). Ao criar um PMOC, o
              owner marca no wizard os itens executados, que preenchem a coluna “Executado” do
              relatório.
            </p>
          </div>
        )}
        {isEquipmentType && (
          <div className="rounded-[var(--radius-lg)] border border-cyan-500/25 bg-cyan-500/5 p-4 text-sm">
            <strong>Checklists de Equipamentos</strong>
            <p className="mt-1 text-[var(--color-muted-foreground)]">
              Tipos ativos aparecem no cadastro de equipamentos. Excluir ou renomear um tipo não
              apaga a classificação dos equipamentos já cadastrados.
            </p>
          </div>
        )}
        {isBudgetMaterial && (
          <div className="rounded-[var(--radius-lg)] border border-violet-500/25 bg-violet-500/5 p-4 text-sm">
            <strong>Descrições de materiais para Orçamentos</strong>
            <p className="mt-1 text-[var(--color-muted-foreground)]">
              Cadastre descrições reutilizáveis para o multi-select da etapa Materiais. O orçamento
              preserva uma cópia do texto selecionado.
            </p>
          </div>
        )}
        <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 md:grid-cols-3 xl:grid-cols-[minmax(220px,1fr)_170px_190px_190px_160px_170px]">
          <label className="flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3">
            <Search className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Pesquisar catálogo"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          {isPmocChecklist ? (
            <select
              value={pmocUnit}
              onChange={(event) => {
                setPmocUnit(event.target.value as PmocChecklistUnit);
                setPage(1);
              }}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
            >
              {PMOC_UNITS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          ) : effectiveType === 'CHECKLIST' ? (
            <select
              value={maintenanceType}
              onChange={(event) => {
                setMaintenanceType(event.target.value as OperationMaintenanceType | '');
                setPage(1);
              }}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
            >
              <option value="">Periodicidade</option>
              {(isRvtChecklist ? RVT_MAINTENANCE_TYPES : MAINTENANCE_TYPES).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="hidden xl:block" />
          )}
          {isSimpleCatalog ? (
            <span className="hidden xl:block" />
          ) : (
            <select
              value={area}
              onChange={(event) => {
                setArea(event.target.value as TechnicalCatalogArea | '');
                setPage(1);
              }}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
            >
              <option value="">Todas as áreas</option>
              {(taxonomy.data?.areas ?? []).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          )}
          {isSimpleCatalog ? (
            <span className="hidden xl:block" />
          ) : isRvtChecklist || isPmocChecklist || selectedType === 'CHECKLIST' ? (
            <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 text-sm">
              {isRvtChecklist
                ? 'Relatório de Visita Técnica'
                : isPmocChecklist
                  ? 'Checklist do Procedimento (PMOC)'
                  : 'Ordem de Serviço e PMOC'}
            </div>
          ) : (
            <select
              value={workflow}
              onChange={(event) => {
                setWorkflow(event.target.value as TechnicalCatalogWorkflow | '');
                setPage(1);
              }}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
            >
              <option value="">Workflows da aba</option>
              {(taxonomy.data?.workflows ?? []).map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          )}
          <select
            value={active}
            onChange={(event) => {
              setActive(event.target.value as typeof active);
              setPage(1);
            }}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
          >
            <option value="">Todos os status</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
          >
            <option value="sortOrder">Ordem manual</option>
            <option value="title">Título</option>
            <option value="updatedAt">Atualização</option>
          </select>
        </div>
        {catalogs.loading ? (
          <SkeletonCard />
        ) : catalogs.error ? (
          <EmptyState
            icon={BookOpenCheck}
            title="Não foi possível carregar"
            description={catalogs.error.message}
            action={
              <button
                type="button"
                onClick={catalogs.refetch}
                className="h-9 rounded border px-3 text-sm"
              >
                Tentar novamente
              </button>
            }
          />
        ) : !catalogs.data?.items.length ? (
          <EmptyState
            icon={BookOpenCheck}
            title="Nenhum item cadastrado"
            description="Crie itens reutilizáveis para agilizar os documentos técnicos."
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3">Ordem</th>
                  <th className="px-4 py-3">Título</th>
                  {effectiveType === 'CHECKLIST' && !isPmocChecklist && (
                    <th className="px-4 py-3">Periodicidade</th>
                  )}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {catalogs.data.items.map((item, index) => (
                  <tr key={item.id} draggable={canEdit && sortBy === 'sortOrder'}>
                    <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                      {item.sortOrder + 1}
                    </td>
                    <td className="px-4 py-3">
                      <strong>{item.title}</strong>
                      {item.description && <p className="mt-1 text-caption">{item.description}</p>}
                      {item.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.tags.slice(0, 5).map((tag) => (
                            <span key={tag} className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    {effectiveType === 'CHECKLIST' && !isPmocChecklist && (
                      <td className="px-4 py-3">
                        {MAINTENANCE_TYPES.find((type) => type.value === item.maintenanceType)
                          ?.label ?? '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <StatusChip tone={item.active ? 'success' : 'neutral'} dot>
                        {item.active ? 'Ativo' : 'Inativo'}
                      </StatusChip>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canEdit && sortBy === 'sortOrder' && (
                          <>
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => void move(item, -1)}
                              aria-label="Mover para cima"
                              className="rounded p-2 disabled:opacity-30"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={index === catalogs.data!.items.length - 1}
                              onClick={() => void move(item, 1)}
                              aria-label="Mover para baixo"
                              className="rounded p-2 disabled:opacity-30"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setEditor(item)}
                            aria-label={`Editar ${item.title}`}
                            className="rounded p-2"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() =>
                              void technicalCatalogsApi
                                .update(item.id, { active: !item.active })
                                .then(() =>
                                  changed(item.active ? 'Item desativado.' : 'Item ativado.'),
                                )
                            }
                            aria-label={item.active ? 'Desativar' : 'Ativar'}
                            className="rounded p-2"
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setRemoving(item)}
                            aria-label={`Excluir ${item.title}`}
                            className="rounded p-2 text-[var(--color-danger)]"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-[var(--color-border)] p-4">
              <Pagination
                pagination={catalogs.data.pagination}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setLimit(value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}
        {editor && effectiveType && (
          <TechnicalCatalogDrawer
            item={editor === 'create' ? null : editor}
            type={effectiveType}
            fixedWorkflows={
              isRvtChecklist
                ? ['TECHNICAL_REPORT']
                : isPmocChecklist
                  ? ['PMOC']
                  : selectedType === 'CHECKLIST'
                    ? ['WORK_ORDER', 'PMOC']
                    : undefined
            }
            pmocUnits={isPmocChecklist ? PMOC_UNITS : undefined}
            defaultPmocUnit={isPmocChecklist ? pmocUnit : undefined}
            maintenanceTypes={isRvtChecklist ? RVT_MAINTENANCE_TYPES : MAINTENANCE_TYPES}
            simple={isSimpleCatalog}
            taxonomy={taxonomy.data ?? undefined}
            onClose={() => setEditor(null)}
            onSaved={(message) => {
              setEditor(null);
              changed(message);
            }}
          />
        )}
        <ConfirmDialog
          open={Boolean(removing)}
          title="Excluir item do catálogo?"
          description="O item deixará de ser listado, mas documentos e operações existentes manterão seus snapshots."
          confirmLabel="Excluir"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            if (removing) {
              await technicalCatalogsApi.remove(removing.id);
              setRemoving(null);
              changed('Item excluído.');
            }
          }}
        />
        </>
        )}
      </div>
    </Gate>
  );
}

function TechnicalCatalogDrawer({
  item,
  type,
  taxonomy,
  fixedWorkflows,
  pmocUnits,
  defaultPmocUnit,
  maintenanceTypes,
  simple = false,
  onClose,
  onSaved,
}: {
  item: TechnicalCatalog | null;
  type: TechnicalCatalogType;
  taxonomy?: TechnicalCatalogTaxonomy;
  fixedWorkflows?: TechnicalCatalogWorkflow[];
  pmocUnits?: Array<{ value: PmocChecklistUnit; label: string }>;
  defaultPmocUnit?: PmocChecklistUnit;
  maintenanceTypes: Array<{ value: OperationMaintenanceType; label: string }>;
  simple?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '');
  const [areas, setAreas] = useState<TechnicalCatalogArea[]>(item?.areas ?? ['GENERAL']);
  const [workflows, setWorkflows] = useState<TechnicalCatalogWorkflow[]>(
    fixedWorkflows ?? item?.workflows ?? ['GENERAL'],
  );
  const [maintenanceType, setMaintenanceType] = useState<OperationMaintenanceType>(
    item?.maintenanceType ?? maintenanceTypes[0]?.value ?? 'SEMIANNUAL',
  );
  const [pmocUnit, setPmocUnit] = useState<PmocChecklistUnit>(
    item?.pmocUnit ?? defaultPmocUnit ?? 'EVAPORATOR',
  );
  const [active, setActive] = useState(item?.active ?? true);
  const [saving, setSaving] = useState(false);
  return (
    <Drawer
      open
      onClose={onClose}
      title={item ? 'Editar item' : 'Novo item'}
      eyebrow="Catálogo Técnico"
      width="max-w-xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded border px-3 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || title.trim().length < 2}
            onClick={async () => {
              setSaving(true);
              try {
                const payload = {
                  title: title.trim(),
                  description: description.trim() || null,
                  tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
                  areas,
                  workflows,
                  maintenanceType: type === 'CHECKLIST' ? maintenanceType : null,
                  pmocUnit: pmocUnits ? pmocUnit : null,
                  active,
                };
                if (item) await technicalCatalogsApi.update(item.id, payload);
                else await technicalCatalogsApi.create({ type, ...payload });
                onSaved(item ? 'Item atualizado.' : 'Item criado.');
              } finally {
                setSaving(false);
              }
            }}
            className="h-9 rounded bg-[var(--color-primary)] px-3 text-sm text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="grid gap-1 text-sm font-medium">
          Título
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            className="h-10 rounded border border-[var(--color-border)] bg-transparent px-3"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Descrição complementar
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={5000}
            className="rounded border border-[var(--color-border)] bg-transparent p-3"
          />
        </label>
        {!simple && (
          <label className="grid gap-1 text-sm font-medium">
            Tags
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="refrigeração, elétrica, segurança"
              className="h-10 rounded border border-[var(--color-border)] bg-transparent px-3"
            />
            <span className="text-caption">Separe por vírgulas. As tags serão normalizadas ao salvar.</span>
          </label>
        )}
        {!simple && (
          <CatalogMultiChoice
            label="Áreas aplicáveis"
            options={taxonomy?.areas ?? []}
            values={areas}
            onChange={setAreas}
          />
        )}
        {simple ? null : fixedWorkflows ? (
          <div className="grid gap-1 text-sm font-medium">
            Uso no sistema
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-muted)] p-3 font-normal">
              {fixedWorkflows
                .map(
                  (workflow) =>
                    taxonomy?.workflows.find((item) => item.value === workflow)?.label ?? workflow,
                )
                .join(' e ')}
            </div>
          </div>
        ) : (
          <CatalogMultiChoice
            label="Workflows aplicáveis"
            options={taxonomy?.workflows ?? []}
            values={workflows}
            onChange={setWorkflows}
          />
        )}
        {pmocUnits ? (
          <label className="grid gap-1 text-sm font-medium">
            Unidade
            <select
              value={pmocUnit}
              onChange={(event) => setPmocUnit(event.target.value as PmocChecklistUnit)}
              className="h-10 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-3"
            >
              {pmocUnits.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          type === 'CHECKLIST' && (
            <label className="grid gap-1 text-sm font-medium">
              Periodicidade
              <select
                value={maintenanceType}
                onChange={(event) =>
                  setMaintenanceType(event.target.value as OperationMaintenanceType)
                }
                className="h-10 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-3"
              >
                {maintenanceTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />{' '}
          Item ativo
        </label>
      </div>
    </Drawer>
  );
}

function CatalogMultiChoice<T extends string>({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  values: T[];
  onChange: (values: T[]) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded border border-[var(--color-border)] p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={(event) => {
                if (event.target.checked) onChange([...values, option.value]);
                else if (values.length > 1) onChange(values.filter((value) => value !== option.value));
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
