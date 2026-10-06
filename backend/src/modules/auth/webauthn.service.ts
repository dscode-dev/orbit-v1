import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import { AppConfigService } from '../config/app-config.service';
import type { WebAuthnConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import {
  AUDIT_ACTIONS,
  AUTH_RESOURCE,
  WEBAUTHN_CHALLENGE_TTL_MS,
  WEBAUTHN_MAX_CREDENTIALS_PER_USER,
} from '../../shared/constants/auth.constants';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { AuthService } from './auth.service';
import type { TokenPairResponseDto } from './dto/auth-response.dto';
import type { WebAuthnLoginVerifyDto, WebAuthnRegistrationVerifyDto } from './dto/webauthn.dto';
import type { AuthRequestContext } from './types/jwt-payload.type';

type ChallengePurpose = 'REGISTRATION' | 'AUTHENTICATION';

const PASSKEY_SELECT = {
  id: true,
  deviceName: true,
  backedUp: true,
  createdAt: true,
  lastUsedAt: true,
} satisfies Prisma.WebAuthnCredentialSelect;

export type PasskeyResponse = Prisma.WebAuthnCredentialGetPayload<{ select: typeof PASSKEY_SELECT }>;

/**
 * Login por biometria do aparelho (passkeys / WebAuthn).
 *
 * O aparelho guarda a chave privada e só a libera com biometria (ou PIN); a API
 * guarda a chave pública e confere a assinatura de um desafio de uso único. Ao
 * final, o login segue exatamente o mesmo caminho da senha (`completeLogin`):
 * bloqueio, regra de canal por papel, sessão e auditoria.
 */
@Injectable()
export class WebAuthnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly auth: AuthService,
  ) {}

  status(): { enabled: boolean } {
    return { enabled: this.config.webAuthn !== null };
  }

  /* ---------- Cadastro (usuário logado) ---------- */

  async registrationOptions(
    actor: AuthenticatedUser,
  ): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const cfg = this.requireEnabled();
    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { userId: actor.id },
      select: { credentialId: true, transports: true },
    });
    if (existing.length >= WEBAUTHN_MAX_CREDENTIALS_PER_USER) {
      throw new ApplicationException(
        ERROR_CODES.WEBAUTHN_CREDENTIAL_LIMIT,
        `Limite de ${WEBAUTHN_MAX_CREDENTIALS_PER_USER} aparelhos com biometria. Remova um antes de cadastrar outro.`,
        HttpStatus.CONFLICT,
      );
    }
    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpId,
      userName: actor.email,
      userDisplayName: actor.name,
      userID: isoUint8Array.fromUTF8String(actor.id),
      attestationType: 'none',
      // Não cadastra de novo o mesmo aparelho.
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        // Passkey "descobrível": permite entrar sem digitar o e-mail.
        residentKey: 'required',
        userVerification: 'required',
      },
    });
    const challengeId = await this.saveChallenge('REGISTRATION', options.challenge, actor.id);
    return { challengeId, options };
  }

  async verifyRegistration(
    actor: AuthenticatedUser,
    dto: WebAuthnRegistrationVerifyDto,
    context: AuthRequestContext,
  ): Promise<PasskeyResponse> {
    const cfg = this.requireEnabled();
    const challenge = await this.consumeChallenge(dto.challengeId, 'REGISTRATION', actor.id);
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.response,
        expectedChallenge: challenge,
        expectedOrigin: cfg.origins,
        expectedRPID: cfg.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw this.verificationFailed();
    }
    if (!verification.verified || !verification.registrationInfo) throw this.verificationFailed();

    const { credential, credentialBackedUp } = verification.registrationInfo;
    const deviceName = dto.deviceName || `Aparelho cadastrado em ${new Date().toLocaleDateString('pt-BR')}`;
    const saved = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webAuthnCredential.create({
        data: {
          userId: actor.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          deviceName,
          backedUp: credentialBackedUp,
        },
        select: PASSKEY_SELECT,
      });
      await tx.auditLog.create({
        data: this.auditData(AUDIT_ACTIONS.PASSKEY_REGISTERED, actor.id, context, {
          passkeyId: created.id,
          deviceName,
        }),
      });
      return created;
    });
    return saved;
  }

  /* ---------- Login (público) ---------- */

  async authenticationOptions(): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const cfg = this.requireEnabled();
    // Sem lista de credenciais: o aparelho oferece as passkeys que tem para o
    // domínio — não é preciso (nem se revela) qual e-mail está entrando.
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpId,
      userVerification: 'required',
    });
    const challengeId = await this.saveChallenge('AUTHENTICATION', options.challenge, null);
    return { challengeId, options };
  }

  async verifyAuthentication(dto: WebAuthnLoginVerifyDto, context: AuthRequestContext): Promise<TokenPairResponseDto> {
    const cfg = this.requireEnabled();
    const challenge = await this.consumeChallenge(dto.challengeId, 'AUTHENTICATION', null);
    const stored = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: dto.response.id },
      include: { user: true },
    });
    if (!stored) {
      await this.writeAudit(AUDIT_ACTIONS.LOGIN_FAILURE, null, context, {
        method: 'passkey',
        reason: 'UNKNOWN_CREDENTIAL',
      });
      throw this.notRecognized();
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: dto.response,
        expectedChallenge: challenge,
        expectedOrigin: cfg.origins,
        expectedRPID: cfg.rpId,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      verification = { verified: false } as typeof verification;
    }
    if (!verification.verified) {
      await this.writeAudit(AUDIT_ACTIONS.LOGIN_FAILURE, stored.userId, context, {
        method: 'passkey',
        passkeyId: stored.id,
        reason: 'INVALID_SIGNATURE',
      });
      throw this.notRecognized();
    }

    const user = stored.user;
    if (!user.isActive || user.deletedAt) {
      await this.writeAudit(AUDIT_ACTIONS.LOGIN_FAILURE, user.id, context, {
        method: 'passkey',
        passkeyId: stored.id,
        reason: 'USER_INACTIVE',
      });
      throw new ApplicationException(ERROR_CODES.AUTH_USER_INACTIVE, 'Esta conta está inativa', HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    return this.auth.completeLogin(user, dto.channel, context, {
      method: 'passkey',
      email: user.email,
      credentialId: stored.id,
    });
  }

  /* ---------- Aparelhos do próprio usuário ---------- */

  list(actor: AuthenticatedUser): Promise<PasskeyResponse[]> {
    return this.prisma.webAuthnCredential.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
      select: PASSKEY_SELECT,
    });
  }

  async remove(actor: AuthenticatedUser, id: string, context: AuthRequestContext): Promise<{ deleted: true }> {
    const passkey = await this.prisma.webAuthnCredential.findFirst({
      where: { id, userId: actor.id },
      select: { id: true, deviceName: true },
    });
    if (!passkey) {
      throw new ApplicationException(
        ERROR_CODES.WEBAUTHN_CREDENTIAL_NOT_FOUND,
        'Aparelho não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.$transaction([
      this.prisma.webAuthnCredential.delete({ where: { id: passkey.id } }),
      this.prisma.auditLog.create({
        data: this.auditData(AUDIT_ACTIONS.PASSKEY_REMOVED, actor.id, context, {
          passkeyId: passkey.id,
          deviceName: passkey.deviceName,
        }),
      }),
    ]);
    return { deleted: true };
  }

  /* ---------- Internos ---------- */

  private requireEnabled(): WebAuthnConfig {
    const cfg = this.config.webAuthn;
    if (!cfg) {
      throw new ApplicationException(
        ERROR_CODES.WEBAUTHN_DISABLED,
        'Login por biometria não está habilitado',
        HttpStatus.NOT_FOUND,
      );
    }
    return cfg;
  }

  private async saveChallenge(purpose: ChallengePurpose, challenge: string, userId: string | null): Promise<string> {
    const now = new Date();
    // Limpeza oportunista dos desafios vencidos.
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
    const saved = await this.prisma.webAuthnChallenge.create({
      data: { purpose, challenge, userId, expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS) },
      select: { id: true },
    });
    return saved.id;
  }

  /** Lê e APAGA o desafio (uso único, mesmo se a verificação falhar depois). */
  private async consumeChallenge(id: string, purpose: ChallengePurpose, userId: string | null): Promise<string> {
    const challenge = await this.prisma.webAuthnChallenge.delete({ where: { id } }).catch(() => null);
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.userId !== userId ||
      challenge.expiresAt.getTime() < Date.now()
    ) {
      throw new ApplicationException(
        ERROR_CODES.WEBAUTHN_CHALLENGE_INVALID,
        'A solicitação de biometria expirou. Tente novamente.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return challenge.challenge;
  }

  private verificationFailed(): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.WEBAUTHN_VERIFICATION_FAILED,
      'Não foi possível confirmar a biometria deste aparelho.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private notRecognized(): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      'Biometria não reconhecida. Entre com e-mail e senha.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private async writeAudit(
    action: string,
    actor: string | null,
    context: AuthRequestContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({ data: this.auditData(action, actor, context, metadata) });
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
      metadata: { requestId: context.requestId, ip: context.ip, userAgent: context.userAgent, ...metadata },
    };
  }
}
