/** Organization, settings, templates and brand assets. */
import { api } from "./client";
import type {
  AssetWithContent,
  CreateOrganizationContactPayload,
  BrandAsset,
  BrandAssetType,
  CreateDocumentTemplatePayload,
  DocumentTemplate,
  Organization,
  OrganizationContact,
  OrganizationSettings,
  PublicCompanyProfile,
  UpdateDocumentTemplatePayload,
  UpdateOrganizationContactPayload,
  UpdateOrganizationPayload,
  UpdateOrganizationSettingsPayload,
} from "@erp/types";

export function getOrganization(opts?: { signal?: AbortSignal }): Promise<Organization> {
  return api.get<Organization>("/organization", opts);
}

/** Vitrine pública (landing page) — endpoint sem autenticação. */
export function getPublicCompany(opts?: { signal?: AbortSignal }): Promise<PublicCompanyProfile> {
  return api.get<PublicCompanyProfile>("/organization/public", { auth: false, ...opts });
}

export function updateOrganization(payload: UpdateOrganizationPayload): Promise<Organization> {
  return api.patch<Organization>("/organization", payload);
}

/* ---------- Contacts (até dois aparecem na landing) ---------- */

export function listContacts(opts?: { signal?: AbortSignal }): Promise<OrganizationContact[]> {
  return api.get<OrganizationContact[]>("/organization/contacts", opts);
}

export function createContact(payload: CreateOrganizationContactPayload): Promise<OrganizationContact> {
  return api.post<OrganizationContact>("/organization/contacts", payload);
}

export function updateContact(
  id: string,
  payload: UpdateOrganizationContactPayload,
): Promise<OrganizationContact> {
  return api.patch<OrganizationContact>(`/organization/contacts/${id}`, payload);
}

export function deleteContact(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/organization/contacts/${id}`);
}

/* ---------- Settings ---------- */

export function getOrganizationSettings(opts?: { signal?: AbortSignal }): Promise<OrganizationSettings> {
  return api.get<OrganizationSettings>("/organization/settings", opts);
}

export function updateOrganizationSettings(
  payload: UpdateOrganizationSettingsPayload,
): Promise<OrganizationSettings> {
  return api.patch<OrganizationSettings>("/organization/settings", payload);
}

/* ---------- Document templates ---------- */

export function listTemplates(opts?: { signal?: AbortSignal }): Promise<DocumentTemplate[]> {
  return api.get<DocumentTemplate[]>("/organization/templates", opts);
}

export function createTemplate(payload: CreateDocumentTemplatePayload): Promise<DocumentTemplate> {
  return api.post<DocumentTemplate>("/organization/templates", payload);
}

export function updateTemplate(
  id: string,
  payload: UpdateDocumentTemplatePayload,
): Promise<DocumentTemplate> {
  return api.patch<DocumentTemplate>(`/organization/templates/${id}`, payload);
}

export function deleteTemplate(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/organization/templates/${id}`);
}

/* ---------- Brand assets (logo / header / footer) ---------- */

export function getAsset(assetId: string): Promise<AssetWithContent> {
  return api.get<AssetWithContent>(`/organization/assets/${assetId}`);
}

export function uploadAsset(type: BrandAssetType, file: File): Promise<BrandAsset> {
  const form = new FormData();
  form.append("type", type);
  form.append("file", file);
  return api.upload<BrandAsset>("/organization/assets", form);
}

export function deleteAsset(assetId: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/organization/assets/${assetId}`);
}
