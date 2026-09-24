"use client";

/**
 * Configuração de comissões por tipo de serviço (aberto por um botão no
 * Financeiro). Cada tipo pode ser elegível ou não à comissão e ter um percentual
 * próprio, aplicado sobre o valor do serviço das operações concluídas do técnico.
 * Simples e objetivo: lista + toggle + % + salvar.
 */
import { useEffect, useMemo, useState } from "react";
import {
  organizationApi,
  serviceTypesApi,
  useQuery,
  errorMessage,
  type CommissionPeriod,
  type ServiceType,
} from "@erp/api";
import { Drawer } from "@erp/ui/drawer";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { Percent } from "lucide-react";

type Row = { eligible: boolean; percent: string };

export function CommissionSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const types = useQuery((signal) => serviceTypesApi.list({ signal }), [open]);
  const settings = useQuery((signal) => organizationApi.getOrganizationSettings({ signal }), [open]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [period, setPeriod] = useState<CommissionPeriod>("MONTHLY");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const items = useMemo(() => types.data?.items ?? [], [types.data]);

  useEffect(() => {
    if (settings.data?.commissionPeriod) setPeriod(settings.data.commissionPeriod);
  }, [settings.data]);

  useEffect(() => {
    const next: Record<string, Row> = {};
    for (const item of items) {
      next[item.id] = {
        eligible: item.commissionEligible,
        percent: String(Number(item.commissionPercent) || 0),
      };
    }
    setRows(next);
  }, [items]);

  const set = (id: string, patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const changed = (item: ServiceType): boolean => {
    const row = rows[item.id];
    if (!row) return false;
    return (
      row.eligible !== item.commissionEligible ||
      Number(row.percent || 0) !== Number(item.commissionPercent)
    );
  };

  const periodChanged = Boolean(settings.data && settings.data.commissionPeriod !== period);

  const save = async () => {
    const dirty = items.filter(changed);
    if (dirty.length === 0 && !periodChanged) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (periodChanged) {
        await organizationApi.updateOrganizationSettings({ commissionPeriod: period });
        await settings.refetch();
      }
      for (const item of dirty) {
        const row = rows[item.id];
        await serviceTypesApi.update(item.id, {
          commissionEligible: row.eligible,
          commissionPercent: Math.min(100, Math.max(0, Number(row.percent || 0))),
        });
      }
      await types.refetch();
      setSavedAt(Date.now());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} eyebrow="Financeiro" title="Comissões por tipo de serviço" width="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Marque os tipos de serviço que geram comissão e defina o percentual aplicado sobre o valor
          do serviço. A comissão de cada técnico aparece em <strong>Técnicos de Campo</strong>, onde
          também é feito o fechamento (marcar como paga).
        </p>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Período de apuração</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as CommissionPeriod)}
            className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="WEEKLY">Semanal</option>
            <option value="BIWEEKLY">Quinzenal</option>
            <option value="MONTHLY">Mensal</option>
          </select>
          <span className="text-caption">
            Define o intervalo sugerido ao abrir a comissão de um técnico.
          </span>
        </label>

        {error && (
          <div className="rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div className="rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            Comissões atualizadas.
          </div>
        )}

        {types.loading && !types.data ? (
          <SkeletonList rows={4} />
        ) : items.length === 0 ? (
          <EmptyState icon={Percent} title="Nenhum tipo de serviço" description="Cadastre tipos de serviço no Catálogo Técnico." />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            {items.map((item) => {
              const row = rows[item.id] ?? { eligible: item.commissionEligible, percent: "0" };
              return (
                <div key={item.id} className="flex items-center gap-3 p-3">
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.eligible}
                      onChange={(e) => set(item.id, { eligible: e.target.checked })}
                    />
                    <span className="font-medium">{item.label}</span>
                    {!item.active && <span className="text-caption">(inativo)</span>}
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={row.percent}
                      disabled={!row.eligible}
                      onChange={(e) => set(item.id, { percent: e.target.value })}
                      className="h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-right text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
                    />
                    <span className="text-sm text-[var(--color-muted-foreground)]">%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm">
            Fechar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
