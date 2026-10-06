import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ReceiptRevisionDto {
  @IsInt() @Min(0) revision!: number;
}

export class UpdateReceiptDto extends ReceiptRevisionDto {
  @IsOptional() @IsDateString() receiptIssuedAt?: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  receiptAmount!: number;
  @Transform(trim) @IsString() @MaxLength(500) receiptAmountInWords!: string;
  @Transform(trim) @IsString() @MaxLength(10000) receiptDescription!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) receiptWarrantyDays?: number | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20000) receiptDeclaration?: string | null;
}
