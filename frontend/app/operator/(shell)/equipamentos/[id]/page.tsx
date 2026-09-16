"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Activity, Plus } from "lucide-react";
import { SkeletonCard } from "@erp/ui/skeletons";
import { AsyncBoundary } from "@erp/ui/states";
import { StatusPill } from "@erp/ui/status-pill";
import { StatusChip } from "@erp/ui/status-chip";
import { QrFoundation } from "@platform/components/qr-foundation";
import { AssetTimeline } from "@erp/ui/assets/asset-timeline";
import { OperationDetailDrawer } from "@platform/components/operation-detail-drawer";
import { OPERATION_STATUS, operationCode } from "@erp/ui/operations/operation-shared";
import { useServiceTypeLabel } from "@erp/ui/operations/use-service-type-label";
import { equipmentsApi, operationApi, useQuery, type EquipmentDetail } from "@erp/api";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { formatDate, formatDateTime } from "@erp/utils";
import { EQUIPMENT_STATUS_LABEL, EQUIPMENT_STATUS_PILL, EQUIPMENT_TYPE_LABEL } from "@platform/equipment-display";

export default function OperatorEquipamentoConsult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role, can } = useAuth();
  const typeLabel = useServiceTypeLabel();
  const canStart = role !== "OPERATOR" || can("canReports");
  const [operationId, setOperationId] = useState<string | null>(null);
  const detail = useQuery<EquipmentDetail>((signal) => equipmentsApi.getEquipment(id, { signal }), [id]);
  const operations = useQuery((signal) => operationApi.listOperations({ equipmentId: id, limit: 30, signal }), [id]);

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      <Link href="/operator/clientes" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <AsyncBoundary loading={detail.loading} error={detail.error} data={detail.data} onRetry={detail.refetch} skeleton={<SkeletonCard />}>
        {(e) => (
          <>
            <header className="space-y-1.5">
              <StatusPill status={EQUIPMENT_STATUS_PILL[e.status]} label={EQUIPMENT_STATUS_LABEL[e.status]} />
              <h1 className="text-section-title leading-tight">{e.name}</h1>
              <p className="text-caption">{e.equipmentTypeCatalog?.title ?? EQUIPMENT_TYPE_LABEL[e.type]} · {e.customer?.name ?? "—"}</p>
            </header>

            {canStart && (
              <Link href={`/operator/atendimento?equipmentId=${e.id}`} className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white h-12 text-sm font-semibold active:scale-[0.99]">
                <Plus className="h-4 w-4" /> Iniciar atendimento
              </Link>
            )}

            <Card title="Ficha">
              <Row label="Tag" value={e.tag ?? "—"} />
              <Row label="Fabricante" value={e.manufacturer ?? "—"} />
              <Row label="Modelo" value={e.model ?? "—"} />
              <Row label="Nº de série" value={e.serialNumber ?? "—"} />
              <Row label="Local" value={e.address?.name ?? e.address?.city ?? "—"} />
              <Row label="Garantia até" value={formatDate(e.warrantyExpiration)} />
            </Card>

            <Card title={`Métricas (${e.metrics.length})`}>
              {e.metrics.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">Nenhuma métrica.</p>
              ) : (
                <ul className="space-y-1.5">
                  {e.metrics.slice(0, 6).map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      <span className="capitalize">{m.key}</span>
                      <span className="ml-auto font-mono tabular-nums">{m.value} {m.unit ?? ""}</span>
                      <span className="text-caption w-20 text-right">{formatDateTime(m.recordedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {e.observations && (
              <Card title="Observações">
                <p className="text-sm text-[var(--color-muted-foreground)]">{e.observations}</p>
              </Card>
            )}

            <Card title={`Operações${operations.data ? ` (${operations.data.pagination.total})` : ""}`}>
              {operations.loading && !operations.data ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">Carregando…</p>
              ) : (operations.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">Nenhuma operação registrada para este equipamento.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]/60">
                  {(operations.data?.items ?? []).map((op) => (
                    <li key={op.id}>
                      <button type="button" onClick={() => setOperationId(op.id)} className="flex w-full items-center gap-3 py-2 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{typeLabel(op.type)}</span>
                          <span className="block text-caption">{operationCode(op.number)} · {op.scheduledFor ? formatDate(op.scheduledFor) : formatDate(op.createdAt)}</span>
                        </span>
                        <StatusChip tone={OPERATION_STATUS[op.status].tone} dot>{OPERATION_STATUS[op.status].label}</StatusChip>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Timeline">
              <AssetTimeline equipmentId={e.id} compact onOpenOperation={setOperationId} />
            </Card>

            <QrFoundation qrCode={e.qrCode} qrToken={e.qrToken} />
            <OperationDetailDrawer operationId={operationId} open={operationId !== null} onClose={() => setOperationId(null)} />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)] space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b last:border-0 border-[var(--color-border)]/60">
      <span className="text-caption">{label}</span>
      <span className="text-sm text-right">{value || "—"}</span>
    </div>
  );
}
