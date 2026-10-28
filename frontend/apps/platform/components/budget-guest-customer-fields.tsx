"use client";

import type { BudgetGuestCustomerPayload } from '@erp/api';
import { maskCpf, maskCnpj, maskCep } from '@erp/utils';

const input = 'w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm';

export function validBudgetGuestCustomer(value: BudgetGuestCustomerPayload): boolean {
  if (value.name.trim().length < 2) return false;
  if (value.type === 'PERSON' && value.cpf && !/^\d{11}$/.test(value.cpf.replace(/\D/g, ''))) return false;
  if (value.type === 'COMPANY' && value.cnpj && !/^\d{14}$/.test(value.cnpj.replace(/\D/g, ''))) return false;
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return false;
  if (value.phone && !/^\+?[0-9 ()-]{8,30}$/.test(value.phone)) return false;
  if (value.secondaryPhone && !/^\+?[0-9 ()-]{8,30}$/.test(value.secondaryPhone)) return false;
  const address = value.address;
  return !address || Boolean(address.name.trim().length >= 2 && address.street.trim().length >= 2 && address.number.trim() && address.district.trim().length >= 2 && address.city.trim().length >= 2 && /^[A-Z]{2}$/.test(address.state) && (!address.zipCode || /^\d{8}$/.test(address.zipCode.replace(/\D/g, ''))));
}

export function BudgetGuestCustomerFields({ value, onChange }: {
  value: BudgetGuestCustomerPayload; onChange: (value: BudgetGuestCustomerPayload) => void;
}) {
  function field(key: keyof Omit<BudgetGuestCustomerPayload, 'address' | 'type'>, label: string, options: { type?: string; maxLength?: number; mask?: (value: string) => string } = {}) {
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
      ] as const).map(([key, label, maxLength]) => <label key={key} className="min-w-0 space-y-1 text-sm"><span className="font-medium">{label}</span><input maxLength={maxLength} value={value.address?.[key] ?? ''} onChange={(event) => onChange({ ...value, address: { ...value.address!, [key]: key === 'state' ? event.target.value.toUpperCase() : key === 'zipCode' ? maskCep(event.target.value) : event.target.value } })} className={input} /></label>)}
    </div>}
    {!validBudgetGuestCustomer(value) && <p className="text-xs text-[var(--color-muted-foreground)]">Informe o nome ou razão social e revise os dados preenchidos para continuar.</p>}
  </section>;
}
