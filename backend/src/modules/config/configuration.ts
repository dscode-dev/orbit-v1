import {
  STORAGE_DRIVERS,
  STORAGE_PROVIDERS,
  type StorageDriver,
  type StorageProvider,
} from '../../infra/storage/storage-provider.type';
import { isAbsolute } from 'node:path';

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_NAME: string;
  APP_PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN_SECONDS: number;
  JWT_REFRESH_EXPIRES_IN_SECONDS: number;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  CORS_ORIGINS: string[];
  HTTP_JSON_BODY_LIMIT_BYTES: number;
  OPERATION_JSON_BODY_LIMIT_BYTES: number;
  STORAGE_PROVIDER: StorageProvider;
  STORAGE_DRIVER: StorageDriver;
  STORAGE_PATH: string;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  /** Usuário do Instagram da empresa (sem @), exibido na landing. Opcional. */
  ORGANIZATION_INSTAGRAM: string | null;
  /** Login por biometria (passkeys). null = recurso desligado. */
  WEBAUTHN: WebAuthnConfig | null;
}

export interface WebAuthnConfig {
  /** Domínio ao qual as passkeys ficam presas (ex.: climacerto-refrigeracao.com.br). */
  rpId: string;
  /** Nome exibido pelo sistema no pedido de biometria. */
  rpName: string;
  /** Endereços exatos de onde o app roda (https://…; http só em localhost). */
  origins: string[];
}

const REQUIRED_VARIABLES = [
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES_IN_SECONDS',
  'JWT_REFRESH_EXPIRES_IN_SECONDS',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'APP_NAME',
  'APP_PORT',
  'CORS_ORIGINS',
  'STORAGE_PROVIDER',
  'STORAGE_DRIVER',
  'STORAGE_PATH',
] as const;

function requireString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value.trim();
}

