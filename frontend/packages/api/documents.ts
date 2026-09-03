/** Production Document Engine API. */
import { api } from "./client";
import type {
  DocumentBlueprint,
  DocumentConfiguration,
  DocumentDownloadResult,
  DocumentKind,
  OperationDocumentStatus,
  DocumentRenderResult,
  Paginated,
  DocumentHandoff,
  DocumentEditorialStatus,
  DocumentHandoffOrigin,
  DocumentRevision,
} from "@erp/types";

export type DocumentCatalogItem = {
  id: string; number: string; type: DocumentKind; status: OperationDocumentStatus;
  editorialStatus: DocumentEditorialStatus; handoffOrigin: DocumentHandoffOrigin;
  submittedAt: string | null; finalizedAt: string | null; revision: number;
  origin: "OPERATION" | "BUDGET"; originId: string | null;
  customer: { id: string; name: string } | null;
  equipment: { id: string; name: string; tag: string } | null;
  responsible: { id: string; name: string } | null;
  issuedAt: string; renderedAt: string | null; fileSize: number | null;
  version: string; createdAt: string; updatedAt: string;
};

export function listDocuments(params?: {
  page?: number; limit?: number; search?: string; type?: DocumentKind;
  status?: OperationDocumentStatus; customerId?: string; equipmentId?: string;
  editorialStatus?: DocumentEditorialStatus; includeDrafts?: boolean;
  operatorId?: string; from?: string; to?: string; signal?: AbortSignal;
}): Promise<Paginated<DocumentCatalogItem>> {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<DocumentCatalogItem>>("/documents", { query, signal });
}

export function previewOperationDocument(
  operationId: string,
  type: DocumentKind,
  opts?: { signal?: AbortSignal },
): Promise<DocumentBlueprint> {
  return api.get<DocumentBlueprint>(`/documents/operations/${operationId}/${type}/preview`, opts);
}

export function renderOperationDocument(
  operationId: string,
  type: DocumentKind,
): Promise<DocumentRenderResult> {
  return api.post<DocumentRenderResult>(`/documents/operations/${operationId}/${type}/render`);
}

export function previewDocument(documentId: string, opts?: { signal?: AbortSignal }): Promise<DocumentBlueprint> {
  return api.get<DocumentBlueprint>(`/documents/${documentId}/preview`, opts);
}

export function previewTemplateDocument(templateId: string, opts?: { signal?: AbortSignal }): Promise<DocumentBlueprint> {
  return api.get<DocumentBlueprint>(`/documents/templates/${templateId}/preview`, opts);
}

export function renderDocument(documentId: string): Promise<DocumentRenderResult> {
  return api.post<DocumentRenderResult>(`/documents/${documentId}/render`);
}

export function downloadDocument(documentId: string, opts?: { signal?: AbortSignal }): Promise<DocumentDownloadResult> {
  return api.blob(`/documents/${documentId}/download`, opts);
}

export function exportDocumentsPdf(params?: {
  search?: string;
  customerId?: string;
  equipmentId?: string;
  operatorId?: string;
  customer?: string;
  equipment?: string;
  operator?: string;
  type?: DocumentKind;
  status?: OperationDocumentStatus;
  from?: string;
  to?: string;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; filename: string | null }> {
  const { signal, ...query } = params ?? {};
  return api.blob("/documents/export", { query, signal });
}

export function listConfiguration(opts?: { signal?: AbortSignal }): Promise<DocumentConfiguration[]> {
  return api.get<DocumentConfiguration[]>("/documents/configuration", opts);
}

export function getConfigurationByType(
  type: DocumentKind,
  opts?: { signal?: AbortSignal },
): Promise<DocumentConfiguration> {
  return api.get<DocumentConfiguration>(`/documents/configuration/types/${type}`, opts);
}

export function getConfigurationByTemplate(
  templateId: string,
  opts?: { signal?: AbortSignal },
): Promise<DocumentConfiguration> {
  return api.get<DocumentConfiguration>(`/documents/configuration/templates/${templateId}`, opts);
}

export function listHandoffs(params?: {
  page?: number; limit?: number; search?: string; status?: DocumentEditorialStatus;
  type?: DocumentKind; origin?: DocumentHandoffOrigin; customerId?: string;
  operatorId?: string; from?: string; to?: string; missingCustomerSignature?: boolean;
  missingTechnicalSignature?: boolean; missingEvidence?: boolean; signal?: AbortSignal;
}): Promise<Paginated<DocumentHandoff>> {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<DocumentHandoff>>('/documents/handoffs', { query, signal });
}

export function saveHandoffDraft(operationId: string, type: DocumentKind): Promise<DocumentHandoff> {
  return api.post<DocumentHandoff>('/documents/handoffs', { operationId, type });
}

export function getHandoff(documentId: string, opts?: { signal?: AbortSignal }): Promise<DocumentHandoff> {
  return api.get<DocumentHandoff>(`/documents/${documentId}/handoff`, opts);
}

export function collectCustomerSignature(documentId: string, payload: {
  signerName: string; signerRole?: string; signatureData: string; collectedAt?: string; timezone: string;
}): Promise<DocumentHandoff> {
  return api.patch<DocumentHandoff>(`/documents/${documentId}/handoff/customer-signature`, payload);
}

export function getCustomerSignatureImage(
  documentId: string,
  opts?: { signal?: AbortSignal },
): Promise<DocumentDownloadResult> {
  return api.blob(`/documents/${documentId}/handoff/customer-signature`, opts);
}

export function submitHandoff(documentId: string): Promise<DocumentHandoff> {
  return api.post<DocumentHandoff>(`/documents/${documentId}/handoff/submit`);
}

export function startHandoffReview(documentId: string): Promise<DocumentHandoff> {
  return api.post<DocumentHandoff>(`/documents/${documentId}/handoff/review`);
}

export function selectHandoffTechnicalSignature(documentId: string, signatureId: string): Promise<DocumentHandoff> {
  return api.patch<DocumentHandoff>(`/documents/${documentId}/handoff/technical-signature`, { signatureId });
}

/** Owner/Manager oculta (ou reexibe) a assinatura do cliente neste documento. */
export function setCustomerSignatureVisibility(documentId: string, hidden: boolean): Promise<DocumentHandoff> {
  return api.patch<DocumentHandoff>(`/documents/${documentId}/handoff/customer-signature-visibility`, { hidden });
}

export function finalizeHandoffReview(documentId: string): Promise<DocumentHandoff> {
  return api.post<DocumentHandoff>(`/documents/${documentId}/handoff/finalize`, { confirm: true });
}

export function getHandoffHistory(documentId: string, opts?: { signal?: AbortSignal }): Promise<DocumentRevision[]> {
  return api.get<DocumentRevision[]>(`/documents/${documentId}/handoff/history`, opts);
}
