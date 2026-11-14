'use client';
import { useState } from 'react';
import { FileText, Loader2, Save, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@erp/ui/confirm-dialog';
import type { FieldDraftSummary } from '@operator/lib/field-drafts';

export function SaveFieldDraft({ onSave, disabled, busy, error, restored }: {
  onSave: () => void; disabled?: boolean; busy: boolean; error: string | null; restored: boolean;
}) {
  return <div className="border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 space-y-1">
    <button type="button" onClick={onSave} disabled={disabled || busy} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--color-primary)] disabled:opacity-50">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{busy ? 'Salvando rascunho…' : 'Salvar rascunho e sair'}
    </button>
    <p className="text-[11px] text-[var(--color-muted-foreground)]">{restored ? 'Rascunho recuperado. Salve novamente para guardar novas alterações.' : 'Salvo somente ao clicar, neste aparelho e para o seu usuário.'}</p>
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
  </div>;
}
export function FieldDraftPicker({ drafts, busy, error, onResume, onNew, onBack, onDelete }: {
  drafts: FieldDraftSummary[]; busy: boolean; error: string | null;
  onResume: (draft: FieldDraftSummary) => void; onNew: () => void; onBack: () => void;
  onDelete: (draft: FieldDraftSummary) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<FieldDraftSummary | null>(null);
  return <div className="min-h-dvh space-y-4 px-4 py-5">
    <button type="button" onClick={onBack} disabled={busy} className="btn-secondary">Voltar</button>
    <h1 className="text-xl font-semibold">Continuar um rascunho?</h1>
    <p className="text-sm text-[var(--color-muted-foreground)]">Estes são os rascunhos do seu usuário salvos neste aparelho.</p>
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    <button type="button" onClick={onNew} disabled={busy} className="btn-primary min-h-12 w-full">Iniciar novo atendimento</button>
    <ul className="space-y-3">{drafts.map((draft) => <li key={draft.id} className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
      <button type="button" disabled={busy} onClick={() => onResume(draft)} className="min-w-0 flex-1 space-y-1 text-left">
        <span className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4 shrink-0" />{draft.customerName || 'Cliente não informado'}</span>
        <span className="block text-caption">Etapa {draft.step + 1} · {new Date(draft.savedAt).toLocaleString('pt-BR')}</span>
      </button>
      <button type="button" onClick={() => setDeleting(draft)} disabled={busy} aria-label={`Excluir rascunho de ${draft.customerName}`} className="grid h-11 w-11 shrink-0 place-items-center text-[var(--color-danger)]"><Trash2 className="h-4 w-4" /></button>
    </li>)}</ul>
    <ConfirmDialog open={Boolean(deleting)} title="Excluir rascunho?" description="Os dados ainda não enviados deste rascunho serão removidos deste aparelho." danger confirmLabel="Excluir rascunho" onClose={() => setDeleting(null)} onConfirm={async () => { if (deleting) await onDelete(deleting); }} />
  </div>;
}
