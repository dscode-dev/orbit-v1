'use client';

import { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock3, Gauge, TriangleAlert, Users } from 'lucide-react';
import { operatorExecutionsApi, useQuery, type OperatorExecutionRow } from '@erp/api';
import { EmptyState } from '@erp/ui/empty-state';
import { FilterBar } from '@erp/ui/filter-bar';
import { SkeletonList } from '@erp/ui/skeletons';
import { ErrorState } from '@erp/ui/states';
import { useDebounce, formatCurrencyBRL } from '@erp/utils';
import { DataTable, type Column } from '@platform/components/data-table';
import { PageHeader } from '@platform/components/page-header';
import { Pagination } from '@platform/components/pagination';

export default function OperatorExecutionsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const debouncedSearch = useDebounce(search, 300);
  const overview = useQuery(
    (signal) =>
      operatorExecutionsApi.list({
        month,
        search: debouncedSearch || undefined,
        page,
        limit,
        signal,
      }),
    [month, debouncedSearch, page, limit],
  );
  const columns = useMemo<Column<OperatorExecutionRow>[]>(
    () => [
      {
        key: 'operator',
        header: 'Operador',
        cell: (item) => (
          <div>
            <strong>{item.name}</strong>
            <span className="block text-caption">{item.jobTitle ?? `@${item.username}`}</span>
          </div>
        ),
      },
      { key: 'total', header: 'Atendimentos', cell: (item) => <MetricValue value={item.metrics.total} /> },
      { key: 'completed', header: 'Concluídos', cell: (item) => <MetricValue value={item.metrics.completed} tone="success" /> },
      { key: 'pending', header: 'Pendentes', cell: (item) => <MetricValue value={item.metrics.pending} tone="warning" /> },
      { key: 'progress', header: 'Em execução', cell: (item) => <MetricValue value={item.metrics.inProgress} /> },
      { key: 'overdue', header: 'Atrasados', cell: (item) => <MetricValue value={item.metrics.overdue} tone="danger" /> },
      { key: 'rate', header: 'Conclusão', cell: (item) => <span className="font-semibold tabular-nums">{formatPercent(item.metrics.completionRate)}</span> },
      { key: 'commission', header: 'Comissão', cell: (item) => <span className="text-sm font-semibold tabular-nums text-[var(--color-primary)]">{formatCurrencyBRL(item.metrics.commission)}</span> },
      { key: 'duration', header: 'Tempo médio', cell: (item) => <span className="text-sm tabular-nums">{formatDuration(item.metrics.averageDurationMinutes)}</span> },
      { key: 'status', header: 'Usuário', cell: (item) => <span className={item.isActive ? 'text-[var(--color-success)]' : 'text-[var(--color-muted-foreground)]'}>{item.isActive ? 'Ativo' : 'Inativo'}</span> },
    ],
    [],
  );

  return (
    <div className="max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow="Gestão"
        title="Execuções dos Operadores"
        description="Indicadores operacionais baseados nos atendimentos e operações realmente atribuídos a cada operador. Nenhum cálculo de comissão é realizado pelo Orbit."
        actions={<MonthField value={month} onChange={(value) => { setMonth(value); setPage(1); }} />}
      />
      {overview.data && <Kpis data={overview.data.kpis} />}
      <FilterBar
        search={search}
        onSearch={(value) => { setSearch(value); setPage(1); }}
        searchPlaceholder="Buscar operador, usuário ou cargo…"
      />
      {overview.loading && !overview.data ? (
        <SkeletonList rows={7} />
      ) : overview.error && !overview.data ? (
        <ErrorState error={overview.error} onRetry={overview.refetch} />
      ) : (overview.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={Users} title="Nenhum operador encontrado" description="Cadastre operadores ou ajuste o período e a busca." />
      ) : (
        <div className="space-y-4">
          <DataTable columns={columns} rows={overview.data?.items ?? []} rowHref={(item) => `/operator-executions/${item.id}?month=${month}`} />
          {overview.data && (
            <Pagination
              pagination={overview.data.pagination}
              onPageChange={setPage}
              onPageSizeChange={(value) => { setLimit(value); setPage(1); }}
              pageSizeOptions={[10, 20, 50]}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Kpis({ data }: { data: Awaited<ReturnType<typeof operatorExecutionsApi.list>>['kpis'] }) {
  const cards = [
    { label: 'Operadores ativos', value: data.activeOperators, helper: `${data.operators} cadastrados`, icon: Users },
    { label: 'Atendimentos no mês', value: data.total, helper: 'Agenda, atribuições e conclusões', icon: Activity },
    { label: 'Concluídos', value: data.completed, helper: formatPercent(data.completionRate), icon: CheckCircle2 },
    { label: 'Pendentes', value: data.pending, helper: `${data.inProgress} em execução`, icon: Clock3 },
    { label: 'Atrasados', value: data.overdue, helper: 'Execuções ainda abertas', icon: TriangleAlert },
    { label: 'Tempo médio', value: formatDuration(data.averageDurationMinutes), helper: 'Entre início e conclusão', icon: Gauge },
  ];
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{cards.map((card) => <div key={card.label} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]"><div className="flex items-center justify-between"><span className="text-caption">{card.label}</span><card.icon className="h-4 w-4 text-[var(--color-primary)]" /></div><strong className="mt-2 block text-2xl tabular-nums">{card.value}</strong><span className="text-caption">{card.helper}</span></div>)}</div>;
}

function MonthField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="flex items-center gap-2 text-sm font-medium"><span>Competência</span><input type="month" value={value} max="2200-12" onChange={(event) => { if (event.target.value) onChange(event.target.value); }} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3" /></label>;
}

function MetricValue({ value, tone }: { value: number; tone?: 'success' | 'warning' | 'danger' }) {
  const colors = { success: 'text-[var(--color-success)]', warning: 'text-[var(--color-warning)]', danger: 'text-[var(--color-danger)]' };
  return <span className={`font-semibold tabular-nums ${tone ? colors[tone] : ''}`}>{value}</span>;
}

function currentMonth(): string { return new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit' }).slice(0, 7); }
function formatPercent(value: number): string { return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`; }
function formatDuration(value: number | null): string { if (value === null) return '—'; const hours = Math.floor(value / 60); const minutes = value % 60; return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`; }
