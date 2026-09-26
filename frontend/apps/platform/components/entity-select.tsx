"use client";

import { useCallback, useMemo, useRef } from "react";
import { MultiSelect } from "@erp/ui/multi-select";
import { EntityCombobox, type ComboboxOption, type ComboboxQuery } from "@erp/ui/entity-combobox";
import {
  customersApi,
  equipmentsApi,
  serviceTypesApi,
  usersApi,
  useQuery,
  type Customer,
  type CustomerAddress,
  type EquipmentSummary,
  type OperationType,
  type TeamUser,
} from "@erp/api";

export const SERVICE_TYPES: Array<{ value: OperationType; label: string }> = [
  { value: "PREVENTIVA", label: "Preventiva" },
  { value: "CORRETIVA", label: "Corretiva" },
  { value: "INSTALACAO", label: "Instalação" },
  { value: "PROJETO", label: "Projeto" },
];

/**
 * Busca no servidor: a base de clientes passa de 100 registros e o select
 * antigo mostrava só a primeira página.
 */
export function CustomerSelect({ value, onChange }: { value: string; onChange: (id: string, customer?: Customer) => void }) {
  // Guarda os clientes já trazidos para devolver o objeto certo no onChange:
  // quem usa este select preenche endereço/contato a partir dele.
  const loaded = useRef(new Map<string, Customer>());
  const fetchOptions = useCallback(async ({ search, page }: ComboboxQuery, signal: AbortSignal) => {
    const result = await customersApi.listCustomers({ search: search || undefined, page, limit: 50, signal });
    for (const customer of result.items) loaded.current.set(customer.id, customer);
    return { options: result.items.map(customerOption), total: result.pagination?.total };
  }, []);
  // Ao editar um registro antigo, o cliente escolhido pode não estar na
  // primeira página — busca pelo id só para manter o rótulo visível.
  const detail = useQuery(
    (signal) => (value && !loaded.current.has(value) ? customersApi.getCustomer(value, { signal }) : Promise.resolve(null)),
    [value],
  );
  const selected = loaded.current.get(value) ?? detail.data ?? null;
  return (
    <EntityCombobox
      label="Cliente"
      value={value}
      onChange={(id) => onChange(id, id ? loaded.current.get(id) : undefined)}
      fetchOptions={fetchOptions}
      selectedOption={selected ? customerOption(selected) : null}
      placeholder="Selecione o cliente"
      emptyMessage="Nenhum cliente encontrado."
    />
  );
}

function customerOption(customer: { id: string; name: string; tradeName?: string | null; document?: string | null }): ComboboxOption {
  return {
    value: customer.id,
    label: customer.name,
    description: customer.tradeName || customer.document || undefined,
  };
}

export function CustomerAddressSelect({ customerId, value, onChange }: { customerId: string; value: string; onChange: (id: string) => void }) {
  const detail = useQuery((signal) => (customerId ? customersApi.getCustomer(customerId, { signal }) : Promise.resolve(null)), [customerId]);
  const addresses = detail.data?.addresses ?? [];
  return (
    <Field label="Endereço">
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputCls} disabled={!customerId}>
        <option value="">Sem endereço específico</option>
        {addresses.map((address) => <option key={address.id} value={address.id}>{addressLabel(address)}</option>)}
      </select>
    </Field>
  );
}

export function EquipmentSelect({ customerId, value, onChange }: { customerId: string; value: string; onChange: (id: string, equipment?: EquipmentSummary) => void }) {
  const loaded = useRef(new Map<string, EquipmentSummary>());
  const fetchOptions = useCallback(
    async ({ search, page }: ComboboxQuery, signal: AbortSignal) => {
      if (!customerId) return { options: [] };
      const result = await equipmentsApi.listEquipments({
        customerId,
        search: search || undefined,
        page,
        limit: 50,
        signal,
      });
      for (const equipment of result.items) loaded.current.set(equipment.id, equipment);
      return { options: result.items.map(equipmentOption), total: result.pagination?.total };
    },
    [customerId],
  );
  const selected = loaded.current.get(value) ?? null;
  return (
    <EntityCombobox
      label="Equipamento"
      value={value}
      onChange={(id) => onChange(id, id ? loaded.current.get(id) : undefined)}
      fetchOptions={fetchOptions}
      selectedOption={selected ? equipmentOption(selected) : null}
      placeholder="Sem equipamento específico"
      clearLabel="Sem equipamento específico"
      emptyMessage="Nenhum equipamento deste cliente."
      disabled={!customerId}
    />
  );
}

function equipmentOption(equipment: EquipmentSummary): ComboboxOption {
  return { value: equipment.id, label: equipment.name, description: equipment.tag ?? undefined };
}

