"use client";

import { useMemo, useState } from "react";
import { Building2, CalendarDays, ClipboardList, LogOut, Package, Plus, RefreshCw, Wrench } from "lucide-react";
import { RequireAuth } from "@erp/ui/auth/require-auth";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { BrandLogo } from "@erp/ui/brand";
import { MultiSelect } from "@erp/ui/multi-select";
import { StatusChip } from "@erp/ui/status-chip";
import { EmptyState } from "@erp/ui/empty-state";
import { serviceRequestsApi, useQuery, type CreateServiceRequestPayload, type CustomerPortalOperation, type ServiceRequestStatus, type ServiceRequestType } from "@erp/api";

type Tab = "history" | "equipment" | "data" | "requests";
const tabs: Array<{ id: Tab; label: string; icon: typeof ClipboardList }> = [
  { id: "history", label: "Serviços e históricos", icon: ClipboardList },
  { id: "equipment", label: "Equipamentos", icon: Package },
  { id: "data", label: "Meus dados", icon: Building2 },
  { id: "requests", label: "Chamados", icon: Wrench },
];

const requestStatus: Record<ServiceRequestStatus, string> = { OPEN: "Aberto", IN_REVIEW: "Em análise", SCHEDULED: "Agendado", CLOSED: "Concluído", CANCELED: "Cancelado" };
const requestType: Record<ServiceRequestType, string> = { WORK_ORDER: "Ordem de Serviço", RVT: "RVT", TECHNICAL_REPORT: "Laudo Técnico" };
const operationStatus: Record<string, string> = { DRAFT: "Rascunho", PENDING: "Pendente", IN_PROGRESS: "Em execução", REVIEW: "Em revisão", COMPLETED: "Concluído", CANCELED: "Cancelado" };

function date(value?: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Não informado";
}

function PortalContent() {
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>("history");
  const [formOpen, setFormOpen] = useState(false);
  const query = useQuery((signal) => serviceRequestsApi.getPortalDashboard({ signal }), []);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-card)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <BrandLogo height={34} />
          <div className="min-w-0 flex-1 border-l border-[var(--color-border)] pl-4">
            <p className="truncate text-sm font-semibold">{query.data?.tradeName || query.data?.name || "Portal do cliente"}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">Área exclusiva do cliente</p>
          </div>
          <button onClick={() => void logout()} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)]"><LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sair</span></button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="text-2xl font-bold">Olá, {query.data?.tradeName || query.data?.name || "cliente"}</h1><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Acompanhe seus atendimentos e equipamentos em um só lugar.</p></div>
          <button onClick={() => setFormOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]"><Plus className="h-4 w-4" /> Abrir chamado</button>
        </div>

        <div className="mb-6 flex gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-1">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`inline-flex min-w-max flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-sm transition ${tab === id ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]" : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"}`}><Icon className="h-4 w-4" />{label}</button>)}
        </div>

        {query.loading && !query.data ? <div className="grid min-h-64 place-items-center"><RefreshCw className="h-6 w-6 animate-spin text-[var(--color-primary)]" /></div> : query.error || !query.data ? <EmptyState icon={Wrench} title="Não foi possível carregar o portal" description="Atualize a página ou tente novamente em alguns instantes." action={<button onClick={query.refetch} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-sm text-white">Tentar novamente</button>} /> : (
          <>
            {tab === "history" && <History operations={query.data.operations} />}
            {tab === "equipment" && <EquipmentList equipments={query.data.equipments} />}
            {tab === "data" && <CustomerData customer={query.data} />}
            {tab === "requests" && <RequestList requests={query.data.serviceRequests} />}
          </>
        )}
      </main>
      {formOpen && query.data && <RequestForm dashboard={query.data} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); setTab("requests"); query.refetch(); }} />}
    </div>
  );
}

