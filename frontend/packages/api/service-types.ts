/** Catálogo editável de "Tipo de Serviço" das operações. */
import { api } from './client';
import type { ServiceType } from '@erp/types';

export type ServiceTypePayload = {
  label: string;
  active?: boolean;
  generatesReminder?: boolean;
  reminderIntervalMonths?: number | null;
  commissionEligible?: boolean;
  commissionPercent?: number;
};

export function list(params?: {
  activeOnly?: boolean;
  signal?: AbortSignal;
}): Promise<{ items: ServiceType[] }> {
  const { signal, ...query } = params ?? {};
  return api.get<{ items: ServiceType[] }>('/service-types', { query, signal });
}

export function create(payload: ServiceTypePayload): Promise<ServiceType> {
  return api.post<ServiceType>('/service-types', payload);
}

export function update(id: string, payload: Partial<ServiceTypePayload>): Promise<ServiceType> {
  return api.patch<ServiceType>(`/service-types/${id}`, payload);
}

export function remove(id: string): Promise<{ deleted: true }> {
  return api.delete<{ deleted: true }>(`/service-types/${id}`);
}

export function reorder(ids: string[]): Promise<{ reordered: number }> {
  return api.patch<{ reordered: number }>('/service-types/reorder', { ids });
}