export function UserSelect({ value, onChange }: { value: string; onChange: (id: string, user?: TeamUser) => void }) {
  const loaded = useRef(new Map<string, TeamUser>());
  const fetchOptions = useCallback(async ({ search, page }: ComboboxQuery, signal: AbortSignal) => {
    const result = await usersApi.listUsers({ search: search || undefined, page, limit: 50, signal });
    // Quem não pode executar atendimento não aparece como responsável.
    const operators = result.items.filter((user) => user.isActive && user.role !== "VIEWER");
    for (const user of operators) loaded.current.set(user.id, user);
    // O total do servidor inclui quem foi filtrado aqui; sem ele a lista para
    // de paginar cedo, então usamos o total bruto como referência de "há mais".
    return { options: operators.map(userOption), total: result.pagination?.total };
  }, []);
  const selected = loaded.current.get(value) ?? null;
  return (
    <EntityCombobox
      label="Operador responsável"
      value={value}
      onChange={(id) => onChange(id, id ? loaded.current.get(id) : undefined)}
      fetchOptions={fetchOptions}
      selectedOption={selected ? userOption(selected) : null}
      placeholder="Usar usuário autenticado"
      clearLabel="Usar usuário autenticado"
      emptyMessage="Nenhum operador encontrado."
    />
  );
}

function userOption(user: TeamUser): ComboboxOption {
  return { value: user.id, label: user.name, description: user.role };
}

/**
 * Auxiliar técnico: recebe/visualiza a mesma demanda do executor primário.
 * Sem permissão de Relatórios (canReports) ficam somente em visualização; com a
 * permissão, podem colaborar. Nunca inclui o próprio executor primário.
 */
export function AuxiliaryOperatorSelect({
  value,
  onChange,
  excludeId,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  excludeId?: string;
}) {
  const users = useQuery((signal) => usersApi.listUsers({ limit: 100, signal }), []);
  const operators = useMemo(
    () => (users.data?.items ?? []).filter((user) => user.isActive && user.role !== "VIEWER" && user.id !== excludeId),
    [users.data, excludeId],
  );
  return (
    <div className="space-y-1.5">
      <MultiSelect
        label="Auxiliar Técnico (opcional)"
        value={value.filter((id) => id !== excludeId)}
        onChange={onChange}
        options={operators.map((user) => ({
          value: user.id,
          label: user.name,
          description: `${user.role}${user.permission?.canReports ? "" : " · somente visualização"}`,
        }))}
        placeholder="Selecionar auxiliar técnico"
        emptyMessage="Nenhum outro técnico disponível."
      />
      <span className="text-caption">
        Recebem e visualizam a mesma demanda. Sem permissão de Relatórios, ficam somente em
        visualização (não iniciam nem editam o atendimento).
      </span>
    </div>
  );
}

export function ServiceTypeSelect({ value, onChange }: { value: OperationType; onChange: (value: OperationType) => void }) {
  // Opções vêm do catálogo editável (aba "Tipo de Serviço" em Catálogos Técnicos);
  // enquanto carrega, usa os 4 tipos do sistema como fallback.
  const types = useQuery((signal) => serviceTypesApi.list({ activeOnly: true, signal }), []);
  const options = useMemo(() => {
    const items = types.data?.items ?? [];
    const fromCatalog = items.map((item) => ({ value: item.key, label: item.label }));
    // Garante que o valor atual (ex.: tipo desativado de uma OS existente) apareça.
    if (value && !fromCatalog.some((o) => o.value === value)) {
      const fallbackLabel = SERVICE_TYPES.find((t) => t.value === value)?.label ?? value;
      return [{ value, label: fallbackLabel }, ...fromCatalog];
    }
    return fromCatalog.length ? fromCatalog : SERVICE_TYPES;
  }, [types.data, value]);
  return (
    <Field label="Tipo de serviço">
      <select value={value} onChange={(event) => onChange(event.target.value as OperationType)} className={inputCls}>
        {options.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
    </Field>
  );
}

export function DateTimePicker({ date, time, onDate, onTime }: { date: string; time: string; onDate: (value: string) => void; onTime: (value: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Data">
        <input type="date" value={date} onChange={(event) => onDate(event.target.value)} className={inputCls} />
      </Field>
      <Field label="Horário">
        <input type="time" value={time} onChange={(event) => onTime(event.target.value)} className={inputCls} />
      </Field>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}

function addressLabel(address: CustomerAddress): string {
  return [address.name, address.street, address.number, address.city, address.state].filter(Boolean).join(" · ") || "Endereço";
}

export const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60";
