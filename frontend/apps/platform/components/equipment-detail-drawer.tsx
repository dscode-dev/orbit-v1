"use client";

/**
 * EquipmentDetailDrawer — read-only detail (GET /equipments/:id) with tabs:
 * Visão geral · Hierarquia · Métricas · QR · Anexos.
 */
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Activity, Paperclip, FileText } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { DrawerTabs } from "@erp/ui/drawer-tabs";
import { StatusPill } from "@erp/ui/status-pill";
import { ErrorState } from "@erp/ui/states";
import { AssetTimeline } from "@erp/ui/assets/asset-timeline";
import { QrFoundation } from "@platform/components/qr-foundation";
import { OperationDetailDrawer } from "@platform/components/operation-detail-drawer";
import { equipmentsApi, useQuery, type EquipmentDetail } from "@erp/api";
import { formatDate, formatDateTime } from "@erp/utils";
import {
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_STATUS_PILL,
  EQUIPMENT_TYPE_LABEL,
} from "@platform/equipment-display";

const TABS = ["Visão geral", "Histórico", "Hierarquia", "Métricas", "QR", "Anexos"] as const;
type Tab = (typeof TABS)[number];

export function EquipmentDetailDrawer({
  equipmentId,
  open,
  onClose,
}: {
  equipmentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Visão geral");
  const [operationId, setOperationId] = useState<string | null>(null);
  const detail = useQuery<EquipmentDetail | null>(
    (signal) => (equipmentId ? equipmentsApi.getEquipment(equipmentId, { signal }) : Promise.resolve(null)),
    [equipmentId, open],
  );
  const e = detail.data;

  return (
    <Drawer open={open} onClose={onClose} eyebrow="Equipamento" title={e?.name ?? "Carregando…"}>
      {detail.loading && !e ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando equipamento…
        </div>
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.refetch} />
      ) : e ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={!e.isActive || e.deletedAt ? 'offline' : EQUIPMENT_STATUS_PILL[e.status]} label={!e.isActive || e.deletedAt ? 'Desativado' : EQUIPMENT_STATUS_LABEL[e.status]} />
            <span className="text-[11px] uppercase tracking-wider rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[var(--color-muted-foreground)]">
              {e.equipmentTypeCatalog?.title ?? EQUIPMENT_TYPE_LABEL[e.type]}
            </span>
            <Link href={`/equipamentos/${e.id}`} className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 h-8 text-xs hover:bg-[var(--color-muted)]">
              <ExternalLink className="h-3.5 w-3.5" /> Abrir página
            </Link>
          </div>

          <DrawerTabs
            tabs={TABS}
            active={tab}
            onChange={setTab}
            counts={{ Hierarquia: e.children.length, Métricas: e.metrics.length, Anexos: e.attachments.length }}
          />

          {tab === "Visão geral" && (
            <div className="space-y-3">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
                <Row label="Cliente" value={e.customer?.name} />
                <Row label="Local" value={e.address?.name ?? e.address?.city} />
                <Row label="Tag" value={e.tag} />
                <Row label="Fabricante" value={e.manufacturer} />
                <Row label="Modelo" value={e.model} />
                <Row label="Nº de série" value={e.serialNumber} />
                <Row label="Capacidade" value={e.capacity} />
                <Row label="Tensão" value={e.voltage} />
                <Row label="Instalação" value={formatDate(e.installationDate)} />
                <Row label="Garantia até" value={formatDate(e.warrantyExpiration)} />
                {e.observations && <Row label="Observações" value={e.observations} />}
              </div>
              <QrFoundation qrCode={e.qrCode} qrToken={e.qrToken} />
            </div>
          )}

          {tab === "Histórico" && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <AssetTimeline equipmentId={e.id} compact onOpenOperation={setOperationId} />
            </div>
          )}

          {tab === "Hierarquia" && (
            <div className="space-y-3">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <div className="text-caption uppercase tracking-wider mb-1">Equipamento pai</div>
                {e.parent ? (
                  <Link href={`/equipamentos/${e.parent.id}`} className="text-sm font-medium hover:text-[var(--color-primary)]">
                    {e.parent.name} {e.parent.tag ? `· ${e.parent.tag}` : ""}
                  </Link>
                ) : (
                  <span className="text-sm text-[var(--color-muted-foreground)]">Sem equipamento pai.</span>
                )}
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <div className="text-caption uppercase tracking-wider mb-2">Equipamentos filhos ({e.children.length})</div>
                {e.children.length === 0 ? (
                  <span className="text-sm text-[var(--color-muted-foreground)]">Nenhum equipamento filho.</span>
                ) : (
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
          )}

          {tab === "Métricas" && (
            <div>
              {e.metrics.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)] py-6 text-center">Nenhuma métrica registrada.</p>
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
            </div>
          )}

          {tab === "QR" && <QrFoundation qrCode={e.qrCode} qrToken={e.qrToken} />}

          {tab === "Anexos" && (
            <div>
              {e.attachments.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)] py-6 text-center">Nenhum anexo.</p>
              ) : (
                <ul className="space-y-2">
                  {e.attachments.map((at) => (
                    <li key={at.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                      <FileText className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{at.originalFileName}</div>
                        <div className="text-caption">{at.category}</div>
                      </div>
                      <Paperclip className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}
      <OperationDetailDrawer operationId={operationId} open={operationId !== null} onClose={() => setOperationId(null)} />
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0 border-[var(--color-border)]/60">
      <span className="text-caption">{label}</span>
      <span className="text-sm text-right">{value || "—"}</span>
    </div>
  );
}
