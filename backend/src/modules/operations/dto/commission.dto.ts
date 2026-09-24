import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class CommissionQueryDto {
  /** Início do intervalo (ISO). Sem from/to, usa a janela configurada. */
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  /** Filtra por chave de tipo de serviço (ex.: PREVENTIVA). */
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(60) serviceType?: string;
}

export class PayCommissionDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(60) serviceType?: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(500) notes?: string;
}
