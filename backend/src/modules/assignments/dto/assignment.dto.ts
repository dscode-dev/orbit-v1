import { AssignmentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const trim = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export class ListAssignmentsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsUUID('4') operationId?: string;
  @IsOptional() @IsUUID('4') assignedTo?: string;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsEnum(AssignmentStatus) status?: AssignmentStatus;
  /**
   * Janela de agenda. Filtra pela data em que o atendimento aparece no
   * calendário: `operation.scheduledFor`, ou `assignedAt` quando não há
   * agendamento. Sem esses parâmetros o comportamento é o anterior.
   */
  @IsOptional() @IsISO8601() scheduledFrom?: string;
  @IsOptional() @IsISO8601() scheduledTo?: string;
  /**
   * `true` devolve só a atribuição do técnico responsável. A Agenda usa isso
   * para não repetir o mesmo atendimento uma vez por auxiliar.
   */
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === 'true' || value === true) isPrimary?: boolean;
  /** `true` omite atribuições de atendimentos já cancelados. */
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === 'true' || value === true) excludeCanceledOperations?: boolean;
}

export class CreateAssignmentDto {
  @IsUUID('4') operationId!: string;
  @IsUUID('4') assignedTo!: string;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(2000) notes?: string;
}

export class ReassignAssignmentDto {
  @IsUUID('4') assignedTo!: string;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(10) @IsUUID('4', { each: true }) auxiliaryOperatorIds?: string[];
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(2000) notes?: string;
}

export class AssignmentNotesDto {
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(2000) notes?: string;
}

export class RejectAssignmentDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(2000)
  rejectionReason!: string;
}

/** Autorização de exibição de demandas no app do operador (por técnico e/ou dia). */
export class AuthorizeDemandsDto {
  @IsOptional() @IsUUID('4') operatorId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}/) date?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) assignmentIds?: string[];
}
