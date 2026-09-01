"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { MultiSelect } from "@erp/ui/multi-select";
import {
  budgetsApi,
  customersApi,
  documentsApi,
  equipmentsApi,
  operationApi,
  signaturesApi,
  technicalCatalogsApi,
  useQuery,
  type Budget,
  type BudgetItemPayload,
  type BudgetItemType,
  type BudgetPaymentMethod,
  type BudgetPayload,
  type Customer,
  type CustomerDetail,
  type EquipmentSummary,
  type Signature,
  type TechnicalCatalog,
} from "@erp/api";
import { brlAmountInWords, formatCurrencyBRL, formatNumber } from "@erp/utils";
import { TechnicalSignaturePreview } from "./document-handoff-inbox";

const STEPS = ["Origem", "Dados gerais", "Serviços", "Materiais", "Valores", "Condições", "Responsável técnico"];
const DEFAULT_SERVICE_DISCOUNT_TEXT = "Desconto especial aplicado aos serviços";
const DEFAULT_MATERIAL_DISCOUNT_TEXT = "Desconto especial aplicado aos materiais e fornecimentos";

export function BudgetWizardDrawer({
  open,
  onClose,
  onSaved,
  budget = null,
  initialOperationId = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (budget: Budget) => void;
  budget?: Budget | null;
  initialOperationId?: string | null;
}) {
  const [step, setStep] = useState(0);
  const [origin, setOrigin] = useState<"MANUAL" | "WORK_ORDER">("MANUAL");
  const [operationId, setOperationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [addressId, setAddressId] = useState("");
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const [title, setTitle] = useState("Orçamento de manutenção");
  const [description, setDescription] = useState("");
  const [issuedAt, setIssuedAt] = useState(today());
  const [introduction, setIntroduction] = useState("Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento conforme solicitado.");
  const [items, setItems] = useState<BudgetItemPayload[]>([]);
  const [serviceDiscount, setServiceDiscount] = useState("0");
  const [materialDiscount, setMaterialDiscount] = useState("0");
  const [serviceDiscountDescription, setServiceDiscountDescription] = useState(DEFAULT_SERVICE_DISCOUNT_TEXT);
  const [materialDiscountDescription, setMaterialDiscountDescription] = useState(DEFAULT_MATERIAL_DISCOUNT_TEXT);
  const [amountInWords, setAmountInWords] = useState("");
  const [amountEdited, setAmountEdited] = useState(false);
  const [validityDays, setValidityDays] = useState("30");
  const [paymentMethods, setPaymentMethods] = useState<BudgetPaymentMethod[]>(["PIX"]);
  const [commercialNotes, setCommercialNotes] = useState("");
  const [observations, setObservations] = useState("");
  const [technicalSignatureId, setTechnicalSignatureId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customers = useQuery((signal) => open ? customersApi.listCustomers({ limit: 100, signal }) : Promise.resolve(null), [open]);
  const customer = useQuery<CustomerDetail | null>((signal) => open && customerId ? customersApi.getCustomer(customerId, { signal }) : Promise.resolve(null), [open, customerId]);
  const equipments = useQuery((signal) => open && customerId ? equipmentsApi.listEquipments({ limit: 100, customerId, signal }) : Promise.resolve(null), [open, customerId]);
  const operations = useQuery((signal) => open && origin === "WORK_ORDER" ? operationApi.listOperations({ limit: 100, status: "COMPLETED", signal }) : Promise.resolve(null), [open, origin]);
  const signatures = useQuery((signal) => open ? signaturesApi.listSignatures({ limit: 100, active: true, signal }) : Promise.resolve(null), [open]);
  const materialDescriptions = useQuery(
    (signal) =>
      open
        ? technicalCatalogsApi.listBudgetMaterialDescriptions({ signal })
        : Promise.resolve(null),
    [open],
  );

  useEffect(() => {
    if (!open) return;
    setStep(0); setOrigin(budget?.operationId || initialOperationId ? "WORK_ORDER" : "MANUAL"); setOperationId(budget?.operationId ?? initialOperationId ?? "");
    setCustomerId(budget?.customerId ?? ""); setAddressId(budget?.customerAddressId ?? ""); setEquipmentIds(budget?.equipments?.map((item) => item.equipmentId) ?? (budget?.equipmentId ? [budget.equipmentId] : []));
    setTitle(budget?.title ?? "Orçamento de manutenção"); setDescription(budget?.description ?? ""); setIssuedAt(budget?.issuedAt?.slice(0, 10) ?? today());
    setIntroduction(budget?.introduction ?? "Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento conforme solicitado.");
    setItems(budget?.items.map((item) => ({ productId: item.productId, type: item.type, source: item.source ?? "MANUAL", description: item.description, quantity: Number(item.quantity), unit: item.unit, unitPrice: Number(item.unitPrice), sortOrder: item.sortOrder })) ?? []);
    setServiceDiscount(String(budget?.serviceDiscount ?? 0)); setMaterialDiscount(String(budget?.materialDiscount ?? 0));
    setServiceDiscountDescription(budget?.serviceDiscountDescription ?? DEFAULT_SERVICE_DISCOUNT_TEXT); setMaterialDiscountDescription(budget?.materialDiscountDescription ?? DEFAULT_MATERIAL_DISCOUNT_TEXT);
    setAmountInWords(budget?.amountInWords ?? ""); setAmountEdited(Boolean(budget?.amountInWords)); setValidityDays(String(budget?.validityDays ?? 30)); setPaymentMethods(budget?.paymentMethods ?? ["PIX"]);
    setCommercialNotes(budget?.commercialNotes ?? ""); setObservations(budget?.observations ?? ""); setTechnicalSignatureId(budget?.document?.technicalSignatureId ?? "");
    setError(null);
  }, [budget, initialOperationId, open]);

  useEffect(() => {
    if (!addressId && customer.data?.addresses?.[0]) setAddressId(customer.data.addresses[0].id);
  }, [addressId, customer.data]);

  useEffect(() => {
    if (technicalSignatureId) return;
    const available = signatures.data?.items ?? [];
    setTechnicalSignatureId(available.find((signature) => signature.isDefault)?.id ?? available[0]?.id ?? "");
  }, [signatures.data, technicalSignatureId]);

  useEffect(() => {
    if (!open || origin !== "WORK_ORDER" || !operationId) return;
    let active = true;
    void operationApi.getOperation(operationId).then((operation) => {
      if (!active) return;
      setCustomerId(operation.customer?.id ?? "");
      setAddressId(operation.address?.id ?? "");
      // Reflete todos os equipamentos da OS (principal + inspecionados) no orçamento.
      const inspected = operation.inspectedEquipments?.map((item) => item.equipmentId) ?? [];
      const combined = [operation.equipment?.id, ...inspected].filter((value): value is string => Boolean(value));
      setEquipmentIds([...new Set(combined)]);
      setTitle(`Orçamento referente à OS-${String(operation.number).padStart(6, "0")}`);
      setDescription(operation.serviceDescription || operation.observations || operation.reportedIssue || "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar a Ordem de Serviço."));
    return () => { active = false; };
  }, [open, origin, operationId]);

  const services = items.filter((item) => item.type === "SERVICE");
  const materials = items.filter((item) => item.type === "MATERIAL" && item.source !== "CATALOG");
  const serviceSubtotal = sum(services);
  const materialSubtotal = sum(materials);
  const serviceDiscountValue = moneyInputValue(serviceDiscount);
  const materialDiscountValue = moneyInputValue(materialDiscount);
  const total = serviceSubtotal + materialSubtotal - serviceDiscountValue - materialDiscountValue;
  const selectedSignature = signatures.data?.items.find((signature) => signature.id === technicalSignatureId) ?? null;

  useEffect(() => {
    if (!amountEdited) setAmountInWords(brlAmountInWords(Math.max(total, 0)));
  }, [amountEdited, total]);

  function canContinue(): boolean {
    if (step === 0) return origin === "MANUAL" || Boolean(operationId);
    if (step === 1) return Boolean(customerId && title.trim() && issuedAt && introduction.trim());
    if (step === 2) return services.length > 0 && serviceDiscountValue <= serviceSubtotal && (serviceDiscountValue === 0 || Boolean(serviceDiscountDescription.trim()));
    if (step === 3) return materialDiscountValue <= materialSubtotal && (materialDiscountValue === 0 || Boolean(materialDiscountDescription.trim()));
    if (step === 4) return total >= 0 && Boolean(amountInWords.trim());
    if (step === 5) return Number(validityDays) > 0 && paymentMethods.length > 0;
    if (step === 6) return Boolean(technicalSignatureId);
    return true;
  }

  async function submit() {
    setSaving(true); setError(null);
    try {
      const payload: BudgetPayload = {
        operationId: origin === "WORK_ORDER" ? operationId : undefined,
        customerId,
        customerAddressId: addressId || undefined,
        equipmentIds,
        title,
        description: description || undefined,
        issuedAt: new Date(`${issuedAt}T12:00:00`).toISOString(),
        introduction,
        serviceDiscount: serviceDiscountValue,
        materialDiscount: materialDiscountValue,
        serviceDiscountDescription: serviceDiscountValue > 0 ? serviceDiscountDescription : undefined,
        materialDiscountDescription: materialDiscountValue > 0 ? materialDiscountDescription : undefined,
        validityDays: Number(validityDays),
        amountInWords,
        paymentMethods,
        commercialNotes: commercialNotes || undefined,
        observations: observations || undefined,
        status: "DRAFT",
        items: items.map((item, index) => ({ ...item, sortOrder: index })),
      };
      let saved = budget
        ? await budgetsApi.updateBudget(budget.id, payload)
        : await budgetsApi.createBudget(payload);
      if (!saved.document?.id) saved = await budgetsApi.getBudget(saved.id);
      if (saved.document?.id) {
        await documentsApi.selectHandoffTechnicalSignature(saved.document.id, technicalSignatureId);
        saved = await budgetsApi.getBudget(saved.id);
      }
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o orçamento.");
    } finally {
      setSaving(false);
    }
  }

  return <Drawer open={open} onClose={onClose} eyebrow="Orçamento" title={budget ? `Editar ORC-${String(budget.number).padStart(6, "0")}` : "Novo orçamento"} width="max-w-5xl" footer={<><button onClick={onClose} className={secondaryBtn}>Cancelar</button>{step > 0 && <button onClick={() => setStep((value) => value - 1)} disabled={saving} className={secondaryBtn}><ChevronLeft className="h-4 w-4" /> Voltar</button>}{step < STEPS.length - 1 ? <button onClick={() => setStep((value) => value + 1)} disabled={!canContinue()} className={primaryBtn}>Continuar <ChevronRight className="h-4 w-4" /></button> : <button onClick={submit} disabled={saving || !canContinue()} className={primaryBtn}>{saving ? "Salvando…" : budget ? "Salvar alterações" : "Salvar orçamento"}</button>}</>}>
    <div className="space-y-5">
      {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
      <div className="flex gap-2 overflow-x-auto pb-1">{STEPS.map((label, index) => <span key={label} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${index === step ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : index < step ? "border-[var(--color-success)]/40 text-[var(--color-success)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}>{index + 1}. {label}</span>)}</div>

      {step === 0 && <OriginStep origin={origin} setOrigin={setOrigin} operationId={operationId} setOperationId={setOperationId} operations={operations.data?.items ?? []} />}
      {step === 1 && <div className="grid gap-3 sm:grid-cols-2"><Field label="Cliente"><select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setAddressId(""); setEquipmentIds([]); }} className={inputCls}><option value="">Selecione</option>{customers.data?.items.map((row: Customer) => <option key={row.id} value={row.id}>{row.tradeName || row.name}</option>)}</select></Field><Field label="Endereço"><select value={addressId} onChange={(event) => setAddressId(event.target.value)} className={inputCls}><option value="">Selecione</option>{customer.data?.addresses?.map((address) => <option key={address.id} value={address.id}>{address.street}, {address.number} · {address.city}/{address.state}</option>)}</select></Field><div className="sm:col-span-2"><MultiSelect label="Equipamentos (opcional)" placeholder="Selecione um ou mais equipamentos" emptyMessage={customerId ? "Nenhum equipamento para este cliente." : "Selecione um cliente primeiro."} value={equipmentIds} onChange={setEquipmentIds} options={(equipments.data?.items ?? []).map((equipment: EquipmentSummary) => ({ value: equipment.id, label: equipment.name, description: equipment.tag ?? undefined }))} /></div><Field label="Data"><input type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} className={inputCls} /></Field><Field label="Título"><input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} /></Field><Field label="Descrição"><textarea value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputCls} min-h-20 py-2`} /></Field><div className="sm:col-span-2"><Field label="Texto introdutório"><textarea value={introduction} onChange={(event) => setIntroduction(event.target.value)} className={`${inputCls} min-h-24 py-2`} /></Field></div></div>}
      {step === 2 && <div className="space-y-4"><BudgetItemsEditor type="SERVICE" items={items} onChange={setItems} /><DiscountEditor scope="SERVICE" value={serviceDiscount} onValueChange={setServiceDiscount} description={serviceDiscountDescription} onDescriptionChange={setServiceDiscountDescription} subtotal={serviceSubtotal} /></div>}
      {step === 3 && (
        <div className="space-y-4"><BudgetItemsEditor
            type="MATERIAL"
            items={items}
            onChange={setItems}
            catalog={materialDescriptions.data ?? []}
          /><DiscountEditor scope="MATERIAL" value={materialDiscount} onValueChange={setMaterialDiscount} description={materialDiscountDescription} onDescriptionChange={setMaterialDiscountDescription} subtotal={materialSubtotal} /></div>
      )}
      {step === 4 && <div className="grid gap-4 md:grid-cols-2"><Summary services={services} materials={materials} serviceDiscount={serviceDiscountValue} materialDiscount={materialDiscountValue} total={total} /><Field label="Valor por extenso"><textarea value={amountInWords} onChange={(event) => { setAmountInWords(event.target.value); setAmountEdited(true); }} className={`${inputCls} min-h-28 py-2`} /><span className="text-caption">Gerado automaticamente e editável.</span></Field></div>}
      {step === 5 && <Conditions validityDays={validityDays} setValidityDays={setValidityDays} paymentMethods={paymentMethods} setPaymentMethods={setPaymentMethods} commercialNotes={commercialNotes} setCommercialNotes={setCommercialNotes} observations={observations} setObservations={setObservations} />}
      {step === 6 && <Signatures signatures={signatures.data?.items ?? []} selected={selectedSignature} technicalSignatureId={technicalSignatureId} setTechnicalSignatureId={setTechnicalSignatureId} />}
    </div>
  </Drawer>;
}

function OriginStep({ origin, setOrigin, operationId, setOperationId, operations }: { origin: "MANUAL" | "WORK_ORDER"; setOrigin: (value: "MANUAL" | "WORK_ORDER") => void; operationId: string; setOperationId: (value: string) => void; operations: Array<{ id: string; number: number; customer: { name: string } | null }> }) {
  return <div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => { setOrigin("MANUAL"); setOperationId(""); }} className={choiceCls(origin === "MANUAL")}><strong className="block">Criação manual</strong><span className="text-caption">Preencha livremente todos os dados.</span></button><button type="button" onClick={() => setOrigin("WORK_ORDER")} className={choiceCls(origin === "WORK_ORDER")}><strong className="block">A partir de uma OS concluída</strong><span className="text-caption">Importe o atendimento e edite qualquer campo.</span></button>{origin === "WORK_ORDER" && <div className="sm:col-span-2"><Field label="Ordem de Serviço concluída"><select value={operationId} onChange={(event) => setOperationId(event.target.value)} className={inputCls}><option value="">Selecione</option>{operations.map((operation) => <option key={operation.id} value={operation.id}>OS-{String(operation.number).padStart(6, "0")} · {operation.customer?.name ?? "Cliente"}</option>)}</select></Field></div>}</div>;
}

function BudgetItemsEditor({ type, items, onChange, catalog = [] }: { type: BudgetItemType; items: BudgetItemPayload[]; onChange: (items: BudgetItemPayload[]) => void; catalog?: TechnicalCatalog[] }) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState(type === "SERVICE" ? "SERV" : "UN");
  const [unitPrice, setUnitPrice] = useState("0");
  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === type && item.source !== "CATALOG");
  const catalogRows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === "MATERIAL" && item.source === "CATALOG");
  const label = type === "SERVICE" ? "serviço" : "material";
  const selectedCatalogIds = catalog
    .filter((entry) => catalogRows.some(({ item }) => item.description === entry.title))
    .map((entry) => entry.id);

  function add() {
    if (!description.trim() || Number(quantity) <= 0 || Number(unitPrice) < 0) return;
    onChange([...items, {
      type,
      source: "MANUAL",
      description: description.trim(),
      quantity: Number(quantity),
      unit: unit.trim() || "UN",
      unitPrice: Number(unitPrice),
    }]);
    setDescription("");
    setQuantity("1");
    setUnitPrice("0");
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...items];
    const sameSourceIndexes = next
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item.type === type && item.source !== "CATALOG")
      .map(({ itemIndex }) => itemIndex);
    const position = sameSourceIndexes.indexOf(index);
    const target = sameSourceIndexes[position + direction];
    if (target === undefined) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function selectCatalog(ids: string[]) {
    const selectedTitles = new Set(
      catalog.filter((entry) => ids.includes(entry.id)).map((entry) => entry.title),
    );
    const retained = items.filter(
      (item) =>
        item.source !== "CATALOG" ||
        (item.type === "MATERIAL" && selectedTitles.has(item.description)),
    );
    const existingTitles = new Set(
      retained
        .filter((item) => item.type === "MATERIAL" && item.source === "CATALOG")
        .map((item) => item.description),
    );
    const added = [...selectedTitles]
      .filter((title) => !existingTitles.has(title))
      .map((title) => ({
        type: "MATERIAL" as const,
        source: "CATALOG" as const,
        description: title,
        quantity: 1,
        unit: "UN",
        unitPrice: 0,
      }));
    onChange([...retained, ...added]);
  }

  function update(index: number, patch: Partial<BudgetItemPayload>) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return <div className="space-y-4">
    <div>
      <h3 className="font-semibold">{type === "SERVICE" ? "Serviços" : "Materiais"}</h3>
      <p className="text-caption">Esta etapa é opcional. Os itens informados são preservados como snapshots do orçamento.</p>
    </div>
    {type === "MATERIAL" && <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div>
        <h4 className="text-sm font-semibold">Descrição dos Materiais</h4>
        <p className="text-caption">Itens sugeridos pelo catálogo não possuem preço e aparecem no documento somente com descrição e quantidade.</p>
      </div>
      <MultiSelect label="Selecionar descrições" value={selectedCatalogIds} onChange={selectCatalog} options={catalog.map((entry) => ({ value: entry.id, label: entry.title, description: entry.description ?? undefined }))} placeholder="Selecione uma ou mais descrições" emptyMessage="Nenhuma descrição cadastrada no Catálogo de Serviços." />
      {catalogRows.length > 0 && <ul className="space-y-2">{catalogRows.map(({ item, index }) => <li key={`catalog-${index}`} className="grid gap-2 rounded-[var(--radius-md)] bg-[var(--color-muted)] p-3 sm:grid-cols-[1fr_110px_auto] sm:items-center"><input aria-label="Descrição do material sugerido" value={item.description} onChange={(event) => update(index, { description: event.target.value })} className={inputCls} /><input aria-label="Quantidade do material sugerido" type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) })} className={inputCls} /><IconButton onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} label="Remover descrição" danger><Trash2 className="h-4 w-4" /></IconButton></li>)}</ul>}
      <a href="/maintenance-checklists?type=BUDGET_MATERIAL_DESCRIPTION" target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-[var(--color-primary)]">Gerenciar descrições no Catálogo de Serviços</a>
    </section>}
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div>
        <h4 className="text-sm font-semibold">{type === "SERVICE" ? "Serviços orçados" : "Materiais e fornecimentos"}</h4>
        <p className="text-caption">{type === "SERVICE" ? "Informe os serviços e seus valores." : "Use esta área somente para itens comerciais que possuem valor."}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_90px_110px_160px_auto] md:items-end">
        <label className="block space-y-1"><span className="text-xs font-medium text-[var(--color-muted-foreground)]">Descrição do {label}</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === "SERVICE" ? "Ex.: Limpeza completa do split" : "Ex.: Gás refrigerante R-410A"} className={inputCls} /></label>
        <label className="block space-y-1"><span className="text-xs font-medium text-[var(--color-muted-foreground)]">Quantidade</span><input type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputCls} /></label>
        <label className="block space-y-1"><span className="text-xs font-medium text-[var(--color-muted-foreground)]">Unidade</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="UN" className={inputCls} /></label>
        <label className="block space-y-1"><span className="text-xs font-medium text-[var(--color-muted-foreground)]">Valor unitário (R$)</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="0,00" className={inputCls} /></label>
        <button type="button" onClick={add} className={secondaryBtn}><Plus className="h-4 w-4" /> Adicionar</button>
      </div>
      {rows.length > 0 && <ul className="space-y-2">{rows.map(({ item, index }, position) => <li key={`${type}-${index}`} className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"><div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_90px_100px_140px]"><input aria-label={`Descrição do ${label}`} value={item.description} onChange={(event) => update(index, { description: event.target.value })} className={inputCls} /><input aria-label="Quantidade" type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) })} className={inputCls} /><input aria-label="Unidade" value={item.unit} onChange={(event) => update(index, { unit: event.target.value })} className={inputCls} /><input aria-label="Valor unitário" type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => update(index, { unitPrice: Number(event.target.value) })} className={inputCls} /></div><div className="flex items-center justify-between gap-3"><strong>{formatNumber(item.quantity)} {item.unit} · {money(item.quantity * item.unitPrice)}</strong><div className="flex gap-1"><IconButton onClick={() => move(index, -1)} disabled={position === 0} label="Mover para cima"><ArrowUp className="h-4 w-4" /></IconButton><IconButton onClick={() => move(index, 1)} disabled={position === rows.length - 1} label="Mover para baixo"><ArrowDown className="h-4 w-4" /></IconButton><IconButton onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} label="Remover" danger><Trash2 className="h-4 w-4" /></IconButton></div></div></li>)}</ul>}
    </section>
  </div>;
}

function DiscountEditor({ scope, value, onValueChange, description, onDescriptionChange, subtotal }: { scope: BudgetItemType; value: string; onValueChange: (value: string) => void; description: string; onDescriptionChange: (value: string) => void; subtotal: number }) {
  const amount = moneyInputValue(value);
  const label = scope === "SERVICE" ? "serviços" : "materiais e fornecimentos";
  const invalid = amount > subtotal;
  return <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4"><div><h4 className="text-sm font-semibold">Desconto nos {label}</h4><p className="text-caption">Opcional. O backend valida o valor contra o subtotal de {label}.</p></div><div className="grid gap-3 md:grid-cols-[220px_1fr]"><Field label="Valor do desconto (R$)"><div className="relative"><span className="pointer-events-none absolute left-3 top-2 text-sm text-[var(--color-muted-foreground)]">R$</span><input inputMode="decimal" value={value} onChange={(event) => onValueChange(event.target.value.replace(/[^\d.,]/g, ""))} className={`${inputCls} pl-10`} placeholder="0,00" /></div>{invalid && <span className="text-xs text-[var(--color-danger)]">O desconto não pode superar {money(subtotal)}.</span>}</Field>{amount > 0 && <Field label="Texto exibido no orçamento"><input value={description} maxLength={500} onChange={(event) => onDescriptionChange(event.target.value)} className={inputCls} /><span className="text-caption">O valor será acrescentado automaticamente ao final desta linha.</span></Field>}</div></section>;
}

function Summary({ services, materials, serviceDiscount, materialDiscount, total }: { services: BudgetItemPayload[]; materials: BudgetItemPayload[]; serviceDiscount: number; materialDiscount: number; total: number }) { return <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"><h3 className="font-semibold">Valores</h3><div className="mt-3 space-y-2"><Info label="Serviços" value={money(sum(services))} />{serviceDiscount > 0 && <Info label="Desconto nos serviços" value={`− ${money(serviceDiscount)}`} />}<Info label="Materiais" value={money(sum(materials))} />{materialDiscount > 0 && <Info label="Desconto nos materiais" value={`− ${money(materialDiscount)}`} />}<Info label="Valor total" value={money(total)} strong /></div></div>; }
function Conditions({ validityDays, setValidityDays, paymentMethods, setPaymentMethods, commercialNotes, setCommercialNotes, observations, setObservations }: { validityDays: string; setValidityDays: (value: string) => void; paymentMethods: BudgetPaymentMethod[]; setPaymentMethods: (value: BudgetPaymentMethod[]) => void; commercialNotes: string; setCommercialNotes: (value: string) => void; observations: string; setObservations: (value: string) => void }) { const options: Array<[BudgetPaymentMethod, string]> = [["CASH", "Espécie"], ["PIX", "PIX"], ["CREDIT_CARD", "Cartão de crédito"]]; return <div className="space-y-4"><Field label="Validade da proposta (dias)"><input type="number" min="1" max="3650" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} className={inputCls} /></Field><div><p className="mb-2 text-sm font-medium">Formas de pagamento</p><div className="flex flex-wrap gap-2">{options.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"><input type="checkbox" checked={paymentMethods.includes(value)} onChange={() => setPaymentMethods(paymentMethods.includes(value) ? paymentMethods.filter((item) => item !== value) : [...paymentMethods, value])} />{label}</label>)}</div></div><Field label="Observações comerciais"><textarea value={commercialNotes} onChange={(event) => setCommercialNotes(event.target.value)} className={`${inputCls} min-h-24 py-2`} /></Field><Field label="Observações gerais"><textarea value={observations} onChange={(event) => setObservations(event.target.value)} className={`${inputCls} min-h-20 py-2`} /></Field></div>; }
function Signatures({ signatures, selected, technicalSignatureId, setTechnicalSignatureId }: { signatures: Signature[]; selected: Signature | null; technicalSignatureId: string; setTechnicalSignatureId: (value: string) => void }) { return <div className="max-w-xl space-y-3"><div><h3 className="font-semibold">Responsável técnico</h3><p className="text-caption">O orçamento é uma proposta e não coleta assinatura do cliente — apenas o responsável técnico.</p></div><Field label="Assinatura técnica"><select value={technicalSignatureId} onChange={(event) => setTechnicalSignatureId(event.target.value)} className={inputCls}><option value="">Selecione</option>{signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name} · {signature.title}{signature.isDefault ? " · padrão" : ""}</option>)}</select></Field>{selected && <TechnicalSignaturePreview signature={selected} />}</div>; }

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>; }
function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) { return <div className="flex justify-between gap-3 text-sm"><span className="text-[var(--color-muted-foreground)]">{label}</span><span className={strong ? "font-semibold" : "font-medium"}>{value}</span></div>; }
function IconButton({ onClick, disabled, label, danger, children }: { onClick: () => void; disabled?: boolean; label: string; danger?: boolean; children: ReactNode }) { return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border disabled:opacity-30 ${danger ? "border-[var(--color-danger)]/30 text-[var(--color-danger)]" : "border-[var(--color-border)]"}`}>{children}</button>; }
function choiceCls(active: boolean) { return `rounded-[var(--radius-lg)] border p-5 text-left ${active ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)]"}`; }
function sum(items: BudgetItemPayload[]) { return items.reduce((total, item) => total + item.quantity * item.unitPrice, 0); }
function moneyInputValue(value: string) { const raw = value.trim(); const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw; const parsed = Number(normalized); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function money(value: number) { return formatCurrencyBRL(value); }
function today() { return new Date().toISOString().slice(0, 10); }

const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";
const primaryBtn = "inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50";
const secondaryBtn = "inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50";
