/**
 * API layer barrel.
 *
 * The single entry point for backend access. Components import from
 * `@erp/api` and never call `fetch` or hit endpoints directly.
 */
export * from '@erp/types';
export {
  api,
  apiRequest,
  ApiClientError,
  API_BASE_URL,
  onSessionInvalid,
  ensureFreshSession,
} from './client';
export { useQuery, errorMessage, type QueryState, type QueryOptions } from './use-query';
export {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  hasSession,
  setSessionScope,
  getSessionScope,
  type SessionScope,
} from './tokens';

export * as authApi from './auth';
export * as usersApi from './users';
export * as organizationApi from './organization';
export * as customersApi from './customers';
export type { WalkInCustomerPayload, WalkInCustomerResult, WalkInEquipmentPayload } from './customers';
export * as equipmentsApi from './equipments';
export * as financialApi from './financial';
export * as procurementApi from './procurement';
export * as maintenanceApi from './maintenance';
export * as maintenanceChecklistTemplatesApi from './maintenance-checklist-templates';
export * as technicalCatalogsApi from './technical-catalogs';
export * as pmocApi from './pmoc';
export * as rvtApi from './rvt';

export * as operationApi from './operation';
export * as operatorExecutionsApi from './operator-executions';
export * as documentsApi from './documents';
export * as signaturesApi from './signatures';
export * as assetLifecycleApi from './asset-lifecycle';
export * as assignmentsApi from './assignments';
export * as inventoryApi from './inventory';
export * as pricingApi from './pricing';
export * as budgetsApi from './budgets';
export * as cepApi from './cep';
export * as notificationsApi from './notifications';
export * as maintenanceRemindersApi from './maintenance-reminders';
export type {
  MaintenanceReminder,
  MaintenanceReminderStatus,
  MaintenanceReminderStats,
  PmocUpcomingItem,
} from './maintenance-reminders';
export * as salesApi from './sales';
export * as customerPortalApi from './customer-portal';
export type { CreateCustomerTicketPayload } from './customer-portal';

export type {
  ListFinancialAccountsParams,
  ListFinancialCategoriesParams,
  ListFinancialEntriesParams,
} from './financial';
export type { ListPurchaseOrdersParams } from './procurement';
export type { ListMaintenancePlansParams, ListMaintenanceExecutionsParams } from './maintenance';
export type { ListMaintenanceChecklistTemplatesParams } from './maintenance-checklist-templates';
export type { ListTechnicalCatalogsParams, TechnicalCatalogPayload } from './technical-catalogs';
export type {
  ListPmocParams,
  PmocActiveCoverageConflict,
  PmocActiveCoverageResult,
} from './pmoc';
export type { ListRvtPlansParams, RvtPlanPayload } from './rvt';
export type { FieldEquipmentDraft, OperationPhotoContent } from './operation';
export type { DocumentCatalogItem } from './documents';
export type { ListSignaturesParams, SignaturePayload } from './signatures';
export type { ListAssetLifecycleParams } from './asset-lifecycle';
export type { ListAssignmentsParams, PendingDemandGroup, PendingDemandItem } from './assignments';
export type { ListBudgetsParams } from './budgets';
export type { ListNotificationsParams } from './notifications';
