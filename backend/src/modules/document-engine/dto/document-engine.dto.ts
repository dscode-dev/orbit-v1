import { DocumentEditorialStatus, DocumentTemplateType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { OperationDocumentStatus } from '@prisma/client';

const trim = (value: unknown): unknown => typeof value === 'string' ? value.trim() : value;

export class ListDocumentsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Transform(({ value }) => trim(value)) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(DocumentTemplateType) type?: DocumentTemplateType;
  @IsOptional() @IsEnum(OperationDocumentStatus) status?: OperationDocumentStatus;
  @IsOptional() @IsEnum(DocumentEditorialStatus) editorialStatus?: DocumentEditorialStatus;
  /** Por padrão o catálogo esconde documentos em rascunho (DRAFT); enviar true os inclui. */
  @IsOptional() @Type(() => Boolean) @IsBoolean() includeDrafts?: boolean;
  @IsOptional() @IsUUID('4') customerId?: string;
  @IsOptional() @IsUUID('4') equipmentId?: string;
  @IsOptional() @IsUUID('4') operatorId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class OperationDocumentParamsDto {
  @IsUUID('4') operationId!: string;
  @IsEnum(DocumentTemplateType) type!: DocumentTemplateType;
}

export class DocumentIdParamsDto {
  @IsUUID('4') documentId!: string;
}

export class TemplatePreviewParamsDto {
  @IsUUID('4') templateId!: string;
}
