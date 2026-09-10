import { api } from "./client";
import type { OperationType, Paginated } from "@erp/types";

export type MaintenanceReminderStatus = "PENDING" | "DONE" | "DISMISSED";

export type MaintenanceReminder = {
  id: string;
  organizationId: string;
  customerId: string;
  equipmentId: string | null;
  operationId: string | null;
  operationType: OperationType;
  baseDate: string;
  dueDate: string;
  intervalMonths: number;
  status: MaintenanceReminderStatus;
  dateOverridden: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; tradeName: string | null } | null;
  equipment?: { id: string; name: string; tag: string | null } | null;
  operation?: { id: string; number: number; type: OperationType; status: string } | null;
};

export type MaintenanceReminderStats = {
  pending: number;
  overdue: number;
  dueSoon: number;
  done: number;
};

export type PmocUpcomingItem = {
  id: string;
  executionNumber: number;
  scheduledFor: string;
  pmocId: string;
  pmocNumber: number;
  periodicity: string;
  planName: string | null;
  customerName: string | null;
  equipment: { name: string; tag: string | null } | null;
};

export type ListRemindersParams = {
  page?: number;
  limit?: number;
  status?: MaintenanceReminderStatus;
  customerId?: string;
  signal?: AbortSignal;
};

export function listReminders(params?: ListRemindersParams): Promise<Paginated<MaintenanceReminder>> {
  const { signal, ...query } = params ?? {};
  return api.get<Paginated<MaintenanceReminder>>("/maintenance-reminders", { query, signal });
}

export function getReminderStats(opts?: { signal?: AbortSignal }): Promise<MaintenanceReminderStats> {
  return api.get<MaintenanceReminderStats>("/maintenance-reminders/stats", opts);
}

export function updateReminder(
  id: string,
  payload: { dueDate?: string; intervalMonths?: number; status?: MaintenanceReminderStatus; notes?: string },
): Promise<MaintenanceReminder> {
  return api.patch<MaintenanceReminder>(`/maintenance-reminders/${id}`, payload);
}

export function listPmocUpcoming(
  customerId?: string,
  opts?: { signal?: AbortSignal },
): Promise<PmocUpcomingItem[]> {
  return api.get<PmocUpcomingItem[]>("/maintenance-reminders/pmoc-upcoming", {
    query: customerId ? { customerId } : {},
    signal: opts?.signal,
  });
}
