import { Role } from '@prisma/client';
import { parseWebAuthnConfig } from '../src/modules/config/configuration';
import { WebAuthnService } from '../src/modules/auth/webauthn.service';
import { LoginChannel } from '../src/modules/auth/dto/login.dto';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: 'reg-challenge' }),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: 'auth-challenge' }),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webauthn = require('@simplewebauthn/server') as Record<string, jest.Mock>;

const context = { requestId: 'r', ip: null, userAgent: null };
const cfg = {
  rpId: 'climacerto.test',
  rpName: 'Clima Certo',
  origins: ['https://app.climacerto.test'],
};
const user = {
  id: 'u1',
  email: 'op@climacerto.test',
  name: 'Operador',
  role: Role.OPERATOR,
  isActive: true,
  deletedAt: null,
  lockedUntil: null,
};
const future = (): Date => new Date(Date.now() + 60_000);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((cause: unknown) => cause);
  return error instanceof ApplicationException ? error.code : undefined;
}

function serviceWith(opts: {
  enabled?: boolean;
  challenge?: Record<string, unknown> | null;
  stored?: Record<string, unknown> | null;
}): {
  service: WebAuthnService;
  prisma: { webAuthnCredential: Record<string, jest.Mock> };
  auth: { completeLogin: jest.Mock };
} {
  const prisma = {
    webAuthnChallenge: {
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'ch-1' }),
      delete: jest
        .fn()
        .mockImplementation(() =>
          opts.challenge === null
            ? Promise.reject(new Error('not found'))
            : Promise.resolve(opts.challenge),
        ),
    },
    webAuthnCredential: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(opts.stored ?? null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'pk-1' }),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  const auth = {
    completeLogin: jest
      .fn()
      .mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
  };
  const config = { webAuthn: opts.enabled === false ? null : cfg };
  return {
    service: new WebAuthnService(prisma as never, config as never, auth as never),
    prisma,
    auth,
  };
}

describe('WebAuthn config (WEBAUTHN_*)', () => {
  it('is disabled when WEBAUTHN_RP_ID is empty', () => {
    expect(parseWebAuthnConfig({}, 'App')).toBeNull();
    expect(parseWebAuthnConfig({ WEBAUTHN_RP_ID: '  ' }, 'App')).toBeNull();
  });

  it('accepts https origins inside the domain and http only on localhost', () => {
    expect(
      parseWebAuthnConfig(
        {
          WEBAUTHN_RP_ID: 'ClimaCerto.test',
          WEBAUTHN_ORIGINS: 'https://climacerto.test,https://app.climacerto.test',
        },
        'App',
      ),
    ).toEqual({
      rpId: 'climacerto.test',
      rpName: 'App',
      origins: ['https://climacerto.test', 'https://app.climacerto.test'],
    });
    expect(
      parseWebAuthnConfig(
        { WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGINS: 'http://localhost:3001' },
        'App',
      )?.origins,
    ).toEqual(['http://localhost:3001']);
  });

  it.each([
    [{ WEBAUTHN_RP_ID: 'climacerto.test' }, /WEBAUTHN_ORIGINS is required/],
    [{ WEBAUTHN_RP_ID: 'climacerto.test', WEBAUTHN_ORIGINS: 'http://climacerto.test' }, /https/],
    [{ WEBAUTHN_RP_ID: 'climacerto.test', WEBAUTHN_ORIGINS: 'https://outro.test' }, /not within/],
    [
      { WEBAUTHN_RP_ID: 'https://climacerto.test', WEBAUTHN_ORIGINS: 'https://climacerto.test' },
      /without protocol/,
    ],
  ])('fails fast on invalid config %p', (input, message) => {
    expect(() => parseWebAuthnConfig(input, 'App')).toThrow(message);
  });
});

