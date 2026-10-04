import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../src/infra/security/argon2.constants';

const password = '  S3cure#$Value!  ';

describe('OWNER seed credentials', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
    jest.dontMock('@prisma/client');
    jest.dontMock('../src/seed-environment');
  });

  async function runSeed(existingPassword: string | null): Promise<{
    prisma: ReturnType<typeof prismaMock>;
    output: jest.SpyInstance;
    errors: jest.SpyInstance;
  }> {
    const hash =
      existingPassword === null ? null : await argon2.hash(existingPassword, ARGON2_OPTIONS);
    const existing =
      hash === null
        ? null
        : {
            id: 'owner-1',
            role: Role.OWNER,
            isActive: true,
            disabledAt: null,
            passwordHash: hash,
          };
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const prisma = prismaMock(existing, finish);
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const errors = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.exitCode = 0;

    jest.doMock('@prisma/client', () => ({
      ...jest.requireActual<object>('@prisma/client'),
      PrismaClient: jest.fn().mockReturnValue(prisma),
    }));
    jest.doMock('../src/seed-environment', () => ({
      loadBootstrapEnvironment: jest.fn().mockReturnValue('/project/.env'),
      ownerBootstrapInput: jest.fn().mockReturnValue({
        email: 'owner@orbit.test',
        username: 'owner',
        name: 'Proprietário',
        password,
      }),
    }));
    jest.isolateModules(() => {
      jest.requireActual('../src/seed');
    });
    await finished;
    return { prisma, output, errors };
  }

  function prismaMock(
    existing: object | null,
    finish: () => void,
  ): {
    user: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock; update: jest.Mock };
    organization: { findFirst: jest.Mock };
    documentTemplate: { findFirst: jest.Mock };
    technicalCatalog: { findMany: jest.Mock; createMany: jest.Mock };
    userPreferences: { upsert: jest.Mock };
    userPermission: { upsert: jest.Mock };
    $transaction: jest.Mock;
    $disconnect: jest.Mock;
  } {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue(existing),
        count: jest.fn().mockResolvedValue(existing ? 1 : 0),
        create: jest.fn().mockResolvedValue({ id: 'owner-1' }),
        update: jest.fn(),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'org-1', _count: { contacts: 1 } }),
      },
      documentTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 'template-1' }) },
      technicalCatalog: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({}),
      },
      userPreferences: { upsert: jest.fn().mockResolvedValue({}) },
      userPermission: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
      $disconnect: jest.fn().mockImplementation(finish),
    };
  }

  it('creates the first OWNER with a hash of the exact configured password', async () => {
    const { prisma, output, errors } = await runSeed(null);
    const call = prisma.user.create.mock.calls[0] as [{ data: { passwordHash: string } }];

    expect(await argon2.verify(call[0].data.passwordHash, password)).toBe(true);
    expect(await argon2.verify(call[0].data.passwordHash, password.trim())).toBe(false);
    expect(process.exitCode).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(JSON.stringify(output.mock.calls)).not.toContain(password);
  });

  it('reports a mismatching existing password without resetting credentials', async () => {
    const { prisma, errors } = await runSeed('PreviousCredential123!');

    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(errors.mock.calls)).toContain('OWNER_PASSWORD does not match');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('remains idempotent when the existing OWNER password matches', async () => {
    const { prisma, output, errors } = await runSeed(password);

    expect(process.exitCode).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(JSON.stringify(output.mock.calls)).toContain('owner_bootstrap_skipped');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
