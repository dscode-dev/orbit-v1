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
  type CommissionMode,
  type CommissionPeriod,
  type ServiceType,
} from "@erp/api";
import { Drawer } from "@erp/ui/drawer";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";
import { Banknote, Percent, UserCog, Users } from "lucide-react";

type Row = {
  eligible: boolean;
  percent: string;
  assistantPercent: string;
  fixed: string;
  fixedAssistant: string;
};

/** Como o valor é cobrado em cada base — muda rótulo, ícone e limite do input. */
const MODES: Array<{ value: CommissionMode; label: string; hint: string; icon: typeof Banknote }> = [
  {
    value: "FIXED",
    label: "Valor fixo",
    hint: "o técnico recebe o mesmo por atendimento, qualquer que seja o valor do serviço",
    icon: Banknote,
  },
  {
    value: "PERCENT",
    label: "Percentual",
    hint: "a comissão é uma fatia do valor do serviço de cada atendimento",
    icon: Percent,
  },
];

const numeric = (value: string, max: number) => Math.min(max, Math.max(0, Number(value || 0)));

const percentCls =
  "h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-2 text-right text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-40";

export function CommissionSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const types = useQuery((signal) => serviceTypesApi.list({ signal }), [open]);
  const settings = useQuery((signal) => organizationApi.getOrganizationSettings({ signal }), [open]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [period, setPeriod] = useState<CommissionPeriod>("MONTHLY");
  const [mode, setMode] = useState<CommissionMode>("FIXED");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const items = useMemo(() => types.data?.items ?? [], [types.data]);
  const isFixed = mode === "FIXED";
  /** Percentual vai até 100; valor em reais tem teto só para evitar engano. */
  const max = isFixed ? 1_000_000 : 100;

  useEffect(() => {
    if (settings.data?.commissionPeriod) setPeriod(settings.data.commissionPeriod);
    if (settings.data?.commissionMode) setMode(settings.data.commissionMode);
  }, [settings.data]);

  useEffect(() => {
    const next: Record<string, Row> = {};
    for (const item of items) {
      next[item.id] = {
        eligible: item.commissionEligible,
        percent: String(Number(item.commissionPercent) || 0),
        assistantPercent: String(Number(item.commissionPercentAssistant) || 0),
        fixed: String(Number(item.commissionFixed) || 0),
        fixedAssistant: String(Number(item.commissionFixedAssistant) || 0),
      };
    }
    setRows(next);
  }, [items]);

  const set = (id: string, patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  /** Só os campos da base ativa são comparados (e salvos): a outra fica intacta. */
  const changed = (item: ServiceType): boolean => {
    const row = rows[item.id];
    if (!row) return false;
    if (row.eligible !== item.commissionEligible) return true;
    return isFixed
      ? numeric(row.fixed, max) !== Number(item.commissionFixed) ||
          numeric(row.fixedAssistant, max) !== Number(item.commissionFixedAssistant)
      : numeric(row.percent, max) !== Number(item.commissionPercent) ||
          numeric(row.assistantPercent, max) !== Number(item.commissionPercentAssistant);
  };

  const settingsChanged = Boolean(
    settings.data &&
      (settings.data.commissionPeriod !== period || settings.data.commissionMode !== mode),
  );

  const save = async () => {
    const dirty = items.filter(changed);
    if (dirty.length === 0 && !settingsChanged) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (settingsChanged) {
        await organizationApi.updateOrganizationSettings({
          commissionPeriod: period,
          commissionMode: mode,
        });
        await settings.refetch();
      }
      for (const item of dirty) {
        const row = rows[item.id];
        await serviceTypesApi.update(item.id, {
          commissionEligible: row.eligible,
          ...(isFixed
            ? {
                commissionFixed: numeric(row.fixed, max),
                commissionFixedAssistant: numeric(row.fixedAssistant, max),
              }
            : {
                commissionPercent: numeric(row.percent, max),
                commissionPercentAssistant: numeric(row.assistantPercent, max),
              }),
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
          Marque os tipos que geram comissão e defina quanto cada função recebe — separadamente
          para quem executa e para quem acompanha como auxiliar. A comissão de cada técnico aparece
          em <strong>Técnicos de Campo</strong>, onde também é feito o fechamento.
        </p>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Base de cálculo</span>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((option) => {
              const active = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMode(option.value)}
                  className={`flex items-center justify-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                  }`}
                >
                  <option.icon className="h-4 w-4" /> {option.label}
                </button>
              );
            })}
          </div>
          <span className="text-caption">
            {MODES.find((option) => option.value === mode)?.hint}. Os valores da outra base ficam
            guardados e voltam a valer se você trocar.
          </span>
        </div>

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
                const row = rows[item.id];
                if (!row) return null;
                // Cada função tem o seu campo na base ativa; o "R$" fica antes
                // do número e o "%" depois, como se escreve.
                const fields: Array<{ key: keyof Row; label: string }> = isFixed
                  ? [
                      { key: "fixed", label: `Valor do técnico em ${item.label}` },
                      { key: "fixedAssistant", label: `Valor do auxiliar em ${item.label}` },
                    ]
                  : [
                      { key: "percent", label: `Percentual do técnico em ${item.label}` },
                      { key: "assistantPercent", label: `Percentual do auxiliar em ${item.label}` },
                    ];
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
                    {fields.map((field) => (
                      <span key={field.key} className="flex items-center gap-1">
                        {isFixed && (
                          <span className="text-sm text-[var(--color-muted-foreground)]">R$</span>
                        )}
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step={isFixed ? "5" : "0.5"}
                          aria-label={field.label}
                          value={String(row[field.key])}
                          disabled={!row.eligible}
                          onChange={(e) => set(item.id, { [field.key]: e.target.value })}
                          className={percentCls}
                        />
                        {!isFixed && (
                          <span className="text-sm text-[var(--color-muted-foreground)]">%</span>
                        )}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-caption">
          <strong>{isFixed ? "R$ 0,00" : "0%"}</strong> significa que aquela função não recebe
          comissão nesse tipo de serviço — é como cada uma fica até você definir o valor dela.
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
