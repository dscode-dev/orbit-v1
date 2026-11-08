/** Customer domain — production API (no mocks). */
import { api } from "./client";
import type {
  AssetWithContent,
  CreateCustomerPayload,
  Customer,
  CustomerAddress,
  CustomerContact,
  CustomerDetail,
  CustomerStats,
  Paginated,
} from "@erp/types";

export function listCustomers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  signal?: AbortSignal;
}): Promise<Paginated<Customer>> {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<Customer>>("/customers", { query, signal });
}

export function getCustomerStats(opts?: { signal?: AbortSignal }): Promise<CustomerStats> {
  return api.get<CustomerStats>("/customers/stats", opts);
}

export function getCustomer(id: string, opts?: { signal?: AbortSignal }): Promise<CustomerDetail> {
  return api.get<CustomerDetail>(`/customers/${id}`, opts);
}

export function createCustomer(payload: CreateCustomerPayload): Promise<Customer> {
  return api.post<Customer>("/customers", payload);
}

export type WalkInCustomerPayload = {
  type: "PERSON" | "COMPANY";
  name: string;
  document?: string;
  address: {
    zipCode?: string;
    street: string;
    number: string;
    complement?: string;
    referencePoint?: string;
    district: string;
    city: string;
    state: string;
  };
  contact: { name: string; phone: string };
  /** Contrato singular legado. Novos clientes devem usar `equipments`. */
  equipment?: WalkInEquipmentPayload;
  equipments?: WalkInEquipmentPayload[];
};

export type WalkInEquipmentPayload = {
  name?: string;
  equipmentTypeCatalogId?: string;
  manufacturer?: string;
  model?: string;
  capacity?: string;
  sector?: string;
  tag?: string;
  serialNumber?: string;
  voltage?: string;
  observations?: string;
  type?: string;
};

export type WalkInCustomerResult = {
  customerId: string;
  addressId: string;
  addressLabel: string;
  equipmentId: string;
  equipmentName: string;
  equipments: Array<{ id: string; name: string; sector: string | null }>;
};

/** OS avulso: registra um cliente novo em campo (fica em Revisão). */
export function createWalkInCustomer(payload: WalkInCustomerPayload): Promise<WalkInCustomerResult> {
  return api.post<WalkInCustomerResult>("/customers/walk-in", payload);
}

export function updateCustomer(
  id: string,
  payload: Partial<CreateCustomerPayload>,
): Promise<Customer> {
  return api.patch<Customer>(`/customers/${id}`, payload);
}

export function disableCustomer(id: string): Promise<Customer> {
  return api.patch<Customer>(`/customers/${id}/disable`);
}

export function enableCustomer(id: string): Promise<Customer> {
  return api.patch<Customer>(`/customers/${id}/enable`);
}

export function deleteCustomer(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/customers/${id}`);
}

/* ---------- Nested: addresses ---------- */

export function createAddress(
  customerId: string,
  payload: Partial<CustomerAddress>,
): Promise<CustomerAddress> {
  return api.post<CustomerAddress>(`/customers/${customerId}/addresses`, payload);
}

export function updateAddress(
  customerId: string,
  addressId: string,
  payload: Partial<CustomerAddress>,
): Promise<CustomerAddress> {
  return api.patch<CustomerAddress>(`/customers/${customerId}/addresses/${addressId}`, payload);
}

export function deleteAddress(
  customerId: string,
  addressId: string,
): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/customers/${customerId}/addresses/${addressId}`);
}

/* ---------- Nested: contacts ---------- */

export function createContact(
  customerId: string,
  payload: Partial<CustomerContact>,
): Promise<CustomerContact> {
  return api.post<CustomerContact>(`/customers/${customerId}/contacts`, payload);
}

export function updateContact(
  customerId: string,
  contactId: string,
  payload: Partial<CustomerContact>,
): Promise<CustomerContact> {
  return api.patch<CustomerContact>(`/customers/${customerId}/contacts/${contactId}`, payload);
}

export function deleteContact(
  customerId: string,
  contactId: string,
): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/customers/${customerId}/contacts/${contactId}`);
}

/* ---------- Attachments ---------- */

export function uploadCustomerAttachment(
  customerId: string,
  category: string,
  file: File,
): Promise<{ id: string }> {
  const form = new FormData();
  form.append("category", category);
  form.append("file", file);
  return api.upload<{ id: string }>(`/customers/${customerId}/attachments`, form);
}

export function getCustomerAttachment(attachmentId: string): Promise<AssetWithContent> {
  return api.get<AssetWithContent>(`/customers/attachments/${attachmentId}`);
}
