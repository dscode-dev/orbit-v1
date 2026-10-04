import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { parseInstagramHandle } from '../src/modules/config/configuration';
import { CreateOrganizationContactDto } from '../src/modules/organization/dto/organization.dto';
import { OrganizationService } from '../src/modules/organization/organization.service';
import { ApplicationException } from '../src/shared/exceptions/application.exception';

const context = { requestId: 'request-1', ip: '127.0.0.1', userAgent: 'jest' };
const user = { id: 'owner-1' } as never;

type Contact = {
  id: string;
  name: string;
  role: string | null;
  phone: string;
  isWhatsapp: boolean;
  showOnLanding: boolean;
  position: number;
};

function contact(overrides: Partial<Contact> & Pick<Contact, 'id' | 'name' | 'phone'>): Contact {
  return { role: null, isWhatsapp: true, showOnLanding: false, position: 0, ...overrides };
}

const baseOrganization = {
  tradeName: 'Clima Certo Refrigeração',
  segment: 'HVAC-R',
  email: 'contato@climacerto.test',
  phone: '(81) 3333-4444',
  phoneNumbers: [] as string[],
  website: null,
  city: 'Recife',
  state: 'PE',
  primaryColor: '#1A3FB8',
  secondaryColor: '#0B1F6B',
  contacts: [] as Contact[],
};

type WriteArgs = { data: Record<string, unknown> };

/**
 * O findFirst do mock devolve a organização como o Prisma devolveria para a
 * consulta em questão (no perfil público, já só com os contatos da landing).
 */
function serviceWith(
  organization: typeof baseOrganization,
  instagram: string | null = null,
): {
  service: OrganizationService;
  createData: () => Record<string, unknown>;
  updateData: () => Record<string, unknown>;
  deleted: jest.Mock;
} {
  const create = jest.fn<Promise<{ id: string }>, [WriteArgs]>().mockResolvedValue({ id: 'new' });
  const update = jest.fn<Promise<{ id: string }>, [WriteArgs]>().mockResolvedValue({ id: 'c1' });
  const deleted = jest.fn().mockResolvedValue({});
  const transaction = {
    organizationContact: { create, update },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1', ...organization }) },
    organizationContact: { delete: deleted },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof transaction) => unknown)(transaction)
        : Promise.all(arg as unknown[]),
    ),
  };
  return {
    service: new OrganizationService(
      prisma as never,
      {} as never,
      { organizationInstagram: instagram } as never,
    ),
    createData: () => create.mock.calls[0][0].data,
    updateData: () => update.mock.calls[0][0].data,
    deleted,
  };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((cause: unknown) => cause);
  return error instanceof ApplicationException ? error.code : undefined;
}

describe('Organization contacts — public profile', () => {
  it('lists the landing contacts with their own WhatsApp and uses the first as primary', async () => {
    const { service } = serviceWith({
      ...baseOrganization,
      contacts: [
        contact({ id: 'c1', name: 'Ana', role: 'Comercial', phone: '(81) 99999-0000' }),
        contact({ id: 'c2', name: 'Bruno', phone: '+55 81 98888-1111' }),
      ],
    });

    const profile = await service.getPublicProfile();

    expect(profile.contacts).toEqual([
      { name: 'Ana', role: 'Comercial', phone: '(81) 99999-0000', whatsapp: '5581999990000' },
      { name: 'Bruno', role: null, phone: '+55 81 98888-1111', whatsapp: '5581988881111' },
    ]);
    expect(profile.whatsapp).toBe('5581999990000');
  });

  it('does not generate a WhatsApp link for a contact that is not WhatsApp', async () => {
    const { service } = serviceWith({
      ...baseOrganization,
      contacts: [
        contact({ id: 'c1', name: 'Ana', phone: '(81) 3222-0000', isWhatsapp: false }),
        contact({ id: 'c2', name: 'Bruno', phone: '(81) 98888-1111' }),
      ],
    });

    const profile = await service.getPublicProfile();

    expect(profile.contacts[0].whatsapp).toBeNull();
    expect(profile.whatsapp).toBe('5581988881111');
  });

  it('falls back to the organization phone when no contact is on the landing', async () => {
    const { service } = serviceWith(baseOrganization);

    const profile = await service.getPublicProfile();

    expect(profile.contacts).toEqual([]);
    expect(profile.whatsapp).toBe('558133334444');
  });
});

