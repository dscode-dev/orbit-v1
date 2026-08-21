import { DocumentTemplateType, OperationType, CustomerPortalTicketStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);
const lower = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CustomerPortalLoginDto {
  @Transform(({ value }) => lower(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class CustomerPortalRefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class CustomerPortalChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'A senha deve conter letra minúscula' })
  @Matches(/[A-Z]/, { message: 'A senha deve conter letra maiúscula' })
  @Matches(/\d/, { message: 'A senha deve conter número' })
  @Matches(/[^A-Za-z0-9]/, { message: 'A senha deve conter caractere especial' })
  newPassword!: string;
}

export class UpsertCustomerPortalAccountDto {
  @IsUUID('4')
  customerId!: string;

  @Transform(({ value }) => lower(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class ListCustomerTicketsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(CustomerPortalTicketStatus) status?: CustomerPortalTicketStatus;
  @IsOptional() @IsUUID('4') customerId?: string;
}

export class CreateCustomerTicketDto {
  @IsOptional()
  @IsUUID('4')
  addressId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  equipmentIds?: string[];

  @IsOptional()
  @IsEnum(DocumentTemplateType)
  documentType?: DocumentTemplateType;

  @IsOptional()
  @IsEnum(OperationType)
  operationType?: OperationType;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsEnum(OperationType, { each: true })
  serviceTypes?: OperationType[];

  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(160)
  title!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(40)
  priority?: string;

  @IsOptional()
  @IsDateString()
  preferredDate?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(30)
  contactPhone?: string;
}
