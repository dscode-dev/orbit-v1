'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ContactRound,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  Trash2,
  Wrench,
  KeyRound,
} from 'lucide-react';
import { Breadcrumbs } from '@platform/components/breadcrumbs';
import { PageHeader } from '@platform/components/page-header';
import { InfoCard, InfoRow } from '@platform/components/info-card';
import { DataTable, type Column } from '@platform/components/data-table';
import { Pagination } from '@platform/components/pagination';
import { CustomerFormDrawer } from '@platform/components/customer-form-drawer';
import { EquipmentFormDrawer } from '@platform/components/equipment-form-drawer';
import { SaleFormDrawer } from '@platform/components/sale-form-drawer';
import { OperationDetailDrawer } from '@platform/components/operation-detail-drawer';
import { OperationCreationDrawer } from '@platform/components/operation-creation-drawer';
import { CustomerContactFormDrawer } from '@platform/components/customer-contact-form-drawer';
import { AddressFormDrawer } from '@platform/components/address-form-drawer';
import { AsyncBoundary, ErrorState } from '@erp/ui/states';
import { EmptyState } from '@erp/ui/empty-state';
import { SkeletonCard, SkeletonList } from '@erp/ui/skeletons';
import { StatusPill } from '@erp/ui/status-pill';
import { ConfirmDialog } from '@erp/ui/confirm-dialog';
import { Gate } from '@erp/ui/auth/gate';
import { useAuth } from '@erp/ui/auth/auth-provider';
import {
  ApiClientError,
  customersApi,
  equipmentsApi,
  operationApi,
  salesApi,
  serviceRequestsApi,
  useQuery,
  type CustomerDetail,
  type CustomerAddress,
  type CustomerContact,
  type CreateOperationPayload,
  type EquipmentDetail,
  type EquipmentSummary,
  type OperationSummary,
  type OperationStats,
  type Sale,
} from '@erp/api';
import { formatCurrencyBRL, formatDate, formatDateTime, maskCep } from '@erp/utils';
import { DOCUMENT_KIND_LABEL } from '@erp/types';
import { OPERATION_STATUS, OPERATION_TYPE_LABEL, operationCode } from '@erp/ui/operations/operation-shared';

type Tab = 'overview' | 'equipment' | 'services' | 'sales';
const formatMoney = formatCurrencyBRL;