function optionalString(
  config: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string {
  const value = config[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Environment variable ${key} must be a non-empty string`);
  }
  return value.trim();
}

function parsePositiveInteger(value: string, key: string, maximum?: number): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  const parsed = Number(value);
  if (parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    throw new Error(
      `Environment variable ${key} must be between 1 and ${maximum ?? Number.MAX_SAFE_INTEGER}`,
    );
  }
  return parsed;
}

function parseCorsOrigins(rawOrigins: string): string[] {
  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('CORS_ORIGINS must contain explicit origins and cannot contain wildcards');
  }

  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
        throw new Error();
      }
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  }

  return [...new Set(origins)];
}

/**
 * Aceita `@usuario`, `usuario` ou a URL do perfil e devolve só o usuário. Vazio
 * ou ausente desliga o Instagram na landing (nem toda empresa usa).
 */
export function parseInstagramHandle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('ORGANIZATION_INSTAGRAM must be a string');
  }
  const raw = value.trim();
  if (raw === '') return null;
  const handle = raw
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  // Regras do Instagram: até 30 caracteres entre letras, números, ponto e _.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    throw new Error('ORGANIZATION_INSTAGRAM must be a valid Instagram username (e.g. @minhaempresa)');
  }
  return handle;
}

/**
 * WEBAUTHN_RP_ID vazio desliga a biometria. Preenchido, exige WEBAUTHN_ORIGINS
 * com origens HTTPS (http só em localhost) pertencentes ao domínio — o
 * navegador recusaria as demais, e o erro só apareceria no celular do usuário.
 */
export function parseWebAuthnConfig(config: Record<string, unknown>, appName: string): WebAuthnConfig | null {
  const rpIdRaw = config.WEBAUTHN_RP_ID;
  const rpId = typeof rpIdRaw === 'string' ? rpIdRaw.trim().toLowerCase() : '';
  if (!rpId) return null;
  if (!/^(localhost|([a-z0-9-]+\.)+[a-z]{2,})$/.test(rpId)) {
    throw new Error('WEBAUTHN_RP_ID must be a domain without protocol or port (e.g. climacerto-refrigeracao.com.br)');
  }
  const originsRaw = typeof config.WEBAUTHN_ORIGINS === 'string' ? config.WEBAUTHN_ORIGINS : '';
  const origins = [...new Set(originsRaw.split(',').map((o) => o.trim()).filter(Boolean))];
  if (origins.length === 0) {
    throw new Error('WEBAUTHN_ORIGINS is required when WEBAUTHN_RP_ID is set');
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`WEBAUTHN_ORIGINS contains an invalid origin: ${origin}`);
    }
    const local = url.hostname === 'localhost';
    if (url.origin !== origin || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      throw new Error(`WEBAUTHN_ORIGINS must contain exact https origins (http only for localhost): ${origin}`);
    }
    if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) {
      throw new Error(`WEBAUTHN_ORIGINS origin ${origin} is not within WEBAUTHN_RP_ID ${rpId}`);
    }
  }
  const nameRaw = typeof config.WEBAUTHN_RP_NAME === 'string' ? config.WEBAUTHN_RP_NAME.trim() : '';
  return { rpId, rpName: nameRaw || appName, origins };
}

function assertProductionSecret(value: string, key: string): void {
  const normalized = value.toLowerCase();
  const unsafeFragments = ['replace_with', 'change_me', 'example', 'secret_of_at_least'];
  if (unsafeFragments.some((fragment) => normalized.includes(fragment))) {
    throw new Error(`${key} must not use placeholder/example values in production`);
  }
}

function assertProductionDatabaseUrl(value: string): void {
  const normalized = value.toLowerCase();
  const unsafeFragments = ['change_me', 'example', 'localhost'];
  if (unsafeFragments.some((fragment) => normalized.includes(fragment))) {
    throw new Error('DATABASE_URL must not use placeholder/example/local values in production');
  }
}

function assertProductionStoragePath(value: string): void {
  if (!isAbsolute(value)) {
    throw new Error('STORAGE_PATH must be an absolute mounted path in production');
  }
  if (
    value === '/tmp' ||
    value.startsWith('/tmp/') ||
    value === '/var/tmp' ||
    value.startsWith('/var/tmp/')
  ) {
    throw new Error('STORAGE_PATH must not point to a temporary directory in production');
  }
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  for (const key of REQUIRED_VARIABLES) {
    requireString(config, key);
  }

  const nodeEnv = (config.NODE_ENV ?? 'development') as string;
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const jwtSecret = requireString(config, 'JWT_SECRET');
  const jwtRefreshSecret = requireString(config, 'JWT_REFRESH_SECRET');
  if (jwtSecret.length < 32 || jwtRefreshSecret.length < 32) {
    throw new Error('JWT secrets must contain at least 32 characters');
  }
  if (jwtSecret === jwtRefreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }

  const storageProvider = requireString(config, 'STORAGE_PROVIDER');
  if (!STORAGE_PROVIDERS.includes(storageProvider as StorageProvider)) {
    throw new Error('STORAGE_PROVIDER must be local or s3');
  }
  const storageDriver = requireString(config, 'STORAGE_DRIVER');
  if (!STORAGE_DRIVERS.includes(storageDriver as StorageDriver)) {
    throw new Error('STORAGE_DRIVER must be local');
  }
  if (storageProvider !== storageDriver) {
    throw new Error('STORAGE_PROVIDER and STORAGE_DRIVER must have the same value');
  }

  const logLevel = optionalString(config, 'LOG_LEVEL', 'info');
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error('LOG_LEVEL must be debug, info, warn, or error');
  }
  if (nodeEnv === 'production') {
    assertProductionSecret(jwtSecret, 'JWT_SECRET');
    assertProductionSecret(jwtRefreshSecret, 'JWT_REFRESH_SECRET');
    assertProductionDatabaseUrl(requireString(config, 'DATABASE_URL'));
    assertProductionStoragePath(requireString(config, 'STORAGE_PATH'));
  }

  return {
    NODE_ENV: nodeEnv as EnvironmentVariables['NODE_ENV'],
    APP_NAME: requireString(config, 'APP_NAME'),
    APP_PORT: parsePositiveInteger(requireString(config, 'APP_PORT'), 'APP_PORT', 65535),
    DATABASE_URL: requireString(config, 'DATABASE_URL'),
    JWT_SECRET: jwtSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_ACCESS_EXPIRES_IN_SECONDS: parsePositiveInteger(
      requireString(config, 'JWT_ACCESS_EXPIRES_IN_SECONDS'),
      'JWT_ACCESS_EXPIRES_IN_SECONDS',
      86400,
    ),
    JWT_REFRESH_EXPIRES_IN_SECONDS: parsePositiveInteger(
      requireString(config, 'JWT_REFRESH_EXPIRES_IN_SECONDS'),
      'JWT_REFRESH_EXPIRES_IN_SECONDS',
      31536000,
    ),
    JWT_ISSUER: requireString(config, 'JWT_ISSUER'),
    JWT_AUDIENCE: requireString(config, 'JWT_AUDIENCE'),
    CORS_ORIGINS: parseCorsOrigins(requireString(config, 'CORS_ORIGINS')),
    HTTP_JSON_BODY_LIMIT_BYTES: parsePositiveInteger(
      optionalString(config, 'HTTP_JSON_BODY_LIMIT_BYTES', '1048576'),
      'HTTP_JSON_BODY_LIMIT_BYTES',
      10 * 1024 * 1024,
    ),
    OPERATION_JSON_BODY_LIMIT_BYTES: parsePositiveInteger(
      optionalString(config, 'OPERATION_JSON_BODY_LIMIT_BYTES', '125829120'),
      'OPERATION_JSON_BODY_LIMIT_BYTES',
      128 * 1024 * 1024,
    ),
    STORAGE_PROVIDER: storageProvider as EnvironmentVariables['STORAGE_PROVIDER'],
    STORAGE_DRIVER: storageDriver as EnvironmentVariables['STORAGE_DRIVER'],
    STORAGE_PATH: requireString(config, 'STORAGE_PATH'),
    RATE_LIMIT_TTL_MS: parsePositiveInteger(
      optionalString(config, 'RATE_LIMIT_TTL_MS', '60000'),
      'RATE_LIMIT_TTL_MS',
    ),
    RATE_LIMIT_MAX: parsePositiveInteger(
      optionalString(config, 'RATE_LIMIT_MAX', '100'),
      'RATE_LIMIT_MAX',
    ),
    LOG_LEVEL: logLevel as EnvironmentVariables['LOG_LEVEL'],
    ORGANIZATION_INSTAGRAM: parseInstagramHandle(config.ORGANIZATION_INSTAGRAM),
    WEBAUTHN: parseWebAuthnConfig(config, requireString(config, 'APP_NAME')),
  };
}
