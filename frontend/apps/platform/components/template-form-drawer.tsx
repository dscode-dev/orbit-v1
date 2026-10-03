"use client";

/**
 * TemplateFormDrawer — criar/editar modelo de documento (OWNER).
 * Conteúdo de cabeçalho/rodapé/observações é texto livre; renderização final é
 * do backend. Inclui padrão e ativo.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { organizationApi, signaturesApi, ApiClientError, type DocumentTemplate, type DocumentTemplateType, type Signature, type SignatureMode } from "@erp/api";

type FormState = {
  name: string;
  headerContent: string;
  footerContent: string;
  observations: string;
  isDefault: boolean;
  isActive: boolean;
  requiresSignature: boolean;
  signatureMode: SignatureMode;
  signatureId: string;
  institutionalSignatureIds: string[];
  executionSignatureClient: boolean;
  executionSignatureTechnician: boolean;
  executionSignatureOperator: boolean;
};

export function TemplateFormDrawer({
  open,
  onClose,
  onSaved,
  type,
  typeLabel,
  template = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  type: DocumentTemplateType;
  typeLabel: string;
  template?: DocumentTemplate | null;
}) {
  const isEdit = Boolean(template);
  const orgName = useAuth().session?.organization.tradeName;
  const [form, setForm] = useState<FormState>(blank());
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setForm(
      template
        ? {
            name: template.name,
            headerContent: template.headerContent,
            footerContent: template.footerContent,
            observations: template.observations,
            isDefault: template.isDefault,
            isActive: template.isActive,
            requiresSignature: template.requiresSignature,
            signatureMode: template.signatureMode,
            signatureId: template.signatureId ?? "",
            institutionalSignatureIds: template.institutionalSignatures?.map((item) => item.signatureId) ?? (template.signatureId ? [template.signatureId] : []),
            executionSignatureClient: template.executionSignatureClient ?? false,
            executionSignatureTechnician: template.executionSignatureTechnician ?? false,
            executionSignatureOperator: template.executionSignatureOperator ?? false,
          }
        : { ...blank(), name: orgName ? `${typeLabel} — ${orgName}` : typeLabel },
    );
    signaturesApi
      .listSignatures({ active: true, limit: 100 })
      .then((result) => setSignatures(result.items))
      .catch(() => setSignatures([]));
  }, [open, template, typeLabel, orgName]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.name.trim()) { setError("Informe o nome do modelo."); return; }
    setSaving(true);
    setError(null);
    try {
      if (isEdit && template) {
        await organizationApi.updateTemplate(template.id, payload(form));
      } else {
        await organizationApi.createTemplate({ type, ...payload(form) });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível salvar.");
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Modelo"
      title={isEdit ? "Editar modelo" : `Novo modelo · ${typeLabel}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]">Cancelar</button>
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Salvar" : "Criar modelo"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
        <Field label="Nome do modelo">
          <input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Cabeçalho">
          <textarea value={form.headerContent} onChange={(e) => set("headerContent", e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} placeholder="Texto/observações de cabeçalho…" />
        </Field>
        <Field label="Rodapé">
          <textarea value={form.footerContent} onChange={(e) => set("footerContent", e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} placeholder="Texto de rodapé…" />
        </Field>
        <Field label="Observações">
          <textarea value={form.observations} onChange={(e) => set("observations", e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} />
        </Field>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium">Definir como padrão</span>
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="accent-[var(--color-primary)] h-4 w-4" />
        </label>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium">Ativo</span>
          <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} className="accent-[var(--color-primary)] h-4 w-4" />
        </label>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span>
              <span className="block text-sm font-medium">Assinatura obrigatória</span>
              <span className="block text-caption">Persistido no backend; o Builder usará em sprint posterior.</span>
            </span>
            <input
              type="checkbox"
              checked={form.requiresSignature}
              onChange={(e) => set("requiresSignature", e.target.checked)}
              className="accent-[var(--color-primary)] h-4 w-4"
            />
          </label>
          <Field label="Modo de assinatura">
            <select
              value={form.signatureMode}
              onChange={(e) => {
                const mode = e.target.value as SignatureMode;
                setForm((current) => ({
                  ...current,
                  signatureMode: mode,
                  requiresSignature: mode !== "NONE",
                  signatureId: mode === "NONE" || mode === "COLLECTED" ? "" : current.signatureId,
                }));
              }}
              className={inputCls}
            >
              <option value="NONE">Sem assinatura</option>
              <option value="FIXED">Assinatura fixa</option>
              <option value="COLLECTED">Assinatura coletada</option>
              <option value="HYBRID">Híbrida</option>
            </select>
          </Field>
          {(form.signatureMode === "FIXED" || form.signatureMode === "HYBRID") && (
            <Field label="Assinaturas institucionais">
              <div className="space-y-2">
                {form.institutionalSignatureIds.map((id, index) => (
                  <div key={`${id}-${index}`} className="flex gap-2">
                    <select value={id} onChange={(e) => set("institutionalSignatureIds", form.institutionalSignatureIds.map((value, i) => i === index ? e.target.value : value))} className={inputCls}>
                      <option value="">Selecione…</option>
                      {signatures.filter((signature) => !form.institutionalSignatureIds.includes(signature.id) || signature.id === id).map((signature) => (
                        <option key={signature.id} value={signature.id}>{signature.name} · {signature.title}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => set("institutionalSignatureIds", form.institutionalSignatureIds.filter((_, i) => i !== index))} className="px-3 rounded border border-[var(--color-border)]">Remover</button>
                  </div>
                ))}
                <button type="button" onClick={() => set("institutionalSignatureIds", [...form.institutionalSignatureIds, ""])} className="text-sm text-[var(--color-primary)]">+ Adicionar assinatura institucional</button>
              </div>
            </Field>
          )}
          <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
            <div className="text-sm font-medium">Assinaturas de execução</div>
            {([['executionSignatureClient', 'Cliente'], ['executionSignatureTechnician', 'Técnico'], ['executionSignatureOperator', 'Operador']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} /> {label}</label>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

const inputCls = "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]";

function blank(): FormState {
  return {
    name: "",
    headerContent: "",
    footerContent: "",
    observations: "",
    isDefault: false,
    isActive: true,
    requiresSignature: false,
    signatureMode: "NONE",
    signatureId: "",
    institutionalSignatureIds: [],
    executionSignatureClient: false,
    executionSignatureTechnician: false,
    executionSignatureOperator: false,
  };
}

function payload(form: FormState) {
  const fixed = form.signatureMode === "FIXED" || form.signatureMode === "HYBRID";
  return {
    name: form.name,
    headerContent: form.headerContent,
    footerContent: form.footerContent,
    observations: form.observations,
    isDefault: form.isDefault,
    isActive: form.isActive,
    requiresSignature: form.signatureMode === "NONE" ? false : form.requiresSignature,
    signatureMode: form.signatureMode,
    signatureId: fixed ? (form.institutionalSignatureIds.find(Boolean) ?? form.signatureId ?? null) : null,
    institutionalSignatureIds: fixed ? form.institutionalSignatureIds.filter(Boolean) : [],
    executionSignatureClient: form.executionSignatureClient,
    executionSignatureTechnician: form.executionSignatureTechnician,
    executionSignatureOperator: form.executionSignatureOperator,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
