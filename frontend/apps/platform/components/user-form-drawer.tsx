"use client";

/**
 * UserFormDrawer — create / edit a team member (OWNER only).
 *
 * On create, the backend returns a one-time `temporaryPassword` which is shown
 * once in a copyable confirmation and never logged/persisted.
 */
import { useEffect, useState } from "react";
import { Loader2, Copy, Check, KeyRound, Building2, Users } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import {
  usersApi,
  customersApi,
  customerPortalApi,
  useQuery,
  ApiClientError,
  type Customer,
  type Role,
  type TeamUser,
  type UserPermissions,
} from "@erp/api";
import { ROLE_LABEL, ROLES, PERMISSION_KEYS, PERMISSION_LABEL } from "@platform/user-display";

type FormState = {
  name: string;
  email: string;
  username: string;
  role: Role;
  phone: string;
  jobTitle: string;
  notes: string;
  permissions: UserPermissions;
};

type AccessType = "INTERNAL" | "CUSTOMER";

type CreatedCredential = {
  email: string;
  password: string;
  accessType: AccessType;
};

const EMPTY_PERMS: UserPermissions = {
  canFinancial: false,
  canUsers: false,
  canReports: false,
  canSchedules: false,
  canTemplates: false,
};

function fromUser(u: TeamUser | null): FormState {
  return {
    name: u?.name ?? "",
    email: u?.email ?? "",
    username: u?.username ?? "",
    role: u?.role ?? "OPERATOR",
    phone: u?.phone ?? "",
    jobTitle: u?.jobTitle ?? "",
    notes: u?.notes ?? "",
    permissions: u?.permission ?? EMPTY_PERMS,
  };
}

