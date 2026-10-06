"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { FieldEquipmentDraft, TechnicalCatalog } from "@erp/api";

export type NewFieldEquipmentDraft = FieldEquipmentDraft & { localId: string };

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]";

export function createEmptyFieldEquipmentDraft(): NewFieldEquipmentDraft {
  return {
    localId: localFieldEquipmentId(),
    equipmentTypeCatalogId: "",
    sector: "",
    manufacturer: "",
    model: "",
    serialNumber: "",
    capacity: "",
    voltage: "",
    tag: "",
    observations: "",
  };
}

function localFieldEquipmentId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  // Chave efêmera de UI. Nunca é enviada como identificador de domínio.
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function FieldEquipmentCollection({
  drafts,
  equipmentTypes,
  equipmentTypesLoading,
  onAdd,
  onRemove,
  title = "Equipamentos identificados em campo",
  maxItems = 20,
  showForm = true,
  description = "Registre os equipamentos encontrados no local. Os novos itens serão vinculados ao cliente e ao relatório.",
}: {
  drafts: NewFieldEquipmentDraft[];
  maxItems?: number;
  showForm?: boolean;
  equipmentTypes: TechnicalCatalog[];
  equipmentTypesLoading: boolean;
  onAdd: (draft: NewFieldEquipmentDraft) => void;
  onRemove: (localId: string) => void;
  title?: string;
  description?: string;
}) {
  const [draft, setDraft] = useState<NewFieldEquipmentDraft>(() => createEmptyFieldEquipmentDraft());
  const complete = Boolean(
    draft.equipmentTypeCatalogId &&
    draft.manufacturer?.trim() &&
    draft.model?.trim() &&
    draft.capacity?.trim(),
  );

  function change(field: keyof FieldEquipmentDraft, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function add(): void {
    if (!complete || drafts.length >= maxItems) return;
    onAdd(draft);
    setDraft(createEmptyFieldEquipmentDraft());
  }

  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-info)]/30 bg-[var(--color-info)]/5 p-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-caption">{description}</p>
      </div>
      {showForm && <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Adicionar equipamento</p>
          <span className="text-caption">{drafts.length}/{maxItems}</span>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Tipo *</span>
          <select value={draft.equipmentTypeCatalogId} onChange={(event) => change("equipmentTypeCatalogId", event.target.value)} disabled={equipmentTypesLoading || drafts.length >= maxItems} className={inputClass}>
            <option value="">{equipmentTypesLoading ? "Carregando tipos…" : "Selecione"}</option>
            {equipmentTypes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldEquipmentInput label="Marca *" value={draft.manufacturer ?? ""} onChange={(value) => change("manufacturer", value)} />
          <FieldEquipmentInput label="Modelo *" value={draft.model ?? ""} onChange={(value) => change("model", value)} />
          <FieldEquipmentInput label="Capacidade *" value={draft.capacity ?? ""} onChange={(value) => change("capacity", value)} placeholder="Ex.: 18.000 BTU/h" />
          <FieldEquipmentInput label="Setor / local" value={draft.sector ?? ""} onChange={(value) => change("sector", value)} />
          <FieldEquipmentInput label="Número de série" value={draft.serialNumber ?? ""} onChange={(value) => change("serialNumber", value)} />
          <FieldEquipmentInput label="Tensão" value={draft.voltage ?? ""} onChange={(value) => change("voltage", value)} />
        </div>
        <button type="button" onClick={add} disabled={!complete || drafts.length >= maxItems} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50">
          <Plus className="h-4 w-4" /> Adicionar equipamento
        </button>
        {!complete && <p className="text-center text-[11px] text-[var(--color-muted-foreground)]">Preencha tipo, marca, modelo e capacidade para adicionar.</p>}
        {drafts.length >= maxItems && <p className="text-center text-[11px] text-[var(--color-muted-foreground)]">Limite de equipamentos atingido. Remova um item para adicionar outro.</p>}
      </div>}

      {drafts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-[var(--color-success)]" /> Equipamentos adicionados</div>
          <ul className="space-y-2">
            {drafts.map((item, index) => {
              const type = equipmentTypes.find((option) => option.id === item.equipmentTypeCatalogId)?.title;
              return (
                <li key={item.localId} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-success)]/10 text-xs font-semibold text-[var(--color-success)]">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{[item.manufacturer, item.model, item.capacity].filter(Boolean).join(" - ")}</strong>
                    <span className="block truncate text-caption">{[type, item.sector].filter(Boolean).join(" · ") || "Equipamento"}</span>
                  </span>
                  <button type="button" onClick={() => onRemove(item.localId)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10" aria-label={`Remover equipamento ${index + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function FieldEquipmentInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
}
