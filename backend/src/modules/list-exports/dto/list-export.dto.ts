import {
  DocumentTemplateType,
  EquipmentStatus,
  EquipmentType,
  OperationDocumentStatus,
  OperationStatus,
} from '@prisma/client';
import type { OperationType } from '../../../shared/constants/service-types.constants';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class OperationsPdfExportQueryDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsUUID('4') operatorId?: string;
  @IsOptional() @IsString() type?: OperationType;
  @IsOptional() @IsEnum(OperationStatus) status?: OperationStatus;
}

export class EquipmentsPdfExportQueryDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') addressId?: string;
  @IsOptional() @IsEnum(EquipmentStatus) status?: EquipmentStatus;
  @IsOptional() @IsEnum(EquipmentType) type?: EquipmentType;
}

export class DocumentsPdfExportQueryDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsUUID('4') operatorId?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) customer?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) equipment?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) operator?: string;
  @IsOptional() @IsEnum(DocumentTemplateType) type?: DocumentTemplateType;
  @IsOptional() @IsEnum(OperationDocumentStatus) status?: OperationDocumentStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