export default function ClienteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [portalAccess, setPortalAccess] = useState(false);
  const detail = useQuery<CustomerDetail>(
    (signal) => customersApi.getCustomer(id, { signal }),
    [id],
  );
  return (
    <div className="max-w-[1400px] space-y-6">
      <Breadcrumbs
        items={[{ label: 'Clientes', href: '/clientes' }, { label: detail.data?.name ?? '…' }]}
      />
      <AsyncBoundary
        loading={detail.loading}
        error={detail.error}
        data={detail.data}
        onRetry={detail.refetch}
        skeleton={<SkeletonCard />}
      >
        {(customer) => (
          <>
            <PageHeader
              eyebrow={customer.type === 'COMPANY' ? 'Empresa' : 'Pessoa'}
              title={customer.name}
              description={customer.tradeName ?? customer.email ?? undefined}
              actions={
                <Gate roles={['OWNER', 'MANAGER']}>
                  <div className="flex flex-wrap gap-2">
                    {hasRole('OWNER') && <button className="btn-secondary" onClick={() => setPortalAccess(true)}><KeyRound className="h-4 w-4" /> Criar acesso ao portal</button>}
                    <button className="btn-secondary" onClick={() => setEditingCustomer(true)}><Pencil className="h-4 w-4" /> Editar cliente</button>
                  </div>
                </Gate>
              }
            />
            <nav
              className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]"
              aria-label="Áreas do cliente"
            >
              {(
                [
                  ['overview', 'Visão geral'],
                  ['equipment', 'Equipamentos'],
                  ['services', 'Serviços'],
                  ...(hasRole('OWNER', 'MANAGER', 'VIEWER') ? [['sales', 'Vendas']] : []),
                ] as Array<[Tab, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === value ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'}`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === 'overview' && <Overview customer={customer} onRefresh={detail.refetch} />}
            {tab === 'equipment' && <EquipmentTab customerId={id} />}
            {tab === 'services' && <ServicesTab customerId={id} />}
            {tab === 'sales' && <SalesTab customer={customer} />}
            <CustomerFormDrawer
              open={editingCustomer}
              onClose={() => setEditingCustomer(false)}
              onSaved={detail.refetch}
              customer={customer}
            />
            {portalAccess && <PortalAccessDialog customer={customer} onClose={() => setPortalAccess(false)} />}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}

function PortalAccessDialog({ customer, onClose }: { customer: CustomerDetail; onClose: () => void }) {
  const [name, setName] = useState(customer.contacts.find((item) => item.isPrimary)?.name || customer.name);
  const [email, setEmail] = useState(customer.contacts.find((item) => item.isPrimary)?.email || customer.email || '');
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null); const [password, setPassword] = useState<string | null>(null);
  async function create() { setSaving(true); setError(null); try { const result = await serviceRequestsApi.createPortalAccount(customer.id, { name: name.trim(), email: email.trim() }); setPassword(result.temporaryPassword); } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : 'Não foi possível criar o acesso.'); } finally { setSaving(false); } }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-floating)]"><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Acesso ao portal do cliente</h2><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">A conta funcionará somente em /customer/login.</p></div><button onClick={onClose} className="p-2">×</button></div>{password ? <div className="mt-5 space-y-4"><div className="rounded-[var(--radius-md)] border border-green-500/30 bg-green-500/10 p-4"><p className="text-sm font-medium text-green-700">Acesso criado. Copie a senha temporária agora:</p><code className="mt-2 block select-all break-all rounded bg-[var(--color-card)] p-3 text-base">{password}</code></div><p className="text-sm">Login: <strong>{email}</strong><br />Endereço: <strong>/customer/login</strong></p><button onClick={onClose} className="btn-primary w-full justify-center">Concluir</button></div> : <div className="mt-5 space-y-4">{error && <p className="rounded bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}<label className="grid gap-1.5 text-sm font-medium">Nome do usuário<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">E-mail de acesso<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><div className="flex justify-end gap-2"><button onClick={onClose} className="btn-secondary">Cancelar</button><button onClick={() => void create()} disabled={saving || !name.trim() || !email.trim()} className="btn-primary">{saving ? 'Criando…' : 'Criar acesso'}</button></div></div>}</div></div>;
}

