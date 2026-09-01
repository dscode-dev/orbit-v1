import {
  BudgetItemSource,
  BudgetItemType,
  BudgetPaymentMethod,
  BudgetStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);
const upper = (value: unknown): unknown => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class BudgetPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class ListBudgetsQueryDto extends BudgetPageQueryDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(BudgetStatus) status?: BudgetStatus;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsUUID('4') operationId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === true || value === 'true') expired?: boolean;
}

export class BudgetItemInputDto {
  @IsOptional() @IsUUID('4') productId?: string;
  @IsEnum(BudgetItemType) type!: BudgetItemType;
  @IsOptional() @IsEnum(BudgetItemSource) source?: BudgetItemSource;
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(2000) description!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @Transform(({ value }) => upper(value)) @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

export class CreateBudgetDto {
  @IsOptional() @IsUUID('4') operationId?: string;
  @IsUUID('4') customerId!: string;
  @IsOptional() @IsUUID('4') customerAddressId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) equipmentIds?: string[];
  @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(180) title!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsDateString() issuedAt?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) introduction?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) serviceDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) materialDiscount?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) serviceDiscountDescription?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) materialDiscountDescription?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) additional?: number;
  @IsOptional() @IsDateString() expirationDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) validityDays?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) amountInWords?: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsEnum(BudgetPaymentMethod, { each: true }) paymentMethods!: BudgetPaymentMethod[];
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) commercialNotes?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) observations?: string;
  @IsOptional() @Transform(({ value }) => upper(value)) @IsEnum(BudgetStatus) status?: BudgetStatus;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BudgetItemInputDto) items!: BudgetItemInputDto[];
}

export class UpdateBudgetDto {
  @IsOptional() @IsUUID('4') operationId?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') customerAddressId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) equipmentIds?: string[];
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsDateString() issuedAt?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) introduction?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) serviceDiscount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) materialDiscount?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) serviceDiscountDescription?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) materialDiscountDescription?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) additional?: number;
  @IsOptional() @IsDateString() expirationDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) validityDays?: number;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) amountInWords?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsEnum(BudgetPaymentMethod, { each: true }) paymentMethods?: BudgetPaymentMethod[];
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) commercialNotes?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(5000) observations?: string;
  @IsOptional() @Transform(({ value }) => upper(value)) @IsEnum(BudgetStatus) status?: BudgetStatus;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BudgetItemInputDto)
  items?: BudgetItemInputDto[];
}

export class BudgetDecisionDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(2000) observation?: string;
}
