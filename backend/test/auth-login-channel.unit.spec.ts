import { HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';
import { LoginChannel } from '../src/modules/auth/dto/login.dto';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

const context = { requestId: 'request-1', ip: '127.0.0.1', userAgent: 'jest' };

function serviceFor(role: Role): AuthService {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@orbit.test', username: 'user', name: 'User', role, passwordHash: 'hash', isActive: true }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const passwords = { verifyPassword: jest.fn().mockResolvedValue(true) };
  return new AuthService(prisma as never, {} as never, {} as never, passwords as never);
}

describe('AuthService login channels', () => {
  it('blocks an OPERATOR at the Platform login boundary', async () => {
    const error = await serviceFor(Role.OPERATOR).login({ email: 'user@orbit.test', password: 'Secret1!', channel: LoginChannel.PLATFORM }, context).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApplicationException);
    expect((error as ApplicationException).code).toBe('AUTH_LOGIN_CHANNEL_FORBIDDEN');
    expect((error as ApplicationException).getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it('blocks a MANAGER at the Operator login boundary', async () => {
    const error = await serviceFor(Role.MANAGER).login({ email: 'user@orbit.test', password: 'Secret1!', channel: LoginChannel.OPERATOR }, context).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApplicationException);
    expect((error as ApplicationException).code).toBe('AUTH_LOGIN_CHANNEL_FORBIDDEN');
    expect((error as ApplicationException).getStatus()).toBe(HttpStatus.FORBIDDEN);
  });
});
