"use client";

/**
 * CustomerFormDrawer — create / edit a customer against the production API.
 * PERSON shows CPF; COMPANY shows tradeName + CNPJ. Documents stay optional.
 */
import { useEffect, useState } from "react";
import { Building2, Loader2, MapPin, Plus, User } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { customersApi, cepApi, ApiClientError } from "@erp/api";
import type { Customer, CustomerAddress, CustomerType, CreateCustomerPayload } from "@erp/api";
import { maskCpf, maskCnpj, maskCep } from "@erp/utils";
import { AddressFormDrawer } from "./address-form-drawer";

type FormState = {
  type: CustomerType;
  name: string;
  tradeName: string;
  cpf: string;
  cnpj: string;
  email: string;
  phone: string;
  secondaryPhone: string;
  notes: string;
};

type AddressState = {
  enabled: boolean;
  name: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  referencePoint: string;
  district: string;
  city: string;
  state: string;
  isPrimary: boolean;
};

const blankAddress: AddressState = {
  enabled: false,
  name: "Principal",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  referencePoint: "",
  district: "",
  city: "",
  state: "",
  isPrimary: true,
};

function fromCustomer(c: Customer | null): FormState {
  return {
    type: c?.type ?? "COMPANY",
    name: c?.name ?? "",
    tradeName: c?.tradeName ?? "",
    cpf: c?.cpf ?? "",
    cnpj: c?.cnpj ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    secondaryPhone: c?.secondaryPhone ?? "",
    notes: c?.notes ?? "",
  };
}

