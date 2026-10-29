"use client";

import { useEffect, useRef, useState } from 'react';
import { cepApi, technicalCatalogsApi, useQuery, type Budget, type BudgetGuestCustomerPayload, type BudgetGuestEquipmentPayload } from '@erp/api';
import { FieldEquipmentCollection } from '@operator/components/field-equipment-collection';

export type BudgetGuestCustomerDraft = Omit<BudgetGuestCustomerPayload, 'equipments'> & {
  equipments?: Array<BudgetGuestEquipmentPayload & { localId: string }>;
};

export function budgetGuestEquipmentDrafts(budget: Budget): NonNullable<BudgetGuestCustomerDraft['equipments']> {
  return (budget.equipments ?? []).map((item) => ({
    id: item.equipmentId, localId: item.equipmentId,
    equipmentTypeCatalogId: item.equipment?.equipmentTypeCatalogId ?? '',
    manufacturer: item.brandSnapshot ?? '', model: item.modelSnapshot ?? '', capacity: item.capacitySnapshot ?? '',
    sector: item.equipment?.sector ?? item.sector, tag: item.tagSnapshot ?? '', serialNumber: item.serialSnapshot ?? '',
    voltage: item.equipment?.voltage ?? '', observations: item.equipment?.observations ?? '',
  }));
}
import { maskCpf, maskCnpj, maskCep } from '@erp/utils';

const input = 'w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm';

export function validBudgetGuestCustomer(value: BudgetGuestCustomerPayload): boolean {
  if (value.name.trim().length < 2) return false;
  if (value.type === 'PERSON' && value.cpf && !/^\d{11}$/.test(value.cpf.replace(/\D/g, ''))) return false;
  if (value.type === 'COMPANY' && value.cnpj && !/^\d{14}$/.test(value.cnpj.replace(/\D/g, ''))) return false;
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return false;
  if (value.phone && !/^\+?[0-9 ()-]{8,30}$/.test(value.phone)) return false;
  if (value.secondaryPhone && !/^\+?[0-9 ()-]{8,30}$/.test(value.secondaryPhone)) return false;
  if ((value.equipments?.length ?? 0) > 20 || value.equipments?.some((item) =>
    !item.equipmentTypeCatalogId || !item.manufacturer?.trim() || !item.model?.trim() || !item.capacity?.trim())) return false;
  const address = value.address;
  return !address || Boolean(address.name.trim().length >= 2 && address.street.trim().length >= 2 && address.number.trim() && address.district.trim().length >= 2 && address.city.trim().length >= 2 && /^[A-Z]{2}$/.test(address.state) && (!address.zipCode || /^\d{8}$/.test(address.zipCode.replace(/\D/g, ''))));
}

