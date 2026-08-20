import { api } from './client';
import type {
  CreateOperationPayload,
  CreateServiceRequestPayload,
  CustomerPortalDashboard,
  OperationDetail,
  Paginated,
  ServiceRequest,
  ServiceRequestStatus,
  ServiceRequestType,
} from '@erp/types';

export function getPortalDashboard(opts?: { signal?: AbortSignal }): Promise<CustomerPortalDashboard> {
  return api.get<CustomerPortalDashboard>('/customer-portal/dashboard', opts);
}

export function createPortalRequest(payload: CreateServiceRequestPayload): Promise<ServiceRequest> {
  return api.post<ServiceRequest>('/customer-portal/service-requests', payload);
}

export function createPortalAccount(customerId: string, payload: { email: string; name: string }): Promise<{ user: { id: string; email: string; name: string }; temporaryPassword: string }> {
  return api.post(`/customer-portal/accounts/${customerId}`, payload);
}

export function listRequests(params?: { page?: number; limit?: number; search?: string; status?: ServiceRequestStatus; type?: ServiceRequestType; customerId?: string; signal?: AbortSignal }): Promise<Paginated<ServiceRequest>> {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<ServiceRequest>>('/service-requests', { query, signal });
}

export function updateRequest(id: string, payload: { status?: ServiceRequestStatus; internalNotes?: string }): Promise<ServiceRequest> {
  return api.patch<ServiceRequest>(`/service-requests/${id}`, payload);
}

export function createOperation(id: string, payload: CreateOperationPayload): Promise<OperationDetail> {
  return api.post<OperationDetail>(`/service-requests/${id}/operation`, payload);
}
