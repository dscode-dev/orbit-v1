export const USER_RESOURCE = 'USER';
export const USER_PREFERENCES_RESOURCE = 'USER_PREFERENCES';
export const USER_AVATAR_RESOURCE = 'USER_AVATAR';

export const USER_AUDIT_ACTIONS = {
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DISABLED: 'USER_DISABLED',
  USER_ENABLED: 'USER_ENABLED',
  USER_DELETED: 'USER_DELETED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  AVATAR_UPDATED: 'AVATAR_UPDATED',
  PREFERENCES_UPDATED: 'PREFERENCES_UPDATED',
} as const;

export const USER_THEMES = ['SYSTEM', 'LIGHT', 'DARK'] as const;
export type UserTheme = (typeof USER_THEMES)[number];

export const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const;
export const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export const GENERATED_PASSWORD_BYTES = 24;
/**
 * Tamanho mínimo de senha (plataforma, app do operador e portal do cliente).
 * Definido pelo OWNER; espelhado em `frontend/packages/utils/password.ts`.
 * Senhas existentes mais longas continuam válidas.
 */
export const MIN_PASSWORD_LENGTH = 8;
