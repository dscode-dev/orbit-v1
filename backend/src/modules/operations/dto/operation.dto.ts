import {
  DocumentTemplateType,
  MaintenanceChecklistResult,
  OperationMaintenanceType,
  OperationStatus,
  OperationType,
  PmocChecklistUnit,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
  ValidateNested,
} from 'class-validator';
import {
  MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS,
  MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS,
} from '../../../shared/constants/maintenance-reminders.constants';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);
const trimStringArray = (value: unknown): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

export class ListOperationsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsUUID('4') operatorId?: string;
  @IsOptional() @IsEnum(OperationType) type?: OperationType;
  @IsOptional() @IsEnum(OperationStatus) status?: OperationStatus;
}

export class OperationStatsQueryDto {
  @IsOptional() @IsUUID('4') customerId?: string;
}

export class OperationChecklistItemDto {
  @Transform(({ value }) => trim(value)) @IsString() @MaxLength(200) label!: string;
  @IsBoolean() done!: boolean;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) note?: string;
}

export class OperationPhotoInputDto {
  /** Data URL (`data:image/png;base64,...`) captured in the field. */
  @IsString() dataUrl!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(255) caption?: string;
}

export class UpdateOperationPhotoDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(255)
  caption!: string;
}

export class OperationFieldEquipmentDto {
  @IsUUID('4') equipmentTypeCatalogId!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(160) sector?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) tag?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) manufacturer?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) model?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) serialNumber?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(80) capacity?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(40) voltage?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) observations?: string;
}

export class CreateOperationFieldEquipmentsDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  existingEquipmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OperationFieldEquipmentDto)
  newEquipments?: OperationFieldEquipmentDto[];
}

export class OperationMaintenanceChecklistItemDto {
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsEnum(PmocChecklistUnit) pmocUnit?: PmocChecklistUnit;
  @IsEnum(OperationMaintenanceType) maintenanceType!: OperationMaintenanceType;
  @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) description!: string;
  @IsBoolean() executed!: boolean;
  @IsOptional() @IsEnum(MaintenanceChecklistResult) result?: MaintenanceChecklistResult;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(2000)
  observations?: string;
}

export class OperationInspectedEquipmentDto {
  @IsUUID('4') equipmentId!: string;
  // Setor derivado do cadastro do equipamento no backend; opcional no payload.
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(160) sector?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  systemType?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(500)
  currentSituation?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  manufacturer?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  model?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  capacity?: string;
}

export class CreateOperationDto {
  @IsOptional() @IsUUID('4') sourceSaleId?: string;
  @IsUUID('4') customerId!: string;
  @IsOptional() @IsUUID('4') addressId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsUUID('4') operatorId?: string;
  // Técnicos auxiliares que também recebem/visualizam a demanda (view-only quando
  // sem permissão de relatórios). O executor continua sendo operatorId.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  auxiliaryOperatorIds?: string[];
  @IsOptional() @IsEnum(DocumentTemplateType) documentType?: DocumentTemplateType;
  @IsEnum(OperationType) type!: OperationType;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsEnum(OperationType, { each: true })
  serviceTypes?: OperationType[];
  @IsOptional() @IsEnum(OperationStatus) status?: OperationStatus;
  @IsOptional() @IsDateString() scheduledFor?: string;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() completedAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) referenceMonth?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2200) referenceYear?: number;
  @IsOptional() @IsEnum(OperationMaintenanceType) maintenanceType?: OperationMaintenanceType;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => OperationMaintenanceChecklistItemDto)
  maintenanceChecklist?: OperationMaintenanceChecklistItemDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperationInspectedEquipmentDto)
  inspectedEquipments?: OperationInspectedEquipmentDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperationChecklistItemDto)
  checklist?: OperationChecklistItemDto[];
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(10000)
  reportedIssue?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  serviceDescription?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  serviceValue?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  @Max(MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  maintenanceReminderIntervalMonths?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(40) @Matches(/^[A-Za-z0-9._/-]+$/) receiptNumber?: string;
  @IsOptional() @IsDateString() receiptIssuedAt?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999_999_999.99) receiptAmount?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) receiptAmountInWords?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) receiptService?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(10000) receiptDescription?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) receiptWarrantyDays?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(20000) receiptDeclaration?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalDiagnosis?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalRecommendations?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionObjective?: string;
  @IsOptional()
  @Transform(({ value }) => trimStringArray(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  technicalOpinionObjectiveItems?: string[];
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionConditions?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(30000)
  technicalOpinionAnalysis?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionConclusion?: string;
  @IsOptional()
  @Transform(({ value }) => trimStringArray(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  technicalOpinionConclusionItems?: string[];
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionRecommendations?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  technicalOpinionResponsible?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(100)
  technicalOpinionCrea?: string;
  @IsOptional() @IsString() @MaxLength(2_000_000) signatureData?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) customerSignerName?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) customerSignerRole?: string;
  @IsOptional() @IsDateString() signedAt?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperationPhotoInputDto)
  photos?: OperationPhotoInputDto[];
}

export class UpdateOperationDto {
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') addressId?: string | null;
  @IsOptional() @IsUUID('4') equipmentId?: string | null;
  @IsOptional() @IsEnum(OperationType) type?: OperationType;
  @IsOptional() @IsDateString() scheduledFor?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  serviceValue?: number | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  @Max(MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  maintenanceReminderIntervalMonths?: number | null;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  auxiliaryOperatorIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsEnum(OperationType, { each: true })
  serviceTypes?: OperationType[];
  @IsOptional() @IsEnum(OperationStatus) status?: OperationStatus;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() completedAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) referenceMonth?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2200) referenceYear?: number;
  @IsOptional() @IsEnum(OperationMaintenanceType) maintenanceType?: OperationMaintenanceType;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => OperationMaintenanceChecklistItemDto)
  maintenanceChecklist?: OperationMaintenanceChecklistItemDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperationInspectedEquipmentDto)
  inspectedEquipments?: OperationInspectedEquipmentDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperationChecklistItemDto)
  checklist?: OperationChecklistItemDto[];
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(10000)
  reportedIssue?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  serviceDescription?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(40) @Matches(/^[A-Za-z0-9._/-]+$/) receiptNumber?: string;
  @IsOptional() @IsDateString() receiptIssuedAt?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999_999_999.99) receiptAmount?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) receiptAmountInWords?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) receiptService?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(10000) receiptDescription?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) receiptWarrantyDays?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(20000) receiptDeclaration?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalDiagnosis?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalRecommendations?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionObjective?: string;
  @IsOptional()
  @Transform(({ value }) => trimStringArray(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  technicalOpinionObjectiveItems?: string[];
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionConditions?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(30000)
  technicalOpinionAnalysis?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionConclusion?: string;
  @IsOptional()
  @Transform(({ value }) => trimStringArray(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  technicalOpinionConclusionItems?: string[];
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(20000)
  technicalOpinionRecommendations?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(180)
  technicalOpinionResponsible?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(100)
  technicalOpinionCrea?: string;
  @IsOptional() @IsString() @MaxLength(2_000_000) signatureData?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(180) customerSignerName?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) customerSignerRole?: string;
  @IsOptional() @IsDateString() signedAt?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperationPhotoInputDto)
  photos?: OperationPhotoInputDto[];
}
