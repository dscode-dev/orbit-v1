import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BrandAssetType, Prisma, SignatureMode, type DocumentTemplateType } from '@prisma/client';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  ALLOWED_BRAND_ASSET_EXTENSIONS,
  ALLOWED_BRAND_ASSET_MIME_TYPES,
  BRAND_ASSET_RESOURCE,
  DOCUMENT_TEMPLATE_RESOURCE,
  MAX_BRAND_ASSET_SIZE_BYTES,
  ORGANIZATION_AUDIT_ACTIONS,
  ORGANIZATION_RESOURCE,
  ORGANIZATION_SETTINGS_RESOURCE,
} from '../../shared/constants/organization.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import {
  STORAGE_PROVIDER_TOKEN,
  type StorageProviderContract,
} from '../../infra/storage/storage-provider.type';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { UpdateOrganizationDto, UpdateOrganizationSettingsDto } from './dto/organization.dto';
import type {
  CreateDocumentTemplateDto,
  UpdateDocumentTemplateDto,
} from './dto/document-template.dto';
import type { UploadedAssetFile } from './types/uploaded-file.type';

export interface RequestAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const ORGANIZATION_SELECT = {
  id: true,
  legalName: true,
  tradeName: true,
  cnpj: true,
  stateRegistration: true,
  email: true,
  phone: true,
  phoneNumbers: true,
  website: true,
  zipCode: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  city: true,
  state: true,
  primaryColor: true,
  secondaryColor: true,
  segment: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

/**
 * Campos liberados para a landing page pública (sem autenticação).
 * Apenas dados de vitrine: nome, segmento e formas de contato. Nenhum dado
 * sigiloso (CNPJ, inscrição estadual, endereço detalhado, ids internos etc.).
 */
const PUBLIC_ORGANIZATION_SELECT = {
  tradeName: true,
  segment: true,
  email: true,
  phone: true,
  phoneNumbers: true,
  website: true,
  city: true,
  state: true,
  primaryColor: true,
  secondaryColor: true,
} satisfies Prisma.OrganizationSelect;

const SETTINGS_SELECT = {
  id: true,
  organizationId: true,
  language: true,
  timezone: true,
  currency: true,
  documentPrefix: true,
  commissionPeriod: true,
  commissionMode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSettingsSelect;

const TEMPLATE_SELECT = {
  id: true,
  organizationId: true,
  type: true,
  name: true,
  headerContent: true,
  footerContent: true,
  observations: true,
  isDefault: true,
  isSystem: true,
  isActive: true,
  requiresSignature: true,
  signatureMode: true,
  signatureId: true,
  executionSignatureClient: true,
  executionSignatureTechnician: true,
  executionSignatureOperator: true,
  institutionalSignatures: {
    orderBy: { position: 'asc' as const },
    select: { signatureId: true, position: true },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentTemplateSelect;

const ASSET_SELECT = {
  id: true,
  organizationId: true,
  type: true,
  storageKey: true,
  mimeType: true,
  originalFileName: true,
  fileSize: true,
  createdAt: true,
} satisfies Prisma.BrandAssetSelect;

export type OrganizationResponse = Prisma.OrganizationGetPayload<{
  select: typeof ORGANIZATION_SELECT;
}>;
export type SettingsResponse = Prisma.OrganizationSettingsGetPayload<{
  select: typeof SETTINGS_SELECT;
}>;
export type TemplateResponse = Prisma.DocumentTemplateGetPayload<{
  select: typeof TEMPLATE_SELECT;
}>;
export type AssetResponse = Prisma.BrandAssetGetPayload<{ select: typeof ASSET_SELECT }>;

export interface AssetContentResponse extends AssetResponse {
  contentBase64: string;
}

/** Perfil público (landing page) — somente vitrine e contato. */
export interface PublicOrganizationProfile {
  name: string;
  segment: string | null;
  email: string;
  phones: string[];
  whatsapp: string | null;
  website: string | null;
  city: string;
  state: string;
  primaryColor: string;
  secondaryColor: string;
}

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER_TOKEN)
    private readonly storage: StorageProviderContract,
  ) {}

  async getOrganization(): Promise<OrganizationResponse> {
    return this.getSingleOrganizationOrThrow();
  }

  /**
   * Perfil público consumido pela landing page (endpoint sem autenticação).
   * Retorna apenas dados de vitrine e contato — nunca dados sigilosos.
   */
  async getPublicProfile(): Promise<PublicOrganizationProfile> {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      where: { isActive: true },
      select: PUBLIC_ORGANIZATION_SELECT,
    });
    if (!org) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organization was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const phones = [org.phone, ...org.phoneNumbers]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    const uniquePhones = Array.from(new Set(phones));
    const primaryDigits = uniquePhones[0]?.replace(/\D/g, '') ?? '';
    // wa.me exige DDI; assume Brasil (55) quando o número não o inclui.
    const whatsapp = primaryDigits
      ? primaryDigits.length > 11
        ? primaryDigits
        : `55${primaryDigits}`
      : null;
    return {
      name: org.tradeName,
      segment: org.segment ?? null,
      email: org.email,
      phones: uniquePhones,
      whatsapp,
      website: org.website ?? null,
      city: org.city,
      state: org.state,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
    };
  }

  async updateOrganization(
    dto: UpdateOrganizationDto,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<OrganizationResponse> {
    const organization = await this.getSingleOrganizationOrThrow();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.organization.update({
        where: { id: organization.id },
        data: dto,
        select: ORGANIZATION_SELECT,
      });
      await transaction.auditLog.create({
        data: this.auditData(
          ORGANIZATION_AUDIT_ACTIONS.ORGANIZATION_UPDATED,
          ORGANIZATION_RESOURCE,
          user,
          context,
          { organizationId: organization.id, changedFields: Object.keys(dto) },
        ),
      });
      return updated;
    });
  }

  async getSettings(): Promise<SettingsResponse> {
    const organization = await this.getSingleOrganizationOrThrow();
    const settings = await this.prisma.organizationSettings.findUnique({
      where: { organizationId: organization.id },
      select: SETTINGS_SELECT,
    });
    if (!settings) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organization settings were not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return settings;
  }

  async updateSettings(
    dto: UpdateOrganizationSettingsDto,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<SettingsResponse> {
    const organization = await this.getSingleOrganizationOrThrow();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.organizationSettings.update({
        where: { organizationId: organization.id },
        data: dto,
        select: SETTINGS_SELECT,
      });
      await transaction.auditLog.create({
        data: this.auditData(
          ORGANIZATION_AUDIT_ACTIONS.SETTINGS_UPDATED,
          ORGANIZATION_SETTINGS_RESOURCE,
          user,
          context,
          { organizationId: organization.id, changedFields: Object.keys(dto) },
        ),
      });
      return updated;
    });
  }

  async listTemplates(): Promise<TemplateResponse[]> {
    const organization = await this.getSingleOrganizationOrThrow();
    return this.prisma.documentTemplate.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      select: TEMPLATE_SELECT,
    });
  }

  async createTemplate(
    dto: CreateDocumentTemplateDto,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<TemplateResponse> {
    const organization = await this.getSingleOrganizationOrThrow();
    return this.prisma.$transaction(async (transaction) => {
      if (dto.isDefault) {
        await transaction.documentTemplate.updateMany({
          where: { organizationId: organization.id, type: dto.type },
          data: { isDefault: false },
        });
      }
      const requestedInstitutionalIds = dto.institutionalSignatureIds ?? [];
      const signatureConfig = await this.resolveSignatureConfig({
        requiresSignature: dto.requiresSignature,
        signatureMode: dto.signatureMode,
        signatureId: dto.signatureId ?? requestedInstitutionalIds[0],
      });
      const institutionalSignatureIds = await this.resolveInstitutionalSignatureIds(
        signatureConfig.signatureMode === SignatureMode.FIXED ||
          signatureConfig.signatureMode === SignatureMode.HYBRID
          ? requestedInstitutionalIds.length > 0
            ? requestedInstitutionalIds
            : signatureConfig.signatureId
              ? [signatureConfig.signatureId]
              : []
          : [],
      );
      const created = await transaction.documentTemplate.create({
        data: {
          organizationId: organization.id,
          type: dto.type,
          name: dto.name,
          headerContent: dto.headerContent,
          footerContent: dto.footerContent,
          observations: dto.observations,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          ...signatureConfig,
          executionSignatureClient: dto.executionSignatureClient ?? false,
          executionSignatureTechnician: dto.executionSignatureTechnician ?? false,
          executionSignatureOperator: dto.executionSignatureOperator ?? false,
          institutionalSignatures: {
            create: institutionalSignatureIds.map((signatureId, position) => ({
              signatureId,
              position,
            })),
          },
          isSystem: false,
        },
        select: TEMPLATE_SELECT,
      });
      await transaction.auditLog.create({
        data: this.auditData(
          ORGANIZATION_AUDIT_ACTIONS.TEMPLATE_CREATED,
          DOCUMENT_TEMPLATE_RESOURCE,
          user,
          context,
          { organizationId: organization.id, templateId: created.id, type: created.type },
        ),
      });
      return created;
    });
  }

  async updateTemplate(
    id: string,
    dto: UpdateDocumentTemplateDto,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<TemplateResponse> {
    const organization = await this.getSingleOrganizationOrThrow();
    const existing = await this.getTemplateOrThrow(organization.id, id);
    return this.prisma.$transaction(async (transaction) => {
      const nextType: DocumentTemplateType = dto.type ?? existing.type;
      if (dto.isDefault) {
        await transaction.documentTemplate.updateMany({
          where: { organizationId: organization.id, type: nextType, id: { not: id } },
          data: { isDefault: false },
        });
      }
      const nextMode = dto.signatureMode ?? existing.signatureMode;
      const requestedInstitutionalIds = dto.institutionalSignatureIds;
      const primarySignatureId =
        nextMode === SignatureMode.FIXED || nextMode === SignatureMode.HYBRID
          ? dto.signatureId !== undefined
            ? dto.signatureId
            : (requestedInstitutionalIds?.[0] ?? existing.signatureId)
          : null;
      const signatureConfig = await this.resolveSignatureConfig({
        requiresSignature: dto.requiresSignature ?? existing.requiresSignature,
        signatureMode: nextMode,
        signatureId: primarySignatureId,
      });
      const effectiveRequestedIds =
        nextMode === SignatureMode.FIXED || nextMode === SignatureMode.HYBRID
          ? requestedInstitutionalIds
          : [];
      const institutionalSignatureIds =
        effectiveRequestedIds === undefined
          ? null
          : await this.resolveInstitutionalSignatureIds(effectiveRequestedIds);
      const { institutionalSignatureIds: _institutionalSignatureIds, ...templateData } = dto;
      void _institutionalSignatureIds;
      const updated = await transaction.documentTemplate.update({
        where: { id },
        data: {
          ...templateData,
          ...signatureConfig,
          ...(institutionalSignatureIds === null
            ? {}
            : {
                institutionalSignatures: {
                  deleteMany: {},
                  create: institutionalSignatureIds.map((signatureId, position) => ({
                    signatureId,
                    position,
                  })),
                },
                signatureId: institutionalSignatureIds[0] ?? signatureConfig.signatureId,
              }),
        },
        select: TEMPLATE_SELECT,
      });
      await transaction.auditLog.create({
        data: this.auditData(
          ORGANIZATION_AUDIT_ACTIONS.TEMPLATE_UPDATED,
          DOCUMENT_TEMPLATE_RESOURCE,
          user,
          context,
          {
            organizationId: organization.id,
            templateId: id,
            changedFields: Object.keys(dto),
          },
        ),
      });
      return updated;
    });
  }

  async deleteTemplate(
    id: string,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<{ deleted: true }> {
    const organization = await this.getSingleOrganizationOrThrow();
    const existing = await this.getTemplateOrThrow(organization.id, id);
    if (existing.isSystem) {
      throw new ApplicationException(
        ERROR_CODES.SYSTEM_TEMPLATE_PROTECTED,
        'System document templates cannot be deleted',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction([
      this.prisma.documentTemplate.delete({ where: { id: existing.id } }),
      this.prisma.auditLog.create({
        data: this.auditData(
          ORGANIZATION_AUDIT_ACTIONS.TEMPLATE_DELETED,
          DOCUMENT_TEMPLATE_RESOURCE,
          user,
          context,
          { organizationId: organization.id, templateId: existing.id, type: existing.type },
        ),
      }),
    ]);
    return { deleted: true };
  }

  async uploadAsset(
    type: BrandAssetType,
    file: UploadedAssetFile | undefined,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<AssetResponse> {
    this.validateUpload(file);
    const validFile = file as UploadedAssetFile;
    const organization = await this.getSingleOrganizationOrThrow();
    const extension = this.extensionFor(validFile);
    const storageKey = `organization/${type.toLowerCase()}/${randomUUID()}.${extension}`;

    await this.storage.save({ storageKey, content: validFile.buffer });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.brandAsset.create({
          data: {
            organizationId: organization.id,
            type,
            storageKey,
            mimeType: validFile.mimetype,
            originalFileName: this.sanitizeOriginalName(validFile.originalname),
            fileSize: validFile.size,
          },
          select: ASSET_SELECT,
        });
        await transaction.auditLog.create({
          data: this.auditData(
            ORGANIZATION_AUDIT_ACTIONS.ASSET_UPLOADED,
            BRAND_ASSET_RESOURCE,
            user,
            context,
            {
              organizationId: organization.id,
              assetId: created.id,
              type: created.type,
              fileSize: created.fileSize,
              mimeType: created.mimeType,
            },
          ),
        });
        return created;
      });
    } catch (error: unknown) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async getAsset(id: string): Promise<AssetContentResponse> {
    const organization = await this.getSingleOrganizationOrThrow();
    const asset = await this.getAssetOrThrow(organization.id, id);
    const stored = await this.storage.get(asset.storageKey);
    return {
      ...asset,
      contentBase64: stored.content.toString('base64'),
    };
  }

  async deleteAsset(
    id: string,
    user: AuthenticatedUser,
    context: RequestAuditContext,
  ): Promise<{ deleted: true }> {
    const organization = await this.getSingleOrganizationOrThrow();
    const asset = await this.getAssetOrThrow(organization.id, id);
    await this.prisma.$transaction([
      this.prisma.brandAsset.delete({ where: { id: asset.id } }),
      this.prisma.auditLog.create({
        data: this.auditData(
          ORGANIZATION_AUDIT_ACTIONS.ASSET_DELETED,
          BRAND_ASSET_RESOURCE,
          user,
          context,
          { organizationId: organization.id, assetId: asset.id, type: asset.type },
        ),
      }),
    ]);
    await this.storage.delete(asset.storageKey);
    return { deleted: true };
  }

  private async getSingleOrganizationOrThrow(): Promise<OrganizationResponse> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: ORGANIZATION_SELECT,
    });
    if (!organization) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organization was not found. Run the initial seed before using organization endpoints.',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization;
  }

  private async getTemplateOrThrow(organizationId: string, id: string): Promise<TemplateResponse> {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id, organizationId },
      select: TEMPLATE_SELECT,
    });
    if (!template) {
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Document template was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return template;
  }

  private async resolveSignatureConfig(input: {
    requiresSignature?: boolean;
    signatureMode?: SignatureMode;
    signatureId?: string | null;
  }): Promise<{
    requiresSignature: boolean;
    signatureMode: SignatureMode;
    signatureId: string | null;
  }> {
    const mode = input.signatureMode ?? SignatureMode.NONE;
    const requiresSignature = input.requiresSignature ?? mode !== SignatureMode.NONE;
    const signatureId = input.signatureId ?? null;

    if (mode === SignatureMode.NONE) {
      if (requiresSignature || signatureId) {
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Signature mode NONE cannot require or reference a signature',
          HttpStatus.BAD_REQUEST,
        );
      }
      return { requiresSignature: false, signatureMode: mode, signatureId: null };
    }

    if (!requiresSignature) {
      throw new ApplicationException(
        ERROR_CODES.VALIDATION_ERROR,
        'Signature configuration requires requiresSignature=true',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (mode === SignatureMode.FIXED || mode === SignatureMode.HYBRID) {
      if (!signatureId) {
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'FIXED and HYBRID signature modes require signatureId',
          HttpStatus.BAD_REQUEST,
        );
      }
      const signature = await this.prisma.signature.findUnique({
        where: { id: signatureId },
        select: { id: true, active: true, deletedAt: true },
      });
      if (!signature || signature.deletedAt) {
        throw new ApplicationException(
          ERROR_CODES.SIGNATURE_NOT_FOUND,
          'Signature was not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (!signature.active) {
        throw new ApplicationException(
          ERROR_CODES.SIGNATURE_INACTIVE,
          'Inactive signatures cannot be assigned to templates',
          HttpStatus.CONFLICT,
        );
      }
      return { requiresSignature: true, signatureMode: mode, signatureId };
    }

    return { requiresSignature: true, signatureMode: mode, signatureId: null };
  }

  private async resolveInstitutionalSignatureIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const signatures = await this.prisma.signature.findMany({
      where: { id: { in: ids }, active: true, deletedAt: null },
      select: { id: true, imageStorageKey: true },
    });
    if (
      signatures.length !== ids.length ||
      signatures.some((signature) => !signature.imageStorageKey)
    ) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_NOT_FOUND,
        'Every institutional signature must exist, be active and have an uploaded image',
        HttpStatus.CONFLICT,
      );
    }
    return ids;
  }

  private async getAssetOrThrow(organizationId: string, id: string): Promise<AssetResponse> {
    const asset = await this.prisma.brandAsset.findFirst({
      where: { id, organizationId },
      select: ASSET_SELECT,
    });
    if (!asset) {
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Brand asset was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return asset;
  }

  private validateUpload(file: UploadedAssetFile | undefined): void {
    if (!file) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_REQUIRED,
        'A file field is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > MAX_BRAND_ASSET_SIZE_BYTES) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        'Uploaded file exceeds the maximum allowed size',
        HttpStatus.BAD_REQUEST,
        { maxBytes: MAX_BRAND_ASSET_SIZE_BYTES },
      );
    }
    if (!ALLOWED_BRAND_ASSET_MIME_TYPES.includes(file.mimetype as never)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'Uploaded file MIME type is not allowed',
        HttpStatus.BAD_REQUEST,
        { allowedMimeTypes: ALLOWED_BRAND_ASSET_MIME_TYPES },
      );
    }
    this.extensionFor(file);
    if (!this.hasValidBinarySignature(file.buffer, file.mimetype)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'Uploaded file binary signature is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private extensionFor(file: UploadedAssetFile): string {
    const extension = extname(file.originalname).replace('.', '').toLowerCase();
    if (!ALLOWED_BRAND_ASSET_EXTENSIONS.includes(extension as never)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_EXTENSION,
        'Uploaded file extension is not allowed',
        HttpStatus.BAD_REQUEST,
        { allowedExtensions: ALLOWED_BRAND_ASSET_EXTENSIONS },
      );
    }
    return extension;
  }

  private hasValidBinarySignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'application/pdf') {
      return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    }
    if (mimeType === 'image/png') {
      return (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      );
    }
    if (mimeType === 'image/jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === 'image/svg+xml') {
      return this.hasSafeSvgPayload(buffer);
    }
    return false;
  }

  private hasSafeSvgPayload(buffer: Buffer): boolean {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 200_000)).trim();
    const lower = text.toLowerCase();
    if (!lower.startsWith('<svg') && !lower.startsWith('<?xml')) {
      return false;
    }
    if (
      lower.includes('<script') ||
      /\son[a-z]+\s*=/.test(lower) ||
      lower.includes('javascript:') ||
      lower.includes('<foreignobject')
    ) {
      return false;
    }
    return lower.includes('<svg');
  }

  private sanitizeOriginalName(originalName: string): string {
    const sanitized = originalName
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 255);
    return sanitized || 'uploaded-file';
  }

  private auditData(
    action: string,
    resource: string,
    user: AuthenticatedUser,
    context: RequestAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogCreateInput {
    return {
      action,
      resource,
      actor: user.id,
      metadata: {
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
        ...metadata,
      },
    };
  }
}
