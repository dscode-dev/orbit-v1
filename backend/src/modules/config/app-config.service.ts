import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from './configuration';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  get appName(): string {
    return this.configService.get('APP_NAME', { infer: true });
  }

  get port(): number {
    return this.configService.get('APP_PORT', { infer: true });
  }

  get corsOrigins(): string[] {
    return this.configService.get('CORS_ORIGINS', { infer: true });
  }

  get httpJsonBodyLimitBytes(): number {
    return this.configService.get('HTTP_JSON_BODY_LIMIT_BYTES', { infer: true });
  }

  get operationJsonBodyLimitBytes(): number {
    return this.configService.get('OPERATION_JSON_BODY_LIMIT_BYTES', { infer: true });
  }

  get jwtSecret(): string {
    return this.configService.get('JWT_SECRET', { infer: true });
  }

  get jwtRefreshSecret(): string {
    return this.configService.get('JWT_REFRESH_SECRET', { infer: true });
  }

  get jwtAccessExpiresInSeconds(): number {
    return this.configService.get('JWT_ACCESS_EXPIRES_IN_SECONDS', {
      infer: true,
    });
  }

  get jwtRefreshExpiresInSeconds(): number {
    return this.configService.get('JWT_REFRESH_EXPIRES_IN_SECONDS', {
      infer: true,
    });
  }

  get jwtIssuer(): string {
    return this.configService.get('JWT_ISSUER', { infer: true });
  }

  get jwtAudience(): string {
    return this.configService.get('JWT_AUDIENCE', { infer: true });
  }

  get storageDriver(): EnvironmentVariables['STORAGE_DRIVER'] {
    return this.configService.get('STORAGE_DRIVER', { infer: true });
  }

  get storagePath(): string {
    return this.configService.get('STORAGE_PATH', { infer: true });
  }

  get rateLimitTtlMs(): number {
    return this.configService.get('RATE_LIMIT_TTL_MS', { infer: true });
  }

  get rateLimitMax(): number {
    return this.configService.get('RATE_LIMIT_MAX', { infer: true });
  }

  get logLevel(): EnvironmentVariables['LOG_LEVEL'] {
    return this.configService.get('LOG_LEVEL', { infer: true });
  }

  /** Usuário do Instagram (sem @) ou null quando a empresa não divulga. */
  get organizationInstagram(): string | null {
    return this.configService.get('ORGANIZATION_INSTAGRAM', { infer: true });
  }

  get nodeEnv(): EnvironmentVariables['NODE_ENV'] {
    return this.configService.get('NODE_ENV', { infer: true });
  }

}