describe('WebAuthn — login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports disabled when not configured', async () => {
    const { service } = serviceWith({ enabled: false });
    expect(service.status()).toEqual({ enabled: false });
    expect(await codeOf(service.authenticationOptions())).toBe('WEBAUTHN_DISABLED');
  });

  it('logs in through the same path as the password (completeLogin)', async () => {
    const stored = {
      id: 'pk-1',
      userId: 'u1',
      credentialId: 'cred-1',
      publicKey: Buffer.from([1, 2]),
      counter: 3n,
      transports: ['internal'],
      user,
    };
    const { service, prisma, auth } = serviceWith({
      challenge: {
        purpose: 'AUTHENTICATION',
        userId: null,
        challenge: 'auth-challenge',
        expiresAt: future(),
      },
      stored,
    });
    webauthn.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 4 },
    });

    await service.verifyAuthentication(
      { challengeId: 'ch-1', response: { id: 'cred-1' } as never, channel: LoginChannel.OPERATOR },
      context,
    );

    expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'auth-challenge',
        expectedRPID: 'climacerto.test',
        expectedOrigin: cfg.origins,
        requireUserVerification: true,
      }),
    );
    expect(prisma.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: 'pk-1' },
      data: expect.objectContaining({ counter: 4n }) as unknown,
    });
    expect(auth.completeLogin).toHaveBeenCalledWith(user, LoginChannel.OPERATOR, context, {
      method: 'passkey',
      email: user.email,
      credentialId: 'pk-1',
    });
  });

  it('rejects an expired, reused or wrong-purpose challenge', async () => {
    const reused = serviceWith({ challenge: null });
    expect(
      await codeOf(
        reused.service.verifyAuthentication(
          { challengeId: 'x', response: { id: 'c' } as never },
          context,
        ),
      ),
    ).toBe('WEBAUTHN_CHALLENGE_INVALID');
    const expired = serviceWith({
      challenge: {
        purpose: 'AUTHENTICATION',
        userId: null,
        challenge: 'c',
        expiresAt: new Date(0),
      },
    });
    expect(
      await codeOf(
        expired.service.verifyAuthentication(
          { challengeId: 'x', response: { id: 'c' } as never },
          context,
        ),
      ),
    ).toBe('WEBAUTHN_CHALLENGE_INVALID');
    const wrongPurpose = serviceWith({
      challenge: { purpose: 'REGISTRATION', userId: null, challenge: 'c', expiresAt: future() },
    });
    expect(
      await codeOf(
        wrongPurpose.service.verifyAuthentication(
          { challengeId: 'x', response: { id: 'c' } as never },
          context,
        ),
      ),
    ).toBe('WEBAUTHN_CHALLENGE_INVALID');
  });

  it('answers an unknown passkey or bad signature with the generic invalid-credentials error', async () => {
    const challenge = {
      purpose: 'AUTHENTICATION',
      userId: null,
      challenge: 'c',
      expiresAt: future(),
    };
    const unknown = serviceWith({ challenge, stored: null });
    expect(
      await codeOf(
        unknown.service.verifyAuthentication(
          { challengeId: 'x', response: { id: 'c' } as never },
          context,
        ),
      ),
    ).toBe('AUTH_INVALID_CREDENTIALS');

    const stored = {
      id: 'pk-1',
      userId: 'u1',
      credentialId: 'c',
      publicKey: Buffer.from([1]),
      counter: 0n,
      transports: [],
      user,
    };
    const bad = serviceWith({ challenge, stored });
    webauthn.verifyAuthenticationResponse.mockRejectedValue(new Error('signature mismatch'));
    expect(
      await codeOf(
        bad.service.verifyAuthentication(
          { challengeId: 'x', response: { id: 'c' } as never },
          context,
        ),
      ),
    ).toBe('AUTH_INVALID_CREDENTIALS');
    expect(bad.auth.completeLogin).not.toHaveBeenCalled();
  });

  it('refuses an inactive or archived user even with a valid passkey', async () => {
    const challenge = {
      purpose: 'AUTHENTICATION',
      userId: null,
      challenge: 'c',
      expiresAt: future(),
    };
    webauthn.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });
    for (const blocked of [
      { ...user, isActive: false },
      { ...user, deletedAt: new Date() },
    ]) {
      const stored = {
        id: 'pk-1',
        userId: 'u1',
        credentialId: 'c',
        publicKey: Buffer.from([1]),
        counter: 0n,
        transports: [],
        user: blocked,
      };
      const { service, auth } = serviceWith({ challenge, stored });
      expect(
        await codeOf(
          service.verifyAuthentication(
            { challengeId: 'x', response: { id: 'c' } as never },
            context,
          ),
        ),
      ).toBe('AUTH_USER_INACTIVE');
      expect(auth.completeLogin).not.toHaveBeenCalled();
    }
  });
});

describe('WebAuthn — registration and devices', () => {
  beforeEach(() => jest.clearAllMocks());
  const actor = { id: 'u1', email: user.email, name: user.name, role: Role.OPERATOR } as never;

  it('requires user verification and a discoverable passkey', async () => {
    const { service } = serviceWith({});
    await service.registrationOptions(actor);
    expect(webauthn.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'climacerto.test',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      }),
    );
  });

  it('only accepts the registration challenge issued to the same user', async () => {
    const { service } = serviceWith({
      challenge: { purpose: 'REGISTRATION', userId: 'outro', challenge: 'c', expiresAt: future() },
    });
    expect(
      await codeOf(
        service.verifyRegistration(actor, { challengeId: 'x', response: {} as never }, context),
      ),
    ).toBe('WEBAUTHN_CHALLENGE_INVALID');
  });

  it("does not let a user remove someone else's device", async () => {
    const { service, prisma } = serviceWith({});
    expect(await codeOf(service.remove(actor, 'pk-de-outro', context))).toBe(
      'WEBAUTHN_CREDENTIAL_NOT_FOUND',
    );
    expect(prisma.webAuthnCredential.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pk-de-outro', userId: 'u1' } }),
    );
  });
});
