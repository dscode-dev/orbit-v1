'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Loader2,
  Check,
  Upload,
  FileText,
  Image as ImageIcon,
  Palette,
  Building2,
  SlidersHorizontal,
  PenLine,
  Trash2,
  Download,
  Plus,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@platform/components/page-header';
import { Drawer } from '@erp/ui/drawer';
import { SectionCard } from '@erp/ui/section-card';
import { StatusChip } from '@erp/ui/status-chip';
import { SkeletonCard } from '@erp/ui/skeletons';
import { AsyncBoundary } from '@erp/ui/states';
import { useAuth, applyBranding } from '@erp/ui/auth/auth-provider';
import {
  organizationApi,
  signaturesApi,
  usersApi,
  useQuery,
  ApiClientError,
  type BrandAssetType,
  type Organization,
  type OrganizationContact,
  type OrganizationSettings,
  type Signature,
} from '@erp/api';

export default function SettingsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('OWNER');

  const org = useQuery<Organization>((signal) => organizationApi.getOrganization({ signal }), []);
  const settings = useQuery<OrganizationSettings>(
    (signal) => organizationApi.getOrganizationSettings({ signal }),
    [],
  );
  const signatures = useQuery((signal) => signaturesApi.listSignatures({ limit: 100, signal }), []);

  return (
    <div className="space-y-6 max-w-[1100px]">
      <PageHeader
        eyebrow="Sistema"
        title="Configurações"
        description="Identidade visual, dados da organização e parâmetros gerais. Modelos documentais ficam em Cadastros."
        actions={!canEdit ? <StatusChip tone="info">Somente leitura</StatusChip> : undefined}
      />

      <BrandingSection canEdit={canEdit} />

      <AsyncBoundary
        loading={org.loading}
        error={org.error}
        data={org.data}
        onRetry={org.refetch}
        skeleton={<SkeletonCard />}
      >
        {(data) => <OrganizationSection org={data} canEdit={canEdit} onSaved={org.refetch} />}
      </AsyncBoundary>

      <AsyncBoundary
        loading={settings.loading}
        error={settings.error}
        data={settings.data}
        onRetry={settings.refetch}
        skeleton={<SkeletonCard />}
      >
        {(data) => <SettingsSection settings={data} canEdit={canEdit} onSaved={settings.refetch} />}
      </AsyncBoundary>

      <AsyncBoundary
        loading={signatures.loading}
        error={signatures.error}
        data={signatures.data}
        onRetry={signatures.refetch}
        skeleton={<SkeletonCard />}
      >
        {(data) => (
          <SignaturesSection
            signatures={data.items}
            canEdit={canEdit}
            onChanged={signatures.refetch}
          />
        )}
      </AsyncBoundary>
    </div>
  );
}

/* ---------- Branding ---------- */

const ASSET_TYPES: { type: BrandAssetType; label: string; icon: typeof ImageIcon }[] = [
  { type: 'LOGO', label: 'Logotipo', icon: ImageIcon },
  { type: 'HEADER', label: 'Cabeçalho', icon: FileText },
  { type: 'FOOTER', label: 'Rodapé', icon: FileText },
];

const primaryBtn =
  'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50';
const secondaryBtn =
  'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)]';

function BrandingSection({ canEdit }: { canEdit: boolean }) {
  return (
    <SectionCard
      title="Identidade visual"
      icon={Palette}
      description="Logotipo, cabeçalho e rodapé dos documentos."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {ASSET_TYPES.map((a) => (
          <AssetUploader
            key={a.type}
            type={a.type}
            label={a.label}
            icon={a.icon}
            canEdit={canEdit}
          />
        ))}
      </div>
    </SectionCard>
  );
}

function AssetUploader({
  type,
  label,
  icon: Icon,
  canEdit,
}: {
  type: BrandAssetType;
  label: string;
  icon: typeof ImageIcon;
  canEdit: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Máximo de 5 MiB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const asset = await organizationApi.uploadAsset(type, file);
      const content = await organizationApi.getAsset(asset.id);
      setPreview(
        content.mimeType.startsWith('image/')
          ? `data:${content.mimeType};base64,${content.contentBase64}`
          : null,
      );
      setFileName(asset.originalFileName);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="relative h-24 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] grid place-items-center bg-[var(--color-muted)]/30 overflow-hidden">
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        ) : preview ? (
          <Image
            src={preview}
            alt={label}
            fill
            sizes="180px"
            unoptimized
            className="object-contain"
          />
        ) : fileName ? (
          <span className="text-caption px-2 text-center">{fileName}</span>
        ) : (
          <span className="text-caption">Nenhum arquivo</span>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> Enviar
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,application/pdf"
            onChange={onFile}
            className="hidden"
            aria-label={`Enviar ${label}`}
          />
        </>
      )}
    </div>
  );
}

