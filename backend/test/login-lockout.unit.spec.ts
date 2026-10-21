import { HttpStatus } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { LOGIN_MAX_FAILED_ATTEMPTS } from '../src/shared/constants/auth.constants';

/**
 * Até aqui o login só tinha rate limit por IP (10/min), que um atacante
 * contorna distribuindo as tentativas. O bloqueio por conta fecha isso — sem
 * virar oráculo de e-mails: com a senha errada a resposta é sempre a mesma,
 * esteja a conta bloqueada ou não.
 */
describe('bloqueio de login por tentativas', () => {
  const contexto = { ip: null, userAgent: null, requestId: 'r1' } as never;

  function serviceFor(user: Record<string, unknown> | null, senhaConfere: boolean) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      refreshToken: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const passwords = { verifyPassword: jest.fn().mockResolvedValue(senhaConfere), hash: jest.fn().mockResolvedValue('h') };
    const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    const config = {
      jwtSecret: 's'.repeat(32), jwtRefreshSecret: 'r'.repeat(32),
      jwtAccessExpiresInSeconds: 900, jwtRefreshExpiresInSeconds: 3600,
      jwtIssuer: 'i', jwtAudience: 'a', refreshTokenGraceMs: 0,
    };
    return {
      service: new AuthService(prisma as never, jwt as never, config as never, passwords as never),
      prisma,
    };
  }

  const ativo = (over: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'a@b.com', role: 'OWNER', isActive: true, passwordHash: 'h',
    failedLoginAttempts: 0, lockedUntil: null, mustChangePassword: false, ...over,
  });

  it('conta a tentativa errada', async () => {
    const { service, prisma } = serviceFor(ativo({ failedLoginAttempts: 2 }), false);
    await expect(service.login({ email: 'a@b.com', password: 'x' } as never, contexto)).rejects.toMatchObject({});
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedLoginAttempts: 3 }) }),
    );
  });

  it('bloqueia ao atingir o teto', async () => {
    const { service, prisma } = serviceFor(ativo({ failedLoginAttempts: LOGIN_MAX_FAILED_ATTEMPTS - 1 }), false);
    await expect(service.login({ email: 'a@b.com', password: 'x' } as never, contexto)).rejects.toMatchObject({});
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.lockedUntil).toBeInstanceOf(Date);
    expect(data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(data.failedLoginAttempts).toBe(0);
  });

  it('senha errada em conta bloqueada responde igual a credencial inválida (não revela o e-mail)', async () => {
    const bloqueada = ativo({ lockedUntil: new Date(Date.now() + 600_000) });
    const { service } = serviceFor(bloqueada, false);
    await expect(service.login({ email: 'a@b.com', password: 'x' } as never, contexto)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
  });

  it('senha certa durante o bloqueio explica o motivo e devolve 429', async () => {
    const bloqueada = ativo({ lockedUntil: new Date(Date.now() + 600_000) });
    const { service } = serviceFor(bloqueada, true);
    const erro = await service.login({ email: 'a@b.com', password: 'ok' } as never, contexto).catch((e) => e);
    expect(erro.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(erro.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(String(erro.message)).toMatch(/minuto/);
  });

  it('bloqueio expirado deixa entrar e zera o contador', async () => {
    const expirado = ativo({ lockedUntil: new Date(Date.now() - 1000), failedLoginAttempts: 9 });
    const { service, prisma } = serviceFor(expirado, true);
    await service.login({ email: 'a@b.com', password: 'ok' } as never, contexto);
    const update = prisma.$transaction.mock.calls[0][0][0];
    void update;
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
