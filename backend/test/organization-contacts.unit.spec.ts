import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { parseInstagramHandle } from '../src/modules/config/configuration';
import { UpdateOrganizationDto } from '../src/modules/organization/dto/organization.dto';
import { OrganizationService } from '../src/modules/organization/organization.service';

const context = { requestId: 'request-1', ip: '127.0.0.1', userAgent: 'jest' };
const user = { id: 'owner-1' } as never;

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
  contacts: [] as Array<{ name: string; role: string | null; phone: string; isWhatsapp: boolean }>,
};

type UpdateArgs = { data: Record<string, unknown> };

function serviceWith(
  organization: typeof baseOrganization,
  instagram: string | null = null,
): { service: OrganizationService; updateData: () => Record<string, unknown> } {
  const update = jest.fn<Promise<{ id: string }>, [UpdateArgs]>().mockResolvedValue({ id: 'org-1' });
  const transaction = {
    organization: { update },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org-1', ...organization }) },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  return {
    service: new OrganizationService(
      prisma as never,
      {} as never,
      { organizationInstagram: instagram } as never,
    ),
    updateData: () => update.mock.calls[0][0].data,
  };
}

describe('Organization contacts — public profile', () => {
  it('lists each responsible with their own WhatsApp and uses the first as primary', async () => {
    const { service } = serviceWith({
      ...baseOrganization,
      contacts: [
        { name: 'Ana', role: 'Comercial', phone: '(81) 99999-0000', isWhatsapp: true },
        { name: 'Bruno', role: null, phone: '+55 81 98888-1111', isWhatsapp: true },
      ],
    });

    const profile = await service.getPublicProfile();

    expect(profile.contacts).toEqual([
      { name: 'Ana', role: 'Comercial', phone: '(81) 99999-0000', whatsapp: '5581999990000' },
      { name: 'Bruno', role: null, phone: '+55 81 98888-1111', whatsapp: '5581988881111' },
    ]);
    expect(profile.whatsapp).toBe('5581999990000');
    expect(profile.phones).toEqual(['(81) 3333-4444', '(81) 99999-0000', '+55 81 98888-1111']);
  });

  it('skips responsibles without WhatsApp when picking the primary number', async () => {
    const { service } = serviceWith({
      ...baseOrganization,
      contacts: [
        { name: 'Ana', role: null, phone: '(81) 3222-0000', isWhatsapp: false },
        { name: 'Bruno', role: null, phone: '(81) 98888-1111', isWhatsapp: true },
      ],
    });

    const profile = await service.getPublicProfile();

    expect(profile.contacts[0].whatsapp).toBeNull();
    expect(profile.whatsapp).toBe('5581988881111');
  });

  it('falls back to the organization phone when no responsible is registered', async () => {
    const { service } = serviceWith(baseOrganization);

    const profile = await service.getPublicProfile();

    expect(profile.contacts).toEqual([]);
    expect(profile.whatsapp).toBe('558133334444');
  });
});

describe('Organization contacts — update', () => {
  it('replaces the whole list keeping the received order as position', async () => {
    const { service, updateData } = serviceWith(baseOrganization);

    await service.updateOrganization(
      {
        tradeName: 'Clima Certo',
        contacts: [
          { name: 'Ana', role: '', phone: '(81) 99999-0000' },
          { name: 'Bruno', phone: '(81) 98888-1111', isWhatsapp: false },
        ],
      },
      user,
      context,
    );

    const data = updateData();
    expect(data.tradeName).toBe('Clima Certo');
    expect(data.contacts).toEqual({
      deleteMany: {},
      create: [
        { name: 'Ana', role: null, phone: '(81) 99999-0000', isWhatsapp: true, position: 0 },
        { name: 'Bruno', role: null, phone: '(81) 98888-1111', isWhatsapp: false, position: 1 },
      ],
    });
  });

  it('keeps the current contacts when the field is omitted', async () => {
    const { service, updateData } = serviceWith(baseOrganization);

    await service.updateOrganization({ tradeName: 'Clima Certo' }, user, context);

    expect(updateData()).not.toHaveProperty('contacts');
  });

  it('rejects invalid contacts in the DTO', async () => {
    const dto = plainToInstance(UpdateOrganizationDto, {
      contacts: [{ name: 'A', phone: 'abc' }],
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain('contacts');
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
