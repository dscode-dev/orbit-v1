"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Breadcrumbs } from "@platform/components/breadcrumbs";
import { PageHeader } from "@platform/components/page-header";
import { InfoCard, InfoRow } from "@platform/components/info-card";
import { QrFoundation } from "@platform/components/qr-foundation";
import { StatusPill } from "@erp/ui/status-pill";
import { StatusChip } from "@erp/ui/status-chip";
import { SkeletonCard, SkeletonList } from "@erp/ui/skeletons";
import { AsyncBoundary, ErrorState } from "@erp/ui/states";
import { EmptyState } from "@erp/ui/empty-state";
import { DrawerTabs } from "@erp/ui/drawer-tabs";
import { AssetTimeline } from "@erp/ui/assets/asset-timeline";
import { OperationDetailDrawer } from "@platform/components/operation-detail-drawer";
import { OPERATION_STATUS, operationCode } from "@erp/ui/operations/operation-shared";
import { useServiceTypeLabel } from "@erp/ui/operations/use-service-type-label";
import { equipmentsApi, assetLifecycleApi, operationApi, pmocApi, useQuery, type EquipmentDetail, type AssetLifecycleStats } from "@erp/api";
import { formatDate, formatDateTime } from "@erp/utils";
import {
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_STATUS_PILL,
  EQUIPMENT_TYPE_LABEL,
} from "@platform/equipment-display";

const TABS = ["Resumo", "Informações", "Operações", "Timeline", "Documentos", "Métricas", "Anexos"] as const;
type Tab = (typeof TABS)[number];

