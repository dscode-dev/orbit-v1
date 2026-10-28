"use client";

import type { CreateOperationPayload, OperationServiceAddressInput } from "@erp/types";
import { CustomerAddressSelect, ServiceTypeSelect, Field, inputCls } from "./entity-select";

export type SecondaryServiceDraft = {
  type: string;
  addressId: string;
  address: OperationServiceAddressInput | null;
};

export function secondaryServiceComplete(draft: SecondaryServiceDraft | null, primaryAddressId: string): boolean {
  if (!draft) return true;
  if (!draft.type || !primaryAddressId) return false;
  if (!draft.address) return Boolean(draft.addressId);
  const a = draft.address;
  return Boolean(a.street.trim().length >= 2 && a.number.trim() && a.district.trim().length >= 2 &&
    a.city.trim().length >= 2 && /^[A-Z]{2}$/.test(a.state.trim()) &&
    (!a.zipCode?.trim() || /^\d{5}-?\d{3}$/.test(a.zipCode.trim())));
}

export function secondaryServicePayload(draft: SecondaryServiceDraft | null): Pick<CreateOperationPayload, "secondaryServiceType" | "secondaryAddressId" | "secondaryAddress"> {
  return {
    secondaryServiceType: draft?.type || null,
    secondaryAddressId: draft?.addressId || null,
    secondaryAddress: draft?.address ?? null,
  };
}

export function OperationSecondaryService({ customerId, value, onChange }: {
  customerId: string;
  value: SecondaryServiceDraft | null;
  onChange: (value: SecondaryServiceDraft | null) => void;
}) {
  const newAddress = (): OperationServiceAddressInput => ({
    name: "Serviço secundário", street: "", number: "", district: "", city: "", state: "",
  });
  if (!value) return (
    <button type="button" onClick={() => onChange({ type: "", addressId: "", address: customerId ? null : newAddress() })}
      className="w-full rounded-[var(--radius-md)] border border-dashed border-[var(--color-primary)] px-3 py-3 text-sm font-medium text-[var(--color-primary)]">
      Adicionar serviço secundário
    </button>
  );
  const updateAddress = (key: keyof OperationServiceAddressInput, next: string) => {
    if (value.address) onChange({ ...value, address: { ...value.address, [key]: next } });
  };
  return (
    <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3" aria-label="Serviço secundário">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Serviço secundário</h3>
        <button type="button" onClick={() => onChange(null)} className="text-sm text-[var(--color-danger)]">Remover serviço secundário</button>
      </div>
      <ServiceTypeSelect label="Tipo do serviço secundário" value={value.type} onChange={(type) => onChange({ ...value, type })} allowEmpty />
      {customerId && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(value.address)} onChange={(event) => onChange({ ...value, addressId: "", address: event.target.checked ? newAddress() : null })} />
          Cadastrar novo endereço para este serviço
        </label>
      )}
      {value.address ? (
        <div className="space-y-3">
          <p className="text-caption">O novo endereço será salvo no cadastro do cliente ao salvar a OS.</p>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="Logradouro do serviço secundário"><input maxLength={180} value={value.address.street} onChange={(e) => updateAddress("street", e.target.value)} className={inputCls} /></Field>
            <Field label="Número"><input maxLength={20} value={value.address.number} onChange={(e) => updateAddress("number", e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Bairro"><input maxLength={100} value={value.address.district} onChange={(e) => updateAddress("district", e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <Field label="Cidade"><input maxLength={100} value={value.address.city} onChange={(e) => updateAddress("city", e.target.value)} className={inputCls} /></Field>
            <Field label="UF"><input maxLength={2} value={value.address.state} onChange={(e) => updateAddress("state", e.target.value.toUpperCase())} className={inputCls} /></Field>
          </div>
          <Field label="CEP (opcional)"><input maxLength={9} inputMode="numeric" value={value.address.zipCode ?? ""} onChange={(e) => updateAddress("zipCode", e.target.value)} className={inputCls} /></Field>
          <Field label="Complemento"><input maxLength={120} value={value.address.complement ?? ""} onChange={(e) => updateAddress("complement", e.target.value)} className={inputCls} /></Field>
          <Field label="Ponto de referência"><input maxLength={180} value={value.address.referencePoint ?? ""} onChange={(e) => updateAddress("referencePoint", e.target.value)} className={inputCls} /></Field>
        </div>
      ) : <CustomerAddressSelect label="Endereço do serviço secundário" customerId={customerId} value={value.addressId} onChange={(addressId) => onChange({ ...value, addressId })} required />}
    </section>
  );
}
