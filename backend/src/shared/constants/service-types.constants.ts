/**
 * "Tipo de serviço" das operações. Antes era o enum Postgres `OperationType`;
 * agora é texto livre validado contra o catálogo `ServiceType` (CRUD do owner).
 *
 * `OperationType` permanece como alias de `string` só para manter a legibilidade
 * do código que já usava esse nome — não há mais um conjunto fechado de valores.
 */
export type OperationType = string;

/**
 * Chaves dos 4 tipos originais (semeados como `isSystem`). Continuam válidas e
 * são referenciadas por código de fluxo (defaults, PMOC, RVT). Nunca devem ser
 * removidas nem ter a chave alterada — ver `ServiceType.isSystem`.
 */
export const SYSTEM_SERVICE_TYPE_KEYS = {
  PREVENTIVA: 'PREVENTIVA',
  CORRETIVA: 'CORRETIVA',
  INSTALACAO: 'INSTALACAO',
  PROJETO: 'PROJETO',
} as const;

/**
 * Compat: objeto com as chaves dos tipos do sistema, drop-in no lugar do antigo
 * enum `OperationType` (permite `OperationType.PREVENTIVA`). Tipo e valor com o
 * mesmo nome coexistem — como fazia o enum. Novo código deve preferir
 * `SYSTEM_SERVICE_TYPE_KEYS` e validar contra o catálogo.
 */
export const OperationType = SYSTEM_SERVICE_TYPE_KEYS;

/** Rótulos padrão dos tipos do sistema (fallback quando o catálogo não é consultado). */
export const SYSTEM_SERVICE_TYPE_LABELS: Record<string, string> = {
  PREVENTIVA: 'Preventiva',
  CORRETIVA: 'Corretiva',
  INSTALACAO: 'Instalação',
  PROJETO: 'Projeto',
};

/**
 * Semente canônica dos tipos do sistema — usada ao criar uma organização nova
 * (a migração já semeia as orgs existentes). Preventiva e Instalação nascem
 * gerando lembrete de +6 meses, preservando o comportamento histórico.
 */
export const SYSTEM_SERVICE_TYPE_SEED: ReadonlyArray<{
  key: string;
  label: string;
  sortOrder: number;
  generatesReminder: boolean;
  reminderIntervalMonths: number | null;
}> = [
  { key: 'PREVENTIVA', label: 'Preventiva', sortOrder: 0, generatesReminder: true, reminderIntervalMonths: 6 },
  { key: 'CORRETIVA', label: 'Corretiva', sortOrder: 1, generatesReminder: false, reminderIntervalMonths: null },
  { key: 'INSTALACAO', label: 'Instalação', sortOrder: 2, generatesReminder: true, reminderIntervalMonths: 6 },
  { key: 'PROJETO', label: 'Projeto', sortOrder: 3, generatesReminder: false, reminderIntervalMonths: null },
];