export function UserFormDrawer({
  open,
  onClose,
  onSaved,
  user = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  user?: TeamUser | null;
}) {
  const isEdit = Boolean(user);
  const [form, setForm] = useState<FormState>(fromUser(user));
  const [accessType, setAccessType] = useState<AccessType>("INTERNAL");
  const [customerId, setCustomerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [credential, setCredential] = useState<CreatedCredential | null>(null);
  const [copied, setCopied] = useState(false);

  const customers = useQuery(
    (signal) => customersApi.listCustomers({ page: 1, limit: 100, signal }),
    [],
  );

  useEffect(() => {
    if (open) {
      setForm(fromUser(user));
      setAccessType("INTERNAL");
      setCustomerId("");
      setError(null);
      setFieldError(null);
      setSaving(false);
      setCredential(null);
      setCopied(false);
    }
  }, [open, user]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // OWNER role has all permission flags effectively true.
  const ownerLocked = form.role === "OWNER";

  function selectCustomer(id: string) {
    setCustomerId(id);
    const customer = customers.data?.items.find((item) => item.id === id);
    if (!customer) return;
    setForm((current) => ({
      ...current,
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
    }));
  }

  async function handleSave() {
    if (!isEdit && accessType === "CUSTOMER") {
      if (!customerId) {
        setError("Selecione o cliente que terá acesso ao portal.");
        return;
      }
      if (!form.name.trim() || !form.email.trim()) {
        setError("Nome e e-mail do usuário do cliente são obrigatórios.");
        return;
      }
      setSaving(true);
      setError(null);
      setFieldError(null);
      try {
        const result = await customerPortalApi.provisionAccount({
          customerId,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
        });
        setCredential({
          email: result.account.email,
          password: result.temporaryPassword,
          accessType: "CUSTOMER",
        });
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 409) {
          setFieldError("Este e-mail já está vinculado a outro cliente.");
        } else if (err instanceof ApiClientError && err.isForbidden) {
          setError("Você não tem permissão para criar acessos de clientes.");
        } else {
          setError(err instanceof ApiClientError ? err.message : "Não foi possível criar o acesso do cliente.");
        }
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!form.name.trim() || !form.email.trim() || !form.username.trim()) {
      setError("Nome, e-mail e usuário são obrigatórios.");
      return;
    }
    setSaving(true);
    setError(null);
    setFieldError(null);
    try {
      if (isEdit && user) {
        await usersApi.updateUser(user.id, {
          name: form.name.trim(),
          email: form.email.trim(),
          username: form.username.trim(),
          role: form.role,
          phone: form.phone.trim() || undefined,
          jobTitle: form.jobTitle.trim() || undefined,
          notes: form.notes.trim() || undefined,
          permissions: form.permissions,
        });
        onSaved();
        onClose();
      } else {
        const result = await usersApi.createUser({
          name: form.name.trim(),
          email: form.email.trim(),
          username: form.username.trim(),
          role: form.role,
          phone: form.phone.trim() || undefined,
          jobTitle: form.jobTitle.trim() || undefined,
          notes: form.notes.trim() || undefined,
          permissions: form.permissions,
        });
        onSaved();
        setCredential({
          email: result.user.email,
          password: result.temporaryPassword,
          accessType: "INTERNAL",
        }); // shown once
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "USER_CONFLICT") {
        setFieldError("E-mail ou usuário já cadastrado.");
      } else if (err instanceof ApiClientError && err.code === "USER_LAST_OWNER") {
        setError("É necessário manter ao menos um proprietário ativo.");
      } else if (err instanceof ApiClientError && err.isForbidden) {
        setError("Você não tem permissão para esta ação.");
      } else {
        setError(err instanceof ApiClientError ? err.message : "Não foi possível salvar.");
      }
    } finally {
      setSaving(false);
    }
  }

  function copyPassword() {
    if (!credential) return;
    navigator.clipboard.writeText(credential.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Success view: show the one-time temporary password.
  if (credential) {
    const isCustomerAccess = credential.accessType === "CUSTOMER";
    return (
      <Drawer
        open={open}
        onClose={onClose}
        eyebrow="Usuários"
        title={isCustomerAccess ? "Acesso do cliente criado" : "Usuário criado"}
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]">
            {isCustomerAccess ? "Acesso ao Portal do Cliente criado" : "Usuário criado com sucesso"}. Copie a senha temporária — ela não será exibida novamente.
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <p className="mb-3 break-all text-sm"><strong>Login:</strong> {credential.email}</p>
            <div className="flex items-center gap-2 text-caption uppercase tracking-wider mb-2">
              <KeyRound className="h-3.5 w-3.5" /> Senha temporária
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm break-all rounded bg-[var(--color-muted)] px-3 py-2">{credential.password}</code>
              <button type="button" onClick={copyPassword} className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]">
                {copied ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted-foreground)]">
              {isCustomerAccess
                ? "O acesso funciona somente em /customer/login e exige a troca da senha no primeiro uso."
                : "O usuário deverá trocar a senha no primeiro acesso (troca obrigatória)."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] h-10 text-sm font-medium">
            Concluir
          </button>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Usuários"
      title={isEdit ? "Editar usuário" : "Novo usuário"}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]">Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : accessType === "CUSTOMER" ? "Criar acesso" : "Criar usuário"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>
        )}

        {!isEdit && (
          <Field label="Tipo de acesso" required>
            <div className="grid gap-2 sm:grid-cols-2">
              <AccessTypeButton
                active={accessType === "INTERNAL"}
                icon={Users}
                title="Equipe interna"
                description="Owner, gestor, gerente ou operador"
                onClick={() => setAccessType("INTERNAL")}
              />
              <AccessTypeButton
                active={accessType === "CUSTOMER"}
                icon={Building2}
                title="Portal do cliente"
                description="Acesso isolado aos dados do cliente"
                onClick={() => setAccessType("CUSTOMER")}
              />
            </div>
          </Field>
        )}

        {!isEdit && accessType === "CUSTOMER" && (
          <>
            <div className="rounded-[var(--radius-md)] border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5 px-3 py-2 text-sm">
              Este acesso será válido somente no Portal do Cliente e não poderá entrar na Platform ou no Operator.
            </div>
            <Field label="Cliente vinculado" required>
              <select
                value={customerId}
                onChange={(event) => selectCustomer(event.target.value)}
                className={inputCls}
                disabled={customers.loading}
              >
                <option value="">{customers.loading ? "Carregando clientes…" : "Selecione um cliente cadastrado"}</option>
                {(customers.data?.items ?? []).filter((item) => item.isActive).map((customer) => (
                  <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>
                ))}
              </select>
            </Field>
            {customers.error && (
              <p className="text-sm text-[var(--color-danger)]">Não foi possível carregar os clientes. Feche e tente novamente.</p>
            )}
          </>
        )}

        <Field label={accessType === "CUSTOMER" && !isEdit ? "Nome do usuário do cliente" : "Nome completo"} required>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
            placeholder={accessType === "CUSTOMER" && !isEdit ? "Nome da pessoa que utilizará o portal" : "Nome do colaborador"}
          />
        </Field>
        <div className={isEdit || accessType === "INTERNAL" ? "grid grid-cols-2 gap-3" : "grid gap-3"}>
          <Field label="E-mail" required error={fieldError ?? undefined}>
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="email@empresa.com.br" />
          </Field>
          {(isEdit || accessType === "INTERNAL") && (
            <Field label="Usuário" required>
              <input value={form.username} onChange={(e) => set("username", e.target.value)} className={inputCls} placeholder="usuario" />
            </Field>
          )}
        </div>
        <div className={isEdit || accessType === "INTERNAL" ? "grid grid-cols-2 gap-3" : "grid gap-3"}>
          <Field label="Telefone">
            <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="(00) 00000-0000" />
          </Field>
          {(isEdit || accessType === "INTERNAL") && (
            <Field label="Cargo">
              <input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} className={inputCls} placeholder="Ex.: Técnico" />
            </Field>
          )}
        </div>

        {(isEdit || accessType === "INTERNAL") && <Field label="Papel">
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => set("role", r)}
                className={`rounded-[var(--radius-md)] border px-3 h-9 text-sm transition ${
                  form.role === r ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]" : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        </Field>}

        {(isEdit || accessType === "INTERNAL") && <Field label="Permissões">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {PERMISSION_KEYS.map((k) => {
              const checked = ownerLocked || form.permissions[k];
              return (
                <label key={k} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm cursor-pointer">
                  <span>{PERMISSION_LABEL[k]}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={ownerLocked}
                    onChange={(e) => set("permissions", { ...form.permissions, [k]: e.target.checked })}
                    className="accent-[var(--color-primary)] disabled:opacity-50"
                  />
                </label>
              );
            })}
          </div>
          {ownerLocked && <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">Proprietários têm todas as permissões.</p>}
        </Field>}

        {(isEdit || accessType === "INTERNAL") && <Field label="Observações">
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={`${inputCls} h-auto py-2 resize-none`} />
        </Field>}
      </div>
    </Drawer>
  );
}

function customerLabel(customer: Customer): string {
  const document = customer.cnpj ?? customer.cpf;
  return document ? `${customer.name} · ${document}` : customer.name;
}

function AccessTypeButton({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: typeof Users;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-16 items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition ${
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <strong className="block text-sm">{title}</strong>
        <span className="mt-0.5 block text-[11px] text-[var(--color-muted-foreground)]">{description}</span>
      </span>
    </button>
  );
}

const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label} {required && <span className="text-[var(--color-danger)]">*</span>}</span>
      {children}
      {error && <span className="block text-[11px] text-[var(--color-danger)]">{error}</span>}
    </label>
  );
}
