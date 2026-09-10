/**
 * Operation domain — production API (no mocks).
 *
 * An Operation is the central field-service record reused by every produced
 * document (OS, PMOC, Laudo, Relatório, Orçamento, Recibo). Creating one also
 * generates a Work Order (OS) in DRAFT on the backend.
 *
 */
import { api } from './client';
import type {
  CreateOperationPayload,
  OperationDetail,
  OperationCancellation,
  OperationStats,
  OperationSummary,
  OperationStatus,
  OperationType,
  Paginated,
} from '@erp/types';

export type OperationPhotoContent = {
  id: string;
  caption: string | null;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  createdBy: { id: string; name: string; role: string } | null;
  contentBase64: string;
};

export type FieldEquipmentDraft = {
  equipmentTypeCatalogId: string;
  sector?: string;
  tag?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  capacity?: string;
  voltage?: string;
  observations?: string;
};

export function listOperations(params?: {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  equipmentId?: string;
  operatorId?: string;
  type?: OperationType;
  status?: OperationStatus;
  signal?: AbortSignal;
}): Promise<Paginated<OperationSummary>> {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<OperationSummary>>('/operations', { query, signal });
}

export function exportOperationsPdf(params?: {
  search?: string;
  customerId?: string;
  equipmentId?: string;
  operatorId?: string;
  type?: OperationType;
  status?: OperationStatus;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; filename: string | null }> {
  const { signal, ...query } = params ?? {};
  return api.blob('/operations/export', { query, signal });
}

export function getOperationStats(opts?: {
  customerId?: string;
  signal?: AbortSignal;
}): Promise<OperationStats> {
  const { signal, ...query } = opts ?? {};
  return api.get<OperationStats>('/operations/stats', { query, signal });
}

export function getOperation(
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<OperationDetail> {
  return api.get<OperationDetail>(`/operations/${id}`, opts);
}

export function createOperation(payload: CreateOperationPayload): Promise<OperationDetail> {
  return api.post<OperationDetail>('/operations', payload);
}

export function updateOperation(
  id: string,
  payload: Partial<
    Pick<
      CreateOperationPayload,
      | 'customerId'
      | 'addressId'
      | 'equipmentId'
      | 'type'
      | 'serviceTypes'
      | 'status'
      | 'scheduledFor'
      | 'auxiliaryOperatorIds'
      | 'startedAt'
      | 'completedAt'
      | 'checklist'
      | 'observations'
      | 'reportedIssue'
      | 'serviceDescription'
      | 'maintenanceReminderIntervalMonths'
      | 'receiptNumber'
      | 'receiptIssuedAt'
      | 'receiptAmount'
      | 'receiptAmountInWords'
      | 'receiptService'
      | 'receiptDescription'
      | 'receiptWarrantyDays'
      | 'receiptDeclaration'
      | 'technicalDiagnosis'
      | 'technicalRecommendations'
      | 'technicalOpinionObjective'
      | 'technicalOpinionObjectiveItems'
      | 'technicalOpinionConditions'
      | 'technicalOpinionAnalysis'
      | 'technicalOpinionConclusion'
      | 'technicalOpinionConclusionItems'
      | 'technicalOpinionRecommendations'
      | 'technicalOpinionResponsible'
      | 'technicalOpinionCrea'
      | 'referenceMonth'
      | 'referenceYear'
      | 'maintenanceType'
      | 'maintenanceChecklist'
      | 'inspectedEquipments'
      | 'signatureData'
      | 'customerSignerName'
      | 'customerSignerRole'
      | 'signedAt'
      | 'photos'
    >
  > & { serviceValue?: number | null },
): Promise<OperationDetail> {
  return api.patch<OperationDetail>(`/operations/${id}`, payload);
}

export function deleteOperation(id: string): Promise<{ deleted: true }> {
  return api.delete<{ deleted: true }>(`/operations/${id}`);
}

export function cancelOperation(id: string): Promise<OperationDetail> {
  return api.patch<OperationDetail>(`/operations/${id}/cancel`, {});
}

export function reactivateOperation(id: string): Promise<OperationDetail> {
  return api.patch<OperationDetail>(`/operations/${id}/reactivate`, {});
}

export function addFieldEquipments(
  id: string,
  payload: { existingEquipmentIds?: string[]; newEquipments?: FieldEquipmentDraft[] },
): Promise<OperationDetail> {
  return api.post<OperationDetail>(`/operations/${id}/equipments`, payload);
}

/** Technical-responsible approval: REVIEW → COMPLETED (OWNER/MANAGER). */
export function approveOperation(id: string): Promise<OperationDetail> {
  return api.patch<OperationDetail>(`/operations/${id}/approve`);
}

export function requestOperationCancellation(id: string, payload: {
  reason: string;
  technicalSignatureId: string;
  customerSignatureData?: string;
  customerSignerName?: string;
  customerSignerRole?: string;
  customerSignedAt?: string;
  photos?: Array<{ dataUrl: string; caption?: string | null }>;
}): Promise<OperationCancellation> {
  return api.post<OperationCancellation>(`/operations/${id}/cancellation`, payload);
}

export function rescheduleCanceledOperation(id: string, payload: {
  assignedTo: string;
  scheduledFor: string;
  notes?: string;
}): Promise<OperationCancellation> {
  return api.patch<OperationCancellation>(`/operations/${id}/cancellation/reschedule`, payload);
}

export function approveOperationCancellation(id: string, notes?: string): Promise<OperationCancellation> {
  return api.patch<OperationCancellation>(`/operations/${id}/cancellation/approve`, { notes });
}

export function getOperationPhoto(
  photoId: string,
  opts?: { signal?: AbortSignal },
): Promise<OperationPhotoContent> {
  return api.get<OperationPhotoContent>(`/operations/photos/${photoId}`, opts);
}

export function updateOperationPhoto(photoId: string, caption: string): Promise<OperationDetail> {
  return api.patch<OperationDetail>(`/operations/photos/${photoId}`, { caption });
}

export function deleteOperationPhoto(photoId: string): Promise<OperationDetail> {
  return api.delete<OperationDetail>(`/operations/photos/${photoId}`);
}
