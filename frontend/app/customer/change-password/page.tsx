'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Circle, Loader2, ShieldCheck } from 'lucide-react';
import { ApiClientError, customerPortalApi } from '@erp/api';
import { BrandLogo } from '@erp/ui/brand';
import { useCustomerAuth } from '@erp/ui/auth/customer-auth-provider';
import { MIN_PASSWORD_LENGTH } from '@erp/utils';

/** Espelha CustomerPortalChangePasswordDto: a senha só é enviada quando todas as regras passam. */
const RULES: Array<[string, (value: string) => boolean]> = [
  [`Ao menos ${MIN_PASSWORD_LENGTH} caracteres`, (value) => value.length >= MIN_PASSWORD_LENGTH],
  ['Uma letra minúscula', (value) => /[a-z]/.test(value)],
  ['Uma letra maiúscula', (value) => /[A-Z]/.test(value)],
  ['Um número', (value) => /\d/.test(value)],
  ['Um símbolo (ex.: ! @ # $ %)', (value) => /[^A-Za-z0-9]/.test(value)],
];

export default function CustomerChangePasswordPage() {
  const { refresh } = useCustomerAuth(); const router = useRouter();
  const [currentPassword, setCurrent] = useState(''); const [newPassword, setNew] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const strong = RULES.every(([, test]) => test(newPassword));
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const ready = currentPassword.length > 0 && strong && confirm === newPassword;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true); setError(null);
    try { await customerPortalApi.changePassword({ currentPassword, newPassword }); await refresh(); router.replace('/customer'); }
    catch (cause) { setError(changePasswordError(cause)); setBusy(false); }
  }
  return <main className="min-h-dvh grid place-items-center px-4 py-10"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border bg-[var(--color-card)] p-6 shadow-lg"><BrandLogo height={44} /><div><h1 className="text-xl font-semibold">Crie sua senha definitiva</h1><p className="text-caption">Substitua a senha temporária recebida por uma senha só sua.</p></div>{error && <p className="rounded-md bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}<input required type="password" autoComplete="current-password" placeholder="Senha temporária" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} className="input w-full"/><div className="space-y-2"><input required type="password" autoComplete="new-password" placeholder="Nova senha" value={newPassword} onChange={(e) => setNew(e.target.value)} className="input w-full"/><ul className="grid gap-1 sm:grid-cols-2" aria-label="Requisitos da senha">{RULES.map(([label, test]) => { const met = test(newPassword); return <li key={label} className={`flex items-center gap-1.5 text-xs ${met ? 'text-[var(--color-success)]' : 'text-[var(--color-muted-foreground)]'}`}>{met ? <Check className="h-3.5 w-3.5"/> : <Circle className="h-3 w-3"/>}{label}</li>; })}</ul></div><div><input required type="password" autoComplete="new-password" placeholder="Confirme a nova senha" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input w-full"/>{mismatch && <p className="mt-1 text-xs text-[var(--color-danger)]">As senhas não coincidem.</p>}</div><button disabled={busy || !ready} className="btn-primary w-full justify-center disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <ShieldCheck className="h-4 w-4"/>} Salvar senha</button></form></main>;
}

/** Mostra o motivo real da recusa (ex.: violações de validação) em vez de uma mensagem genérica. */
function changePasswordError(cause: unknown): string {
  if (!(cause instanceof ApiClientError)) return 'Não foi possível trocar a senha. Verifique sua conexão e tente novamente.';
  if (cause.code === 'AUTH_INVALID_CREDENTIALS') return 'A senha temporária está incorreta.';
  const violations = cause.details.violations;
  if (Array.isArray(violations) && violations.length) return violations.join('. ') + '.';
  return cause.message || 'Não foi possível trocar a senha.';
}
