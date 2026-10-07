import { type CustomerPortalAccount, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CustomerPortalService } from '../../src/modules/customer-portal/customer-portal.service';
import type { AuthenticatedUser } from '../../src/shared/types/authenticated-user.type';
import {
  createActor,
  createCustomerGraph,
  createOrganization,
  disconnectDatabase,
  prisma,
  resetDatabase,
} from './helpers';

describe('Customer portal account CRUD', () => {
  const service = new CustomerPortalService(
    prisma as never,
    {} as never,
    {} as never,
    { hash: (password: string) => Promise.resolve(`hashed:${password}`) } as never,
    {} as never,
  );

  beforeEach(resetDatabase);
  afterAll(disconnectDatabase);

  async function fixture(): Promise<{
    actor: AuthenticatedUser;
    account: CustomerPortalAccount;
    sessionId: string;
  }> {
    const organization = await createOrganization();
    const actor = await createActor();
    const customer = await createCustomerGraph();
    const account = await prisma.customerPortalAccount.create({
      data: {
        organizationId: organization.id,
        customerId: customer.customerId,
        name: 'Cliente do portal',
        email: 'portal@orbit.test',
        phone: '81999999999',
        passwordHash: 'original-secret-hash',
        mustChangePassword: false,
      },
    });
    const sessionId = randomUUID();
    await prisma.customerPortalRefreshToken.create({
      data: {
        id: sessionId,
        accountId: account.id,
        tokenHash: 'original-session-hash',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return { actor, account, sessionId };
  }

  it('edits the portal identity without changing the customer, credentials or internal users', async () => {
    const { actor, account, sessionId } = await fixture();
    const updated = await service.updateAccount(
      account.id,
      { name: 'Novo nome', email: 'novo@orbit.test', phone: null },
      actor,
    );
    expect(updated).toMatchObject({
      id: account.id,
      customerId: account.customerId,
      name: 'Novo nome',
      email: 'novo@orbit.test',
      phone: null,
      mustChangePassword: false,
    });
    expect(updated).not.toHaveProperty('passwordHash');
    expect(updated).not.toHaveProperty('refreshTokens');
    const stored = await prisma.customerPortalAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(stored.passwordHash).toBe(account.passwordHash);
    expect(
      (await prisma.customerPortalRefreshToken.findUniqueOrThrow({ where: { id: sessionId } }))
        .revokedAt,
    ).not.toBeNull();
    expect(await prisma.user.count()).toBe(1);
  });

  it('does not reset a password or revoke the session when only name and phone change', async () => {
    const { actor, account, sessionId } = await fixture();
    await service.updateAccount(
      account.id,
      { name: 'Outro nome', email: account.email, phone: '81888888888' },
      actor,
    );
    expect(
      (await prisma.customerPortalRefreshToken.findUniqueOrThrow({ where: { id: sessionId } }))
        .revokedAt,
    ).toBeNull();
    expect(
      (await prisma.customerPortalAccount.findUniqueOrThrow({ where: { id: account.id } }))
        .passwordHash,
    ).toBe(account.passwordHash);
  });

  it('disables and enables access while keeping old sessions revoked', async () => {
    const { actor, account, sessionId } = await fixture();
    expect((await service.disableAccount(account.id, actor)).isActive).toBe(false);
    expect((await service.enableAccount(account.id, actor)).isActive).toBe(true);
    expect(
      (await prisma.customerPortalRefreshToken.findUniqueOrThrow({ where: { id: sessionId } }))
        .revokedAt,
    ).not.toBeNull();
  });

  it('resets the password using the portal account and revokes previous sessions', async () => {
    const { actor, account, sessionId } = await fixture();
    const result = await service.resetAccountPassword(account.id, actor);
    expect(result.temporaryPassword).toBeTruthy();
    expect(result.account.mustChangePassword).toBe(true);
    expect(result.account).not.toHaveProperty('passwordHash');
    expect(
      (await prisma.customerPortalAccount.findUniqueOrThrow({ where: { id: account.id } }))
        .passwordHash,
    ).toBe(`hashed:${result.temporaryPassword}`);
    expect(
      (await prisma.customerPortalRefreshToken.findUniqueOrThrow({ where: { id: sessionId } }))
        .revokedAt,
    ).not.toBeNull();
  });

  it('deletes an unused account and its sessions while preserving the customer', async () => {
    const { actor, account } = await fixture();
    expect(await service.deleteAccount(account.id, actor)).toEqual({
      deleted: true,
      mode: 'deleted',
    });
    expect(await prisma.customerPortalAccount.findUnique({ where: { id: account.id } })).toBeNull();
    expect(
      await prisma.customerPortalRefreshToken.count({ where: { accountId: account.id } }),
    ).toBe(0);
    expect(await prisma.customer.findUnique({ where: { id: account.customerId } })).not.toBeNull();
  });

  it('archives accounts with tickets, hides them from the directory and prevents restoring their access', async () => {
    const { actor, account, sessionId } = await fixture();
    const ticket = await prisma.customerServiceTicket.create({
      data: {
        organizationId: account.organizationId,
        customerId: account.customerId,
        accountId: account.id,
        title: 'Histórico do cliente',
        description: 'Solicitação anterior',
      },
    });
    expect(await service.deleteAccount(account.id, actor)).toEqual({
      deleted: true,
      mode: 'archived',
    });
    const stored = await prisma.customerPortalAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.isActive).toBe(false);
    expect(
      await prisma.customerServiceTicket.findUnique({ where: { id: ticket.id } }),
    ).not.toBeNull();
    expect(
      (await prisma.customerPortalRefreshToken.findUniqueOrThrow({ where: { id: sessionId } }))
        .revokedAt,
    ).not.toBeNull();
    const directory = (await service.listAccountDirectory({ page: 1, limit: 20 })) as {
      items: unknown[];
    };
    expect(directory.items).toHaveLength(0);
    expect(await service.listAccounts(account.customerId)).toEqual([]);
    await expect(service.enableAccount(account.id, actor)).rejects.toThrow('não encontrado');
    await expect(service.resetAccountPassword(account.id, actor)).rejects.toThrow('não encontrado');
    await expect(
      service.provisionAccount(
        { customerId: account.customerId, email: account.email, name: account.name },
        actor,
      ),
    ).rejects.toThrow('acesso excluído');
  });

  it('rejects duplicate emails without partially updating the account', async () => {
    const { actor, account } = await fixture();
    await prisma.customerPortalAccount.create({
      data: {
        organizationId: account.organizationId,
        customerId: account.customerId,
        name: 'Outro acesso',
        email: 'outro@orbit.test',
        passwordHash: 'other-secret-hash',
      },
    });
    await expect(
      service.updateAccount(
        account.id,
        { name: 'Nome inválido', email: 'outro@orbit.test', phone: null },
        actor,
      ),
    ).rejects.toThrow('E-mail já cadastrado');
    expect(
      (await prisma.customerPortalAccount.findUniqueOrThrow({ where: { id: account.id } })).name,
    ).toBe(account.name);
  });

  it.each([Role.OPERATOR, Role.VIEWER])('rejects account management by %s', async (role) => {
    const { account } = await fixture();
    const actor = await createActor(role);
    await expect(
      service.updateAccount(
        account.id,
        { name: 'Outra pessoa', email: account.email, phone: null },
        actor,
      ),
    ).rejects.toThrow('permissão');
    await expect(service.deleteAccount(account.id, actor)).rejects.toThrow('permissão');
    await expect(service.resetAccountPassword(account.id, actor)).rejects.toThrow('permissão');
  });
});