function History({ operations }: { operations: CustomerPortalOperation[] }) {
  if (!operations.length) return <EmptyState icon={ClipboardList} title="Nenhum serviço registrado" description="Seus atendimentos, PMOCs, RVTs e ordens de serviço aparecerão aqui." />;
  return <div className="space-y-3">{operations.map((operation) => <details key={operation.id} className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]"><summary className="flex cursor-pointer list-none items-center justify-between gap-3"><span><span className="block font-semibold">Operação #{String(operation.number).padStart(6, "0")}</span><span className="text-xs text-[var(--color-muted-foreground)]">{date(operation.scheduledFor || operation.createdAt)} · {operation.equipment?.name || `${operation.inspectedEquipments.length} equipamento(s)`}</span></span><StatusChip tone={operation.status === "COMPLETED" ? "success" : operation.status === "CANCELED" ? "danger" : "info"}>{operationStatus[operation.status] || operation.status}</StatusChip></summary><div className="mt-4 grid gap-4 border-t border-[var(--color-border)] pt-4 text-sm md:grid-cols-2"><Info label="Técnico responsável" value={operation.operator.name} /><Info label="Endereço" value={operation.address ? `${operation.address.street}, ${operation.address.number} · ${operation.address.city}/${operation.address.state}` : "Não informado"} /><Info label="Problema relatado" value={operation.reportedIssue || "Não informado"} /><Info label="Serviço executado" value={operation.serviceDescription || "Aguardando execução"} /><div className="md:col-span-2"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">Documentos e execuções</p>{operation.documents.length ? <div className="flex flex-wrap gap-2">{operation.documents.map((doc) => <span key={doc.id} className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs">{doc.type} · {doc.number} · {doc.status}</span>)}</div> : <p className="text-[var(--color-muted-foreground)]">Nenhum documento emitido.</p>}</div></div></details>)}</div>;
}

function EquipmentList({ equipments }: { equipments: Array<{ id: string; name: string; type: string; status: string; tag: string | null; sector: string | null; manufacturer: string | null; model: string | null; serialNumber?: string | null; capacity: string | null; voltage?: string | null }> }) {
  if (!equipments.length) return <EmptyState icon={Package} title="Nenhum equipamento cadastrado" description="Os equipamentos vinculados ao seu cadastro aparecerão aqui." />;
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{equipments.map((item) => <div key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{item.name}</h3><p className="text-xs text-[var(--color-muted-foreground)]">{item.tag || item.type}</p></div><StatusChip tone={item.status === "ACTIVE" ? "success" : "warning"}>{item.status}</StatusChip></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><Info label="Setor" value={item.sector || "—"} /><Info label="Fabricante" value={item.manufacturer || "—"} /><Info label="Modelo" value={item.model || "—"} /><Info label="Capacidade" value={item.capacity || "—"} /><Info label="Série" value={item.serialNumber || "—"} /><Info label="Tensão" value={item.voltage || "—"} /></dl></div>)}</div>;
}

function CustomerData({ customer }: { customer: { name: string; tradeName: string | null; cpf: string | null; cnpj: string | null; email: string | null; phone: string | null; secondaryPhone: string | null; addresses: Array<{ id: string; name: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; zipCode: string; referencePoint: string | null }>; contacts: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null }> } }) {
  return <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5"><h2 className="font-semibold">Dados cadastrais</h2><dl className="mt-4 grid grid-cols-2 gap-4"><Info label="Nome / Razão social" value={customer.name} /><Info label="Nome fantasia" value={customer.tradeName || "—"} /><Info label="CPF / CNPJ" value={customer.cpf || customer.cnpj || "—"} /><Info label="E-mail" value={customer.email || "—"} /><Info label="Telefone" value={customer.phone || "—"} /><Info label="Telefone alternativo" value={customer.secondaryPhone || "—"} /></dl></section><section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5"><h2 className="font-semibold">Endereços</h2><div className="mt-4 space-y-3">{customer.addresses.map((address) => <div key={address.id} className="rounded-[var(--radius-md)] bg-[var(--color-muted)] p-3 text-sm"><p className="font-medium">{address.name}</p><p className="text-[var(--color-muted-foreground)]">{address.street}, {address.number}{address.complement ? ` · ${address.complement}` : ""}<br />{address.district} · {address.city}/{address.state} · CEP {address.zipCode}</p></div>)}</div></section></div>;
}

function RequestList({ requests }: { requests: Array<{ id: string; number: number; subject: string; type: ServiceRequestType; status: ServiceRequestStatus; createdAt: string; description: string; operation: { number: number; scheduledFor: string | null; operator: { name: string } } | null }> }) {
  if (!requests.length) return <EmptyState icon={Wrench} title="Nenhum chamado aberto" description="Use o botão “Abrir chamado” quando precisar de atendimento." />;
  return <div className="space-y-3">{requests.map((request) => <div key={request.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-[var(--color-muted-foreground)]">Chamado #{String(request.number).padStart(6, "0")} · {requestType[request.type]} · {date(request.createdAt)}</p><h3 className="mt-1 font-semibold">{request.subject}</h3></div><StatusChip tone={request.status === "CLOSED" ? "success" : request.status === "CANCELED" ? "danger" : "info"}>{requestStatus[request.status]}</StatusChip></div><p className="mt-3 whitespace-pre-wrap text-sm text-[var(--color-muted-foreground)]">{request.description}</p>{request.operation && <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-primary)]/5 p-3 text-sm">Operação #{String(request.operation.number).padStart(6, "0")} · {request.operation.operator.name} · {date(request.operation.scheduledFor)}</div>}</div>)}</div>;
}

function RequestForm({ dashboard, onClose, onCreated }: { dashboard: { addresses: Array<{ id: string; name: string; street: string; number: string }>; equipments: Array<{ id: string; name: string; tag: string | null; sector: string | null }>; phone: string | null }; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateServiceRequestPayload>({ type: "WORK_ORDER", subject: "", description: "", equipmentIds: [], contactPhone: dashboard.phone || "" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const equipmentOptions = useMemo(() => dashboard.equipments.map((item) => ({ value: item.id, label: item.name, description: [item.tag, item.sector].filter(Boolean).join(" · ") })), [dashboard.equipments]);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(null); try { await serviceRequestsApi.createPortalRequest({ ...form, preferredAt: form.preferredAt ? new Date(form.preferredAt).toISOString() : undefined }); onCreated(); } catch { setError("Não foi possível abrir o chamado. Confira os dados e tente novamente."); setSaving(false); } }
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={submit} className="max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-t-[var(--radius-lg)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-floating)] sm:rounded-[var(--radius-lg)] sm:p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold">Abrir chamado</h2><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Só o assunto e a descrição são obrigatórios.</p></div><button type="button" onClick={onClose} className="rounded p-2 text-xl">×</button></div>{error && <p className="mt-4 rounded-[var(--radius-md)] bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Tipo de serviço"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ServiceRequestType })} className="input"><option value="WORK_ORDER">Ordem de Serviço (padrão)</option><option value="RVT">RVT</option><option value="TECHNICAL_REPORT">Laudo Técnico</option></select></Field><Field label="Endereço"><select value={form.addressId || ""} onChange={(e) => setForm({ ...form, addressId: e.target.value || undefined })} className="input"><option value="">Selecione se aplicável</option>{dashboard.addresses.map((address) => <option key={address.id} value={address.id}>{address.name} · {address.street}, {address.number}</option>)}</select></Field><div className="sm:col-span-2"><MultiSelect label="Equipamentos envolvidos" options={equipmentOptions} value={form.equipmentIds || []} onChange={(equipmentIds) => setForm({ ...form, equipmentIds })} placeholder="Selecione um ou mais (opcional)" /></div><div className="sm:col-span-2"><Field label="Assunto *"><input required minLength={3} maxLength={180} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="input" placeholder="Ex.: Ar-condicionado não está refrigerando" /></Field></div><div className="sm:col-span-2"><Field label="Descrição *"><textarea required minLength={5} maxLength={5000} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input h-auto py-3" placeholder="Descreva brevemente o que está acontecendo." /></Field></div><Field label="Melhor data e horário"><input type="datetime-local" value={form.preferredAt || ""} onChange={(e) => setForm({ ...form, preferredAt: e.target.value || undefined })} className="input" /></Field><Field label="Telefone para contato"><input value={form.contactPhone || ""} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="input" placeholder="(00) 00000-0000" /></Field></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm">Cancelar</button><button disabled={saving || !form.subject.trim() || !form.description.trim()} className="h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50">{saving ? "Enviando…" : "Abrir chamado"}</button></div></form></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-[var(--color-muted-foreground)]">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{value}</dd></div>; }

export default function CustomerPortalPage() {
  return <RequireAuth roles={["CUSTOMER"]} fallbackPath="/customer/login" loginPath="/customer/login" changePasswordPath="/customer"><PortalContent /></RequireAuth>;
}
