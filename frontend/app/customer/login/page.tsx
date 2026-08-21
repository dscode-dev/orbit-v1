'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { BrandLogo } from '@erp/ui/brand';
import { ApiClientError } from '@erp/api';
import { useCustomerAuth } from '@erp/ui/auth/customer-auth-provider';

function CustomerLoginForm() {
  const { login, status } = useCustomerAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status === 'authenticated') router.replace(params.get('next') ?? '/customer');
    if (status === 'password-change') router.replace('/customer/change-password');
  }, [status, router, params]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await login(email.trim(), password); }
    catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Não foi possível acessar o portal.');
      setBusy(false);
    }
  }
  return <main className="min-h-dvh grid place-items-center bg-[var(--color-background)] px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center text-center"><BrandLogo height={58} /><h1 className="mt-5 text-page-title">Portal do cliente</h1><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Acompanhe seus equipamentos, atendimentos e chamados.</p></div>
      <form onSubmit={submit} className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-card)]">
        {error && <div className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</div>}
        <label className="block space-y-1.5"><span className="text-sm font-medium">E-mail de acesso</span><input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input h-11 w-full" /></label>
        <label className="block space-y-1.5"><span className="text-sm font-medium">Senha</span><input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input h-11 w-full" /></label>
        <button disabled={busy} className="btn-primary h-11 w-full justify-center">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Entrar</button>
      </form>
      <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">Acesso exclusivo para clientes. Usuários internos utilizam seus portais próprios.</p>
    </div>
  </main>;
}

export default function CustomerLoginPage() { return <Suspense fallback={null}><CustomerLoginForm /></Suspense>; }