/* ---------- Organization ---------- */

function OrganizationSection({
  org,
  canEdit,
  onSaved,
}: {
  org: Organization;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { refresh } = useAuth();
  const [form, setForm] = useState(org);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(org), [org]);
  function set<K extends keyof Organization>(k: K, v: Organization[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Live branding preview while editing brand colors.
  function setColor(key: 'primaryColor' | 'secondaryColor', value: string) {
    set(key, value);
    applyBranding(
      key === 'primaryColor' ? value : form.primaryColor,
      key === 'secondaryColor' ? value : form.secondaryColor,
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await organizationApi.updateOrganization({
        legalName: form.legalName,
        tradeName: form.tradeName,
        cnpj: form.cnpj,
        stateRegistration: form.stateRegistration ?? undefined,
        email: form.email,
        phone: form.phone,
        phoneNumbers: form.phoneNumbers,
        contacts: form.contacts
          .map((contact) => ({
            name: contact.name.trim(),
            role: contact.role?.trim() || undefined,
            phone: contact.phone.trim(),
            isWhatsapp: contact.isWhatsapp,
          }))
          .filter((contact) => contact.name || contact.phone),
        city: form.city,
        state: form.state,
        website: form.website ?? undefined,
        zipCode: form.zipCode ?? undefined,
        street: form.street ?? undefined,
        number: form.number ?? undefined,
        complement: form.complement ?? undefined,
        district: form.district ?? undefined,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
      });
      applyBranding(form.primaryColor, form.secondaryColor);
      onSaved();
      // Re-bootstrap the session so the persisted colors apply app-wide.
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Organização"
      icon={Building2}
      action={canEdit ? <SaveButton saving={saving} saved={saved} onClick={save} /> : undefined}
    >
      {error && (
        <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Razão social"
          value={form.legalName}
          onChange={(v) => set('legalName', v)}
          disabled={!canEdit}
        />
        <Input
          label="Nome fantasia"
          value={form.tradeName}
          onChange={(v) => set('tradeName', v)}
          disabled={!canEdit}
        />
        <Input
          label="CNPJ"
          value={form.cnpj}
          onChange={(v) => set('cnpj', v)}
          disabled={!canEdit}
        />
        <Input
          label="Inscrição estadual"
          value={form.stateRegistration ?? ''}
          onChange={(v) => set('stateRegistration', v)}
          disabled={!canEdit}
        />
        <Input
          label="E-mail"
          value={form.email}
          onChange={(v) => set('email', v)}
          disabled={!canEdit}
        />
        <Input
          label="Telefone"
          value={form.phone}
          onChange={(v) => set('phone', v)}
          disabled={!canEdit}
        />
        <Input
          label="Telefones adicionais (separados por vírgula)"
          value={form.phoneNumbers.join(', ')}
          onChange={(v) =>
            set(
              'phoneNumbers',
              v
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
          disabled={!canEdit}
        />
        <Input
          label="Website"
          value={form.website ?? ''}
          onChange={(v) => set('website', v)}
          disabled={!canEdit}
        />
        <Input
          label="CEP"
          value={form.zipCode ?? ''}
          onChange={(v) => set('zipCode', v)}
          disabled={!canEdit}
        />
        <Input
          label="Logradouro"
          value={form.street ?? ''}
          onChange={(v) => set('street', v)}
          disabled={!canEdit}
        />
        <Input
          label="Número"
          value={form.number ?? ''}
          onChange={(v) => set('number', v)}
          disabled={!canEdit}
        />
        <Input
          label="Complemento"
          value={form.complement ?? ''}
          onChange={(v) => set('complement', v)}
          disabled={!canEdit}
        />
        <Input
          label="Bairro"
          value={form.district ?? ''}
          onChange={(v) => set('district', v)}
          disabled={!canEdit}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Cidade"
            value={form.city}
            onChange={(v) => set('city', v)}
            disabled={!canEdit}
          />
          <Input
            label="UF"
            value={form.state}
            onChange={(v) => set('state', v)}
            disabled={!canEdit}
          />
        </div>
        <ColorInput
          label="Cor primária"
          value={form.primaryColor}
          onChange={(v) => setColor('primaryColor', v)}
          disabled={!canEdit}
        />
        <ColorInput
          label="Cor secundária"
          value={form.secondaryColor}
          onChange={(v) => setColor('secondaryColor', v)}
          disabled={!canEdit}
        />
      </div>
      <ContactsEditor
        contacts={form.contacts}
        onChange={(contacts) => set('contacts', contacts)}
        disabled={!canEdit}
      />
    </SectionCard>
  );
}

/* ---------- Settings ---------- */

function SettingsSection({
  settings,
  canEdit,
  onSaved,
}: {
  settings: OrganizationSettings;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);
  function set<K extends keyof OrganizationSettings>(k: K, v: OrganizationSettings[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await organizationApi.updateOrganizationSettings({
        language: form.language,
        timezone: form.timezone,
        currency: form.currency,
        documentPrefix: form.documentPrefix,
      });
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Parâmetros"
      icon={SlidersHorizontal}
      action={canEdit ? <SaveButton saving={saving} saved={saved} onClick={save} /> : undefined}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Idioma"
          value={form.language}
          onChange={(v) => set('language', v)}
          disabled={!canEdit}
        />
        <Input
          label="Fuso horário"
          value={form.timezone}
          onChange={(v) => set('timezone', v)}
          disabled={!canEdit}
        />
        <Input
          label="Moeda"
          value={form.currency}
          onChange={(v) => set('currency', v)}
          disabled={!canEdit}
        />
        <Input
          label="Prefixo de documentos"
          value={form.documentPrefix}
          onChange={(v) => set('documentPrefix', v)}
          disabled={!canEdit}
        />
      </div>
    </SectionCard>
  );
}

function RowText({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-caption">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function SmallAction({
  icon: Icon,
  label,
  onClick,
  busy,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-xs disabled:opacity-50 ${
        danger
          ? 'border-[var(--color-danger)]/30 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
          : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]'
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}{' '}
      {label}
    </button>
  );
}

function SignaturesSection({
  signatures,
  canEdit,
  onChanged,
}: {
  signatures: Signature[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editor, setEditor] = useState<
    { mode: 'create'; signature: null } | { mode: 'edit'; signature: Signature } | null
  >(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Signature | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(signature: Signature) {
    setBusy(signature.id);
    setError(null);
    try {
      await signaturesApi.updateSignature(signature.id, { active: !signature.active });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Falha ao atualizar assinatura.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(signature: Signature): Promise<boolean> {
    setBusy(signature.id);
    setError(null);
    try {
      await signaturesApi.deleteSignature(signature.id);
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Falha ao remover assinatura.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function download(signature: Signature) {
    setBusy(signature.id);
    setError(null);
    try {
      const image = await signaturesApi.downloadSignatureImage(signature.id);
      const binary = atob(image.contentBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: image.mimeType ?? 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = image.originalFileName ?? `${image.name}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Imagem de assinatura indisponível.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard
      title="Assinaturas"
      icon={PenLine}
      description="Assinaturas institucionais reutilizáveis nos modelos de documentos e armazenadas com segurança."
      action={
        canEdit ? (
          <button
            type="button"
            onClick={() => setEditor({ mode: 'create', signature: null })}
            className={primaryBtn}
          >
            Nova assinatura
          </button>
        ) : (
          <StatusChip tone="info">Somente leitura</StatusChip>
        )
      }
    >
      {error && (
        <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}
      {signatures.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Nenhuma assinatura cadastrada.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {signatures.map((signature) => (
            <li
              key={signature.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
            >
              <div className="flex items-start gap-3">
                <SignaturePreview signature={signature} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{signature.name}</div>
                  <div className="text-caption truncate">{signature.title}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusChip tone={signature.active ? 'success' : 'neutral'} dot>
                      {signature.active ? 'Ativa' : 'Inativa'}
                    </StatusChip>
                    <StatusChip tone={signature.hasImage ? 'info' : 'neutral'}>
                      {signature.hasImage ? 'Imagem enviada' : 'Sem imagem'}
                    </StatusChip>
                    {signature.user?.role === 'OWNER' && (
                      <StatusChip tone="info">Técnico: {signature.user.name}</StatusChip>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <SmallAction
                  icon={Download}
                  label="Download"
                  busy={busy === signature.id}
                  onClick={() => download(signature)}
                />
                {canEdit && (
                  <>
                    <SmallAction
                      icon={PenLine}
                      label="Editar"
                      onClick={() => setEditor({ mode: 'edit', signature })}
                    />
                    <SmallAction
                      icon={Check}
                      label={signature.active ? 'Desativar' : 'Ativar'}
                      busy={busy === signature.id}
                      onClick={() => toggle(signature)}
                    />
                    <SmallAction
                      icon={Trash2}
                      label="Excluir"
                      danger
                      busy={busy === signature.id}
                      onClick={() => setConfirmingDelete(signature)}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editor && (
        <SignatureEditor
          key={editor.mode === 'edit' ? `edit-${editor.signature.id}` : 'create-signature'}
          open
          signature={editor.signature}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            onChanged();
          }}
        />
      )}
      <Drawer
        open={confirmingDelete !== null}
        onClose={() => setConfirmingDelete(null)}
        eyebrow="Confirmação"
        title="Excluir assinatura?"
        width="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmingDelete(null)}
              className={secondaryBtn}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() =>
                confirmingDelete &&
                remove(confirmingDelete).then((deleted) => {
                  if (deleted) setConfirmingDelete(null);
                })
              }
              disabled={!confirmingDelete || busy === confirmingDelete.id}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-danger)] px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {confirmingDelete && busy === confirmingDelete.id && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Excluir assinatura
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-4">
            <p className="text-sm font-medium text-[var(--color-danger)]">
              Esta ação remove a assinatura da listagem normal.
            </p>
            <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
              Confirme apenas se você realmente deseja excluir
              {confirmingDelete ? ` “${confirmingDelete.name}”` : ''}. A assinatura será desativada
              e marcada como removida.
            </p>
          </div>
          {confirmingDelete && (
            <dl className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 text-sm">
              <RowText label="Nome" value={confirmingDelete.name} />
              <RowText label="Título" value={confirmingDelete.title} />
              <RowText label="Status" value={confirmingDelete.active ? 'Ativa' : 'Inativa'} />
            </dl>
          )}
        </div>
      </Drawer>
    </SectionCard>
  );
}

function SignatureEditor({
  open,
  signature,
  onClose,
  onSaved,
}: {
  open: boolean;
  signature: Signature | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [profession, setProfession] = useState('');
  const [professionalCouncil, setProfessionalCouncil] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [active, setActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [position, setPosition] = useState(0);
  const [mode, setMode] = useState<'upload' | 'draw'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const owners = useQuery(
    (signal) => usersApi.listUsers({ limit: 100, signal }),
    [open],
  );

  useEffect(() => {
    if (!open) return;
    setName(signature?.name ?? '');
    setUserId(signature?.userId ?? '');
    setTitle(signature?.title ?? '');
    setProfession(signature?.profession ?? '');
    setProfessionalCouncil(signature?.professionalCouncil ?? '');
    setRegistrationNumber(signature?.registrationNumber ?? '');
    setDepartment(signature?.department ?? '');
    setActive(signature?.active ?? true);
    setIsDefault(signature?.isDefault ?? false);
    setPosition(signature?.position ?? 0);
    setMode('upload');
    setFile(null);
    setPreview(null);
    setDrawingFile(null);
    setError(null);
  }, [open, signature]);

  async function save() {
    if (!name.trim() || !title.trim()) {
      setError('Informe nome e título.');
      return;
    }
    if (mode === 'draw' && !drawingFile) {
      setError('Desenhe a assinatura antes de salvar ou use o modo Upload image.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = signature
          ? await signaturesApi.updateSignature(signature.id, {
            userId: userId || null,
            name,
            title,
            profession,
            professionalCouncil,
            registrationNumber,
            department,
            active,
            isDefault,
            position,
          })
        : await signaturesApi.createSignature({
            userId: userId || null,
            name,
            title,
            profession,
            professionalCouncil,
            registrationNumber,
            department,
            active,
            isDefault,
            position,
          });
      const selectedFile = mode === 'draw' ? drawingFile : file;
      if (selectedFile) await signaturesApi.uploadSignatureImage(saved.id, selectedFile);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Falha ao salvar assinatura.');
    } finally {
      setSaving(false);
    }
  }

  function onUpload(file: File | null) {
    if (file && file.size > 2 * 1024 * 1024) {
      setError('A imagem de assinatura deve ter no máximo 2 MiB.');
      return;
    }
    setFile(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Assinaturas"
      title={signature ? 'Editar assinatura' : 'Nova assinatura'}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim() || !title.trim()}
            className={primaryBtn}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar assinatura
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Cadastre uma assinatura fixa por upload ou desenho. A imagem é validada e armazenada pelo
          backend.
        </p>
        {error && (
          <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}
        <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold">Identificação</h3>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              Use nome e cargo exatamente como devem aparecer nos documentos.
            </p>
          </div>
          <Input label="Nome" value={name} onChange={setName} />
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Responsável técnico OWNER</span>
            <select value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">Assinatura institucional sem vínculo pessoal</option>
              {(owners.data?.items ?? [])
                .filter((owner) => owner.isActive && owner.role === 'OWNER')
                .map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name} · {owner.jobTitle ?? 'OWNER'}
                  </option>
                ))}
            </select>
            <span className="text-caption">
              Vincule para que esta assinatura seja reconhecida automaticamente nos planos PMOC
              cujo técnico responsável seja este OWNER.
            </span>
          </label>
          <Input label="Título" value={title} onChange={setTitle} />
          <Input label="Profissão" value={profession} onChange={setProfession} />
          <Input
            label="Conselho profissional"
            value={professionalCouncil}
            onChange={setProfessionalCouncil}
          />
          <Input label="Número do registro" value={registrationNumber} onChange={setRegistrationNumber} />
          <Input label="Departamento" value={department} onChange={setDepartment} />
          <Input label="Ordem de exibição" value={String(position)} onChange={(value) => setPosition(Math.max(0, Number(value) || 0))} />
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium">Ativa</span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span><span className="block text-sm font-medium">Assinatura padrão</span><span className="block text-caption">Pré-selecionada nos novos documentos.</span></span>
            <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
          </label>
        </section>

        <section className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-1">
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-sm ${mode === 'upload' ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-muted)]'}`}
            >
              Upload image
            </button>
            <button
              type="button"
              onClick={() => setMode('draw')}
              className={`flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-sm ${mode === 'draw' ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'hover:bg-[var(--color-muted)]'}`}
            >
              Draw signature
            </button>
          </div>

          {mode === 'upload' ? (
            <div className="space-y-3">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3 text-xs text-[var(--color-muted-foreground)]">
                Use PNG com fundo transparente quando possível; assinatura escura, bom contraste,
                margens cortadas, sem sombras e até 2 MiB. Formatos aceitos pelo backend: PNG, JPG e
                JPEG.
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="grid min-h-32 w-full place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4 text-center hover:bg-[var(--color-muted)]/35"
              >
                <span>
                  <Upload className="mx-auto mb-2 h-5 w-5 text-[var(--color-muted-foreground)]" />
                  <span className="text-sm font-medium">
                    {file ? file.name : 'Clique para enviar uma imagem'}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-muted-foreground)]">
                    PNG/JPG/JPEG · máximo 2 MiB
                  </span>
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(event) => onUpload(event.target.files?.[0] ?? null)}
              />
              {file && (
                <button type="button" onClick={() => onUpload(null)} className={secondaryBtn}>
                  Remover arquivo antes de salvar
                </button>
              )}
            </div>
          ) : (
            <SignatureCanvas
              onChange={(nextFile, dataUrl) => {
                setDrawingFile(nextFile);
                setPreview(dataUrl);
              }}
            />
          )}

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div className="text-xs font-medium text-[var(--color-muted-foreground)]">Preview</div>
            <div className="relative mt-2 grid min-h-24 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-muted)]/25">
              {preview ? (
                <Image
                  src={preview}
                  alt="Preview da assinatura"
                  fill
                  sizes="420px"
                  unoptimized
                  className="object-contain p-2"
                />
              ) : (
                <span className="text-caption">
                  Nenhuma nova imagem selecionada. Metadados podem ser salvos sem substituir a
                  assinatura atual.
                </span>
              )}
            </div>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function SignaturePreview({ signature }: { signature: Signature }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!signature.hasImage) {
      setSrc(null);
      return;
    }
    signaturesApi
      .downloadSignatureImage(signature.id)
      .then((image) => {
        if (alive) setSrc(`data:${image.mimeType};base64,${image.contentBase64}`);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [signature.id, signature.hasImage]);

  return (
    <span className="relative grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
      {src ? (
        <Image
          src={src}
          alt={signature.name}
          fill
          sizes="80px"
          unoptimized
          className="object-contain p-1"
        />
      ) : (
        <PenLine className="h-5 w-5" />
      )}
    </span>
  );
}

function SignatureCanvas({
  onChange,
}: {
  onChange: (file: File | null, dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = 900;
    canvas.height = 260;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasStroke(true);
  }

  async function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    await emitFile();
  }

  async function emitFile() {
    const canvas = canvasRef.current;
    if (!canvas || !hasCanvasInk(canvas)) {
      onChange(null, null);
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png', 0.92),
    );
    if (!blob) return;
    onChange(new File([blob], `assinatura-${Date.now()}.png`, { type: 'image/png' }), dataUrl);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    onChange(null, null);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3 text-xs text-[var(--color-muted-foreground)]">
        Desenhe com mouse, caneta ou toque. O resultado vira PNG transparente e passa pelo upload
        oficial do backend.
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="h-44 w-full touch-none rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-white"
        aria-label="Área para desenhar assinatura"
      />
      <button type="button" onClick={clear} disabled={!hasStroke} className={secondaryBtn}>
        Limpar desenho
      </button>
    </div>
  );
}

function hasCanvasInk(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

/* ---------- Inputs ---------- */

const MAX_CONTACTS = 5;

/**
 * Responsáveis de contato exibidos na landing (nome, função e telefone de cada
 * um). A ordem importa: o primeiro com WhatsApp recebe os botões gerais da página.
 */
function ContactsEditor({
  contacts,
  onChange,
  disabled,
}: {
  contacts: OrganizationContact[];
  onChange: (contacts: OrganizationContact[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<OrganizationContact>) {
    onChange(contacts.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));
  }
  function add() {
    onChange([
      ...contacts,
      {
        id: `new-${Date.now()}`,
        name: '',
        role: null,
        phone: '',
        isWhatsapp: true,
        position: contacts.length,
      },
    ]);
  }

  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Responsáveis de contato</h3>
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
            Aparecem na página inicial, cada um com seu telefone e WhatsApp. O primeiro com
            WhatsApp é o contato principal dos botões da página.
          </p>
        </div>
        {!disabled && contacts.length < MAX_CONTACTS && (
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)]"
          >
            <Plus className="h-4 w-4" /> Adicionar responsável
          </button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-sm text-[var(--color-muted-foreground)]">
          Nenhum responsável cadastrado — a página inicial usa o telefone da organização.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {contacts.map((contact, index) => (
            <li
              key={contact.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
                  <UserRound className="h-3.5 w-3.5" /> Responsável {index + 1}
                  {index === 0 && ' · principal'}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(contacts.filter((_, i) => i !== index))}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                    aria-label={`Remover responsável ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Nome"
                  value={contact.name}
                  onChange={(v) => update(index, { name: v })}
                  disabled={disabled}
                />
                <Input
                  label="Função (opcional)"
                  value={contact.role ?? ''}
                  onChange={(v) => update(index, { role: v })}
                  disabled={disabled}
                />
                <Input
                  label="Telefone"
                  value={contact.phone}
                  onChange={(v) => update(index, { phone: v })}
                  disabled={disabled}
                />
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={contact.isWhatsapp}
                  onChange={(e) => update(index, { isWhatsapp: e.target.checked })}
                  disabled={disabled}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                Este número atende pelo WhatsApp
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SaveButton({
  saving,
  saved,
  onClick,
}: {
  saving: boolean;
  saved: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50"
    >
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : saved ? (
        <Check className="h-4 w-4" />
      ) : null}
      {saved ? 'Salvo' : 'Salvar'}
    </button>
  );
}

function Input({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
      />
    </label>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-12 rounded border border-[var(--color-border)] bg-transparent disabled:opacity-60"
          aria-label={label}
        />
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm font-mono outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
        />
      </div>
    </label>
  );
}
