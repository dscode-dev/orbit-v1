'use client';

import { useCapturedPhotos } from "@erp/ui/use-captured-photos";
import { useMemo, useState } from 'react';
import { CheckCircle2, FileText, Save, Send } from 'lucide-react';
import {
  documentsApi,
  equipmentsApi,
  operationApi,
  useQuery,
  type DocumentHandoff,
  type DocumentKind,
  type EquipmentSummary,
  type OperationDetail,
} from '@erp/api';
import { DOCUMENT_KIND_LABEL } from '@erp/types';
import { MultiSelect } from '@erp/ui/multi-select';
import { PhotoInput } from '@erp/ui/photo-input';
import { SignaturePad } from '@erp/ui/documents/signature-pad';

const FIELD_TYPES: DocumentKind[] = ['WORK_ORDER', 'TECHNICAL_REPORT', 'TECHNICAL_OPINION', 'BUDGET', 'PMOC'];
const SELF_SERVICE_TYPES = new Set<DocumentKind>(['WORK_ORDER', 'TECHNICAL_REPORT']);
const CUSTOMER_SIGNATURE = new Set<DocumentKind>(['WORK_ORDER', 'TECHNICAL_REPORT', 'BUDGET', 'PMOC']);
const input = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]';

export function FieldReportHandoff({ operation, onSaved }: { operation: OperationDetail; onSaved: () => void }) {
  const isPmoc = Boolean(operation.maintenanceExecution?.plan.pmocPlan);
  const managementAssigned = Boolean(operation.assignment && operation.assignment.assignedBy !== operation.assignment.assignedTo);
  const requestedType = isPmoc ? 'PMOC' : operation.requestedDocumentType ?? 'WORK_ORDER';
  const [type, setType] = useState<DocumentKind>(requestedType);
  const [issue, setIssue] = useState(operation.reportedIssue ?? '');
  const [diagnosis, setDiagnosis] = useState(operation.technicalDiagnosis ?? '');
  const [service, setService] = useState(operation.serviceDescription ?? '');
  const [recommendations, setRecommendations] = useState(operation.technicalRecommendations ?? '');
  const [observations, setObservations] = useState(operation.observations ?? '');
  const [equipmentIds, setEquipmentIds] = useState(operation.inspectedEquipments.map((item) => item.equipmentId));
  const [photos, setPhotos] = useCapturedPhotos();
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(operation.customerSignerName ?? '');
  const [signerRole, setSignerRole] = useState(operation.customerSignerRole ?? '');
  const [handoff, setHandoff] = useState<DocumentHandoff | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const equipments = useQuery(
    (signal) => equipmentsApi.listEquipments({ customerId: operation.customer?.id, page: 1, limit: 100, signal }),
    [operation.customer?.id],
  );
  const options = useMemo(() => (equipments.data?.items ?? []).map((item) => ({ value: item.id, label: equipmentLabel(item) })), [equipments.data]);


  async function persist(submit: boolean) {
    setBusy(submit ? 'submit' : 'save');
    setError(null);
    setFeedback(null);
    try {
      const equipmentMap = new Map((equipments.data?.items ?? []).map((item) => [item.id, item]));
      await operationApi.updateOperation(operation.id, {
        reportedIssue: issue,
        technicalDiagnosis: diagnosis,
        serviceDescription: service,
        technicalRecommendations: recommendations,
        observations,
        inspectedEquipments: equipmentIds.map((id) => {
          const equipment = equipmentMap.get(id);
          const existing = operation.inspectedEquipments.find((item) => item.equipmentId === id);
          return { equipmentId: id, sector: existing?.sector ?? equipment?.address?.name ?? equipment?.name ?? 'Não informado' };
        }),
        photos: await Promise.all(photos.map(async (photo) => ({ dataUrl: await fileToDataUrl(photo.file), caption: photo.caption || undefined }))),
      });
      let current = handoff ?? await documentsApi.saveHandoffDraft(operation.id, type);
      if (signature) {
        if (!signerName.trim()) throw new Error('Informe o nome de quem assinou.');
        current = await documentsApi.collectCustomerSignature(current.id, {
          signerName: signerName.trim(), signerRole: signerRole.trim() || undefined,
          signatureData: signature, collectedAt: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife',
        });
      }
      if (submit) current = await documentsApi.submitHandoff(current.id);
      setHandoff(current);
      setPhotos([]);
      setSignature(null);
      setFeedback(submit ? (current.workflowStatus === 'REVIEW' ? 'Atendimento devolvido para revisão da equipe responsável.' : 'Atendimento enviado como rascunho para aprovação da equipe responsável.') : 'Rascunho salvo. Você pode continuar depois.');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o relatório.');
    } finally {
      setBusy(null);
    }
  }

  const customerSignatureRequired = CUSTOMER_SIGNATURE.has(type);
  const canSubmit = equipmentIds.length > 0 && (isPmoc || !customerSignatureRequired || signature || operation.signatureCaptured || handoff?.customerSignature);

  return <section className="space-y-3">
    <div>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Preparar relatório para revisão</h2>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Colete os dados em campo. A emissão final será realizada pela Platform.</p>
    </div>
    <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <label className="space-y-1 text-sm"><span className="font-medium">Tipo do relatório</span><select className={input} value={type} onChange={(event) => { setType(event.target.value as DocumentKind); setHandoff(null); }} disabled={isPmoc || managementAssigned}>{FIELD_TYPES.filter((item) => isPmoc ? item === 'PMOC' : managementAssigned ? item === requestedType : SELF_SERVICE_TYPES.has(item)).map((item) => <option key={item} value={item}>{DOCUMENT_KIND_LABEL[item]}</option>)}</select>{managementAssigned && <span className="block text-xs text-[var(--color-muted-foreground)]">Definido pela gestão para este atendimento.</span>}</label>
      <div className="space-y-1 text-sm"><MultiSelect label="Equipamentos envolvidos" value={equipmentIds} onChange={setEquipmentIds} options={options} placeholder="Selecionar equipamentos" /></div>
      <TextArea label={type === 'TECHNICAL_REPORT' ? 'Motivo da visita' : type === 'TECHNICAL_OPINION' ? 'Contexto da inspeção' : type === 'BUDGET' ? 'Necessidade identificada' : 'Problema relatado'} value={issue} onChange={setIssue} />
      <TextArea label="Condições encontradas / diagnóstico" value={diagnosis} onChange={setDiagnosis} />
      <TextArea label={type === 'BUDGET' ? 'Serviços e peças sugeridos' : 'Atividades e verificações realizadas'} value={service} onChange={setService} />
      <TextArea label="Recomendações" value={recommendations} onChange={setRecommendations} />
      <TextArea label="Observações de campo" value={observations} onChange={setObservations} />
      {!isPmoc && <div className="space-y-2"><div className="text-sm font-medium">Evidências</div><PhotoInput photos={photos} onChange={setPhotos} max={16} existingCount={operation.photos.length} onProcessingChange={setPhotoProcessing} /></div>}
      {customerSignatureRequired && !isPmoc && <div className="space-y-3"><div className="text-sm font-medium">Assinatura do cliente</div><input className={input} value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Nome do signatário" /><input className={input} value={signerRole} onChange={(event) => setSignerRole(event.target.value)} placeholder="Função ou vínculo (opcional)" /><SignaturePad onChange={setSignature} onConfirm={setSignature} /></div>}
      {handoff && <div className="rounded-[var(--radius-md)] bg-[var(--color-muted)] p-3 text-sm"><strong>{handoff.editorialStatus === 'DRAFT' ? 'Rascunho' : handoff.editorialStatus === 'PENDING' ? 'Em revisão' : handoff.editorialStatus === 'READY' ? 'Pronto' : 'Atualização necessária'}</strong><span className="block text-xs text-[var(--color-muted-foreground)]">{handoff.number} · revisão {handoff.revision}</span></div>}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {feedback && <p className="flex items-center gap-1.5 text-sm text-[var(--color-success)]"><CheckCircle2 className="h-4 w-4" />{feedback}</p>}
      <div className="grid grid-cols-2 gap-2"><button className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium disabled:opacity-50" disabled={Boolean(busy) || photoProcessing} onClick={() => void persist(false)}><Save className="h-4 w-4" />{busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}</button><button className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50" disabled={Boolean(busy) || photoProcessing || !canSubmit} onClick={() => void persist(true)}><Send className="h-4 w-4" />{busy === 'submit' ? 'Enviando…' : 'Enviar para revisão'}</button></div>
      <p className="text-[11px] text-[var(--color-muted-foreground)]"><FileText className="mr-1 inline h-3.5 w-3.5" />Após o envio, alterações ficam rastreadas e o PDF continua sob responsabilidade da Platform.</p>
    </div>
  </section>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span><textarea className={`${input} min-h-20 resize-y`} value={value} onChange={(event) => onChange(event.target.value)} maxLength={20000} /></label>; }
function equipmentLabel(item: EquipmentSummary): string { return [item.name, item.tag].filter(Boolean).join(' · '); }
function fileToDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
