import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerPortalChangePasswordDto } from '../src/modules/customer-portal/dto/customer-portal.dto';
import { ChangePasswordDto, CompleteFirstAccessDto } from '../src/modules/users/dto/user.dto';
import { MIN_PASSWORD_LENGTH } from '../src/shared/constants/users.constants';

async function invalidFields(dto: object): Promise<string[]> {
  return (await validate(dto)).map((error) => error.property);
}

describe('Password policy — minimum length', () => {
  it('is 8 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('accepts an 8-character new password and rejects 7 (platform and operator)', async () => {
    const ok = plainToInstance(ChangePasswordDto, {
      currentPassword: 'Temp1234',
      newPassword: 'Nova1234',
    });
    const short = plainToInstance(ChangePasswordDto, {
      currentPassword: 'Temp1234',
      newPassword: 'Nova123',
    });

    expect(await invalidFields(ok)).toEqual([]);
    expect(await invalidFields(short)).toEqual(['newPassword']);
  });

  it('applies the same minimum to the first access (operator app)', async () => {
    const dto = plainToInstance(CompleteFirstAccessDto, {
      currentPassword: 'Temp1234',
      newPassword: 'Nova1234',
      signatureTitle: 'Técnico',
    });

    expect(await invalidFields(dto)).toEqual([]);
  });

  it('keeps the complexity rules in the customer portal with the new minimum', async () => {
    const ok = plainToInstance(CustomerPortalChangePasswordDto, {
      currentPassword: 'x',
      newPassword: 'Ab1!cdef',
    });
    const short = plainToInstance(CustomerPortalChangePasswordDto, {
      currentPassword: 'x',
      newPassword: 'Ab1!cde',
    });
    const weak = plainToInstance(CustomerPortalChangePasswordDto, {
      currentPassword: 'x',
      newPassword: 'abcdefgh',
    });

    expect(await invalidFields(ok)).toEqual([]);
    expect(await invalidFields(short)).toEqual(['newPassword']);
    expect(await invalidFields(weak)).toEqual(['newPassword']);
  });
});
