"use client";

/**
 * Configuração de comissões por tipo de serviço (aberto por um botão no
 * Financeiro). Cada tipo pode ser elegível ou não à comissão e tem dois
 * percentuais: o do técnico que executa (primário) e o do técnico auxiliar,
 * que o owner pode querer remunerar de forma diferente. Ambos incidem sobre o
 * valor do serviço das operações concluídas.
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
import { Percent, UserCog, Users } from "lucide-react";

type Row = { eligible: boolean; percent: string; assistantPercent: string };

const numeric = (value: string) => Math.min(100, Math.max(0, Number(value || 0)));

const percentCls =
  "h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-right text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-40";

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
        assistantPercent: String(Number(item.commissionPercentAssistant) || 0),
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
      numeric(row.percent) !== Number(item.commissionPercent) ||
      numeric(row.assistantPercent) !== Number(item.commissionPercentAssistant)
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
          commissionPercent: numeric(row.percent),
          commissionPercentAssistant: numeric(row.assistantPercent),
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
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Financeiro"
      title="Comissões por tipo de serviço"
      width="max-w-xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Marque os tipos que geram comissão e defina o percentual sobre o valor do serviço —
          separadamente para quem executa e para quem acompanha como auxiliar. A comissão de cada
          técnico aparece em <strong>Técnicos de Campo</strong>, onde também é feito o fechamento.
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
          <EmptyState
            icon={Percent}
            title="Nenhum tipo de serviço"
            description="Cadastre tipos de serviço no Catálogo Técnico."
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            {/* Cabeçalho das duas faixas de percentual, para não confundir quem é quem. */}
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3 border-b border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2">
              <span className="text-caption">Tipo de serviço</span>
              <span className="flex w-20 items-center justify-end gap-1 text-caption">
                <UserCog className="h-3.5 w-3.5" /> Técnico
              </span>
              <span className="flex w-20 items-center justify-end gap-1 text-caption">
                <Users className="h-3.5 w-3.5" /> Auxiliar
              </span>
            </div>

            <div className="divide-y divide-[var(--color-border)]">
              {items.map((item) => {
                const row =
                  rows[item.id] ??
                  ({ eligible: item.commissionEligible, percent: "0", assistantPercent: "0" } as Row);
                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5"
                  >
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                        checked={row.eligible}
                        onChange={(e) => set(item.id, { eligible: e.target.checked })}
                      />
                      <span className="font-medium">{item.label}</span>
                      {!item.active && <span className="text-caption">(inativo)</span>}
                    </label>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        aria-label={`Percentual do técnico em ${item.label}`}
                        value={row.percent}
                        disabled={!row.eligible}
                        onChange={(e) => set(item.id, { percent: e.target.value })}
                        className={percentCls}
                      />
                      <span className="text-sm text-[var(--color-muted-foreground)]">%</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        aria-label={`Percentual do auxiliar em ${item.label}`}
                        value={row.assistantPercent}
                        disabled={!row.eligible}
                        onChange={(e) => set(item.id, { assistantPercent: e.target.value })}
                        className={percentCls}
                      />
                      <span className="text-sm text-[var(--color-muted-foreground)]">%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-caption">
          <strong>0%</strong> significa que aquela função não recebe comissão nesse tipo de serviço —
          é como os auxiliares ficam até você definir o percentual deles.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm"
          >
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