describe('Organization contacts — CRUD', () => {
  it('creates a contact at the end of the list', async () => {
    const { service, createData } = serviceWith({
      ...baseOrganization,
      contacts: [contact({ id: 'c1', name: 'Ana', phone: '(81) 99999-0000', position: 3 })],
    });

    await service.createContact(
      { name: 'Bruno', role: '', phone: '(81) 98888-1111' },
      user,
      context,
    );

    expect(createData()).toEqual({
      organizationId: 'org-1',
      name: 'Bruno',
      role: null,
      phone: '(81) 98888-1111',
      isWhatsapp: true,
      showOnLanding: false,
      position: 4,
    });
  });

  it('refuses a third contact on the landing (create and update)', async () => {
    const organization = {
      ...baseOrganization,
      contacts: [
        contact({ id: 'c1', name: 'Ana', phone: '(81) 99999-0000', showOnLanding: true }),
        contact({ id: 'c2', name: 'Bruno', phone: '(81) 98888-1111', showOnLanding: true }),
        contact({ id: 'c3', name: 'Caio', phone: '(81) 97777-2222' }),
      ],
    };
    const { service } = serviceWith(organization);

    expect(
      await errorCode(
        service.createContact(
          { name: 'Davi', phone: '(81) 96666-3333', showOnLanding: true },
          user,
          context,
        ),
      ),
    ).toBe('ORGANIZATION_LANDING_CONTACT_LIMIT');
    expect(
      await errorCode(service.updateContact('c3', { showOnLanding: true }, user, context)),
    ).toBe('ORGANIZATION_LANDING_CONTACT_LIMIT');
  });

  it('lets a contact already on the landing be edited without hitting the limit', async () => {
    const { service, updateData } = serviceWith({
      ...baseOrganization,
      contacts: [
        contact({ id: 'c1', name: 'Ana', phone: '(81) 99999-0000', showOnLanding: true }),
        contact({ id: 'c2', name: 'Bruno', phone: '(81) 98888-1111', showOnLanding: true }),
      ],
    });

    await service.updateContact(
      'c1',
      { showOnLanding: true, isWhatsapp: false, role: '' },
      user,
      context,
    );

    expect(updateData()).toEqual({ showOnLanding: true, isWhatsapp: false, role: null });
  });

  it('deletes a contact and reports unknown ids', async () => {
    const { service, deleted } = serviceWith({
      ...baseOrganization,
      contacts: [contact({ id: 'c1', name: 'Ana', phone: '(81) 99999-0000' })],
    });

    await expect(service.deleteContact('c1', user, context)).resolves.toEqual({ deleted: true });
    expect(deleted).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(await errorCode(service.deleteContact('nope', user, context))).toBe(
      'ORGANIZATION_CONTACT_NOT_FOUND',
    );
  });

  it('rejects invalid contacts in the DTO', async () => {
    const dto = plainToInstance(CreateOrganizationContactDto, { name: 'A', phone: 'abc' });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual(['name', 'phone']);
  });
});

describe('Organization Instagram (ORGANIZATION_INSTAGRAM)', () => {
  it.each([
    ['@Climacerto_refrigeracao', 'Climacerto_refrigeracao'],
    ['climacerto.refrigeracao', 'climacerto.refrigeracao'],
    ['https://www.instagram.com/Climacerto_refrigeracao/', 'Climacerto_refrigeracao'],
    ['  @empresa?igsh=abc ', 'empresa'],
  ])('normalizes %p to the bare username', (input, expected) => {
    expect(parseInstagramHandle(input)).toBe(expected);
  });

  it.each([undefined, null, '', '   '])('is optional: %p disables it', (input) => {
    expect(parseInstagramHandle(input)).toBeNull();
  });

  it('fails fast on an invalid username', () => {
    expect(() => parseInstagramHandle('@nome com espaço')).toThrow(/ORGANIZATION_INSTAGRAM/);
  });

  it('exposes the profile link on the public profile when configured', async () => {
    const { service } = serviceWith(baseOrganization, 'Climacerto_refrigeracao');

    const profile = await service.getPublicProfile();

    expect(profile.instagram).toEqual({
      handle: 'Climacerto_refrigeracao',
      url: 'https://www.instagram.com/Climacerto_refrigeracao/',
    });
  });

  it('omits Instagram from the public profile when not configured', async () => {
    const { service } = serviceWith(baseOrganization);

    expect((await service.getPublicProfile()).instagram).toBeNull();
  });
});
