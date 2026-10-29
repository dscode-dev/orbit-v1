'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Download, FileText, Loader2, Share2 } from 'lucide-react';
import { budgetsApi, type Budget } from '@erp/api';
import { formatCurrencyBRL } from '@erp/utils';
import { BudgetWizardDrawer } from '@platform/components/budget-wizard-drawer';
import { ConfirmDialog } from '@erp/ui/confirm-dialog';
import { renderOperatorBudget, confirmOperatorBudgetAcceptance } from '@operator/lib/budget';

const primary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50';
const secondary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50';

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function OperatorBudgetWizard({ initialBudgetId }: { initialBudgetId?: string }) {
  const router = useRouter();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [editing, setEditing] = useState(!initialBudgetId);
  const [loading, setLoading] = useState(Boolean(initialBudgetId));
  const [confirming, setConfirming] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'approval' | 'pdf' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const working = useRef(false);
  const number = budget ? `ORC-${String(budget.number).padStart(6, '0')}` : '';

  async function fetchPdf(saved: Budget) {
    setBusy('pdf');
    const download = await budgetsApi.downloadBudget(saved.id);
    setFile(new File([download.blob], download.filename ?? `ORC-${String(saved.number).padStart(6, '0')}.pdf`, { type: 'application/pdf' }));
  }

  async function finish(saved: Budget, acceptance = false) {
    if (working.current) return;
    working.current = true;
    setBusy(acceptance ? 'approval' : 'pdf');
    setError(null);
    setNotice(null);
    try {
      if (acceptance) await confirmOperatorBudgetAcceptance(saved.id, (approved) => {
        setBudget(approved);
        setFile(null);
        setRendered(false);
      });
      else await renderOperatorBudget(saved.id, setBudget);
      setRendered(true);
      await fetchPdf(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação. Tente novamente.');
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  async function retryDownload(saved: Budget) {
    if (working.current) return;
    working.current = true;
    setError(null);
    try {
      await fetchPdf(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o PDF.');
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  async function share() {
    if (!file || working.current) return;
    working.current = true;
    setBusy('share');
    setError(null);
    setNotice(null);
    try {
      // The file is already loaded. Invoke Web Share in the user's click, without awaiting a request.
      if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: number, text: `Orçamento ${number}` });
      } else {
        downloadFile(file);
        setNotice('PDF baixado. Compartilhe o arquivo pelo aplicativo de sua preferência.');
      }
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) {
        setError('Não foi possível compartilhar. Tente novamente ou baixe o PDF.');
      }
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!initialBudgetId) return;
    const controller = new AbortController();
    void budgetsApi.getBudget(initialBudgetId, { signal: controller.signal }).then(async (saved) => {
      if (controller.signal.aborted) return;
      setBudget(saved);
      if (saved.document?.renderedAt && saved.document.editorialStatus !== 'STALE') {
        setRendered(true);
        try {
          const pdf = await budgetsApi.downloadBudget(saved.id, { signal: controller.signal });
          if (!controller.signal.aborted) setFile(new File([pdf.blob], pdf.filename ?? `ORC-${String(saved.number).padStart(6, '0')}.pdf`, { type: 'application/pdf' }));
        } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o PDF.'); }
      }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o orçamento.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialBudgetId]);

  if (loading) return <div className="flex min-h-dvh items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Carregando orçamento…</div>;
  if (!editing && !budget) return <div className="space-y-4 p-4"><p role="alert">{error ?? 'Orçamento não encontrado.'}</p><button className={secondary} onClick={() => router.push('/operator/atendimento')}>Voltar aos atendimentos</button></div>;

  if (editing) return <BudgetWizardDrawer
    open
    budget={budget}
    presentation="page"
    allowDocumentGeneration
    onClose={() => router.push('/operator/atendimento')}
    onSaved={(saved, action) => {
      setBudget(saved);
      setEditing(false);
      setRendered(false);
      setFile(null);
      setError(null);
      setNotice(null);
      window.scrollTo({ top: 0 });
      window.history.replaceState(window.history.state, '', `/operator/orcamento?budgetId=${encodeURIComponent(saved.id)}`);
      if (action === 'generate') void finish(saved);
    }}
  />;

  if (!budget) return null;
  const approved = budget.status === 'APPROVED';
  const undecided = ['PENDING', 'DRAFT'].includes(budget.status);
  const expired = undecided && new Date(budget.expirationDate).getTime() < Date.now();
  const blocked = ['REJECTED', 'CANCELED'].includes(budget.status);
  return <div className="min-h-dvh space-y-5 px-4 py-6">
    <header className="space-y-3">
      {approved && <CheckCircle2 className="h-12 w-12 text-[var(--color-success)]" />}
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)]"><FileText className="h-4 w-4" />{number}</p>
      <h1 className="text-[22px] font-semibold">{approved ? 'Orçamento aprovado' : 'Orçamento pendente de aceite'}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{rendered ? 'O PDF oficial foi gerado. Baixe ou compartilhe a proposta com o cliente.' : approved ? 'A aprovação foi registrada. Gere o PDF para baixar ou compartilhar.' : 'Gere e apresente a proposta ao cliente. Confirme o aceite somente depois da aprovação do cliente.'}</p>
    </header>
    <dl className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 text-sm">
      <div><dt className="text-caption">Cliente</dt><dd className="font-medium">{budget.customer?.tradeName || budget.customer?.name}</dd></div>
      <div><dt className="text-caption">Proposta</dt><dd>{budget.title}</dd></div>
      <div className="flex items-center justify-between gap-3"><dt>Valor total</dt><dd className="text-lg font-semibold">{formatCurrencyBRL(Number(budget.total))}</dd></div>
    </dl>
    {error && <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
    {notice && <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 p-3 text-sm">{notice}</p>}
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{busy === 'approval' ? 'Registrando aceite e atualizando PDF…' : busy === 'pdf' ? 'Preparando PDF…' : 'Compartilhando…'}</p>}
    <div className="grid gap-2">
      {!rendered && !blocked && <button type="button" disabled={busy !== null} onClick={() => void finish(budget)} className={primary}>Gerar proposta PDF</button>}
      {rendered && !blocked && <>
        {!file && <button type="button" disabled={busy !== null} onClick={() => void retryDownload(budget)} className={primary}>Preparar PDF</button>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!file || busy !== null} onClick={() => void share()} className={primary}><Share2 className="h-4 w-4" />Compartilhar</button>
          <button type="button" disabled={!file || busy !== null} onClick={() => file && downloadFile(file)} className={secondary}><Download className="h-4 w-4" />Baixar PDF</button>
        </div>
      </>}
      {undecided && <button type="button" disabled={busy !== null} onClick={() => setEditing(true)} className={secondary}>Editar proposta</button>}
      {undecided && <button type="button" disabled={busy !== null || expired} onClick={() => setConfirming(true)} className={secondary}>Confirmar aceite do cliente</button>}
      {expired && <p className="text-sm text-[var(--color-danger)]">A proposta venceu. Revise a validade antes de confirmar o aceite.</p>}
      <button type="button" disabled={busy !== null} onClick={() => router.push('/operator/atendimento')} className={secondary}>Voltar aos atendimentos</button>
      <button type="button" disabled={busy !== null} onClick={() => router.push('/operator')} className={secondary}>Voltar ao início</button>
    </div>
    <ConfirmDialog open={confirming} title="Confirmar aceite do cliente?" description="Confirme somente se o cliente aprovou esta proposta. O orçamento será marcado como aprovado e o cliente avulso passará a fazer parte da base de clientes." confirmLabel="Sim, cliente aprovou" onClose={() => setConfirming(false)} onConfirm={async () => { setConfirming(false); await finish(budget, true); }} />
  </div>;
}
