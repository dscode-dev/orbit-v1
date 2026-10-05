'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PenLine, Save } from 'lucide-react';
import { signaturesApi, useQuery, type Signature } from '@erp/api';
import { SignaturePad } from '@erp/ui/documents/signature-pad';
import { dataUrlToFile } from '@erp/utils';

const inputClass = 'h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--color-primary)]';

export function OperatorSignatureChoice({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (signatureId: string | null) => void;
}) {
  const signature = useQuery((signal) => signaturesApi.getMySignature({ signal }), []);

  useEffect(() => {
    if (signature.data?.active && signature.data.hasImage && !selectedId) onSelect(signature.data.id);
  }, [onSelect, selectedId, signature.data]);

  if (signature.loading && signature.data === undefined) {
    return <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" />Carregando sua assinatura técnica…</div>;
  }
  if (!signature.data?.active || !signature.data.hasImage) {
    return (
      <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4">
        <div className="flex items-start gap-2"><PenLine className="mt-0.5 h-5 w-5 text-[var(--color-warning)]" /><div><strong className="text-sm">Assinatura técnica não configurada</strong><p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Cadastre sua assinatura nas configurações do aplicativo para concluir OS e Visita Técnica.</p></div></div>
        <Link href="/operator/profile#assinatura-tecnica" className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]">Configurar minha assinatura</Link>
      </div>
    );
  }

  const selected = selectedId === signature.data.id;
  return (
    <button type="button" onClick={() => onSelect(selected ? null : signature.data!.id)} className={`w-full rounded-[var(--radius-lg)] border p-4 text-left transition ${selected ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] bg-[var(--color-card)]'}`}>
      <div className="mb-3 flex items-center justify-between gap-3"><div><span className="text-caption uppercase tracking-wider">Responsável técnico</span><strong className="block text-sm">Usar minha assinatura nesta atividade</strong></div>{selected ? <CheckCircle2 className="h-5 w-5 text-[var(--color-primary)]" /> : <span className="h-5 w-5 rounded-full border border-[var(--color-border)]" />}</div>
      <SignatureIdentity signature={signature.data} />
    </button>
  );
}

export function OperatorSignatureSettings() {
  const signature = useQuery((signal) => signaturesApi.getMySignature({ signal }), []);
  const [title, setTitle] = useState('Técnico');
  const [profession, setProfession] = useState('');
  const [professionalCouncil, setProfessionalCouncil] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [drawing, setDrawing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signature.data) return;
    setTitle(signature.data.title || 'Técnico');
    setProfession(signature.data.profession ?? '');
    setProfessionalCouncil(signature.data.professionalCouncil ?? '');
    setRegistrationNumber(signature.data.registrationNumber ?? '');
    setDepartment(signature.data.department ?? '');
  }, [signature.data]);

  async function save() {
    if (!title.trim()) return setError('Informe o cargo ou função técnica.');
    if (!signature.data?.hasImage && !drawing) return setError('Desenhe e confirme sua assinatura.');
    setSaving(true); setError(null); setFeedback(null);
    try {
      await signaturesApi.saveMySignature(
        { title: title.trim(), profession: profession.trim() || undefined, professionalCouncil: professionalCouncil.trim() || undefined, registrationNumber: registrationNumber.trim() || undefined, department: department.trim() || undefined },
        drawing ? dataUrlToFile(drawing, 'assinatura.png') : undefined,
      );
      setDrawing(null);
      setFeedback('Assinatura técnica salva. Ela será pré-selecionada nas suas próximas OS e Visitas Técnicas.');
      signature.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar sua assinatura.');
    } finally { setSaving(false); }
  }

  return (
    <section id="assinatura-tecnica" className="scroll-mt-20 space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
      <div><div className="flex items-center gap-2 text-caption uppercase tracking-wider"><PenLine className="h-3.5 w-3.5" /> Minha assinatura técnica</div><p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Utilizada somente nas OS e Visitas Técnicas executadas por você.</p></div>
      {signature.data?.hasImage && <SignatureIdentity signature={signature.data} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cargo ou função *" value={title} onChange={setTitle} placeholder="Ex.: Técnico de manutenção" />
        <Field label="Profissão" value={profession} onChange={setProfession} placeholder="Ex.: Técnico em refrigeração" />
        <Field label="Conselho profissional" value={professionalCouncil} onChange={setProfessionalCouncil} placeholder="Ex.: CREA-PE" />
        <Field label="Registro" value={registrationNumber} onChange={setRegistrationNumber} placeholder="Número do registro" />
        <Field label="Departamento" value={department} onChange={setDepartment} placeholder="Ex.: Operações" />
      </div>
      <div className="space-y-2"><span className="text-sm font-medium">{signature.data?.hasImage ? 'Substituir desenho da assinatura' : 'Desenho da assinatura *'}</span><SignaturePad onChange={(value) => { if (!value) setDrawing(null); }} onConfirm={setDrawing} /></div>
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {feedback && <p className="text-sm text-[var(--color-success)]">{feedback}</p>}
      <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar assinatura técnica</button>
    </section>
  );
}

function SignatureIdentity({ signature }: { signature: Signature }) {
  const image = useQuery((signal) => signaturesApi.downloadMySignatureImage({ signal }), [signature.id, signature.updatedAt]);
  const source = image.data ? `data:${image.data.mimeType};base64,${image.data.contentBase64}` : null;
  return <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] p-3 sm:grid-cols-[130px_1fr] sm:items-center"><div className="grid min-h-20 place-items-center rounded bg-white p-2">{source ? <Image unoptimized src={source} width={130} height={70} alt={`Assinatura de ${signature.name}`} className="max-h-16 max-w-full object-contain" /> : <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />}</div><div><strong className="text-sm">{signature.name}</strong><span className="block text-xs text-[var(--color-muted-foreground)]">{[signature.profession, signature.title, signature.professionalCouncil, signature.registrationNumber, signature.department].filter(Boolean).join(' · ')}</span></div></div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="space-y-1"><span className="text-sm font-medium">{label}</span><input className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

