"use client";

/**
 * UserDetailDrawer — team member detail with tabs and OWNER actions
 * (edit, enable/disable, delete, reset password). Avatar is fetched on demand.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { Copy, Check, KeyRound, Pencil, Power, Trash2 } from "lucide-react";
import { Drawer } from "@erp/ui/drawer";
import { DrawerTabs } from "@erp/ui/drawer-tabs";
import { StatusChip } from "@erp/ui/status-chip";
import { ConfirmDialog } from "@erp/ui/confirm-dialog";
import { useAuth } from "@erp/ui/auth/auth-provider";
import { usersApi, customerPortalApi, ApiClientError, type TeamUser, type CustomerPortalDirectoryAccount } from "@erp/api";
import { initials, formatDate, formatDateTime } from "@erp/utils";
import { ROLE_LABEL, ROLE_TONE, PERMISSION_KEYS, PERMISSION_LABEL } from "@platform/user-display";

const TABS = ["Dados", "Permissões", "Preferências"] as const;
type Tab = (typeof TABS)[number];

export function UserDetailDrawer({
  user,
  portalAccount = null,
  onEditPortal,
  open,
  onClose,
  onChanged,
  onDeleted,
  onEdit,
}: {
  user: TeamUser | null;
  portalAccount?: CustomerPortalDirectoryAccount | null;
  onEditPortal?: (account: CustomerPortalDirectoryAccount) => void;
  open: boolean;
  onClose: () => void;
  onChanged: (account?: CustomerPortalDirectoryAccount) => void;
  /** Depois da exclusão: o drawer deve fechar (o usuário pode ter saído da lista). */
  onDeleted?: (mode: "deleted" | "archived", name: string) => void;
  onEdit: (user: TeamUser) => void;
}) {
  const { session, hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>("Dados");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "disable" | "delete">(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwner = hasRole("OWNER");
  const account = user ?? portalAccount;
  const [actionError, setActionError] = useState<string | null>(null);
  const isSelf = Boolean(user) && session?.user.id === user?.id;

  useEffect(() => {
    if (open) { setTab("Dados"); setTempPassword(null); setCopied(false); setConfirm(null); setActionError(null); }
  }, [open, user?.id, portalAccount?.id]);

  useEffect(() => {
    setAvatar(null);
    if (!open || !user?.avatarAssetId) return;
    let active = true;
    usersApi.getAvatar(user.avatarAssetId)
      .then((a) => { if (active) setAvatar(`data:${a.mimeType};base64,${a.contentBase64}`); })
      .catch(() => {});
    return () => { active = false; };
  }, [open, user?.avatarAssetId]);

  if (!account) return null;

  async function runAction(fn: () => Promise<TeamUser | CustomerPortalDirectoryAccount>) {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await fn();
      onChanged("customer" in updated ? updated : undefined);
    } catch (error) {
      setActionError(error instanceof ApiClientError ? error.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      const res = portalAccount ? await customerPortalApi.resetAccountPassword(portalAccount.id) : await usersApi.resetPassword(user!.id);
      setTempPassword(res.temporaryPassword);
      onChanged("account" in res ? res.account : undefined);
    } catch (err) {
      setTempPassword(err instanceof ApiClientError ? `Erro: ${err.message}` : "Erro ao redefinir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} eyebrow="Usuário" title={account.name}>
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <span className="relative h-14 w-14 rounded-full bg-[var(--color-accent)] grid place-items-center text-white font-semibold text-lg overflow-hidden">
              {avatar ? <Image src={avatar} alt={account.name} fill sizes="56px" unoptimized className="object-cover" /> : initials(account.name)}
            </span>
            <div className="min-w-0">
              <div className="font-medium truncate">{account.name}</div>
              <div className="text-caption truncate">{account.email}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <StatusChip tone={user ? ROLE_TONE[user.role] : "info"}>{user ? ROLE_LABEL[user.role] : "Portal do cliente"}</StatusChip>
                <StatusChip tone={account.isActive ? "success" : "neutral"} dot>{account.isActive ? "Ativo" : "Inativo"}</StatusChip>
              </div>
            </div>
          </div>

          {/* Actions (OWNER only) */}
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              <ActionBtn icon={Pencil} label="Editar" onClick={() => { if (portalAccount) onEditPortal?.(portalAccount); else if (user) onEdit(user); }} />
              {account.isActive ? (
                <ActionBtn icon={Power} label="Desativar" onClick={() => setConfirm("disable")} disabled={isSelf} />
              ) : (
                <ActionBtn icon={Power} label="Ativar" onClick={() => runAction(() => portalAccount ? customerPortalApi.enableAccount(portalAccount.id) : usersApi.enableUser(user!.id))} disabled={busy} />
              )}
              <ActionBtn icon={KeyRound} label="Resetar senha" onClick={handleReset} disabled={busy} />
              <ActionBtn icon={Trash2} label="Excluir" onClick={() => setConfirm("delete")} disabled={isSelf} danger />
            </div>
          )}

          {tempPassword && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3">
              <div className="flex items-center gap-2 text-caption uppercase tracking-wider mb-2"><KeyRound className="h-3.5 w-3.5" /> Senha temporária (única vez)</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm break-all rounded bg-[var(--color-card)] px-3 py-2">{tempPassword}</code>
                <button type="button" onClick={() => { navigator.clipboard.writeText(tempPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 h-9 text-sm hover:bg-[var(--color-muted)]">
                  {copied ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {actionError && <p role="alert" className="text-sm text-[var(--color-danger)]">{actionError}</p>}
          <DrawerTabs tabs={portalAccount ? TABS.filter((item) => item !== "Preferências") : TABS} active={tab} onChange={setTab} />

          {tab === "Dados" && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <Row label={portalAccount ? "Login" : "Usuário"} value={user?.username ?? account.email} />
              {portalAccount && <Row label="Cliente vinculado" value={portalAccount.customer.tradeName || portalAccount.customer.name} />}
              <Row label="Telefone" value={account.phone} />
              {user && <Row label="Cargo" value={user.jobTitle} />}
              <Row label="Último acesso" value={account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "Nunca"} />
              <Row label="Criado em" value={formatDate(account.createdAt)} />
              {account.mustChangePassword && <Row label="Senha" value={<StatusChip tone="warning">Troca obrigatória pendente</StatusChip>} />}
              {user?.notes && <Row label="Observações" value={user.notes} />}
            </div>
          )}

          {tab === "Permissões" && portalAccount && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 text-sm">
              Este usuário acessa somente os dados e as solicitações do cliente {portalAccount.customer.tradeName || portalAccount.customer.name} no Portal do Cliente.
            </div>
          )}
          {tab === "Permissões" && user && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] divide-y divide-[var(--color-border)]">
              {PERMISSION_KEYS.map((k) => {
                const on = user.role === "OWNER" || user.permission[k];
                return (
                  <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{PERMISSION_LABEL[k]}</span>
                    <StatusChip tone={on ? "success" : "neutral"}>{on ? "Permitido" : "Bloqueado"}</StatusChip>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "Preferências" && user && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <Row label="Tema" value={user.preferences?.theme ?? "SYSTEM"} />
              <Row label="Notificações" value={user.preferences?.notificationsEnabled ? "Ativadas" : "Desativadas"} />
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirm === "disable"}
        title="Desativar usuário"
        description={<>O acesso de <strong>{account.name}</strong> será revogado imediatamente.</>}
        confirmLabel="Desativar"
        danger
        onConfirm={() => (portalAccount ? customerPortalApi.disableAccount(portalAccount.id) : usersApi.disableUser(user!.id)).then((updated) => onChanged("customer" in updated ? updated : undefined))}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Excluir usuário"
        description={
          <>
            <strong>{account.name}</strong> {portalAccount ? "será excluído do Portal do Cliente. Se já tiver solicitações no histórico," : "será excluído junto com a assinatura e os acessos. Se já tiver atendimentos, documentos ou outros registros,"} ficará apenas inativo para auditoria
            e sairá da lista de usuários. Para só suspender o acesso e manter na lista, use{" "}
            <strong>Desativar</strong>.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={() =>
          (portalAccount ? customerPortalApi.deleteAccount(portalAccount.id) : usersApi.deleteUser(user!.id)).then((result) => {
            onChanged();
            onDeleted?.(result.mode, account.name);
          })
        }
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

function ActionBtn({ icon: Icon, label, onClick, disabled, danger }: { icon: typeof Pencil; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 h-8 text-xs disabled:opacity-40 ${danger ? "border-[var(--color-danger)]/30 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10" : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"}`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
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