function Overview({
  customer,
  onRefresh,
}: {
  customer: CustomerDetail;
  onRefresh: () => void;
}) {
  const { hasRole } = useAuth();
  const canManage = hasRole('OWNER', 'MANAGER');
  const [contactOpen, setContactOpen] = useState(false);
  const [addressDrawer, setAddressDrawer] = useState<{ address: CustomerAddress | null } | null>(null);
  const [editingContact, setEditingContact] = useState<CustomerContact | null>(null);
  const [deletingContact, setDeletingContact] = useState<CustomerContact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const stats = useQuery<OperationStats>(
    (signal) => operationApi.getOperationStats({ customerId: customer.id, signal }),
    [customer.id],
  );
  const recent = useQuery(
    (signal) => operationApi.listOperations({ customerId: customer.id, page: 1, limit: 5, signal }),
    [customer.id],
  );
  const pending =
    (stats.data?.byStatus.DRAFT ?? 0) +
    (stats.data?.byStatus.PENDING ?? 0) +
    (stats.data?.byStatus.REVIEW ?? 0);

  async function removeContact() {
    if (!deletingContact) return;
    setDeleting(true);
    setContactError(null);
    try {
      await customersApi.deleteContact(customer.id, deletingContact.id);
      setDeletingContact(null);
      onRefresh();
    } catch (cause) {
      setContactError(
        cause instanceof ApiClientError ? cause.message : 'Não foi possível excluir o contato.',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CustomerKpi
            icon={Activity}
            label="Atendimentos"
            value={stats.loading ? '…' : String(stats.data?.total ?? 0)}
            hint="Total registrado"
          />
          <CustomerKpi
            icon={CheckCircle2}
            label="Concluídos"
            value={stats.loading ? '…' : String(stats.data?.byStatus.COMPLETED ?? 0)}
            hint="Operações finalizadas"
            tone="success"
          />
          <CustomerKpi
            icon={Wrench}
            label="Em execução"
            value={stats.loading ? '…' : String(stats.data?.byStatus.IN_PROGRESS ?? 0)}
            hint="Atendimentos em campo"
            tone="primary"
          />
          <CustomerKpi
            icon={Clock3}
            label="Pendências"
            value={stats.loading ? '…' : String(pending)}
            hint="Rascunho, pendente ou revisão"
            tone="warning"
          />
        </div>

        {stats.error && (
          <ErrorState error={stats.error} onRetry={stats.refetch} />
        )}

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1.35fr]">
          <InfoCard title="Identificação e canais">
            <InfoRow
              label="Status"
              value={
                <StatusPill
                  status={customer.isActive ? 'success' : 'offline'}
                  label={customer.isActive ? 'Ativo' : 'Inativo'}
                />
              }
            />
            {customer.tradeName && <InfoRow label="Nome fantasia" value={customer.tradeName} />}
            <InfoRow
              label={customer.type === 'COMPANY' ? 'CNPJ' : 'CPF'}
              value={customer.cnpj ?? customer.cpf ?? 'Não informado'}
            />
            <InfoRow label="E-mail principal" value={customer.email ?? 'Não informado'} />
            <InfoRow label="Telefone principal" value={customer.phone ?? 'Não informado'} />
            {customer.secondaryPhone && (
              <InfoRow label="Telefone adicional" value={customer.secondaryPhone} />
            )}
            <InfoRow label="Cliente desde" value={formatDate(customer.createdAt)} />
            {customer.notes && <InfoRow label="Observações" value={customer.notes} />}
          </InfoCard>

          <InfoCard
            title={`Endereços (${customer.addresses.length})`}
            action={
              canManage ? (
                <button
                  type="button"
                  onClick={() => setAddressDrawer({ address: null })}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 h-8 text-xs font-medium hover:bg-[var(--color-muted)]"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar endereço
                </button>
              ) : undefined
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              {customer.addresses.map((address) => (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => canManage && setAddressDrawer({ address })}
                  disabled={!canManage}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3 text-left transition enabled:hover:border-[var(--color-primary)]/40 enabled:hover:bg-[var(--color-muted)]/40 disabled:cursor-default"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <MapPin className="h-4 w-4 text-[var(--color-primary)]" />
                    {address.name || 'Endereço'}
                    {address.isPrimary && (
                      <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                        PRINCIPAL
                      </span>
                    )}
                    {canManage && <span className="ml-auto text-[11px] text-[var(--color-primary)]">editar</span>}
                  </div>
                  <p className="mt-2 text-caption">
                    {[
                      [address.street, address.number].filter(Boolean).join(', '),
                      address.complement,
                      address.district,
                      [address.city, address.state].filter(Boolean).join('/'),
                      address.zipCode ? `CEP ${maskCep(address.zipCode)}` : null,
                      address.referencePoint ? `Referência: ${address.referencePoint}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Dados de endereço incompletos'}
                  </p>
                </button>
              ))}
              {!customer.addresses.length && (
                <EmptyState
                  icon={MapPin}
                  title="Nenhum endereço"
                  description="Use “Adicionar endereço” para cadastrar o primeiro."
                />
              )}
            </div>
          </InfoCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <InfoCard title="Atendimentos recentes">
            {recent.loading && !recent.data ? (
              <SkeletonList rows={3} />
            ) : recent.error ? (
              <ErrorState error={recent.error} onRetry={recent.refetch} />
            ) : recent.data?.items.length ? (
              <div className="divide-y divide-[var(--color-border)]">
                {recent.data.items.map((operation) => (
                  <button
                    key={operation.id}
                    type="button"
                    onClick={() => setOperationId(operation.id)}
                    className="flex w-full items-center justify-between gap-4 py-3 text-left hover:text-[var(--color-primary)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {operationCode(operation.number)} ·{' '}
                        {DOCUMENT_KIND_LABEL[operation.requestedDocumentType]}
                      </p>
                      <p className="truncate text-caption">
                        {operation.equipment?.name ?? 'Sem equipamento específico'} ·{' '}
                        {OPERATION_TYPE_LABEL[operation.type]}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusPill
                        status={
                          operation.status === 'COMPLETED'
                            ? 'success'
                            : operation.status === 'CANCELED'
                              ? 'danger'
                              : 'warning'
                        }
                        label={OPERATION_STATUS[operation.status].label}
                      />
                      <p className="mt-1 text-caption">
                        {formatDate(operation.completedAt ?? operation.scheduledFor ?? operation.createdAt)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Wrench}
                title="Nenhum atendimento"
                description="As operações deste cliente aparecerão aqui."
              />
            )}
          </InfoCard>

          <InfoCard
            title={`Contatos (${customer.contacts.length})`}
            action={
              canManage ? (
                <button
                  type="button"
                  className="btn-secondary h-8 px-2.5"
                  onClick={() => {
                    setContactError(null);
                    setEditingContact(null);
                    setContactOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar
                </button>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {contactError && (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">
                  {contactError}
                </div>
              )}
              {customer.contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{contact.name}</strong>
                        {contact.isPrimary && (
                          <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                            PRINCIPAL
                          </span>
                        )}
                      </div>
                      <p className="text-caption">{contact.role ?? 'Contato do cliente'}</p>
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Editar ${contact.name}`}
                          className="rounded-md p-2 hover:bg-[var(--color-muted)]"
                          onClick={() => {
                            setContactError(null);
                            setEditingContact(contact);
                            setContactOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Excluir ${contact.name}`}
                          className="rounded-md p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                          onClick={() => {
                            setContactError(null);
                            setDeletingContact(contact);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-caption">
                    {contact.phone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" /> {contact.phone}
                      </p>
                    )}
                    {contact.email && (
                      <p className="flex items-center gap-2 break-all">
                        <Mail className="h-3.5 w-3.5" /> {contact.email}
                      </p>
                    )}
                    {contact.notes && <p className="pt-1">{contact.notes}</p>}
                  </div>
                </div>
              ))}
              {!customer.contacts.length && (
                <EmptyState
                  icon={ContactRound}
                  title="Nenhum contato cadastrado"
                  description={
                    canManage
                      ? 'Adicione a primeira pessoa de contato deste cliente.'
                      : 'Ainda não existem contatos disponíveis.'
                  }
                />
              )}
            </div>
          </InfoCard>
        </div>
      </div>

      <CustomerContactFormDrawer
        open={contactOpen}
        customerId={customer.id}
        contact={editingContact}
        onClose={() => setContactOpen(false)}
        onSaved={onRefresh}
      />
      <AddressFormDrawer
        open={addressDrawer !== null}
        customerId={customer.id}
        address={addressDrawer?.address ?? null}
        onClose={() => setAddressDrawer(null)}
        onSaved={onRefresh}
      />
      <ConfirmDialog
        open={Boolean(deletingContact)}
        title="Excluir contato?"
        description={`O contato ${deletingContact?.name ?? ''} deixará de aparecer neste cliente.`}
        confirmLabel={deleting ? 'Excluindo…' : 'Excluir contato'}
        danger
        onClose={() => {
          if (!deleting) setDeletingContact(null);
        }}
        onConfirm={removeContact}
      />
      <OperationDetailDrawer
        operationId={operationId}
        open={Boolean(operationId)}
        onClose={() => setOperationId(null)}
      />
    </>
  );
}

function CustomerKpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning';
}) {
  const tones = {
    neutral: 'bg-[var(--color-muted)] text-[var(--color-foreground)]',
    primary: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
    success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
    warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
  };
  return (
    <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-caption">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-caption">{hint}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-[var(--radius-md)] ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </article>
  );
}

function EquipmentTab({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentDetail | null>(null);
  const list = useQuery(
    (signal) => equipmentsApi.listEquipments({ customerId, page, limit, signal }),
    [customerId, page, limit],
  );
  const columns = useMemo<Column<EquipmentSummary>[]>(
    () => [
      {
        key: 'name',
        header: 'Equipamento',
        cell: (item) => (
          <div>
            <strong>{item.name}</strong>
            <p className="text-caption">
              {item.tag ?? item.serialNumber ?? 'Sem identificação auxiliar'}
            </p>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Tipo',
        cell: (item) => item.equipmentTypeCatalog?.title ?? item.type,
      },
      {
        key: 'model',
        header: 'Modelo',
        cell: (item) =>
          [item.manufacturer, item.model, item.capacity].filter(Boolean).join(' · ') || '—',
      },
      {
        key: 'status',
        header: 'Status',
        cell: (item) => (
          <StatusPill
            status={
              item.status === 'ACTIVE'
                ? 'success'
                : item.status === 'MAINTENANCE'
                  ? 'warning'
                  : 'offline'
            }
            label={item.status}
          />
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-16',
        link: false,
        cell: (item) => (
          <Gate roles={['OWNER', 'MANAGER']}>
            <button
              type="button"
              aria-label={`Editar ${item.name}`}
              title="Editar equipamento"
              className="rounded-md border border-[var(--color-border)] p-2"
              onClick={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                setEditing(await equipmentsApi.getEquipment(item.id));
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </button>
          </Gate>
        ),
      },
    ],
    [],
  );
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Equipamentos do cliente</h2>
          <p className="text-caption">Cadastro, manutenção e acesso ao histórico de cada ativo.</p>
        </div>
        <Gate roles={['OWNER', 'MANAGER']}>
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Novo equipamento
          </button>
        </Gate>
      </div>
      {list.loading && !list.data ? (
        <SkeletonList rows={5} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data?.items.length ? (
        <>
          <DataTable
            columns={columns}
            rows={list.data.items}
            rowHref={(item) => `/equipamentos/${item.id}`}
          />
          <Pagination
            pagination={list.data.pagination}
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setLimit(value);
              setPage(1);
            }}
          />
        </>
      ) : (
        <EmptyState
          icon={Wrench}
          title="Nenhum equipamento"
          description="Cadastre o primeiro equipamento deste cliente."
        />
      )}
      <EquipmentFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={list.refetch}
        equipment={editing}
        presetCustomerId={customerId}
      />
    </section>
  );
}

function ServicesTab({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [creationOpen, setCreationOpen] = useState(false);
  const creationDefaults = useMemo<Partial<CreateOperationPayload>>(
    () => ({
      customerId,
      type: 'PREVENTIVA',
      documentType: 'WORK_ORDER',
      status: 'DRAFT',
    }),
    [customerId],
  );
  const list = useQuery(
    (signal) => operationApi.listOperations({ customerId, page, limit, signal }),
    [customerId, page, limit],
  );
  const columns: Column<OperationSummary>[] = [
    {
      key: 'number',
      header: 'Atendimento',
      cell: (item) => <strong>{operationCode(item.number)}</strong>,
    },
    {
      key: 'document',
      header: 'Serviço / documento',
      cell: (item) => (
        <div>
          {DOCUMENT_KIND_LABEL[item.requestedDocumentType]}
          <p className="text-caption">{OPERATION_TYPE_LABEL[item.type]}</p>
        </div>
      ),
    },
    {
      key: 'equipment',
      header: 'Equipamento',
      cell: (item) => item.equipment?.name ?? 'Sem equipamento específico',
    },
    { key: 'operator', header: 'Responsável', cell: (item) => item.operator?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      cell: (item) => (
        <StatusPill
          status={
            item.status === 'COMPLETED'
              ? 'success'
              : item.status === 'CANCELED'
                ? 'danger'
                : 'warning'
          }
          label={OPERATION_STATUS[item.status].label}
        />
      ),
    },
    {
      key: 'date',
      header: 'Data',
      cell: (item) => formatDateTime(item.completedAt ?? item.scheduledFor ?? item.createdAt),
    },
  ];
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Serviços registrados</h2>
          <p className="text-caption">
            Ordens de Serviço, visitas, laudos e demais atendimentos vinculados ao cliente.
          </p>
        </div>
        <Gate roles={['OWNER', 'MANAGER']}>
          <button type="button" className="btn-primary" onClick={() => setCreationOpen(true)}>
            <Plus className="h-4 w-4" />
            Novo atendimento
          </button>
        </Gate>
      </div>
      {list.loading && !list.data ? (
        <SkeletonList rows={5} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data?.items.length ? (
        <>
          <DataTable
            columns={columns}
            rows={list.data.items}
            onRowClick={(item) => setOperationId(item.id)}
          />
          <Pagination
            pagination={list.data.pagination}
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setLimit(value);
              setPage(1);
            }}
          />
        </>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title="Nenhum serviço registrado"
          description="Os atendimentos do cliente aparecerão aqui."
        />
      )}
      <OperationDetailDrawer
        operationId={operationId}
        open={Boolean(operationId)}
        onClose={() => setOperationId(null)}
      />
      <OperationCreationDrawer
        open={creationOpen}
        mode="service"
        initialValues={creationDefaults}
        lockCustomer
        contextNotice="Este atendimento será criado diretamente para o cliente selecionado."
        onClose={() => setCreationOpen(false)}
        onCreated={() => {
          void list.refetch();
        }}
      />
    </section>
  );
}

function SalesTab({ customer }: { customer: CustomerDetail }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Sale | null>(null);
  const list = useQuery(
    (signal) => salesApi.listSales({ customerId: customer.id, page, limit, signal }),
    [customer.id, page, limit],
  );
  const reload = () => list.refetch();
  const columns: Column<Sale>[] = [
    {
      key: 'number',
      header: 'Venda',
      cell: (item) => <strong>V-{String(item.number).padStart(6, '0')}</strong>,
    },
    { key: 'date', header: 'Data', cell: (item) => formatDate(item.soldAt) },
    {
      key: 'items',
      header: 'Itens',
      cell: (item) => (
        <div>
          {item.items.length} produto(s)
          <p className="text-caption truncate max-w-xs">
            {item.items.map((line) => line.description).join(', ')}
          </p>
        </div>
      ),
    },
    { key: 'total', header: 'Total', cell: (item) => formatMoney(Number(item.total)) },
    {
      key: 'warranty',
      header: 'Garantia',
      cell: (item) =>
        item.warrantyDays ? (
          <div>
            {item.warrantyDays} dias
            <p className="text-caption">até {formatDate(item.warrantyEndsAt)}</p>
          </div>
        ) : (
          'Sem garantia'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (item) => (
        <StatusPill
          status={
            item.status === 'COMPLETED'
              ? 'success'
              : item.status === 'CANCELED'
                ? 'danger'
                : 'warning'
          }
          label={item.status}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Ações',
      cell: (item) => (
        <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
          {item.status === 'DRAFT' && (
            <Gate roles={['OWNER', 'MANAGER']}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(item);
                  setFormOpen(true);
                }}
              >
                Editar
              </button>
              <button
                className="btn-secondary"
                onClick={async () => {
                  await salesApi.completeSale(item.id);
                  reload();
                }}
              >
                Concluir
              </button>
            </Gate>
          )}
          {item.status === 'COMPLETED' && (
            <Link className="btn-secondary" href={`/reports?create=RECEIPT&saleId=${item.id}`}>
              Criar recibo
            </Link>
          )}
          {item.status !== 'CANCELED' && (
            <Gate roles={['OWNER', 'MANAGER']}>
              <button
                className="btn-secondary text-[var(--color-danger)]"
                onClick={async () => {
                  if (!window.confirm('Deseja realmente cancelar esta venda? O histórico será preservado.')) return;
                  await salesApi.cancelSale(item.id);
                  reload();
                }}
              >
                Cancelar
              </button>
            </Gate>
          )}
        </div>
      ),
    },
  ];
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Vendas do cliente</h2>
          <p className="text-caption">
            Produtos, datas e cobertura de garantia preservados para emissão de recibos.
          </p>
        </div>
        <Gate roles={['OWNER', 'MANAGER']}>
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nova venda
          </button>
        </Gate>
      </div>
      {list.loading && !list.data ? (
        <SkeletonList rows={5} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data?.items.length ? (
        <>
          <DataTable columns={columns} rows={list.data.items} />
          <Pagination
            pagination={list.data.pagination}
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setLimit(value);
              setPage(1);
            }}
          />
        </>
      ) : (
        <EmptyState
          icon={CircleDollarSign}
          title="Nenhuma venda registrada"
          description="Registre produtos vendidos para controlar a garantia e emitir o recibo."
        />
      )}
      <SaleFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        customerId={customer.id}
        addresses={customer.addresses}
        sale={editing}
      />
    </section>
  );
}