export function BudgetGuestCustomerFields({ value, onChange }: {
  value: BudgetGuestCustomerDraft; onChange: (value: BudgetGuestCustomerDraft) => void;
}) {
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [lookupZip, setLookupZip] = useState('');
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [cepBusy, setCepBusy] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const normalizedCep = value.address?.zipCode?.replace(/\D/g, '') ?? '';
  const equipmentTypes = useQuery((signal) => value.equipments !== undefined
    ? technicalCatalogsApi.listEquipmentTypes({ signal }) : Promise.resolve([]), [value.equipments !== undefined]);

  useEffect(() => {
    setCepError(null);
    if (!/^\d{8}$/.test(lookupZip) || lookupZip !== normalizedCep) { setCepBusy(false); return; }
    const controller = new AbortController();
    let active = true;
    setCepBusy(true);
    const timer = window.setTimeout(async () => {
      const before = latest.current.value.address;
      try {
        const result = await cepApi.lookupCep(lookupZip, { signal: controller.signal });
        const current = latest.current.value;
        if (!active || !before || current.address?.zipCode?.replace(/\D/g, '') !== lookupZip) return;
        const address = { ...current.address };
        for (const key of ['street', 'district', 'city', 'state'] as const) {
          if (address[key] === before[key] && result[key]) address[key] = result[key];
        }
        latest.current.onChange({ ...current, address });
      } catch (cause) {
        if (active && !controller.signal.aborted) setCepError(cause instanceof Error ? cause.message : 'Não foi possível consultar o CEP.');
      } finally { if (active) setCepBusy(false); }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [lookupZip, normalizedCep, lookupAttempt]);

  function addressField(key: keyof NonNullable<BudgetGuestCustomerPayload['address']>, text: string) {
    if (!value.address) return;
    const next = key === 'state' ? text.toUpperCase() : key === 'zipCode' ? maskCep(text) : text;
    if (key === 'zipCode') setLookupZip(next.replace(/\D/g, ''));
    onChange({ ...value, address: { ...value.address, [key]: next } });
  }

  function field(key: keyof Omit<BudgetGuestCustomerPayload, 'address' | 'type' | 'equipments'>, label: string, options: { type?: string; maxLength?: number; mask?: (value: string) => string } = {}) {
    return <label className="min-w-0 space-y-1 text-sm"><span className="font-medium">{label}</span><input type={options.type ?? 'text'} maxLength={options.maxLength} value={value[key] ?? ''} onChange={(event) => onChange({ ...value, [key]: options.mask ? options.mask(event.target.value) : event.target.value })} className={input} /></label>;
  }
  return <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
    <div><h3 className="font-semibold">Cadastro do cliente avulso</h3><p className="text-caption">Fica restrito ao orçamento durante a validade da proposta. Só entra na base de clientes após a confirmação do aceite.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span className="font-medium">Tipo de cliente</span><select value={value.type} onChange={(event) => onChange({ ...value, type: event.target.value as BudgetGuestCustomerPayload['type'], cpf: undefined, cnpj: undefined })} className={input}><option value="COMPANY">Pessoa jurídica</option><option value="PERSON">Pessoa física</option></select></label>
      {field('name', value.type === 'PERSON' ? 'Nome completo' : 'Razão social', { maxLength: 180 })}
      {value.type === 'COMPANY' && field('tradeName', 'Nome fantasia', { maxLength: 180 })}
      {value.type === 'PERSON' ? field('cpf', 'CPF (opcional)', { mask: maskCpf }) : field('cnpj', 'CNPJ (opcional)', { mask: maskCnpj })}
      {field('email', 'E-mail', { type: 'email', maxLength: 254 })}
      {field('phone', 'Telefone', { type: 'tel', maxLength: 30 })}
      {field('secondaryPhone', 'Telefone secundário', { type: 'tel', maxLength: 30 })}
    </div>
    <label className="block space-y-1 text-sm"><span className="font-medium">Observações do cadastro</span><textarea rows={2} value={value.notes ?? ''} onChange={(event) => onChange({ ...value, notes: event.target.value })} maxLength={5000} className={input} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(value.address)} onChange={(event) => onChange({ ...value, address: event.target.checked ? { name: 'Principal', street: '', number: '', district: '', city: '', state: '' } : undefined })} />Informar endereço do cliente</label>
    {value.address && <div className="grid gap-3 sm:grid-cols-2">
      {([
        ['name', 'Identificação do endereço', 100], ['zipCode', 'CEP (opcional)', 9], ['street', 'Logradouro', 180],
        ['number', 'Número', 20], ['complement', 'Complemento', 120], ['district', 'Bairro', 100], ['city', 'Cidade', 100], ['state', 'UF', 2],
      ] as const).map(([key, label, maxLength]) => <label key={key} className="min-w-0 space-y-1 text-sm"><span className="font-medium">{label}</span><input maxLength={maxLength} value={value.address?.[key] ?? ''} onChange={(event) => addressField(key, event.target.value)} className={input} /></label>)}
    </div>}
    {value.address && <div aria-live="polite" className="text-sm">
      {cepBusy && <p className="text-caption">Consultando CEP…</p>}
      {cepError && <div className="space-y-2"><p className="text-[var(--color-danger)]">{cepError} Você pode preencher o endereço manualmente.</p><button type="button" onClick={() => { setLookupZip(normalizedCep); setLookupAttempt((attempt) => attempt + 1); }} className="text-[var(--color-primary)] underline">Tentar consultar CEP novamente</button></div>}
    </div>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.equipments !== undefined} onChange={(event) => onChange({ ...value, equipments: event.target.checked ? [] : undefined })} />Adicionar equipamentos ao orçamento (opcional)</label>
    {value.equipments !== undefined && <>
      <FieldEquipmentCollection
        title="Equipamentos do orçamento (opcional)"
        description="Adicione um ou mais equipamentos. Eles entram na base do cliente após o aceite do orçamento."
        drafts={value.equipments}
        equipmentTypes={equipmentTypes.data ?? []} equipmentTypesLoading={equipmentTypes.loading}
        onAdd={(draft) => onChange({ ...value, equipments: [...(value.equipments ?? []), draft] })}
        onRemove={(localId) => onChange({ ...value, equipments: value.equipments?.filter((item) => item.localId !== localId) })}
      />
      {equipmentTypes.error && <p className="text-sm text-[var(--color-danger)]">Não foi possível carregar os tipos. <button type="button" onClick={equipmentTypes.refetch} className="underline">Tentar novamente</button></p>}
    </>}
    {!validBudgetGuestCustomer(value) && <p className="text-xs text-[var(--color-muted-foreground)]">Informe o nome ou razão social e revise os dados preenchidos para continuar.</p>}
  </section>;
}
