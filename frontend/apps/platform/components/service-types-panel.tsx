"use client";

/**
 * Aba "Tipo de Serviço" do Catálogo Técnico — CRUD do catálogo editável que
 * alimenta o select de tipo de serviço das operações (antes um enum fixo).
 * Os 4 tipos do sistema (isSystem) não podem ser removidos nem ter a chave
 * alterada; remover um tipo custom é uma desativação (soft-delete).
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Bell, BellOff, Pencil, Plus, Trash2 } from "lucide-react";
import { serviceTypesApi, useQuery, errorMessage, type ServiceType } from "@erp/api";
import { Drawer } from "@erp/ui/drawer";
import { ConfirmDialog } from "@erp/ui/confirm-dialog";
import { StatusChip } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyState } from "@erp/ui/empty-state";

const inputCls =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; item: ServiceType }
  | null;

export function ServiceTypesPanel({ canEdit }: { canEdit: boolean }) {
  const [reloadKey, setReloadKey] = useState(0);
  const types = useQuery((signal) => serviceTypesApi.list({ signal }), [reloadKey]);
  const [editor, setEditor] = useState<EditorState>(null);
  const [removing, setRemoving] = useState<ServiceType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => types.data?.items ?? [], [types.data]);
  const reload = () => setReloadKey((k) => k + 1);

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    try {
      await serviceTypesApi.reorder(ids);
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-blue-500/25 bg-blue-500/5 p-4 text-sm">
        <strong>Tipos de serviço das operações</strong>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          Estas opções aparecem no campo “Tipo de serviço” ao criar operações (avulso, PMOC, etc.).
          Marque “gera lembrete” para que uma operação desse tipo agende automaticamente um lembrete
          de manutenção. Tipos do sistema não podem ser excluídos — desative-os se não usar mais.
        </p>
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditor({ mode: "create" })}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)]"
          >
            <Plus className="h-4 w-4" /> Novo tipo
          </button>
        </div>
      )}

      {types.loading && !types.data ? (
        <SkeletonList rows={4} />
      ) : items.length === 0 ? (
        <EmptyState icon={Plus} title="Nenhum tipo de serviço" description="Cadastre o primeiro tipo." />
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          {items.map((item, index) => (
            <div key={item.id} className="flex items-center gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  disabled={!canEdit || busy || index === 0}
                  onClick={() => move(index, -1)}
                  className="text-[var(--color-muted-foreground)] disabled:opacity-30"
                  aria-label="Mover para cima"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!canEdit || busy || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  className="text-[var(--color-muted-foreground)] disabled:opacity-30"
                  aria-label="Mover para baixo"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-caption">{item.key}</span>
                  {item.isSystem && <StatusChip tone="info">Sistema</StatusChip>}
                  <StatusChip tone={item.active ? "success" : "neutral"} dot>
                    {item.active ? "Ativo" : "Inativo"}
                  </StatusChip>
                  {item.generatesReminder && (
                    <span className="inline-flex items-center gap-1 text-caption text-[var(--color-primary)]">
                      <Bell className="h-3.5 w-3.5" /> Lembrete {item.reminderIntervalMonths ?? 6}m
                    </span>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditor({ mode: "edit", item })}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--color-muted)]"
                    aria-label="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!item.isSystem && (
                    <button
                      type="button"
                      onClick={() => setRemoving(item)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-red-600 hover:bg-red-500/10"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editor && (
        <ServiceTypeEditor
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setError(null);
            reload();
          }}
          onError={setError}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remover tipo de serviço?"
        description="Ele deixa de aparecer no select. Operações já registradas com este tipo continuam válidas."
        confirmLabel="Remover"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await serviceTypesApi.remove(removing.id);
            setRemoving(null);
            reload();
          } catch (e) {
            setError(errorMessage(e));
            setRemoving(null);
          }
        }}
      />
    </div>
  );
}

function ServiceTypeEditor({
  state,
  onClose,
  onSaved,
  onError,
}: {
  state: Exclude<EditorState, null>;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const existing = state.mode === "edit" ? state.item : null;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [generatesReminder, setGeneratesReminder] = useState(existing?.generatesReminder ?? false);
  const [intervalMonths, setIntervalMonths] = useState(String(existing?.reminderIntervalMonths ?? 6));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!label.trim()) {
      onError("Informe o nome do tipo de serviço.");
      return;
    }
    const payload = {
      label: label.trim(),
      active,
      generatesReminder,
      reminderIntervalMonths: generatesReminder ? Number(intervalMonths) || 6 : null,
    };
    setSaving(true);
    try {
      if (existing) await serviceTypesApi.update(existing.id, payload);
      else await serviceTypesApi.create(payload);
      onSaved();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Tipo de Serviço"
      title={existing ? existing.label : "Novo tipo de serviço"}
      width="max-w-md"
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Nome</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="Ex.: Higienização" />
        </label>
        {existing?.isSystem && (
          <p className="text-caption">
            Tipo do sistema (chave <code>{existing.key}</code>). É possível ajustar o nome, a
            ativação e o lembrete; a chave é fixa.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Ativo (aparece no select de operações)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={generatesReminder}
            onChange={(e) => setGeneratesReminder(e.target.checked)}
          />
          {generatesReminder ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          Gera lembrete de manutenção
        </label>
        {generatesReminder && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Intervalo padrão (meses)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={intervalMonths}
              onChange={(e) => setIntervalMonths(e.target.value)}
              className={inputCls}
            />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
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
