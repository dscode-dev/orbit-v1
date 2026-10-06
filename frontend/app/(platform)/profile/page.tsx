"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Camera, Loader2, Trash2, KeyRound, Check, ShieldCheck, Building2, ZoomIn } from "lucide-react";
import { PageHeader } from "@platform/components/page-header";
import { Drawer } from "@erp/ui/drawer";
import { SectionCard } from "@erp/ui/section-card";
import { StatusChip } from "@erp/ui/status-chip";
import { UserAvatar } from "@erp/ui/user-avatar";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { usersApi, ApiClientError, type UserTheme } from "@erp/api";
import { MIN_PASSWORD_LENGTH } from "@erp/utils";
import { BiometricDevices } from "@erp/ui/auth/biometric-devices";
import { ROLE_LABEL, ROLE_TONE, PERMISSION_KEYS, PERMISSION_LABEL } from "@platform/user-display";

const THEME_OPTIONS: { value: UserTheme; label: string }[] = [
  { value: "SYSTEM", label: "Sistema" },
  { value: "LIGHT", label: "Claro" },
  { value: "DARK", label: "Escuro" },
];

export default function ProfilePage() {
  const { session, refresh } = useAuth();

  if (!session) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando perfil…
      </div>
    );
  }

  const { user, organization, permissions } = session;
  const activePerms = PERMISSION_KEYS.filter((k) => permissions[k]);

  return (
    <div className="space-y-6 max-w-[1100px]">
      <PageHeader eyebrow="Sistema" title="Meu perfil" description="Seus dados, avatar, senha e preferências." />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <AvatarCard
            name={user.name}
            avatarAssetId={user.avatarAssetId}
            onChanged={refresh}
          />

          <SectionCard title="Identidade" icon={ShieldCheck}>
            <Row label="Nome" value={user.name} />
            <Row label="E-mail" value={user.email} />
            <Row label="Usuário" value={user.username} />
            <Row label="Papel" value={<StatusChip tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</StatusChip>} />
          </SectionCard>

          <SectionCard title="Organização" icon={Building2}>
            <Row label="Empresa" value={organization.tradeName || organization.legalName} />
            {organization.segment && <Row label="Segmento" value={organization.segment} />}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Permissões">
            {activePerms.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">Sem permissões administrativas adicionais.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {activePerms.map((k) => <StatusChip key={k} tone="primary">{PERMISSION_LABEL[k]}</StatusChip>)}
              </div>
            )}
          </SectionCard>

          <PreferencesCard
            theme={session.preferences?.theme ?? "SYSTEM"}
            notifications={session.preferences?.notificationsEnabled ?? true}
            onSaved={refresh}
          />

          <ChangePasswordCard />
        </div>
      </div>
    </div>
  );
}

