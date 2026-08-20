import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, type User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { AUDIT_ACTIONS, AUTH_RESOURCE } from '../../shared/constants/auth.constants';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { PasswordService } from './password.service';
import type {
  AccessTokenPayload,
  AuthRequestContext,
  RefreshTokenPayload,
} from './types/jwt-payload.type';
import type { LoginDto } from './dto/login.dto';
import { LogoutResponseDto, MeResponseDto, TokenPairResponseDto } from './dto/auth-response.dto';

/**
 * Corridas de rotação (várias abas renovando quase juntas) não são reuso
 * malicioso: dentro desta janela o token já rotacionado gera 401 sem derrubar
 * as demais sessões do usuário. Fora dela, o reuso revoga a família inteira.
 */
const REFRESH_ROTATION_GRACE_SECONDS = 60;

const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  customerId: true,
  isActive: true,
  mustChangePassword: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
  ) {}

  async login(
    input: LoginDto,
    context: AuthRequestContext,
    allowedRoles: Role[],
  ): Promise<TokenPairResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    const passwordValid = await this.passwords.verifyPassword(
      user?.passwordHash ?? null,
      input.password,
    );

    if (!user || !passwordValid || !user.isActive || !allowedRoles.includes(user.role)) {
      await this.writeAudit(AUDIT_ACTIONS.LOGIN_FAILURE, user?.id ?? null, context, {
        email: input.email,
        reason: !user || !passwordValid || (user && !allowedRoles.includes(user.role))
          ? 'INVALID_CREDENTIALS'
          : 'USER_INACTIVE',
      });

      throw new ApplicationException(
        !user || !passwordValid || (user && !allowedRoles.includes(user.role))
          ? ERROR_CODES.AUTH_INVALID_CREDENTIALS
          : ERROR_CODES.AUTH_USER_INACTIVE,
        !user || !passwordValid || !allowedRoles.includes(user.role)
          ? 'Invalid email or password'
          : 'User account is inactive',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.issueTokenPair(user);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
      }),
      this.prisma.refreshToken.create({
        data: tokens.refreshTokenRecord,
      }),
      this.prisma.auditLog.create({
        data: this.auditData(AUDIT_ACTIONS.LOGIN_SUCCESS, user.id, context, {
          sessionId: tokens.refreshTokenRecord.id,
        }),
      }),
    ]);

    return tokens.response;
  }

  async refresh(rawToken: string, context: AuthRequestContext): Promise<TokenPairResponseDto> {
    const payload = await this.verifyRefreshJwt(rawToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (!storedToken || storedToken.userId !== payload.sub) {
      throw this.invalidRefreshToken();
    }

    if (storedToken.revokedAt) {
      // Janela de graça para corridas benignas de rotação (duas abas do mesmo
      // navegador renovando ao mesmo tempo): um token rotacionado há poucos
      // segundos recebe 401 simples e a aba recupera o token novo do storage.
      // Reuso FORA da graça é sinal real de vazamento e continua revogando a
      // família inteira de sessões (detecção de reuso preservada).
      const graceMs = REFRESH_ROTATION_GRACE_SECONDS * 1000;
      const withinGrace = Date.now() - storedToken.revokedAt.getTime() <= graceMs;
      if (!withinGrace) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: storedToken.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new ApplicationException(
        ERROR_CODES.AUTH_SESSION_REVOKED,
        'Refresh token has already been used or revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const now = new Date();
    if (!storedToken.user.isActive) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new ApplicationException(
        ERROR_CODES.AUTH_USER_INACTIVE,
        'User account is inactive',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokenValid =
      storedToken.expiresAt > now && (await this.passwords.verify(storedToken.tokenHash, rawToken));

    if (!tokenValid) {
      throw this.invalidRefreshToken();
    }

    const tokens = await this.issueTokenPair(storedToken.user);

    try {
      await this.prisma.$transaction(async (transaction) => {
        const revoked = await transaction.refreshToken.updateMany({
          where: {
            id: storedToken.id,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });

        if (revoked.count !== 1) {
          throw this.invalidRefreshToken();
        }

        await transaction.refreshToken.create({
          data: tokens.refreshTokenRecord,
        });
        await transaction.auditLog.create({
          data: this.auditData(AUDIT_ACTIONS.TOKEN_REFRESH, storedToken.userId, context, {
            previousSessionId: storedToken.id,
            sessionId: tokens.refreshTokenRecord.id,
          }),
        });
      });
    } catch (error: unknown) {
      if (error instanceof ApplicationException) {
        throw error;
      }
      throw error;
    }

    return tokens.response;
  }

  async logout(rawToken: string, context: AuthRequestContext): Promise<LogoutResponseDto> {
    const payload = await this.verifyRefreshJwt(rawToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });

    if (
      !storedToken ||
      storedToken.userId !== payload.sub ||
      !(await this.passwords.verify(storedToken.tokenHash, rawToken))
    ) {
      throw this.invalidRefreshToken();
    }

    if (storedToken.revokedAt) {
      return { revoked: true };
    }

    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt },
      }),
      this.prisma.auditLog.create({
        data: this.auditData(AUDIT_ACTIONS.LOGOUT, storedToken.userId, context, {
          sessionId: storedToken.id,
        }),
      }),
    ]);

    return { revoked: true };
  }

  async validateAccessToken(rawToken: string): Promise<AuthenticatedUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(rawToken, {
        secret: this.config.jwtSecret,
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
    } catch {
      throw new ApplicationException(
        ERROR_CODES.AUTH_INVALID_TOKEN,
        'Access token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (payload.type !== 'access' || !payload.sub || !payload.jti) {
      throw new ApplicationException(
        ERROR_CODES.AUTH_INVALID_TOKEN,
        'Access token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!payload.sid) {
      throw new ApplicationException(
        ERROR_CODES.AUTH_INVALID_TOKEN,
        'Access token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const session = await this.prisma.refreshToken.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        user: {
          select: USER_PUBLIC_SELECT,
        },
      },
    });
    if (!session) {
      throw new ApplicationException(
        ERROR_CODES.AUTH_SESSION_REVOKED,
        'Session is no longer active',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!session.user.isActive) {
      throw new ApplicationException(
        ERROR_CODES.AUTH_USER_INACTIVE,
        'User account is inactive',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return session.user;
  }

  me(user: AuthenticatedUser): MeResponseDto {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    };
  }

  private async issueTokenPair(user: User): Promise<{
    response: TokenPairResponseDto;
    refreshTokenRecord: Prisma.RefreshTokenUncheckedCreateInput;
  }> {
    const accessId = randomUUID();
    const refreshId = randomUUID();
    const accessPayload: Omit<AccessTokenPayload, 'jti'> = {
      sub: user.id,
      username: user.username,
      role: user.role,
      type: 'access',
      sid: refreshId,
    };
    const refreshPayload: Omit<RefreshTokenPayload, 'jti'> = {
      sub: user.id,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.jwtSecret,
        algorithm: 'HS256',
        expiresIn: this.config.jwtAccessExpiresInSeconds,
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        jwtid: accessId,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.jwtRefreshSecret,
        algorithm: 'HS256',
        expiresIn: this.config.jwtRefreshExpiresInSeconds,
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        jwtid: refreshId,
      }),
    ]);

    const tokenHash = await this.passwords.hash(refreshToken);
    return {
      response: {
        accessToken,
        refreshToken,
        expiresIn: this.config.jwtAccessExpiresInSeconds,
      },
      refreshTokenRecord: {
        id: refreshId,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + this.config.jwtRefreshExpiresInSeconds * 1000),
      },
    };
  }

  private async verifyRefreshJwt(rawToken: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.jwtRefreshSecret,
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
      if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
        throw new Error('Invalid refresh payload');
      }
      return payload;
    } catch {
      throw this.invalidRefreshToken();
    }
  }

  private invalidRefreshToken(): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.AUTH_INVALID_TOKEN,
      'Refresh token is invalid or expired',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private async writeAudit(
    action: string,
    actor: string | null,
    context: AuthRequestContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: this.auditData(action, actor, context, metadata),
    });
  }

  private auditData(
    action: string,
    actor: string | null,
    context: AuthRequestContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogCreateInput {
    return {
      action,
      resource: AUTH_RESOURCE,
      actor,
      metadata: {
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
        ...metadata,
      },
    };
  }
}
