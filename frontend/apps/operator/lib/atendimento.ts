/**
 * Atendimento (field service) draft model + submission.
 *
 * Finalizing the wizard now creates a real Operation in the backend (the central
 * operational domain), which also generates a Work Order (OS) draft. Reading data
 * (clients, equipments) and writing the Operation both use the production API.
 */
import { assignmentsApi, documentsApi, operationApi, rvtApi } from '@erp/api';
import type {
  CreateOperationPayload,
  FieldEquipmentDraft,
  DocumentHandoff,
  DocumentKind,
  OperationDetail,
  OperationMaintenanceChecklistItem,
  OperationMaintenanceType,
} from '@erp/api';
import type { CapturedPhoto } from '@erp/ui/photo-input';
import type { ServiceTypeKey } from './service-types';

export type AtendimentoDraft = {
  documentType: DocumentKind;
  newEquipments?: FieldEquipmentDraft[];
  customerId: string | null;
  addressId: string | null;
  equipmentId: string | null;
  inspectedEquipments: Array<{
    equipmentId: string;
    sector: string;
    manufacturer?: string;
    model?: string;
    capacity?: string;
  }>;
  /** ServiceTypeKey maps 1:1 to the backend OperationType. */
  serviceType: ServiceTypeKey | null;
  checklist: { catalogId?: string; label: string; done: boolean; note?: string }[];
  maintenanceType: OperationMaintenanceType;
  maintenanceChecklist: OperationMaintenanceChecklistItem[];
  reportedIssue: string;
  serviceDescription: string;
  observations: string;
  objective: string[];
  conditions: string[];
  recommendations: string[];
  conclusion: string[];
  photos: CapturedPhoto[];
  signature: string | null;
  /** Quem assinou pelo cliente — obrigatório quando há assinatura. */
  signerName: string;
  signerRole: string;
  signedAt: string | null;
  technicalSignatureId: string | null;
  startedAt: string | null;
};

export type AtendimentoSubmission = {
  operation: OperationDetail;
  handoff: DocumentHandoff;
};

/** Read a captured File into a data URL for the create payload. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read error'));
    reader.readAsDataURL(file);
  });
}

/** Find the generated Work Order number on a created operation, if any. */
export function workOrderNumber(operation: OperationDetail): string | null {
  return operation.documents.find((d) => d.type === 'WORK_ORDER')?.number ?? null;
}

export async function createOperationFromDraft(
  draft: AtendimentoDraft,
  options: { operationId?: string | null; onCreated?: (operationId: string) => void } = {},
): Promise<AtendimentoSubmission> {
  if (!draft.customerId) throw new Error('Cliente é obrigatório');
  if (!draft.serviceType) throw new Error('Tipo de atendimento é obrigatório');
  if (draft.documentType !== 'WORK_ORDER' && draft.documentType !== 'TECHNICAL_REPORT') {
    throw new Error('O operador pode iniciar somente Ordem de Serviço ou Relatório de Visita Técnica.');
  }
  if (draft.documentType === 'WORK_ORDER' && (!draft.signature || !draft.signerName.trim())) {
    throw new Error('A assinatura e o nome do cliente/responsável são obrigatórios.');
  }
  if (draft.signature && !draft.signerName.trim()) throw new Error('Informe o nome de quem assinou.');
  if (!draft.technicalSignatureId) throw new Error('Selecione sua assinatura técnica para esta atividade.');

  const photos = await Promise.all(
    draft.photos.map(async (p) => ({ dataUrl: await fileToDataUrl(p.file), caption: p.name })),
  );

  const now = draft.signature ? draft.signedAt ?? new Date().toISOString() : null;
  const payload: CreateOperationPayload = {
    customerId: draft.customerId,
    addressId: draft.addressId,
    equipmentId: draft.equipmentId,
    inspectedEquipments: draft.inspectedEquipments,
    newEquipments: draft.newEquipments,
    type: draft.serviceType,
    documentType: draft.documentType,
    status: 'DRAFT',
    // catalogId pertence somente ao seletor do frontend. O contrato oficial da
    // Operation persiste o snapshot textual e o estado realizado do item.
    checklist: draft.checklist.map(({ label, done, note }) => ({ label, done, note })),
    maintenanceType: draft.documentType === 'TECHNICAL_REPORT' ? draft.maintenanceType : null,
    maintenanceChecklist:
      draft.documentType === 'TECHNICAL_REPORT' ? draft.maintenanceChecklist : [],
    reportedIssue: draft.reportedIssue.trim() || null,
    serviceDescription: draft.serviceDescription.trim() || null,
    observations: draft.observations.trim() || null,
    technicalRecommendations:
      draft.documentType === 'TECHNICAL_REPORT'
        ? draft.recommendations.join('\n').trim() || null
        : null,
    technicalOpinionObjective: draft.objective.join('\n') || null,
    technicalOpinionConditions: draft.conditions.join('\n') || null,
    technicalOpinionRecommendations: draft.recommendations.join('\n') || null,
    technicalOpinionConclusion: draft.conclusion.join('\n') || null,
    signatureData: draft.signature,
    customerSignerName: draft.signature ? draft.signerName.trim() : null,
    customerSignerRole: draft.signerRole.trim() || null,
    signedAt: now,
    photos,
  };

  const created = options.operationId
    ? await operationApi.getOperation(options.operationId)
    : await operationApi.createOperation(payload);
  options.onCreated?.(created.id);
  const assignments = await assignmentsApi.listMyAssignments({ operationId: created.id, limit: 1 });
  const assignment = assignments.items[0];
  if (!assignment) throw new Error('O atendimento foi criado, mas sua execução não foi localizada.');

  // Self-service continua passando pelo Assignment oficial, mas OS/RVT são
  // concluídos diretamente em campo e não entram em uma fila editorial.
  if (assignment.status === 'ASSIGNED') await assignmentsApi.acceptAssignment(assignment.id);
  if (assignment.status === 'ASSIGNED' || assignment.status === 'ACCEPTED') await assignmentsApi.startAssignment(assignment.id);

  const existingDocument = created.documents.find((document) => document.type === draft.documentType);
  let draftDocument: DocumentHandoff;
  if (assignment.status === 'COMPLETED' && existingDocument) {
    draftDocument = await documentsApi.getHandoff(existingDocument.id);
  } else {
    draftDocument = await documentsApi.saveHandoffDraft(created.id, draft.documentType);
    draftDocument = await documentsApi.selectHandoffTechnicalSignature(
      draftDocument.id,
      draft.technicalSignatureId,
    );
    // Registro oficial da assinatura no documento (nome/função/quando/por quem),
    // usado pelo Preview e pelo PDF a partir do mesmo DocumentContext.
    if (draft.signature && now) {
      draftDocument = await documentsApi.collectCustomerSignature(draftDocument.id, {
        signerName: draft.signerName.trim(),
        signerRole: draft.signerRole.trim() || undefined,
        signatureData: draft.signature,
        collectedAt: now,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife',
      });
    }
    await documentsApi.submitHandoff(draftDocument.id);
    await assignmentsApi.completeAssignment(assignment.id, 'Atendimento iniciado e executado pelo operador.');
  }
  const handoff = await documentsApi.finalizeHandoffReview(draftDocument.id);
  await documentsApi.renderDocument(draftDocument.id);
  if (draft.documentType === 'TECHNICAL_REPORT') await rvtApi.registerAdHoc(created.id);
  const operation = await operationApi.getOperation(created.id);
  return { operation, handoff };
}
