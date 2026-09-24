import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS,
  MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS,
} from '../../../shared/constants/maintenance-reminders.constants';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class ListServiceTypesQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}

export class CreateServiceTypeDto {
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(120)
  label!: string;

  @IsOptional() @IsBoolean() active?: boolean;

  @IsOptional() @IsBoolean() generatesReminder?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  @Max(MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  reminderIntervalMonths?: number;

  @IsOptional() @IsBoolean() commissionEligible?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  commissionPercent?: number;
}

export class UpdateServiceTypeDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(120)
  label?: string;

  @IsOptional() @IsBoolean() active?: boolean;

  @IsOptional() @IsBoolean() generatesReminder?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  @Max(MAX_MAINTENANCE_REMINDER_INTERVAL_MONTHS)
  reminderIntervalMonths?: number | null;

  @IsOptional() @IsBoolean() commissionEligible?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  commissionPercent?: number;
}

export class ReorderServiceTypesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids!: string[];
}
