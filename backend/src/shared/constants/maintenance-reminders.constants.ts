import { OperationType } from '@prisma/client';

export const DEFAULT_MAINTENANCE_REMINDER_INTERVAL_MONTHS = 6;
export const MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS = 1;
export const MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS = 120;

export const MAINTENANCE_REMINDER_OPERATION_TYPES: OperationType[] = [
  OperationType.PREVENTIVA,
  OperationType.INSTALACAO,
];
