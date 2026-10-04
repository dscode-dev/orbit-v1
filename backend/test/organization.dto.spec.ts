import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOrganizationDto } from '../src/modules/organization/dto/organization.dto';

describe('Organization update validation', () => {
  it.each(['12345678000190', '12.345.678/0001-90', ' 12.345.678/0001-90 '])(
    'accepts a CNPJ with the supported format: %s',
    async (cnpj) => {
      expect(await validate(plainToInstance(UpdateOrganizationDto, { cnpj }))).toHaveLength(0);
    },
  );

  it.each(['', '123', '12.345.678/0001', 'abcdefghijklmn'])(
    'rejects malformed CNPJ: %s',
    async (cnpj) => {
      const errors = await validate(plainToInstance(UpdateOrganizationDto, { cnpj }));
      expect(errors.some((error) => error.property === 'cnpj')).toBe(true);
      expect(JSON.stringify(errors)).toContain('CNPJ deve conter 14 dígitos');
    },
  );

  it.each(['', '   ', null])('accepts clearing the optional website: %s', async (website) => {
    const dto = plainToInstance(UpdateOrganizationDto, { website });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.website).toBeNull();
  });

  it('adds HTTPS to a website without a protocol and preserves path case', async () => {
    const dto = plainToInstance(UpdateOrganizationDto, {
      website: ' empresa.com.br/Contato?ref=Site ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.website).toBe('https://empresa.com.br/Contato?ref=Site');
  });

  it.each(['https://empresa.com.br/Contato', 'http://empresa.com.br'])(
    'accepts HTTP websites: %s',
    async (website) => {
      const dto = plainToInstance(UpdateOrganizationDto, { website });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.website).toBe(website);
    },
  );

  it.each(['not a website', 'javascript:alert(1)', 'ftp://empresa.com.br', 123])(
    'rejects invalid websites and unsupported protocols: %s',
    async (website) => {
      const errors = await validate(plainToInstance(UpdateOrganizationDto, { website }));
      expect(errors.some((error) => error.property === 'website')).toBe(true);
    },
  );

  it('allows a PATCH without CNPJ or website', async () => {
    const dto = plainToInstance(UpdateOrganizationDto, { city: 'Recife' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.cnpj).toBeUndefined();
    expect(dto.website).toBeUndefined();
  });
});