function AvatarCard({ name, avatarAssetId, onChanged }: { name: string; avatarAssetId: string | null; onChanged: () => Promise<void> }) {
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) { setError("Use PNG ou JPG."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Imagem original até 5 MiB antes do recorte."); return; }
    setError(null);
    setCropSource(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadCropped(file: File) {
    setBusy(true); setError(null);
    try {
      await usersApi.uploadAvatar(file);
      await onChanged();
      setCropSource(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Falha no upload.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true); setError(null);
    try {
      await usersApi.deleteAvatar();
      await onChanged();
    } catch {
      setError("Falha ao remover.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Avatar">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <UserAvatar name={name} avatarAssetId={avatarAssetId} size="xl" />
          {busy && <div className="absolute inset-0 grid place-items-center bg-black/40"><Loader2 className="h-5 w-5 animate-spin text-white" /></div>}
        </div>
        {error && <p className="text-[11px] text-[var(--color-danger)]">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50">
            <Camera className="h-4 w-4" /> Enviar
          </button>
          {avatarAssetId && (
            <button type="button" onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-9 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Remover
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg" onChange={onFile} className="hidden" aria-label="Enviar avatar" />
        <p className="text-[11px] text-[var(--color-muted-foreground)]">PNG ou JPG. O avatar final será recortado em 512×512 PNG.</p>
      </div>
      <AvatarCropDrawer
        file={cropSource}
        busy={busy}
        onClose={() => setCropSource(null)}
        onConfirm={uploadCropped}
      />
    </SectionCard>
  );
}

function AvatarCropDrawer({
  file,
  busy,
  onClose,
  onConfirm,
}: {
  file: File | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (file: File) => Promise<void>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cropSize = 288;

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImageSize(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file || !src) return null;

  function pointer(event: React.PointerEvent<HTMLDivElement>) {
    return { x: event.clientX, y: event.clientY };
  }

  async function confirm() {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const naturalRatio = image.naturalWidth / image.naturalHeight;
    const baseWidth = naturalRatio >= 1 ? cropSize * naturalRatio : cropSize;
    const baseHeight = naturalRatio >= 1 ? cropSize : cropSize / naturalRatio;
    const displayedWidth = baseWidth * zoom;
    const displayedHeight = baseHeight * zoom;
    const scale = 512 / cropSize;
    const dx = ((cropSize - displayedWidth) / 2 + offset.x) * scale;
    const dy = ((cropSize - displayedHeight) / 2 + offset.y) * scale;
    ctx.drawImage(image, dx, dy, displayedWidth * scale, displayedHeight * scale);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!blob) return;
    await onConfirm(new File([blob], `avatar-${Date.now()}.png`, { type: "image/png" }));
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Perfil"
      title="Recortar avatar"
      width="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={confirm} disabled={busy} className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar recorte
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--color-muted-foreground)]">Arraste para reposicionar e ajuste o zoom. Nada será enviado até confirmar.</p>
        <div
          className="relative mx-auto h-72 w-72 touch-none overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-muted)]"
          onPointerDown={(event) => {
            const p = pointer(event);
            setDragStart({ x: p.x, y: p.y, ox: offset.x, oy: offset.y });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragStart) return;
            const p = pointer(event);
            setOffset({ x: dragStart.ox + p.x - dragStart.x, y: dragStart.oy + p.y - dragStart.y });
          }}
          onPointerUp={() => setDragStart(null)}
          onPointerCancel={() => setDragStart(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={src}
            alt="Prévia do avatar"
            className="absolute left-1/2 top-1/2 max-w-none select-none"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              const ratio = image.naturalWidth / image.naturalHeight;
              setImageSize({
                width: ratio >= 1 ? cropSize * ratio : cropSize,
                height: ratio >= 1 ? cropSize : cropSize / ratio,
              });
            }}
            style={{
              width: imageSize ? `${imageSize.width * zoom}px` : `${cropSize}px`,
              height: imageSize ? `${imageSize.height * zoom}px` : `${cropSize}px`,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80 ring-offset-2 ring-offset-black/15" />
        </div>
        <label className="block space-y-2">
          <span className="flex items-center gap-2 text-sm font-medium"><ZoomIn className="h-4 w-4" /> Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
        </label>
      </div>
    </Drawer>
  );
}

function PreferencesCard({ theme, notifications, onSaved }: { theme: UserTheme; notifications: boolean; onSaved: () => Promise<void> }) {
  const { setTheme } = useTheme();
  const [localTheme, setLocalTheme] = useState<UserTheme>(theme);
  const [notif, setNotif] = useState(notifications);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function persist(next: { theme?: UserTheme; notificationsEnabled?: boolean }) {
    setSaving(true); setSaved(false);
    try {
      await usersApi.updatePreferences(next);
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  function changeTheme(value: UserTheme) {
    setLocalTheme(value);
    setTheme(value.toLowerCase()); // sync next-themes
    persist({ theme: value });
  }

  function toggleNotif() {
    const next = !notif;
    setNotif(next);
    persist({ notificationsEnabled: next });
  }

  return (
    <SectionCard title="Preferências" action={saving ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" /> : saved ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : null}>
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium mb-2">Tema</div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => changeTheme(o.value)} className={`rounded-[var(--radius-md)] border px-3 h-9 text-sm transition ${localTheme === o.value ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]" : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"}`}>{o.label}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-sm font-medium">Notificações</div>
            <p className="text-caption">Preferência armazenada (entrega ainda não disponível).</p>
          </div>
          <input type="checkbox" checked={notif} onChange={toggleNotif} className="accent-[var(--color-primary)] h-4 w-4" />
        </label>
      </div>
    </SectionCard>
  );
}

function ChangePasswordCard() {
  const { logout } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = current && next.length >= MIN_PASSWORD_LENGTH && next === confirm && !saving;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(null);
    try {
      await usersApi.changePassword({ currentPassword: current, newPassword: next });
      await logout();
      router.replace("/login");
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : "";
      setError(
        code === "PASSWORD_CURRENT_INVALID" ? "Senha atual incorreta." :
        code === "PASSWORD_REUSE_NOT_ALLOWED" ? "A nova senha deve ser diferente da atual." :
        code === "VALIDATION_ERROR" ? `A nova senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.` :
        "Não foi possível alterar a senha.",
      );
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Segurança" icon={KeyRound}>
      <form onSubmit={onSubmit} className="space-y-3">
        {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
        <Input label="Senha atual" value={current} onChange={setCurrent} />
        <Input label={`Nova senha (mín. ${MIN_PASSWORD_LENGTH})`} value={next} onChange={setNext} />
        <Input label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
        <p className="text-[11px] text-[var(--color-muted-foreground)]">Ao alterar a senha, todas as sessões serão encerradas e será necessário entrar novamente.</p>
        <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Alterar senha
        </button>
      </form>
      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <BiometricDevices />
      </div>
    </SectionCard>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 h-9 text-sm outline-none focus:border-[var(--color-primary)]" />
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0 border-[var(--color-border)]/60">
      <span className="text-caption">{label}</span>
      <span className="text-sm text-right">{value || "—"}</span>
    </div>
  );
}
