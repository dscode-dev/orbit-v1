'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, ClipboardCheck } from 'lucide-react';
import { operatorExecutionsApi, useQuery, type OperatorExecutionOperation, type OperationStatus } from '@erp/api';
import { EmptyState } from '@erp/ui/empty-state';
import { StatusChip } from '@erp/ui/status-chip';
import { SkeletonList } from '@erp/ui/skeletons';
import { ErrorState } from '@erp/ui/states';
import { formatDateTime, formatCurrencyBRL } from '@erp/utils';
import { DataTable, type Column } from '@platform/components/data-table';
import { OperationDetailDrawer } from '@platform/components/operation-detail-drawer';
import { TechnicianCommissionPanel } from '@platform/components/technician-commission-panel';
import { PageHeader } from '@platform/components/page-header';
import { Pagination } from '@platform/components/pagination';
import { OPERATION_STATUS, operationCode } from '@erp/ui/operations/operation-shared';
import { useServiceTypeLabel } from '@erp/ui/operations/use-service-type-label';

export default function OperatorExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const typeLabel = useServiceTypeLabel();
  const searchParams = useSearchParams();
  const [month, setMonth] = useState(searchParams.get('month') ?? currentMonth());
  const [view, setView] = useState<'HISTORY' | 'AGENDA'>('HISTORY');
  const [status, setStatus] = useState<'all' | OperationStatus>('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [operationId, setOperationId] = useState<string | null>(null);
  const detail = useQuery((signal) => operatorExecutionsApi.get(id, { month, signal }), [id, month]);
  const operations = useQuery(
    (signal) => operatorExecutionsApi.operations(id, { month, view, status: status === 'all' ? undefined : status, page, limit, signal }),
    [id, month, view, status, page, limit],
  );
  const columns = useMemo<Column<OperatorExecutionOperation>[]>(() => [
    { key: 'number', header: 'Operação', cell: (item) => <span className="font-mono text-xs">{operationCode(item.number)}</span> },
    { key: 'customer', header: 'Cliente / equipamento', cell: (item) => <div><strong>{item.customer.tradeName ?? item.customer.name}</strong><span className="block text-caption">{item.equipment?.name ?? 'Sem equipamento principal'}</span></div> },
    { key: 'type', header: 'Serviço', cell: (item) => typeLabel(item.type) },
    { key: 'scheduled', header: 'Agendado', cell: (item) => item.scheduledFor ? formatDateTime(item.scheduledFor) : 'Não agendado' },
    { key: 'completed', header: 'Concluído', cell: (item) => item.completedAt ? formatDateTime(item.completedAt) : '—' },
    { key: 'status', header: 'Status', cell: (item) => <StatusChip tone={OPERATION_STATUS[item.status].tone} dot>{OPERATION_STATUS[item.status].label}</StatusChip> },
  ], []);

  if (detail.loading && !detail.data) return <SkeletonList rows={8} />;
  if (detail.error && !detail.data) return <ErrorState error={detail.error} onRetry={detail.refetch} />;
  if (!detail.data) return null;
  const { operator, metrics } = detail.data;
  return <div className="max-w-[1400px] space-y-6">
    <Link href={`/operator-executions?month=${month}`} className="inline-flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"><ArrowLeft className="h-4 w-4" />Voltar para operadores</Link>
    <PageHeader eyebrow="Execuções dos Operadores" title={operator.name} description={`${operator.jobTitle ?? 'Operador'} · @${operator.username}`} actions={<label className="flex items-center gap-2 text-sm font-medium">Competência<input type="month" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setPage(1); } }} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3" /></label>} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{[
      ['Atendimentos', metrics.total], ['Concluídos', metrics.completed], ['Pendentes', metrics.pending], ['Em execução', metrics.inProgress], ['Atrasados', metrics.overdue], ['Cancelados', metrics.canceled], ['Taxa de conclusão', `${metrics.completionRate.toLocaleString('pt-BR')}%`], ['Tempo médio', formatDuration(metrics.averageDurationMinutes)], ['Comissão', formatCurrencyBRL(metrics.commission)],
    ].map(([label, value]) => <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4"><span className="text-caption">{label}</span><strong className="mt-2 block text-xl tabular-nums">{value}</strong></div>)}</div>
    <TechnicianCommissionPanel operatorId={id} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)]">
      <div className="flex gap-1">{([['HISTORY', 'Histórico', ClipboardCheck], ['AGENDA', 'Agenda registrada', CalendarDays]] as const).map(([key, label, Icon]) => <button key={key} onClick={() => { setView(key); setPage(1); }} className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${view === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-muted-foreground)]'}`}><Icon className="h-4 w-4" />{label}</button>)}</div>
      <select value={status} onChange={(event) => { setStatus(event.target.value as 'all' | OperationStatus); setPage(1); }} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"><option value="all">Todos os status</option>{Object.entries(OPERATION_STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
    </div>
    {operations.loading && !operations.data ? <SkeletonList rows={6} /> : operations.error && !operations.data ? <ErrorState error={operations.error} onRetry={operations.refetch} /> : (operations.data?.items.length ?? 0) === 0 ? <EmptyState icon={view === 'AGENDA' ? CalendarDays : ClipboardCheck} title={view === 'AGENDA' ? 'Nenhum agendamento no período' : 'Nenhuma execução no período'} description="Selecione outra competência ou ajuste o filtro de status." /> : <div className="space-y-4"><DataTable columns={columns} rows={operations.data?.items ?? []} onRowClick={(item) => setOperationId(item.id)} />{operations.data && <Pagination pagination={operations.data.pagination} onPageChange={setPage} onPageSizeChange={(value) => { setLimit(value); setPage(1); }} />}</div>}
    <OperationDetailDrawer operationId={operationId} open={Boolean(operationId)} onClose={() => setOperationId(null)} />
  </div>;
}

function currentMonth(): string { return new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit' }).slice(0, 7); }
function formatDuration(value: number | null): string { if (value === null) return '—'; const hours = Math.floor(value / 60); const minutes = value % 60; return hours ? `${hours}h ${minutes}min` : `${minutes}min`; }
