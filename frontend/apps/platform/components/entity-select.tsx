"use client";

import { useMemo } from "react";
import { MultiSelect } from "@erp/ui/multi-select";
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

export function CustomerSelect({ value, onChange }: { value: string; onChange: (id: string, customer?: Customer) => void }) {
  const customers = useQuery((signal) => customersApi.listCustomers({ limit: 100, signal }), []);
  return (
    <Field label="Cliente">
      <select value={value} onChange={(event) => onChange(event.target.value, customers.data?.items.find((c) => c.id === event.target.value))} className={inputCls}>
        <option value="">Selecione o cliente</option>
        {(customers.data?.items ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
      </select>
    </Field>
  );
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
  const equipments = useQuery(
    (signal) => (customerId ? equipmentsApi.listEquipments({ customerId, limit: 100, signal }) : Promise.resolve(null)),
    [customerId],
  );
  return (
    <Field label="Equipamento">
      <select value={value} onChange={(event) => onChange(event.target.value, equipments.data?.items.find((e) => e.id === event.target.value))} className={inputCls} disabled={!customerId}>
        <option value="">Sem equipamento específico</option>
        {(equipments.data?.items ?? []).map((equipment) => <option key={equipment.id} value={equipment.id}>{equipment.name}{equipment.tag ? ` · ${equipment.tag}` : ""}</option>)}
      </select>
    </Field>
  );
}

export function UserSelect({ value, onChange }: { value: string; onChange: (id: string, user?: TeamUser) => void }) {
  const users = useQuery((signal) => usersApi.listUsers({ limit: 100, signal }), []);
  const operators = useMemo(() => (users.data?.items ?? []).filter((user) => user.isActive && user.role !== "VIEWER"), [users.data]);
  return (
    <Field label="Operador responsável">
      <select value={value} onChange={(event) => onChange(event.target.value, operators.find((u) => u.id === event.target.value))} className={inputCls}>
        <option value="">Usar usuário autenticado</option>
        {operators.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}
      </select>
    </Field>
  );
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
