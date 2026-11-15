import { EquipmentAttachmentCategory, EquipmentStatus, EquipmentType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class ListEquipmentsQueryDto {
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) activity: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ACTIVE';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') addressId?: string;
  @IsOptional() @IsUUID('4') equipmentTypeCatalogId?: string;
  @IsOptional() @IsEnum(EquipmentStatus) status?: EquipmentStatus;
  @IsOptional() @IsEnum(EquipmentType) type?: EquipmentType;
}

export class CreateEquipmentDto {
  @IsUUID('4') customerId!: string;
  @IsOptional() @IsUUID('4') addressId?: string;
  @IsOptional() @IsUUID('4') parentEquipmentId?: string;
  @IsOptional() @IsUUID('4') equipmentTypeCatalogId?: string;
  @IsOptional() @IsEnum(EquipmentType) type?: EquipmentType;
  @IsOptional() @IsEnum(EquipmentStatus) status?: EquipmentStatus;
  // Nome é derivado de marca + modelo quando não informado (identificação do
  // equipamento por marca/modelo). Opcional no formulário.
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) name?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(160) sector?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) tag?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  manufacturer?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) model?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  serialNumber?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) capacity?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(40) voltage?: string;
  @IsOptional() @IsDateString() installationDate?: string;
  @IsOptional() @IsDateString() warrantyExpiration?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string;
}

export class UpdateEquipmentDto {
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') addressId?: string;
  @IsOptional() @IsUUID('4') parentEquipmentId?: string;
  @IsOptional() @IsUUID('4') equipmentTypeCatalogId?: string;
  @IsOptional() @IsEnum(EquipmentType) type?: EquipmentType;
  @IsOptional() @IsEnum(EquipmentStatus) status?: EquipmentStatus;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  name?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(160) sector?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) tag?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  manufacturer?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) model?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  serialNumber?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) capacity?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(40) voltage?: string;
  @IsOptional() @IsDateString() installationDate?: string;
  @IsOptional() @IsDateString() warrantyExpiration?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string;
}

export class UploadEquipmentAttachmentDto {
  @IsEnum(EquipmentAttachmentCategory) category!: EquipmentAttachmentCategory;
}

export class CreateEquipmentMetricDto {
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(1) @MaxLength(80) key!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) value!: number;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(1) @MaxLength(30) unit!: string;
  @IsOptional() @IsDateString() recordedAt?: string;
}
