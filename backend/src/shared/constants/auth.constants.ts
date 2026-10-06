export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  PASSKEY_REGISTERED: 'PASSKEY_REGISTERED',
  PASSKEY_REMOVED: 'PASSKEY_REMOVED',
} as const;

export const AUTH_RESOURCE = 'AUTH_SESSION';

/**
 * Bloqueio temporário por conta, complementar ao rate limit por IP (que um
 * atacante contorna rodando de vários IPs). Valores em constante, não em env:
 * variável nova e obrigatória derrubaria o boot em produção.
 */
export const LOGIN_MAX_FAILED_ATTEMPTS = 10;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

/** Validade do desafio de biometria (cadastro/login). Uso único. */
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Aparelhos com biometria cadastrada por usuário. */
export const WEBAUTHN_MAX_CREDENTIALS_PER_USER = 10;
