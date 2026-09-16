import {
  MaintenancePriority,
  PmocExecutionRequestStatus,
  PmocGenerationMode,
  PmocPeriodicity,
} from '@prisma/client';
import type { OperationType } from '../../../shared/constants/service-types.constants';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RecurrenceFrequency } from '../../maintenance-planning/dto/maintenance-planning.dto';
import { CreateOperationDto } from '../../operations/dto/operation.dto';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class PmocRecurrenceRuleDto {
  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  interval?: number;
}

export class ListPmocQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @IsOptional()
  @IsUUID('4')
  equipmentId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active?: boolean;
}

export class PmocNameSuggestionQueryDto {
  @IsUUID('4')
  customerId!: string;
}

export class PmocActiveCoverageQueryDto {
  @IsUUID('4')
  customerId!: string;
}

export class PmocDashboardQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CreatePmocPlanDto {
  /**
   * Persiste somente a configuração do plano, sem reservar execução,
   * criar atendimento ou iniciar o fluxo documental.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  configurationOnly?: boolean;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(140)
  name?: string;

  @IsUUID('4')
  customerId!: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  confirmActiveCoverage?: boolean;

  @IsUUID('4')
  equipmentId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  equipmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  scopeCatalogIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  checklistCatalogIds?: string[];

  @IsOptional()
  @IsBoolean()
  includeChecklistInOperations?: boolean;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000)
  coverage?: string;

  @IsOptional() @IsEnum(PmocPeriodicity)
  periodicity?: PmocPeriodicity;

  @IsOptional() @IsEnum(PmocGenerationMode)
  generationMode?: PmocGenerationMode;

  @IsOptional() @IsUUID('4')
  defaultOperatorId?: string;

  @IsOptional() @IsUUID('4')
  defaultTechnicianId?: string;

  @IsOptional() @IsUUID('4')
  defaultAddressId?: string;

  @IsOptional() @IsString()
  defaultOperationType?: OperationType;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  serviceTypes?: OperationType[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(10080)
  defaultEstimatedDurationMinutes?: number;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000)
  defaultOperationObservations?: string;

  @IsOptional() @IsUUID('4')
  signatureOverrideId?: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  responsibleTechnician!: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  artNumber?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  contractNumber?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string;

  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @IsOptional()
  @ValidateNested()
  @Type(() => PmocRecurrenceRuleDto)
  recurrenceRule?: PmocRecurrenceRuleDto;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active?: boolean;
}

export class UpdatePmocPlanDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  configurationOnly?: boolean;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  equipmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  scopeCatalogIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  checklistCatalogIds?: string[];

  @IsOptional()
  @IsBoolean()
  includeChecklistInOperations?: boolean;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000)
  coverage?: string | null;

  @IsOptional() @IsEnum(PmocPeriodicity)
  periodicity?: PmocPeriodicity;

  @IsOptional() @IsEnum(PmocGenerationMode)
  generationMode?: PmocGenerationMode;

  @IsOptional() @IsUUID('4')
  defaultOperatorId?: string | null;

  @IsOptional() @IsUUID('4')
  defaultTechnicianId?: string | null;

  @IsOptional() @IsUUID('4')
  defaultAddressId?: string | null;

  @IsOptional() @IsString()
  defaultOperationType?: OperationType;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  serviceTypes?: OperationType[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(10080)
  defaultEstimatedDurationMinutes?: number | null;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000)
  defaultOperationObservations?: string | null;

  @IsOptional() @IsBoolean()
  applyDefaultsToPendingExecutions?: boolean;

  @IsOptional() @IsUUID('4')
  signatureOverrideId?: string | null;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  responsibleTechnician?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  artNumber?: string | null;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  contractNumber?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string | null;

  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @IsOptional()
  @ValidateNested()
  @Type(() => PmocRecurrenceRuleDto)
  recurrenceRule?: PmocRecurrenceRuleDto;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active?: boolean;
}

export class ListPmocExecutionRequestsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @IsOptional() @IsEnum(PmocExecutionRequestStatus)
  status?: PmocExecutionRequestStatus;
}

export class CreatePmocExecutionRequestDto {
  @IsOptional() @IsUUID()
  equipmentId?: string;

  @IsOptional() @IsDateString()
  scheduledFor?: string;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(1000)
  notes?: string;
}

export class ReschedulePmocExecutionRequestDto {
  @IsDateString()
  scheduledFor!: string;

  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(1000)
  notes?: string;
}

export class GeneratePmocWorkOrderDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOperationDto)
  operation?: CreateOperationDto;

  /**
   * Confirma o adiantamento de uma execução prevista para muito no futuro.
   * Sem esta confirmação, gerar uma execução muito antecipada é bloqueado.
   */
  @IsOptional()
  @IsBoolean()
  allowEarly?: boolean;
}

export class RunPmocSchedulerQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;
}

export class CreatePmocEnvironmentDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  area?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  occupancy?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  equipmentIds?: string[];

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string;
}

export class UpdatePmocEnvironmentDto {
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  area?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  occupancy?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  equipmentIds?: string[];

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(5000)
  observations?: string | null;
}
