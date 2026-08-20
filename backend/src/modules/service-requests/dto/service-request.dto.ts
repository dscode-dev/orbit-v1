import { ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
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
} from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class CreateServiceRequestDto {
  @IsOptional() @IsUUID('4') addressId?: string;
  @IsOptional() @IsEnum(ServiceRequestType) type?: ServiceRequestType;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(3) @MaxLength(180) subject!: string;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(5) @MaxLength(5000) description!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(150) contactName?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(30) contactPhone?: string;
  @IsOptional() @IsDateString() preferredAt?: string;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(30) @IsUUID('4', { each: true }) equipmentIds?: string[];
}

export class ListServiceRequestsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(ServiceRequestStatus) status?: ServiceRequestStatus;
  @IsOptional() @IsEnum(ServiceRequestType) type?: ServiceRequestType;
  @IsOptional() @IsUUID('4') customerId?: string;
}

export class UpdateServiceRequestDto {
  @IsOptional() @IsEnum(ServiceRequestStatus) status?: ServiceRequestStatus;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) internalNotes?: string;
}

export class CreateCustomerPortalAccountDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(150) name!: string;
}
