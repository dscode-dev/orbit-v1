'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { ApiClientError, customerPortalApi } from '@erp/api';
import { BrandLogo } from '@erp/ui/brand';
import { useCustomerAuth } from '@erp/ui/auth/customer-auth-provider';

export default function CustomerChangePasswordPage() {
  const { refresh } = useCustomerAuth(); const router = useRouter();
  const [currentPassword, setCurrent] = useState(''); const [newPassword, setNew] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) { setError('As senhas não coincidem.'); return; }
    setBusy(true); setError(null);
    try { await customerPortalApi.changePassword({ currentPassword, newPassword }); await refresh(); router.replace('/customer'); }
    catch (cause) { setError(cause instanceof ApiClientError ? cause.message : 'Não foi possível trocar a senha.'); setBusy(false); }
  }
  return <main className="min-h-dvh grid place-items-center px-4 py-10"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border bg-[var(--color-card)] p-6 shadow-lg"><BrandLogo height={44} /><div><h1 className="text-xl font-semibold">Crie sua senha definitiva</h1><p className="text-caption">Use ao menos 12 caracteres, maiúscula, minúscula, número e símbolo.</p></div>{error && <p className="rounded-md bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}<input required type="password" placeholder="Senha temporária" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} className="input w-full"/><input required minLength={12} type="password" placeholder="Nova senha" value={newPassword} onChange={(e) => setNew(e.target.value)} className="input w-full"/><input required minLength={12} type="password" placeholder="Confirme a nova senha" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input w-full"/><button disabled={busy} className="btn-primary w-full justify-center">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <ShieldCheck className="h-4 w-4"/>} Salvar senha</button></form></main>;
}
