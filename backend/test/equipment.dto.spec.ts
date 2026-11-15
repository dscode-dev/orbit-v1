import 'reflect-metadata';
import { EquipmentStatus, EquipmentType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateEquipmentDto,
  CreateEquipmentMetricDto,
  ListEquipmentsQueryDto,
} from '../src/modules/equipments/dto/equipment.dto';

describe('Equipment DTOs', () => {
  it('accepts a production equipment payload with optional address', async () => {
    const dto = plainToInstance(CreateEquipmentDto, {
      customerId: '9c29f81c-a494-4130-93dc-c498e8503a6d',
      type: EquipmentType.SPLIT,
      status: EquipmentStatus.ACTIVE,
      name: 'Split Samsung 24.000 BTU',
      installationDate: '2024-03-15',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a catalog-backed equipment type without requiring the legacy enum', async () => {
    const dto = plainToInstance(CreateEquipmentDto, {
      customerId: '9c29f81c-a494-4130-93dc-c498e8503a6d',
      equipmentTypeCatalogId: '8113c516-13da-4eaf-ac24-76e5fb34f5b4',
      manufacturer: 'Carrier',
      model: '42X',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('validates filters and pagination', async () => {
    const dto = plainToInstance(ListEquipmentsQueryDto, {
      page: '2',
      limit: '25',
      type: EquipmentType.CHILLER,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(25);
  });

  it('rejects a non-numeric metric value', async () => {
    const dto = plainToInstance(CreateEquipmentMetricDto, {
      key: 'temperature',
      value: 'invalid',
      unit: '°C',
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it.each(['ACTIVE', 'INACTIVE', 'ALL'])('accepts equipment visibility filter %s', async (activity) => {
    const dto = plainToInstance(ListEquipmentsQueryDto, { activity });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.activity).toBe(activity);
  });

  it('defaults to active equipment and rejects unsupported visibility filters', async () => {
    expect(plainToInstance(ListEquipmentsQueryDto, {}).activity).toBe('ACTIVE');
    expect(await validate(plainToInstance(ListEquipmentsQueryDto, { activity: 'DELETED' }))).not.toHaveLength(0);
  });
});
