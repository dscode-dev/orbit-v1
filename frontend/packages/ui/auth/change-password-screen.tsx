'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, KeyRound, Loader2, PenLine, ShieldCheck } from 'lucide-react';
import { useAuth } from './auth-provider';
import { usersApi, ApiClientError } from '@erp/api';
import { dataUrlToFile } from '@erp/utils';
import { SignaturePad } from '../documents/signature-pad';

const ERROR_MESSAGES: Record<string, string> = {
  PASSWORD_CURRENT_INVALID: 'A senha atual está incorreta.',
  PASSWORD_REUSE_NOT_ALLOWED: 'A nova senha deve ser diferente da atual.',
  SIGNATURE_IMAGE_REQUIRED: 'Desenhe e confirme sua assinatura.',
  UPLOAD_INVALID_MIME_TYPE: 'A imagem gerada para a assinatura é inválida.',
  UPLOAD_FILE_TOO_LARGE: 'A assinatura excedeu o limite permitido.',
  VALIDATION_ERROR: 'Revise a senha e os dados profissionais informados.',
  AUTH_INVALID_TOKEN: 'Sua sessão expirou. Entre novamente com a senha temporária.',
};

export function ChangePasswordScreen({ variant }: { variant: 'platform' | 'operator' }) {
  const { status, logout, session } = useAuth();
  const router = useRouter();
  const loginPath = variant === 'operator' ? '/operator/login' : '/login';
  const requiresSignature = variant === 'operator';
  const [step, setStep] = useState<0 | 1>(0);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [title, setTitle] = useState('');
  const [profession, setProfession] = useState('');
  const [professionalCouncil, setProfessionalCouncil] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(loginPath);
  }, [status, router, loginPath]);

  useEffect(() => {
    if (!title && session?.user.jobTitle) setTitle(session.user.jobTitle);
  }, [session, title]);

  const tooShort = newPassword.length > 0 && newPassword.length < 12;
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const passwordReady = currentPassword.length > 0 && newPassword.length >= 12 && confirm === newPassword;
  const signatureReady = title.trim().length >= 2 && Boolean(signature);

  async function finish(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      if (requiresSignature) {
        if (!signature) throw new Error('SIGNATURE_REQUIRED');
        await usersApi.completeFirstAccess(
          {
            currentPassword,
            newPassword,
            signatureTitle: title.trim(),
            profession: profession.trim() || undefined,
            professionalCouncil: professionalCouncil.trim() || undefined,
            registrationNumber: registrationNumber.trim() || undefined,
            department: department.trim() || undefined,
          },
          dataUrlToFile(signature, 'assinatura.png'),
        );
      } else {
        await usersApi.changePassword({ currentPassword, newPassword });
      }
      await logout();
      router.replace(loginPath);
    } catch (cause) {
      setError(firstAccessErrorMessage(cause));
      setSubmitting(false);
    }
  }

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (step === 0 && requiresSignature) {
      if (passwordReady) {
        setError(null);
        setStep(1);
      }
      return;
    }
    if ((requiresSignature ? passwordReady && signatureReady : passwordReady) && !submitting)
      void finish();
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-[var(--color-background)] px-4 py-10">
      <div className={`w-full ${requiresSignature ? 'max-w-xl' : 'max-w-sm'}`}>
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            {step === 0 ? <ShieldCheck className="h-7 w-7" /> : <PenLine className="h-7 w-7" />}
          </div>
          <h1 className="text-page-title mt-4">
            {step === 0 ? 'Proteja seu acesso' : 'Cadastre sua assinatura técnica'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {step === 0
              ? 'Substitua a senha temporária por uma senha definitiva.'
              : 'Ela ficará disponível no cadastro oficial para seleção nos relatórios.'}
          </p>
          {requiresSignature && (
            <div className="mt-4 flex w-full gap-2" aria-label="Progresso do primeiro acesso">
              <div className={`h-1.5 flex-1 rounded-full ${step >= 0 ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted)]'}`} />
              <div className={`h-1.5 flex-1 rounded-full ${step === 1 ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-muted)]'}`} />
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-card)]">
          {error && <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
          {step === 0 ? (
            <>
              <PwInput label="Senha temporária" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
              <div><PwInput label="Nova senha" value={newPassword} onChange={setNewPassword} autoComplete="new-password" /><p className={`mt-1 text-[11px] ${tooShort ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted-foreground)]'}`}>Mínimo de 12 caracteres.</p></div>
              <div><PwInput label="Confirmar nova senha" value={confirm} onChange={setConfirm} autoComplete="new-password" />{mismatch && <p className="mt-1 text-[11px] text-[var(--color-danger)]">As senhas não coincidem.</p>}</div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cargo no documento" required value={title} onChange={setTitle} placeholder="Ex.: Técnico de Refrigeração" />
                <Field label="Profissão" value={profession} onChange={setProfession} placeholder="Ex.: Técnico em Climatização" />
                <Field label="Conselho profissional" value={professionalCouncil} onChange={setProfessionalCouncil} placeholder="Ex.: CREA, CFT" />
                <Field label="Número do registro" value={registrationNumber} onChange={setRegistrationNumber} placeholder="Registro profissional" />
                <div className="sm:col-span-2"><Field label="Departamento" value={department} onChange={setDepartment} placeholder="Ex.: Operações de Campo" /></div>
              </div>
              <div className="space-y-2"><div><span className="text-sm font-medium">Assinatura *</span><p className="text-[11px] text-[var(--color-muted-foreground)]">Desenhe e pressione “Confirmar assinatura”.</p></div><SignaturePad onChange={(value) => { if (!value) setSignature(null); }} onConfirm={setSignature} /></div>
            </>
          )}
          <div className="flex gap-2">
            {step === 1 && <button type="button" className="btn-secondary" onClick={() => setStep(0)}><ArrowLeft className="h-4 w-4" />Voltar</button>}
            <button type="submit" disabled={step === 0 ? !passwordReady : !signatureReady || submitting} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-hover)] disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : step === 0 && requiresSignature ? <ArrowRight className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {step === 0 && requiresSignature ? 'Continuar' : 'Concluir primeiro acesso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Mensagem para o usuário: códigos conhecidos têm texto próprio; erro da API
 * sem mapeamento mostra a mensagem da própria API (com o id da requisição);
 * falha antes de chegar à API (rede, navegador) é registrada no console para
 * diagnóstico — a API não tem como logar o que nunca recebeu.
 */
function firstAccessErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError) {
    const known = ERROR_MESSAGES[cause.code];
    if (known) return known;
    const reference = cause.requestId ? ` (ref. ${cause.requestId})` : '';
    return `${cause.message || 'Não foi possível concluir o primeiro acesso.'}${reference}`;
  }
  if (cause instanceof Error && cause.message === 'SIGNATURE_REQUIRED') {
    return ERROR_MESSAGES.SIGNATURE_IMAGE_REQUIRED;
  }
  console.error('[primeiro acesso] falha antes de chegar à API', cause);
  if (cause instanceof TypeError) {
    return 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
  }
  return 'Não foi possível concluir o primeiro acesso.';
}

function PwInput({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span><input type="password" required autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} placeholder="••••••••••••" className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--color-primary)]" /></label>;
}

function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}{required ? ' *' : ''}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--color-primary)]" /></label>;
}
