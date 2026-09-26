"use client";

/**
 * EquipmentFormDrawer — create / edit an equipment against the production API.
 * customerId, type and name are required. Address options are restricted to the
 * selected customer's addresses (loaded on demand).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EntityCombobox, type ComboboxQuery } from "@erp/ui/entity-combobox";
import { Drawer } from "@erp/ui/drawer";
import {
  equipmentsApi,
  customersApi,
  technicalCatalogsApi,
  ApiClientError,
  type EquipmentDetail,
  type EquipmentStatus,
  type EquipmentType,
  type CreateEquipmentPayload,
  type Customer,
  type CustomerAddress,
  type TechnicalCatalog,
} from "@erp/api";
import {
  EQUIPMENT_TYPES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABEL,
} from "@platform/equipment-display";

type FormState = {
  customerId: string;
  type: EquipmentType;
  equipmentTypeCatalogId: string;
  sector: string;
  addressId: string;
  status: EquipmentStatus;
  tag: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  capacity: string;
  voltage: string;
  observations: string;
};

function fromEquipment(e: EquipmentDetail | null, presetCustomerId?: string): FormState {
  return {
    customerId: e?.customer?.id ?? presetCustomerId ?? "",
    type: e?.type ?? "SPLIT",
    equipmentTypeCatalogId: e?.equipmentTypeCatalogId ?? e?.equipmentTypeCatalog?.id ?? "",
    sector: e?.sector ?? "",
    addressId: e?.address?.id ?? "",
    status: e?.status ?? "ACTIVE",
    tag: e?.tag ?? "",
    manufacturer: e?.manufacturer ?? "",
    model: e?.model ?? "",
    serialNumber: e?.serialNumber ?? "",
    capacity: e?.capacity ?? "",
    voltage: e?.voltage ?? "",
    observations: e?.observations ?? "",
  };
}

export function EquipmentFormDrawer({
  open,
  onClose,
  onSaved,
  equipment = null,
  presetCustomerId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  equipment?: EquipmentDetail | null;
  presetCustomerId?: string;
}) {
  const isEdit = Boolean(equipment);
  const [form, setForm] = useState<FormState>(fromEquipment(equipment, presetCustomerId));
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Cache dos clientes já vistos (lista inicial + resultados de busca), para
  // manter o rótulo do selecionado mesmo fora da página atual.
  const seenCustomers = useRef(new Map<string, Customer>());
  const searchCustomers = useCallback(async ({ search, page }: ComboboxQuery, signal: AbortSignal) => {
    const result = await customersApi.listCustomers({ search: search || undefined, page, limit: 50, signal });
    for (const item of result.items) seenCustomers.current.set(item.id, item);
    return {
      options: result.items.map((item) => ({ value: item.id, label: item.tradeName || item.name })),
      total: result.pagination?.total,
    };
  }, []);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<TechnicalCatalog[]>([]);
  const [typesError, setTypesError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the customer list once the drawer opens.
  useEffect(() => {
    if (!open) return;
    setForm(fromEquipment(equipment, presetCustomerId));
    setError(null);
    setSaving(false);
    const ac = new AbortController();
    // Primeira página só para exibir o rótulo do cliente já vinculado; a
    // escolha usa busca no servidor (a base passa de 100 clientes).
    customersApi
      .listCustomers({ page: 1, limit: 20, signal: ac.signal })
      .then((res) => setCustomers(res.items))
      .catch(() => undefined);
    technicalCatalogsApi
      .listEquipmentTypes({ signal: ac.signal })
      .then((activeTypes) => {
        const archived = equipment?.equipmentTypeCatalog;
        const items =
          archived && !activeTypes.some((item) => item.id === archived.id)
            ? [
                ...activeTypes,
                {
                  ...archived,
                  organizationId: "",
                  type: "EQUIPMENT_TYPE" as const,
                  description: null,
                  areas: ["GENERAL" as const],
                  workflows: ["GENERAL" as const],
                  maintenanceType: null,
                  pmocUnit: null,
                  sortOrder: Number.MAX_SAFE_INTEGER,
                  createdAt: "",
                  updatedAt: "",
                },
              ]
            : activeTypes;
        setEquipmentTypes(items);
        setTypesError(false);
        setForm((current) => {
          if (current.equipmentTypeCatalogId) return current;
          const tag = `legacy-${current.type.toLowerCase().replaceAll("_", "-")}`;
          const matched = items.find((item) => item.tags.includes(tag));
          return matched ? { ...current, equipmentTypeCatalogId: matched.id } : current;
        });
      })
      .catch(() => setTypesError(true));
    return () => ac.abort();
  }, [open, equipment, presetCustomerId]);

  // Load addresses whenever the selected customer changes.
  useEffect(() => {
    if (!open || !form.customerId) {
      setAddresses([]);
      return;
    }
    const ac = new AbortController();
    customersApi
      .getCustomer(form.customerId, { signal: ac.signal })
      .then((c) => setAddresses(c.addresses))
      .catch(() => setAddresses([]));
    return () => ac.abort();
  }, [open, form.customerId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.customerId) { setError("Selecione o cliente."); return; }
    if (!form.equipmentTypeCatalogId) {
      setError("Selecione o tipo do equipamento.");
      return;
    }
    if (!form.manufacturer.trim() && !form.model.trim()) {
      setError("Informe ao menos a marca ou o modelo do equipamento.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload: CreateEquipmentPayload = {
      customerId: form.customerId,
      type: form.type,
      equipmentTypeCatalogId: form.equipmentTypeCatalogId,
      sector: form.sector.trim() || null,
      addressId: form.addressId || null,
      status: form.status,
      tag: form.tag.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serialNumber: form.serialNumber.trim() || null,
      capacity: form.capacity.trim() || null,
      voltage: form.voltage.trim() || null,
      observations: form.observations.trim() || null,
    };

    try {
      if (isEdit && equipment) {
        await equipmentsApi.updateEquipment(equipment.id, payload);
      } else {
        await equipmentsApi.createEquipment(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.isForbidden) {
        setError("Você não tem permissão para esta ação.");
      } else {
        setError(err instanceof ApiClientError ? err.message : "Não foi possível salvar.");
      }
      setSaving(false);
    }
  }

  const selectedCustomer =
    seenCustomers.current.get(form.customerId) ?? customers.find((item) => item.id === form.customerId) ?? null;
  const selectedCustomerOption = selectedCustomer
    ? { value: selectedCustomer.id, label: selectedCustomer.tradeName || selectedCustomer.name }
    : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Ativos"
      title={isEdit ? "Editar equipamento" : "Novo equipamento"}
      width="max-w-xl"
      footer={
        <>
          <button onClick={onClose} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Criar equipamento"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <EntityCombobox
          label="Cliente"
          value={form.customerId}
          onChange={(id) => { set("customerId", id); set("addressId", ""); }}
          fetchOptions={searchCustomers}
          selectedOption={selectedCustomerOption}
          placeholder="Selecione o cliente…"
          emptyMessage="Nenhum cliente encontrado."
        />

        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          O equipamento é identificado por marca e modelo (preenchidos abaixo).
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select
              value={form.equipmentTypeCatalogId}
              onChange={(event) => {
                const selected = equipmentTypes.find((item) => item.id === event.target.value);
                set("equipmentTypeCatalogId", event.target.value);
                set("type", legacyEquipmentType(selected));
              }}
              className={inputCls}
            >
              <option value="">Selecione o tipo…</option>
              {equipmentTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.title}{type.deletedAt ? " (tipo arquivado)" : ""}
                </option>
              ))}
            </select>
            {typesError && (
              <span className="text-caption text-[var(--color-danger)]">
                Não foi possível carregar os tipos cadastrados.
              </span>
            )}
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set("status", e.target.value as EquipmentStatus)} className={inputCls}>
              {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{EQUIPMENT_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Endereço">
            <select value={form.addressId} onChange={(e) => set("addressId", e.target.value)} className={inputCls} disabled={!form.customerId}>
              <option value="">{form.customerId ? "Sem endereço específico" : "Selecione o cliente primeiro"}</option>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>{a.name || [a.street, a.number, a.city].filter(Boolean).join(", ") || "Endereço"}</option>
              ))}
            </select>
          </Field>
          <Field label="Setor">
            <input value={form.sector} onChange={(e) => set("sector", e.target.value)} className={inputCls} placeholder="Ex.: Recepção, Sala 01" />
          </Field>
        </div>
        {form.customerId && addresses.length === 0 && (
          <span className="block text-[11px] text-[var(--color-muted-foreground)]">
            Este cliente ainda não possui endereço cadastrado. Cadastre o endereço no cliente para selecionar uma instalação específica.
          </span>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tag">
            <input value={form.tag} onChange={(e) => set("tag", e.target.value)} className={inputCls} placeholder="EQ-001" />
          </Field>
          <Field label="Nº de série">
            <input value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fabricante">
            <input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Modelo">
            <input value={form.model} onChange={(e) => set("model", e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacidade">
            <input value={form.capacity} onChange={(e) => set("capacity", e.target.value)} className={inputCls} placeholder="12.000 BTU" />
          </Field>
          <Field label="Tensão">
            <input value={form.voltage} onChange={(e) => set("voltage", e.target.value)} className={inputCls} placeholder="220V" />
          </Field>
        </div>

        <Field label="Observações">
          <textarea value={form.observations} onChange={(e) => set("observations", e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} />
        </Field>
      </div>
    </Drawer>
  );
}

const inputCls =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";

function legacyEquipmentType(catalog?: Pick<TechnicalCatalog, "tags">): EquipmentType {
  for (const type of EQUIPMENT_TYPES) {
    const tag = `legacy-${type.toLowerCase().replaceAll("_", "-")}`;
    if (catalog?.tags.includes(tag)) return type;
  }
  return "OTHER";
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </span>
      {children}
    </label>
  );
}
