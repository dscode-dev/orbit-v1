import type { Role, UserPermissions } from "@erp/api";
import type { ChipTone } from "@erp/ui/status-chip";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Proprietário",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  VIEWER: "Visualizador",
  CUSTOMER: "Cliente",
};

export const ROLE_TONE: Record<Role, ChipTone> = {
  OWNER: "primary",
  MANAGER: "info",
  OPERATOR: "success",
  VIEWER: "neutral",
  CUSTOMER: "info",
};

export const ROLES: Role[] = ["OWNER", "MANAGER", "OPERATOR", "VIEWER"];

export const PERMISSION_LABEL: Record<keyof UserPermissions, string> = {
  canFinancial: "Financeiro",
  canUsers: "Usuários",
  canReports: "Relatórios",
  canSchedules: "Agendamentos",
  canTemplates: "Modelos",
};

export const PERMISSION_KEYS: (keyof UserPermissions)[] = [
  "canFinancial",
  "canUsers",
  "canReports",
  "canSchedules",
  "canTemplates",
];
