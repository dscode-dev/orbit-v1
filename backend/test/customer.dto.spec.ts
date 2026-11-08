import 'reflect-metadata';
import { CustomerType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCustomerDto,
  CreateWalkInCustomerDto,
  CustomerAddressDto,
  ListCustomersQueryDto,
} from '../src/modules/customers/dto/customer.dto';

describe('Customer DTOs', () => {
  it('accepts a company without CNPJ because documents are optional in V1', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      type: CustomerType.COMPANY,
      name: 'Hospital Santa Clara',
      email: 'CONTATO@HOSPITAL.EXAMPLE',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('contato@hospital.example');
  });

  it('rejects malformed CPF', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      type: CustomerType.PERSON,
      name: 'Roberto Alves',
      cpf: '123',
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('applies production pagination defaults', async () => {
    const dto = plainToInstance(ListCustomersQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.isActive).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('parses the customer status filter %s as %s', async (value, expected) => {
    const dto = plainToInstance(ListCustomersQueryDto, { isActive: value });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.isActive).toBe(expected);
  });

  it.each(['invalid', '', '0', '1', ['true', 'false']])(
    'rejects an invalid customer status filter %s',
    async (value) => {
      const dto = plainToInstance(ListCustomersQueryDto, { isActive: value });
      expect((await validate(dto)).some((error) => error.property === 'isActive')).toBe(true);
    },
  );

  it('accepts an optional sanitized address reference point', async () => {
    const dto = plainToInstance(CustomerAddressDto, {
      name: 'Matriz',
      street: 'Rua do Sol',
      number: '120',
      complement: 'Sala 2',
      referencePoint: '  Entrada ao lado da farmácia  ',
      district: 'Centro',
      city: 'Recife',
      state: 'pe',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.referencePoint).toBe('Entrada ao lado da farmácia');
    expect(dto.state).toBe('PE');
  });

  it('accepts multiple technically identified equipments in a walk-in customer', async () => {
    const dto = plainToInstance(CreateWalkInCustomerDto, {
      type: CustomerType.COMPANY,
      name: 'Clínica Recife',
      address: {
        street: 'Rua do Sol',
        number: '120',
        district: 'Centro',
        city: 'Recife',
        state: 'PE',
      },
      contact: { name: 'Ana Lima', phone: '81999999999' },
      equipments: [
        {
          equipmentTypeCatalogId: '11111111-1111-4111-8111-111111111111',
          manufacturer: 'Midea',
          model: 'Xtreme Save',
          capacity: '12.000 BTU/h',
          sector: 'Recepção',
        },
        {
          equipmentTypeCatalogId: '22222222-2222-4222-8222-222222222222',
          manufacturer: 'Carrier',
          model: 'EcoSplit',
          capacity: '20 TR',
          sector: 'Sala técnica',
        },
      ],
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.equipments).toHaveLength(2);
  });

  it('rejects more than twenty equipments in a walk-in customer', async () => {
    const dto = plainToInstance(CreateWalkInCustomerDto, {
      type: CustomerType.COMPANY,
      name: 'Clínica Recife',
      address: {
        street: 'Rua do Sol', number: '120', district: 'Centro', city: 'Recife', state: 'PE',
      },
      contact: { name: 'Ana Lima', phone: '81999999999' },
      equipments: Array.from({ length: 21 }, (_, index) => ({
        equipmentTypeCatalogId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
        manufacturer: 'Midea', model: `Modelo ${index}`, capacity: '12.000 BTU/h',
      })),
    });

    expect((await validate(dto)).some((error) => error.property === 'equipments')).toBe(true);
  });
});
