import { CustomerType, EquipmentType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);
const lower = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upper = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListCustomersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive = true;
}

export class CreateCustomerDto {
  @IsEnum(CustomerType) type!: CustomerType;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(180) name!: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  tradeName?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/)
  cpf?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/)
  cnpj?: string;
  @IsOptional() @Transform(({ value }) => lower(value)) @IsEmail() @MaxLength(254) email?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\+?[0-9 ()-]{8,30}$/)
  phone?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\+?[0-9 ()-]{8,30}$/)
  secondaryPhone?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) notes?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  tradeName?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/)
  cpf?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/)
  cnpj?: string;
  @IsOptional() @Transform(({ value }) => lower(value)) @IsEmail() @MaxLength(254) email?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\+?[0-9 ()-]{8,30}$/)
  phone?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\+?[0-9 ()-]{8,30}$/)
  secondaryPhone?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) notes?: string;
}

export class CustomerAddressDto {
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(100) name!: string;
  // CEP é opcional; quando informado, deve ter o formato brasileiro.
  @IsOptional() @Transform(({ value }) => trim(value) || undefined) @Matches(/^\d{5}-?\d{3}$/) zipCode?: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(180) street!: string;
  @Transform(({ value }) => trim(value)) @IsString() @MaxLength(20) number!: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  complement?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  referencePoint?: string;
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  district!: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @Transform(({ value }) => upper(value)) @IsString() @Length(2, 2) state!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpdateCustomerAddressDto {
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
  @IsOptional() @Transform(({ value }) => trim(value) || undefined) @Matches(/^\d{5}-?\d{3}$/) zipCode?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  street?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(20) number?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  complement?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  referencePoint?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  district?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city?: string;
  @IsOptional() @Transform(({ value }) => upper(value)) @IsString() @Length(2, 2) state?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class CustomerContactDto {
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) role?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\+?[0-9 ()-]{8,30}$/)
  phone?: string;
  @IsOptional() @Transform(({ value }) => lower(value)) @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpdateCustomerContactDto {
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) role?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(/^\+?[0-9 ()-]{8,30}$/)
  phone?: string;
  @IsOptional() @Transform(({ value }) => lower(value)) @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UploadCustomerAttachmentDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  category!: string;
}

/* ---------- OS avulso: cadastro de cliente novo em campo ---------- */

class WalkInAddressDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(9) zipCode?: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(180) street!: string;
  @Transform(({ value }) => trim(value)) @IsString() @MaxLength(20) number!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) complement?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) referencePoint?: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(100) district!: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @Transform(({ value }) => upper(value)) @IsString() @Length(2, 2) state!: string;
}

class WalkInContactDto {
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(8) @MaxLength(30) phone!: string;
}

class WalkInEquipmentDto {
  // O equipamento é identificado por marca + modelo; o nome é derivado quando
  // não informado. Marca/modelo/capacidade são opcionais no atendimento avulso.
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) name?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) manufacturer?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) model?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) capacity?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(160) sector?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) tag?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) serialNumber?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(40) voltage?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) observations?: string;
  @IsOptional() @IsUUID('4') equipmentTypeCatalogId?: string;
  @IsOptional() @IsEnum(EquipmentType) type?: EquipmentType;
}

export class CreateWalkInCustomerDto {
  @IsEnum(CustomerType) type!: CustomerType;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(180) name!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MinLength(11) @MaxLength(18) document?: string;
  @ValidateNested() @Type(() => WalkInAddressDto) address!: WalkInAddressDto;
  @ValidateNested() @Type(() => WalkInContactDto) contact!: WalkInContactDto;
  /** Contrato legado singular, preservado para clientes anteriores. */
  @IsOptional() @ValidateNested() @Type(() => WalkInEquipmentDto) equipment?: WalkInEquipmentDto;
  /** Coleção oficial usada pelo atendimento avulso para cadastrar até 20 equipamentos. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WalkInEquipmentDto)
  equipments?: WalkInEquipmentDto[];
}