export function CustomerFormDrawer({
  open,
  onClose,
  onSaved,
  customer = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  customer?: Customer | null;
}) {
  const isEdit = Boolean(customer);
  const [form, setForm] = useState<FormState>(fromCustomer(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressState>(blankAddress);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  // Endereços cadastrados (modo edição): permite escolher um para editar/adicionar.
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addrDrawer, setAddrDrawer] = useState<{ address: CustomerAddress | null } | null>(null);

  const refreshAddresses = () => {
    if (!customer) return;
    customersApi.getCustomer(customer.id).then((c) => setAddresses(c.addresses ?? [])).catch(() => undefined);
  };

  useEffect(() => {
    if (open) {
      setForm(fromCustomer(customer));
      setError(null);
      setFieldError(null);
      setSaving(false);
      setAddress(blankAddress);
      setCreatedCustomerId(null);
      setCepLoading(false);
      setAddrDrawer(null);
      setAddresses([]);
      if (customer) customersApi.getCustomer(customer.id).then((c) => setAddresses(c.addresses ?? [])).catch(() => undefined);
    }
  }, [open, customer]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setAddressField<K extends keyof AddressState>(key: K, value: AddressState[K]) {
    setAddress((current) => ({ ...current, [key]: value }));
  }

  async function lookupCep() {
    setCepLoading(true);
    setError(null);
    try {
      const result = await cepApi.lookupCep(address.zipCode);
      setAddress((current) => ({
        ...current,
        enabled: true,
        zipCode: result.zipCode,
        street: result.street || current.street,
        district: result.district || current.district,
        city: result.city || current.city,
        state: result.state || current.state,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível consultar o CEP.");
    } finally {
      setCepLoading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    setSaving(true);
    setError(null);
    setFieldError(null);

    const payload: CreateCustomerPayload = {
      type: form.type,
      name: form.name.trim(),
      tradeName: form.type === "COMPANY" ? form.tradeName.trim() || null : null,
      cpf: form.type === "PERSON" ? form.cpf.trim() || null : null,
      cnpj: form.type === "COMPANY" ? form.cnpj.trim() || null : null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      secondaryPhone: form.secondaryPhone.trim() || null,
      notes: form.notes.trim() || null,
    };

    try {
      if (isEdit && customer) {
        await customersApi.updateCustomer(customer.id, payload);
      } else {
        const savedCustomer = createdCustomerId ? null : await customersApi.createCustomer(payload);
        const customerId = createdCustomerId ?? savedCustomer?.id;
        if (address.enabled && customerId) {
          const validation = validateAddress(address);
          if (validation) {
            setError(validation);
            setCreatedCustomerId(customerId);
            setSaving(false);
            return;
          }
          try {
            await customersApi.createAddress(customerId, {
              name: address.name.trim() || "Principal",
              zipCode: address.zipCode.trim() || undefined,
              street: address.street.trim(),
              number: address.number.trim(),
              complement: address.complement.trim() || null,
              referencePoint: address.referencePoint.trim() || null,
              district: address.district.trim(),
              city: address.city.trim(),
              state: address.state.trim().toUpperCase(),
              isPrimary: address.isPrimary,
            });
          } catch (addressErr) {
            setCreatedCustomerId(customerId);
            setError(addressErr instanceof ApiClientError ? `Cliente criado, mas o endereço não foi salvo: ${addressErr.message}. Corrija os dados e clique em salvar novamente.` : "Cliente criado, mas o endereço não foi salvo. Corrija os dados e clique em salvar novamente.");
            setSaving(false);
            return;
          }
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "CUSTOMER_CONFLICT") {
        setFieldError(form.type === "PERSON" ? "CPF já cadastrado." : "CNPJ já cadastrado.");
      } else if (err instanceof ApiClientError && err.isForbidden) {
        setError("Você não tem permissão para esta ação.");
      } else {
        setError(err instanceof ApiClientError ? err.message : "Não foi possível salvar.");
      }
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Cadastros"
      title={isEdit ? "Editar cliente" : "Novo cliente"}
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
            {createdCustomerId ? "Salvar endereço" : isEdit ? "Salvar alterações" : "Criar cliente"}
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

        {/* Tipo */}
        <div className="grid grid-cols-2 gap-2">
          {(["COMPANY", "PERSON"] as const).map((t) => {
            const Icon = t === "COMPANY" ? Building2 : User;
            return (
              <button
                key={t}
                onClick={() => set("type", t)}
                className={`flex items-center gap-2 rounded-[var(--radius-md)] border px-3 h-10 text-sm transition ${
                  form.type === t
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                }`}
              >
                <Icon className="h-4 w-4" /> {t === "COMPANY" ? "Empresa" : "Pessoa"}
              </button>
            );
          })}
        </div>

        <Field label={form.type === "COMPANY" ? "Razão social" : "Nome completo"} required>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder={form.type === "COMPANY" ? "Empresa LTDA" : "Nome do cliente"} />
        </Field>

        {form.type === "COMPANY" && (
          <Field label="Nome fantasia">
            <input value={form.tradeName} onChange={(e) => set("tradeName", e.target.value)} className={inputCls} />
          </Field>
        )}

        {form.type === "PERSON" ? (
          <Field label="CPF" error={fieldError ?? undefined}>
            <input value={form.cpf} onChange={(e) => set("cpf", maskCpf(e.target.value))} className={inputCls} placeholder="000.000.000-00" inputMode="numeric" />
          </Field>
        ) : (
          <Field label="CNPJ" error={fieldError ?? undefined}>
            <input value={form.cnpj} onChange={(e) => set("cnpj", maskCnpj(e.target.value))} className={inputCls} placeholder="00.000.000/0000-00" inputMode="numeric" />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone">
            <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="(00) 00000-0000" />
          </Field>
          <Field label="Telefone secundário">
            <input value={form.secondaryPhone} onChange={(e) => set("secondaryPhone", e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="E-mail">
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="contato@empresa.com.br" />
        </Field>

        <Field label="Observações">
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} />
        </Field>

        {isEdit && customer && (
          <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Endereços cadastrados ({addresses.length})</h3>
              <button type="button" onClick={() => setAddrDrawer({ address: null })} className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 h-8 text-xs font-medium hover:bg-[var(--color-muted)]">
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </button>
            </div>
            {addresses.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">Nenhum endereço cadastrado. Use “Adicionar” para incluir (matriz, filial, obra…).</p>
            ) : (
              <ul className="space-y-2">
                {addresses.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setAddrDrawer({ address: a })} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5 text-left transition hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-muted)]/40">
                      <MapPin className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{a.name || "Endereço"}{a.isPrimary ? " · principal" : ""}</span>
                        <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">{[[a.street, a.number].filter(Boolean).join(", "), a.city ? `${a.city}/${a.state}` : null, a.zipCode ? maskCep(a.zipCode) : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="text-[11px] text-[var(--color-primary)]">editar</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!isEdit && (
          <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Endereço inicial</h3>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  O cliente é criado primeiro e o endereço é salvo pelo endpoint oficial de endereços. Se o endereço falhar, o cliente não será duplicado no retry.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={address.enabled} onChange={(event) => setAddressField("enabled", event.target.checked)} className="accent-[var(--color-primary)]" />
                Incluir
              </label>
            </div>

            {address.enabled && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Field label="CEP">
                    <input value={address.zipCode} onChange={(e) => setAddressField("zipCode", e.target.value)} className={inputCls} placeholder="00000-000" inputMode="numeric" />
                  </Field>
                  <button
                    type="button"
                    onClick={lookupCep}
                    disabled={cepLoading || address.zipCode.replace(/\D/g, "").length !== 8}
                    className="mt-6 inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
                  >
                    {cepLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Buscar CEP
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome do endereço">
                    <input value={address.name} onChange={(e) => setAddressField("name", e.target.value)} className={inputCls} placeholder="Principal, Filial, Obra…" />
                  </Field>
                  <Field label="Número">
                    <input value={address.number} onChange={(e) => setAddressField("number", e.target.value)} className={inputCls} />
                  </Field>
                </div>

                <Field label="Logradouro">
                  <input value={address.street} onChange={(e) => setAddressField("street", e.target.value)} className={inputCls} />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Bairro">
                    <input value={address.district} onChange={(e) => setAddressField("district", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Complemento">
                    <input value={address.complement} onChange={(e) => setAddressField("complement", e.target.value)} className={inputCls} />
                  </Field>
                </div>

                <Field label="Ponto de referência">
                  <input
                    value={address.referencePoint}
                    onChange={(e) => setAddressField("referencePoint", e.target.value)}
                    className={inputCls}
                    placeholder="Ex.: entrada pela rua lateral"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cidade">
                    <input value={address.city} onChange={(e) => setAddressField("city", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="UF">
                    <input value={address.state} onChange={(e) => setAddressField("state", e.target.value.toUpperCase())} className={inputCls} maxLength={2} />
                  </Field>
                </div>

                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={address.isPrimary} onChange={(event) => setAddressField("isPrimary", event.target.checked)} className="accent-[var(--color-primary)]" />
                  Definir como endereço principal
                </label>
              </div>
            )}
          </section>
        )}
      </div>

      {customer && (
        <AddressFormDrawer
          open={addrDrawer !== null}
          customerId={customer.id}
          address={addrDrawer?.address ?? null}
          onClose={() => setAddrDrawer(null)}
          onSaved={() => { refreshAddresses(); onSaved(); }}
        />
      )}
    </Drawer>
  );
}

function validateAddress(address: AddressState): string | null {
  const missing = [
    ["logradouro", address.street],
    ["número", address.number],
    ["bairro", address.district],
    ["cidade", address.city],
    ["UF", address.state],
  ].filter(([, value]) => !String(value).trim()).map(([label]) => label);

  if (missing.length > 0) return `Complete o endereço: ${missing.join(", ")}.`;
  // CEP é opcional; valida o formato apenas quando informado.
  if (address.zipCode.trim() && !/^\d{5}-?\d{3}$/.test(address.zipCode.trim())) return "Informe um CEP válido.";
  if (!/^[A-Z]{2}$/.test(address.state.trim().toUpperCase())) return "Informe a UF com 2 letras.";
  return null;
}

const inputCls =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </span>
      {children}
      {error && <span className="block text-[11px] text-[var(--color-danger)]">{error}</span>}
    </label>
  );
}
