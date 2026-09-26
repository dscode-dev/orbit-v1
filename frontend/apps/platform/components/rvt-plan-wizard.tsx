'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ClipboardList, UserRound, Wrench } from 'lucide-react';
import { customersApi, equipmentsApi, rvtApi, technicalCatalogsApi, usersApi, useQuery, ApiClientError, type RvtPlan } from '@erp/api';
import { Drawer } from '@erp/ui/drawer';
import { MultiSelect } from '@erp/ui/multi-select';
import { EntityCombobox, type ComboboxQuery } from '@erp/ui/entity-combobox';
import { ErrorState } from '@erp/ui/states';

type Form = {
  customerId: string; addressId: string; name: string; maintenanceType: 'WEEKLY' | 'SEMIANNUAL';
  startDate: string; endDate: string; equipmentIds: string[]; responsibleTechnicianId: string;
  defaultOperatorId: string; checklistCatalogIds: string[]; observations: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const initial = (): Form => ({ customerId: '', addressId: '', name: '', maintenanceType: 'WEEKLY', startDate: today(), endDate: today(), equipmentIds: [], responsibleTechnicianId: '', defaultOperatorId: '', checklistCatalogIds: [], observations: '' });

export function RvtPlanWizard({ open, onClose, onSaved, plan }: { open: boolean; onClose: () => void; onSaved: (plan: RvtPlan) => void; plan?: RvtPlan | null }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Busca no servidor: a página fixa escondia clientes além dos 100 primeiros.
  const searchCustomers = useCallback(async ({ search, page }: ComboboxQuery, signal: AbortSignal) => {
    const result = await customersApi.listCustomers({ search: search || undefined, page, limit: 50, signal });
    return {
      options: result.items.map((item) => ({ value: item.id, label: item.tradeName ?? item.name })),
      total: result.pagination?.total,
    };
  }, []);
  const customer = useQuery((signal) => open && form.customerId ? customersApi.getCustomer(form.customerId, { signal }) : Promise.resolve(null), [open, form.customerId]);
  const equipments = useQuery((signal) => open && form.customerId ? equipmentsApi.listEquipments({ customerId: form.customerId, page: 1, limit: 100, signal }) : Promise.resolve({ items: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }), [open, form.customerId]);
  const users = useQuery((signal) => open ? usersApi.listUsers({ page: 1, limit: 100, signal }) : Promise.resolve({ items: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }), [open]);
  const catalogs = useQuery((signal) => open ? technicalCatalogsApi.listChecklistItems('TECHNICAL_REPORT', { maintenanceType: form.maintenanceType, includeGeneral: false, signal }) : Promise.resolve([]), [open, form.maintenanceType]);

  useEffect(() => {
    if (!open) return;
    setStep(0); setError(null);
    setForm(plan ? {
      customerId: plan.customerId, addressId: plan.addressId, name: plan.name, maintenanceType: plan.maintenanceType,
      startDate: plan.startDate.slice(0, 10), endDate: plan.endDate.slice(0, 10), equipmentIds: plan.equipments.map((item) => item.equipmentId),
      responsibleTechnicianId: plan.responsibleTechnicianId, defaultOperatorId: plan.defaultOperatorId ?? '',
      checklistCatalogIds: plan.checklists.map((item) => item.technicalCatalogId), observations: plan.observations ?? '',
    } : initial());
  }, [open, plan]);

  useEffect(() => {
    if (!open || plan || !catalogs.data) return;
    setForm((current) => ({ ...current, checklistCatalogIds: catalogs.data?.map((item) => item.id) ?? [] }));
  }, [catalogs.data, open, plan]);

  const occurrences = useMemo(() => {
    const start = new Date(`${form.startDate}T12:00:00Z`); const end = new Date(`${form.endDate}T12:00:00Z`);
    if (Number.isNaN(start.getTime()) || end < start) return 0;
    let count = 0; const cursor = new Date(start);
    while (cursor <= end && count <= 520) {
      count += 1;
      if (form.maintenanceType === 'WEEKLY') cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 6);
    }
    return count;
  }, [form.endDate, form.maintenanceType, form.startDate]);
  const valid = [Boolean(form.customerId && form.addressId && form.name.trim()), Boolean(form.startDate && form.endDate && form.equipmentIds.length && occurrences), Boolean(form.responsibleTechnicianId), true][step];
  const field = 'grid gap-1.5 text-sm font-medium';
  const input = 'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 font-normal';
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true); setError(null);
    try {
      const { customerId, ...mutable } = form;
      const payload = { ...mutable, defaultOperatorId: form.defaultOperatorId || null, observations: form.observations.trim() || null };
      const saved = plan ? await rvtApi.updatePlan(plan.id, payload) : await rvtApi.createPlan({ ...payload, customerId, defaultOperatorId: payload.defaultOperatorId ?? undefined });
      onSaved(saved); onClose();
    } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : 'Não foi possível salvar a configuração do RVT.'); }
    finally { setSaving(false); }
  }

  return <Drawer open={open} onClose={onClose} eyebrow="Relatório de Visita Técnica" title={plan ? 'Editar configuração' : 'Nova configuração'} width="max-w-3xl" footer={<><button className="h-10 rounded-md border px-4 text-sm" onClick={step ? () => setStep((value) => value - 1) : onClose}>{step ? 'Voltar' : 'Cancelar'}</button>{step < 3 ? <button disabled={!valid} className={primary} onClick={() => setStep((value) => value + 1)}>Continuar</button> : <button disabled={saving} className={primary} onClick={() => void save()}>{saving ? 'Salvando…' : plan ? 'Salvar alterações' : 'Criar configuração'}</button>}</>}>
    <div className="space-y-5">
      <ol className="grid grid-cols-4 gap-2">{['Identificação', 'Planejamento', 'Responsáveis', 'Confirmação'].map((label, index) => <li key={label} className={`rounded-lg p-2 text-center text-xs ${index === step ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-muted)]'}`}>{index + 1}. {label}</li>)}</ol>
      {error && <ErrorState error={new Error(error)} onRetry={() => setError(null)} />}
      {step === 0 && <section className="grid gap-4 md:grid-cols-2"><EntityCombobox label="Cliente" value={form.customerId} disabled={Boolean(plan)} onChange={(id) => { set('customerId', id); set('addressId', ''); set('equipmentIds', []); }} fetchOptions={searchCustomers} selectedOption={customer.data ? { value: customer.data.id, label: customer.data.tradeName ?? customer.data.name } : null} placeholder="Selecione" emptyMessage="Nenhum cliente encontrado." /><label className={field}>Endereço<select className={input} value={form.addressId} onChange={(event) => set('addressId', event.target.value)}><option value="">Selecione</option>{customer.data?.addresses.map((item) => <option key={item.id} value={item.id}>{item.name ?? [item.street, item.number, item.city].filter(Boolean).join(', ')}</option>)}</select></label><label className={`${field} md:col-span-2`}>Nome da configuração<input className={input} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: RVT semanal — unidade Recife" /></label></section>}
      {step === 1 && <section className="space-y-4"><div className="grid gap-4 md:grid-cols-3"><label className={field}>Periodicidade<select className={input} value={form.maintenanceType} onChange={(event) => { set('maintenanceType', event.target.value as Form['maintenanceType']); set('checklistCatalogIds', []); }}><option value="WEEKLY">Semanal</option><option value="SEMIANNUAL">Semestral</option></select></label><label className={field}>Início<input type="date" className={input} value={form.startDate} onChange={(event) => set('startDate', event.target.value)} /></label><label className={field}>Fim<input type="date" className={input} value={form.endDate} onChange={(event) => set('endDate', event.target.value)} /></label></div><MultiSelect label="Equipamentos cobertos" value={form.equipmentIds} onChange={(value) => set('equipmentIds', value)} options={(equipments.data?.items ?? []).map((item) => ({ value: item.id, label: [item.manufacturer, item.model, item.capacity].filter(Boolean).join(' - ') || item.name, description: item.sector ?? undefined }))} /><div className="rounded-lg border bg-[var(--color-muted)] p-4 text-sm"><CalendarDays className="mb-2 h-5 w-5 text-[var(--color-primary)]" /><strong>{occurrences} execução(ões) prevista(s)</strong><p className="text-caption">As ocorrências são persistidas individualmente e nenhuma delas gera documento durante a configuração.</p></div></section>}
      {step === 2 && <section className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><label className={field}>Responsável técnico<select className={input} value={form.responsibleTechnicianId} onChange={(event) => set('responsibleTechnicianId', event.target.value)}><option value="">Selecione</option>{users.data?.items.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.jobTitle ?? item.role}</option>)}</select></label><label className={field}>Operador padrão (opcional)<select className={input} value={form.defaultOperatorId} onChange={(event) => set('defaultOperatorId', event.target.value)}><option value="">Definir em cada execução</option>{users.data?.items.filter((item) => item.isActive && item.role !== 'VIEWER').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><MultiSelect label="Checklist atribuído" value={form.checklistCatalogIds} onChange={(value) => set('checklistCatalogIds', value)} options={(catalogs.data ?? []).map((item) => ({ value: item.id, label: item.title, description: item.description ?? undefined }))} /><label className={field}>Observações para as execuções<textarea className="min-h-28 rounded-md border bg-transparent p-3 font-normal" value={form.observations} onChange={(event) => set('observations', event.target.value)} /></label></section>}
      {step === 3 && <section className="grid gap-3 md:grid-cols-2"><Summary icon={ClipboardList} label="Configuração" value={`${form.name} · ${form.maintenanceType === 'WEEKLY' ? 'Semanal' : 'Semestral'}`} /><Summary icon={CalendarDays} label="Cobertura" value={`${form.startDate} a ${form.endDate} · ${occurrences} execução(ões)`} /><Summary icon={Wrench} label="Equipamentos" value={`${form.equipmentIds.length} selecionado(s)`} /><Summary icon={UserRound} label="Responsáveis" value={`${users.data?.items.find((item) => item.id === form.responsibleTechnicianId)?.name ?? '—'} · ${form.defaultOperatorId ? users.data?.items.find((item) => item.id === form.defaultOperatorId)?.name : 'operador por execução'}`} /><div className="md:col-span-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-600" /><strong>Somente planejamento será criado.</strong><p className="text-caption">Preview e PDF serão gerados apenas quando uma execução for concluída.</p></div></section>}
    </div>
  </Drawer>;
}

function Summary({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) { return <div className="rounded-lg border p-4"><Icon className="h-5 w-5 text-[var(--color-primary)]" /><span className="mt-3 block text-caption">{label}</span><strong className="text-sm">{value}</strong></div>; }
const primary = 'h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50';
