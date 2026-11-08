'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, Users, Pencil, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@platform/components/page-header';
import { DataTable, type Column } from '@platform/components/data-table';
import { Pagination } from '@platform/components/pagination';
import { StatusPill } from '@erp/ui/status-pill';
import { StatusChip } from '@erp/ui/status-chip';
import { SkeletonList } from '@erp/ui/skeletons';
import { EmptyState } from '@erp/ui/empty-state';
import { ErrorState } from '@erp/ui/states';
import { Gate } from '@erp/ui/auth/gate';
import { ConfirmDialog } from '@erp/ui/confirm-dialog';
import { CustomerFormDrawer } from '@platform/components/customer-form-drawer';
import { customersApi, errorMessage, useQuery, type Customer } from '@erp/api';
import { useDebounce } from '@erp/utils';

export default function ClientesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState('active');
  const debounced = useDebounce(search, 300);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [statusTarget, setStatusTarget] = useState<Customer | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery(
    (signal) =>
      customersApi.listCustomers({
        page,
        limit,
        search: debounced || undefined,
        isActive: status === 'active',
        signal,
      }),
    [page, limit, debounced, status],
  );
  const stats = useQuery((signal) => customersApi.getCustomerStats({ signal }), []);

  const columns = useMemo<Column<Customer>[]>(
    () => [
      {
        key: 'name',
        header: 'Cliente',
        cell: (c) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{c.name}</span>
              {c.pendingReview && <StatusChip tone="warning">Revisão</StatusChip>}
            </div>
            <div className="text-caption truncate">{c.tradeName ?? c.email ?? c.phone ?? '—'}</div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Tipo',
        className: 'w-[120px]',
        cell: (c) => (
          <span className="text-[11px] uppercase tracking-wider rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[var(--color-muted-foreground)]">
            {c.type === 'COMPANY' ? 'Empresa' : 'Pessoa'}
          </span>
        ),
      },
      {
        key: 'doc',
        header: 'Documento',
        className: 'w-[180px]',
        cell: (c) => <span className="font-mono text-xs">{c.cnpj ?? c.cpf ?? '—'}</span>,
      },
      {
        key: 'phone',
        header: 'Contato',
        className: 'w-[170px]',
        cell: (c) => <span className="text-sm truncate">{c.phone ?? c.email ?? '—'}</span>,
      },
      {
        key: 'counts',
        header: 'Vínculos',
        className: 'w-[140px]',
        cell: (c) => (
          <span className="text-caption">
            {c._count ? `${c._count.addresses} end · ${c._count.contacts} cont` : '—'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        className: 'w-[120px]',
        cell: (c) => (
          <StatusPill
            status={c.isActive ? 'success' : 'offline'}
            label={c.isActive ? 'Ativo' : 'Desativado'}
          />
        ),
      },
      {
        key: 'actions',
        header: 'Ações',
        className: 'w-[140px]',
        cell: (c) => (
          <Gate roles={['OWNER', 'MANAGER']}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`Editar ${c.name}`}
                title="Editar cliente"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditing(c);
                  setFormOpen(true);
                }}
                className="rounded-md border border-[var(--color-border)] p-2 hover:bg-[var(--color-muted)]"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`${c.isActive ? 'Desativar' : 'Reativar'} ${c.name}`}
                title={c.isActive ? 'Desativar cliente' : 'Reativar cliente'}
                onClick={(event) => {
                  event.stopPropagation();
                  setStatusError(null);
                  setNotice(null);
                  setStatusTarget(c);
                }}
                className={`rounded-md border border-[var(--color-border)] p-2 hover:bg-[var(--color-muted)] ${c.isActive ? 'text-[var(--color-danger)]' : 'text-[var(--color-primary)]'}`}
              >
                {c.isActive ? (
                  <UserRoundX className="h-4 w-4" />
                ) : (
                  <UserRoundCheck className="h-4 w-4" />
                )}
              </button>
            </div>
          </Gate>
        ),
      },
    ],
    [],
  );

  function reload() {
    list.refetch();
    stats.refetch();
  }

  async function changeStatus() {
    if (!statusTarget) return;
    setStatusError(null);
    try {
      if (statusTarget.isActive) {
        await customersApi.disableCustomer(statusTarget.id);
      } else {
        await customersApi.enableCustomer(statusTarget.id);
      }
    } catch (error) {
      setStatusError(errorMessage(error));
      throw error;
    }
    setNotice(
      `Cliente ${statusTarget.name} ${statusTarget.isActive ? 'desativado' : 'reativado'} com sucesso.`,
    );
    if (page > 1 && list.data?.items.length === 1) {
      setPage(page - 1);
    } else {
      list.refetch();
    }
    stats.refetch();
  }

  const s = stats.data;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        eyebrow="Cadastros"
        title="Clientes"
        description="Gerencie sua carteira de clientes ativos e desativados."
        actions={
          <Gate roles={['OWNER', 'MANAGER']}>
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-hover)]"
            >
              <Plus className="h-4 w-4" /> Novo cliente
            </button>
          </Gate>
        }
      />

      {notice && (
        <p
          role="status"
          className="rounded-[var(--radius-md)] bg-[var(--color-success)]/10 p-3 text-sm text-[var(--color-success)]"
        >
          {notice}
        </p>
      )}

      {/* Stats */}
      {s && (
        <div className="flex flex-wrap gap-2 text-caption">
          <Chip label="Total" value={s.total} />
          <Chip label="Ativos" value={s.active} />
          <Chip label="Desativados" value={s.inactive} />
          <Chip label="Empresas" value={s.companies} />
          <Chip label="Pessoas" value={s.people} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 h-9 w-full max-w-[360px]">
          <Search className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nome, documento, telefone ou e-mail…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--color-muted-foreground)]"
          />
        </div>
        <Gate roles={['OWNER', 'MANAGER']}>
          <label className="flex items-center gap-2 text-sm">
            Status
            <select
              aria-label="Status dos clientes"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
                setNotice(null);
              }}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm outline-none focus:border-[var(--color-primary)]"
            >
              <option value="active">Ativos</option>
              <option value="inactive">Desativados</option>
            </select>
          </label>
        </Gate>
      </div>

      {/* List */}
      {list.loading ? (
        <SkeletonList rows={6} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            debounced
              ? 'Nenhum cliente encontrado'
              : status === 'inactive'
                ? 'Nenhum cliente desativado'
                : 'Nenhum cliente ativo'
          }
          description={
            debounced
              ? 'Ajuste a busca e tente novamente.'
              : status === 'inactive'
                ? 'Os clientes desativados aparecerão aqui.'
                : 'Cadastre um cliente ou consulte o filtro de desativados.'
          }
        />
      ) : list.data ? (
        <div className="space-y-3">
          <DataTable
            columns={columns}
            rows={list.data.items}
            onRowClick={(c) => router.push(`/clientes/${c.id}`)}
          />
          <Pagination
            pagination={list.data.pagination}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
        </div>
      ) : null}

      {/* Drawers */}
      <CustomerFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        customer={editing}
      />
      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.isActive ? 'Desativar cliente?' : 'Reativar cliente?'}
        description={
          <div className="space-y-2">
            <p>
              {statusTarget?.isActive
                ? `O cliente ${statusTarget.name} sairá da lista de ativos. Seus dados e histórico serão preservados e poderão ser consultados no filtro de desativados.`
                : `O cliente ${statusTarget?.name ?? ''} voltará a aparecer na lista de ativos.`}
            </p>
            {statusError && (
              <p role="alert" className="text-[var(--color-danger)]">
                {statusError}
              </p>
            )}
          </div>
        }
        confirmLabel={statusTarget?.isActive ? 'Desativar cliente' : 'Reativar cliente'}
        danger={statusTarget?.isActive}
        onClose={() => {
          setStatusTarget(null);
          setStatusError(null);
        }}
        onConfirm={changeStatus}
      />
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="font-medium text-[var(--color-foreground)] tabular-nums">{value}</span>
    </span>
  );
}
