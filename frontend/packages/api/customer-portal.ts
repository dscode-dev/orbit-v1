import { api, apiRequest } from './client';
import { clearTokens, getRefreshToken, setTokens } from './tokens';
import type {
  AuthTokens,
  CreateOperationPayload,
  CustomerPortalAccount,
  CustomerPortalDirectoryAccount,
  CustomerPortalEquipment,
  CustomerPortalOperation,
  CustomerPortalSession,
  CustomerServiceTicket,
  DocumentTemplateType,
  OperationType,
  OperationDetail,
  Paginated,
} from '@erp/types';

export type CreateCustomerTicketPayload = {
  addressId?: string;
  equipmentIds?: string[];
  documentType?: DocumentTemplateType;
  operationType?: OperationType;
  serviceTypes?: OperationType[];
  title: string;
  description: string;
  priority?: string;
  preferredDate?: string;
  contactName?: string;
  contactPhone?: string;
};

export function login(email: string, password: string): Promise<AuthTokens> {
  return apiRequest<AuthTokens>('/customer/auth/login', {
    method: 'POST', body: { email, password }, auth: false,
  }).then((tokens) => { setTokens(tokens); return tokens; });
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) await api.post('/customer/auth/logout', { refreshToken });
  } finally {
    clearTokens();
  }
}

export const me = (signal?: AbortSignal) => api.get<CustomerPortalSession>('/customer/me', { signal });
export const changePassword = (payload: { currentPassword: string; newPassword: string }) => api.post<{ changed: true }>('/customer/change-password', payload);
export const listOperations = (params?: { page?: number; limit?: number; search?: string; signal?: AbortSignal }) => {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<CustomerPortalOperation>>('/customer/operations', { query, signal });
};
export const getOperation = (id: string, signal?: AbortSignal) => api.get<CustomerPortalOperation>(`/customer/operations/${id}`, { signal });
export const listEquipments = (signal?: AbortSignal) => api.get<CustomerPortalEquipment[]>('/customer/equipments', { signal });
export const getEquipment = (id: string, signal?: AbortSignal) => api.get<CustomerPortalEquipment & { operations: CustomerPortalOperation[] }>(`/customer/equipments/${id}`, { signal });
export const listMyTickets = (params?: { page?: number; limit?: number; status?: string; search?: string; signal?: AbortSignal }) => {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<CustomerServiceTicket>>('/customer/tickets', { query, signal });
};
export const createTicket = (payload: CreateCustomerTicketPayload) => api.post<CustomerServiceTicket>('/customer/tickets', payload);

export const listAccounts = (customerId: string, signal?: AbortSignal) => api.get<CustomerPortalAccount[]>('/customer-portal/accounts', { query: { customerId }, signal });
export const listAccountDirectory = (params?: { page?: number; limit?: number; search?: string; status?: 'ACTIVE' | 'INACTIVE'; signal?: AbortSignal }) => {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<CustomerPortalDirectoryAccount>>('/customer-portal/accounts/directory', { query, signal });
};
export const provisionAccount = (payload: { customerId: string; email: string; name: string; phone?: string }) => api.post<{ account: CustomerPortalAccount; temporaryPassword: string }>('/customer-portal/accounts', payload);
export const disableAccount = (id: string) => api.patch<CustomerPortalAccount>(`/customer-portal/accounts/${id}/disable`);
export const resetAccountPassword = (id: string) => api.patch<{ account: CustomerPortalAccount; temporaryPassword: string }>(`/customer-portal/accounts/${id}/reset-password`);

export const listTickets = (params?: { page?: number; limit?: number; search?: string; status?: string; customerId?: string; signal?: AbortSignal }) => {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<CustomerServiceTicket>>('/service-tickets', { query, signal });
};
export const getTicket = (id: string, signal?: AbortSignal) => api.get<CustomerServiceTicket>(`/service-tickets/${id}`, { signal });
export const getOperationPrefill = (id: string, signal?: AbortSignal) => api.get<Partial<CreateOperationPayload>>(`/service-tickets/${id}/operation-prefill`, { signal });
export const createOperation = (id: string, payload: CreateOperationPayload) => api.post<OperationDetail>(`/service-tickets/${id}/operation`, payload);
