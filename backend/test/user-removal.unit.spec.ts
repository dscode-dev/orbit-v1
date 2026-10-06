import { Prisma, Role } from '@prisma/client';
import { UsersService } from '../src/modules/users/users.service';
import { USER_HISTORY_RELATIONS, USER_OWNED_RELATIONS } from '../src/modules/users/user-history';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

const context = { requestId: 'request-1', ip: '127.0.0.1', userAgent: 'jest' };
const actor = { id: 'owner-1', role: Role.OWNER } as never;
const TARGET = '7c0e2a9f-1111-4222-8333-944455556666';

const existingUser = {
  id: TARGET,
  email: 'tecnico@climacerto.test',
  username: 'tecnico',
  name: 'Técnico Teste',
  role: Role.OPERATOR,
  isActive: true,
  disabledAt: null,
};

type Footprint = {
  counts?: Partial<Record<(typeof USER_HISTORY_RELATIONS)[number], number>>;
  signature?: { id: string; imageStorageKey: string | null; usedIn?: number } | null;
  avatar?: { id: string; storageKey: string } | null;
};

function zeroCounts(): Record<string, number> {
  return Object.fromEntries(USER_HISTORY_RELATIONS.map((name) => [name, 0]));
}

function serviceWith(footprint: Footprint): {
  service: UsersService;
  prisma: Record<string, Record<string, jest.Mock>>;
  storageDelete: jest.Mock;
} {
  const signature = footprint.signature
    ? {
        id: footprint.signature.id,
        imageStorageKey: footprint.signature.imageStorageKey,
        _count: {
          templates: 0,
          templateLinks: 0,
          pmocOverrides: 0,
          selectedDocuments: footprint.signature.usedIn ?? 0,
          operationCancellations: 0,
        },
      }
    : null;
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(existingUser),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        _count: { ...zeroCounts(), ...footprint.counts },
        institutionalSignature: signature,
        avatarAsset: footprint.avatar ?? null,
      }),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    signature: {
      delete: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    userAvatarAsset: { delete: jest.fn().mockResolvedValue({}) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
    webAuthnCredential: { deleteMany: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    ...prisma,
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => unknown)(prisma)
        : Promise.all(arg as unknown[]),
    ),
  };
  const storageDelete = jest.fn().mockResolvedValue(undefined);
  return {
    service: new UsersService(client as never, {} as never, { delete: storageDelete } as never),
    prisma,
    storageDelete,
  };
}

describe('User removal — relation classification', () => {
  it('classifies every User relation as history or owned data', () => {
    const userModel = Prisma.dmmf.datamodel.models.find((model) => model.name === 'User');
    const relations = (userModel?.fields ?? [])
      .filter((field) => field.kind === 'object')
      .map((field) => field.name)
      .sort();
    const classified = [...USER_HISTORY_RELATIONS, ...USER_OWNED_RELATIONS].sort();

    // Se falhar: um relacionamento novo de User precisa entrar em user-history.ts.
    expect(relations).toEqual(classified);
  });
});

describe('User removal — behaviour', () => {
  it('deletes the user, signature and avatar (with files) when there is no history', async () => {
    const { service, prisma, storageDelete } = serviceWith({
      signature: { id: 'sig-1', imageStorageKey: 'signatures/sig-1.png' },
      avatar: { id: 'av-1', storageKey: 'users/avatar/av-1.png' },
    });

    await expect(service.remove(TARGET, actor, context)).resolves.toEqual({
      deleted: true,
      mode: 'deleted',
    });

    expect(prisma.signature.delete).toHaveBeenCalledWith({ where: { id: 'sig-1' } });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
    expect(prisma.userAvatarAsset.delete).toHaveBeenCalledWith({ where: { id: 'av-1' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(storageDelete.mock.calls.map(([key]) => key as string).sort()).toEqual([
      'signatures/sig-1.png',
      'users/avatar/av-1.png',
    ]);
  });

  it('archives (inactive, hidden, credentials freed) when the user has operations', async () => {
    const { service, prisma, storageDelete } = serviceWith({
      counts: { operations: 3, assignmentsReceived: 2 },
      signature: { id: 'sig-1', imageStorageKey: 'signatures/sig-1.png' },
    });

    await expect(service.remove(TARGET, actor, context)).resolves.toEqual({
      deleted: true,
      mode: 'archived',
    });

    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.signature.delete).not.toHaveBeenCalled();
    expect(storageDelete).not.toHaveBeenCalled();
    const { data } = (prisma.user.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0];
    expect(data).toMatchObject({
      isActive: false,
      email: 'tecnico@climacerto.test#excluido-7c0e2a9f',
    });
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.username).toBe('excluido-7c0e2a9f-tecnico');
    expect(prisma.signature.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET, deletedAt: null },
      data: expect.objectContaining({ active: false }) as unknown,
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    // Biometria cadastrada é apagada: o usuário arquivado não entra mais.
    expect(prisma.webAuthnCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: TARGET },
    });
    const audit = (
      prisma.auditLog.create.mock.calls[0] as [{ data: { metadata: Record<string, unknown> } }]
    )[0];
    expect(audit.data.metadata).toMatchObject({
      mode: 'archived',
      email: 'tecnico@climacerto.test',
      history: { operations: 3, assignmentsReceived: 2 },
    });
  });

  it('archives when only the signature was already used in documents', async () => {
    const { service, prisma } = serviceWith({
      signature: { id: 'sig-1', imageStorageKey: 'signatures/sig-1.png', usedIn: 1 },
    });

    await expect(service.remove(TARGET, actor, context)).resolves.toMatchObject({
      mode: 'archived',
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('does not let a user delete themselves', async () => {
    const { service } = serviceWith({});

    const error = await service.remove('owner-1', actor, context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApplicationException);
  });

  it('hides archived users from the list and from edits', async () => {
    const { service, prisma } = serviceWith({});
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    Object.assign(prisma.user, { findMany, count });

    await service.list({ page: 1, limit: 20 });
    await service.list({ page: 1, limit: 20, search: 'ana' });
    await service.get(TARGET);

    const wheres = findMany.mock.calls.map(
      ([args]) => (args as { where: Record<string, unknown> }).where,
    );
    expect(wheres[0]).toEqual({ deletedAt: null });
    expect(wheres[1]).toMatchObject({ deletedAt: null });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TARGET, deletedAt: null } }),
    );
  });
});