export default function EquipamentoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const typeLabel = useServiceTypeLabel();
  const [tab, setTab] = useState<Tab>("Resumo");
  const [operationId, setOperationId] = useState<string | null>(null);
  const detail = useQuery<EquipmentDetail>((signal) => equipmentsApi.getEquipment(id, { signal }), [id]);
  const lifecycleStats = useQuery<AssetLifecycleStats>((signal) => assetLifecycleApi.getEquipmentLifecycleStats(id, { signal }), [id]);
  const pmocs = useQuery((signal) => pmocApi.listPmoc({ equipmentId: id, page: 1, limit: 5, signal }), [id]);
  const operations = useQuery((signal) => operationApi.listOperations({ equipmentId: id, limit: 50, signal }), [id]);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <Breadcrumbs items={[{ label: "Equipamentos", href: "/equipamentos" }, { label: detail.data?.name ?? "…" }]} />

      <AsyncBoundary
        loading={detail.loading}
        error={detail.error}
        data={detail.data}
        onRetry={detail.refetch}
        skeleton={<div className="grid gap-3 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>}
      >
        {(e) => (
          <>
            <PageHeader
              eyebrow={e.equipmentTypeCatalog?.title ?? EQUIPMENT_TYPE_LABEL[e.type]}
              title={e.name}
              description={e.customer?.name ?? undefined}
              actions={<StatusPill status={EQUIPMENT_STATUS_PILL[e.status]} label={EQUIPMENT_STATUS_LABEL[e.status]} />}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-4">
                <DrawerTabs tabs={TABS} active={tab} onChange={setTab} counts={{ "Operações": operations.data?.pagination.total, Timeline: lifecycleStats.data?.total, Métricas: e.metrics.length, Anexos: e.attachments.length }} />

                {tab === "Resumo" && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <InfoCard title="Preventivas"><p className="text-2xl font-semibold">{lifecycleStats.data?.preventiveCount ?? "—"}</p></InfoCard>
                      <InfoCard title="Corretivas"><p className="text-2xl font-semibold">{lifecycleStats.data?.correctiveCount ?? "—"}</p></InfoCard>
                      <InfoCard title="Documentos"><p className="text-2xl font-semibold">{lifecycleStats.data?.documentCount ?? "—"}</p></InfoCard>
                      <InfoCard title="Inspeções"><p className="text-2xl font-semibold">{lifecycleStats.data?.inspectionCount ?? "—"}</p></InfoCard>
                    </div>
                    <InfoCard title="Últimos eventos">
                      <AssetTimeline equipmentId={e.id} limit={5} compact onOpenOperation={setOperationId} />
                    </InfoCard>
                  </>
                )}

                {tab === "Informações" && (
                  <InfoCard title="Ficha técnica">
                  <InfoRow label="Tag" value={e.tag ?? "—"} />
                  <InfoRow label="Fabricante" value={e.manufacturer ?? "—"} />
                  <InfoRow label="Modelo" value={e.model ?? "—"} />
                  <InfoRow label="Nº de série" value={<span className="font-mono text-xs">{e.serialNumber ?? "—"}</span>} />
                  <InfoRow label="Capacidade" value={e.capacity ?? "—"} />
                  <InfoRow label="Tensão" value={e.voltage ?? "—"} />
                  <InfoRow label="Instalação" value={formatDate(e.installationDate)} />
                  <InfoRow label="Garantia até" value={formatDate(e.warrantyExpiration)} />
                  <InfoRow label="Local" value={e.address?.name ?? e.address?.city ?? "—"} />
                  {e.observations && <InfoRow label="Observações" value={e.observations} />}
                  </InfoCard>
                )}

                {tab === "Operações" && (
                  <InfoCard title={`Histórico de operações${operations.data ? ` (${operations.data.pagination.total})` : ""}`}>
                    {operations.loading && !operations.data ? (
                      <SkeletonList rows={5} />
                    ) : operations.error && !operations.data ? (
                      <ErrorState error={operations.error} onRetry={operations.refetch} />
                    ) : (operations.data?.items.length ?? 0) === 0 ? (
                      <EmptyState icon={Activity} title="Nenhuma operação" description="Ainda não há atendimentos registrados para este equipamento." />
                    ) : (
                      <ul className="divide-y divide-[var(--color-border)]">
                        {(operations.data?.items ?? []).map((op) => (
                          <li key={op.id}>
                            <button type="button" onClick={() => setOperationId(op.id)} className="-mx-2 flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5 text-left hover:bg-[var(--color-muted)]/40">
                              <span className="w-24 shrink-0 font-mono text-xs text-[var(--color-muted-foreground)]">{operationCode(op.number)}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{typeLabel(op.type)}{op.customer ? ` · ${op.customer.name}` : ""}</span>
                                <span className="block text-caption">{op.scheduledFor ? formatDateTime(op.scheduledFor) : formatDateTime(op.createdAt)}</span>
                              </span>
                              <StatusChip tone={OPERATION_STATUS[op.status].tone} dot>{OPERATION_STATUS[op.status].label}</StatusChip>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </InfoCard>
                )}

                {tab === "Timeline" && (
                  <InfoCard title="Timeline oficial">
                    <AssetTimeline equipmentId={e.id} onOpenOperation={setOperationId} />
                  </InfoCard>
                )}

                {tab === "Documentos" && (
                  <InfoCard title="Documentos do ciclo de vida">
                    <AssetTimeline equipmentId={e.id} type="DOCUMENT" compact onOpenOperation={setOperationId} />
                  </InfoCard>
                )}

                {tab === "Métricas" && (
                  <InfoCard title={`Métricas recentes (${e.metrics.length})`}>
                  {e.metrics.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted-foreground)]">Nenhuma métrica registrada.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {e.metrics.map((m) => (
                        <li key={m.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                          <Activity className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          <span className="text-sm font-medium capitalize">{m.key}</span>
                          <span className="ml-auto font-mono text-sm tabular-nums">{m.value} {m.unit ?? ""}</span>
                          <span className="text-caption w-28 text-right">{formatDateTime(m.recordedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  </InfoCard>
                )}

                {tab === "Anexos" && (
                  <InfoCard title={`Anexos (${e.attachments.length})`}>
                    {e.attachments.length === 0 ? (
                      <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum anexo.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {e.attachments.map((at) => (
                          <li key={at.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{at.originalFileName}</span>
                            <span className="text-caption">{at.category}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </InfoCard>
                )}
              </div>

              <div className="space-y-4">
                <QrFoundation qrCode={e.qrCode} qrToken={e.qrToken} />

                <InfoCard title="PMOC">
                  {pmocs.loading && !pmocs.data ? <SkeletonCard /> : pmocs.data?.items.length ? (() => { const plan = pmocs.data.items[0]; return <div className="space-y-1"><InfoRow label="Plano vinculado" value={<Link className="font-medium text-[var(--color-primary)]" href={`/pmoc/${plan.id}`}>{plan.maintenancePlan?.name ?? `PMOC-${String(plan.number).padStart(6, "0")}`}</Link>} /><InfoRow label="Status" value={plan.operationalStatus} /><InfoRow label="Último PMOC" value={formatDate(plan.overview?.lastExecutionDate ?? plan.lastExecutionDate)} /><InfoRow label="Próximo PMOC" value={formatDate(plan.nextExecutionDate)} /><InfoRow label="Execuções" value={String(plan.overview?.expectedExecutions ?? 0)} /></div>; })() : <p className="text-sm text-[var(--color-muted-foreground)]">Equipamento sem plano PMOC vinculado.</p>}
                </InfoCard>

                <InfoCard title="Hierarquia">
                  <div className="space-y-3">
                    <div>
                      <div className="text-caption uppercase tracking-wider mb-1">Equipamento pai</div>
                      {e.parent ? (
                        <Link href={`/equipamentos/${e.parent.id}`} className="text-sm font-medium hover:text-[var(--color-primary)]">{e.parent.name}{e.parent.tag ? ` · ${e.parent.tag}` : ""}</Link>
                      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Sem equipamento pai.</span>}
                    </div>
                    <div>
                      <div className="text-caption uppercase tracking-wider mb-2">Filhos ({e.children.length})</div>
                      {e.children.length === 0 ? <span className="text-sm text-[var(--color-muted-foreground)]">Nenhum equipamento filho.</span> : (
                        <ul className="space-y-1.5">
                          {e.children.map((child) => (
                            <li key={child.id}>
                              <Link href={`/equipamentos/${child.id}`} className="flex items-center justify-between text-sm hover:text-[var(--color-primary)]">
                                <span>{child.name}</span>
                                <StatusPill status={EQUIPMENT_STATUS_PILL[child.status]} label={EQUIPMENT_STATUS_LABEL[child.status]} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </InfoCard>
              </div>
            </div>
            <OperationDetailDrawer operationId={operationId} open={operationId !== null} onClose={() => setOperationId(null)} />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
