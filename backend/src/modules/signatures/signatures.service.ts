import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { extname } from 'node:path';
import { DocumentAssetResolver } from '../document-engine/assets/document-asset-resolver.service';
import { PrismaService } from '../database/prisma.service';
import {
  MAX_SIGNATURE_IMAGE_SIZE_BYTES,
  SIGNATURE_AUDIT_ACTIONS,
  SIGNATURE_IMAGE_EXTENSIONS,
  SIGNATURE_IMAGE_MIME_TYPES,
  SIGNATURE_RESOURCE,
} from '../../shared/constants/signatures.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import type {
  CreateSignatureDto,
  ListSignaturesQueryDto,
  UpsertOwnSignatureDto,
  UpdateSignatureDto,
} from './dto/signature.dto';
import type { UploadedSignatureFile } from './types/uploaded-signature-file.type';

export interface SignatureAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const SIGNATURE_SELECT = {
  id: true,
  userId: true,
  name: true,
  title: true,
  profession: true,
  professionalCouncil: true,
  registrationNumber: true,
  department: true,
  mimeType: true,
  originalFileName: true,
  fileSize: true,
  active: true,
  isDefault: true,
  position: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, role: true, jobTitle: true } },
} satisfies Prisma.SignatureSelect;

const SIGNATURE_INTERNAL_SELECT = {
  ...SIGNATURE_SELECT,
  imageStorageKey: true,
} satisfies Prisma.SignatureSelect;

type SignatureInternal = Prisma.SignatureGetPayload<{ select: typeof SIGNATURE_INTERNAL_SELECT }>;
export type SignatureResponse = Prisma.SignatureGetPayload<{ select: typeof SIGNATURE_SELECT }> & { hasImage: boolean };

export interface SignatureImageResponse extends SignatureResponse {
  contentBase64: string;
}

export type StagedSignatureImage = {
  storageKey: string;
  mimeType: string;
  originalFileName: string;
  fileSize: number;
};

@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: DocumentAssetResolver,
  ) {}

  async list(query: ListSignaturesQueryDto): Promise<unknown> {
    const where: Prisma.SignatureWhereInput = {
      deletedAt: null,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.signature.findMany({
        where,
        select: SIGNATURE_INTERNAL_SELECT,
        orderBy: [{ active: 'desc' }, { isDefault: 'desc' }, { position: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.signature.count({ where }),
    ]);
    return buildPaginatedResponse(items.map((item) => this.toResponse(item)), total, query.page, query.limit);
  }

  async get(id: string): Promise<SignatureResponse> {
    return this.signatureOrThrow(id, { includeDeleted: false });
  }

  /**
   * "Minha assinatura" no app mobile. Prioriza a assinatura vinculada ao usuário
   * (userId). Se não houver e o usuário for de plataforma (não-operador — ex.: owner
   * usando o app com o próprio login), recai na assinatura institucional definida na
   * plataforma (padrão da organização), para que a mesma assinatura fique disponível
   * também no mobile. Operadores continuam exigindo a própria assinatura.
   */
  async getOwn(actor: AuthenticatedUser): Promise<SignatureResponse | null> {
    const own = await this.prisma.signature.findUnique({
      where: { userId: actor.id },
      select: SIGNATURE_INTERNAL_SELECT,
    });
    if (own && !own.deletedAt) return this.toResponse(own);
    const institutional = await this.resolveInstitutionalFallback(actor);
    return institutional ? this.toResponse(institutional) : null;
  }

  /** Assinatura institucional usada como "própria" para usuários de plataforma. */
  private async resolveInstitutionalFallback(
    actor: AuthenticatedUser,
  ): Promise<Prisma.SignatureGetPayload<{ select: typeof SIGNATURE_INTERNAL_SELECT }> | null> {
    if (actor.role === Role.OPERATOR) return null;
    return this.prisma.signature.findFirst({
      where: { userId: null, active: true, deletedAt: null, imageStorageKey: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
      select: SIGNATURE_INTERNAL_SELECT,
    });
  }

  async upsertOwn(
    dto: UpsertOwnSignatureDto,
    file: UploadedSignatureFile | undefined,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<SignatureResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        institutionalSignature: { select: SIGNATURE_INTERNAL_SELECT },
      },
    });
    if (!user) {
      throw new ApplicationException(ERROR_CODES.USER_NOT_FOUND, 'Usuário não encontrado', HttpStatus.NOT_FOUND);
    }
    if (!file && !user.institutionalSignature?.imageStorageKey) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_IMAGE_REQUIRED,
        'Desenhe e confirme sua assinatura antes de salvar',
        HttpStatus.BAD_REQUEST,
      );
    }
    const staged = file ? await this.stageUserSignatureImage(file) : null;
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!organization) {
          throw new ApplicationException(
            ERROR_CODES.ORGANIZATION_NOT_FOUND,
            'Organização não encontrada',
            HttpStatus.NOT_FOUND,
          );
        }
        const signature = await tx.signature.upsert({
          where: { userId: actor.id },
          create: {
            organizationId: organization.id,
            userId: actor.id,
            name: user.name,
            title: this.clean(dto.title || user.jobTitle || 'Técnico'),
            profession: dto.profession ? this.clean(dto.profession) : null,
            professionalCouncil: dto.professionalCouncil ? this.clean(dto.professionalCouncil) : null,
            registrationNumber: dto.registrationNumber ? this.clean(dto.registrationNumber) : null,
            department: dto.department ? this.clean(dto.department) : null,
            imageStorageKey: staged!.storageKey,
            mimeType: staged!.mimeType,
            originalFileName: staged!.originalFileName,
            fileSize: staged!.fileSize,
            active: true,
          },
          update: {
            name: user.name,
            title: this.clean(dto.title || user.jobTitle || 'Técnico'),
            profession: dto.profession ? this.clean(dto.profession) : null,
            professionalCouncil: dto.professionalCouncil ? this.clean(dto.professionalCouncil) : null,
            registrationNumber: dto.registrationNumber ? this.clean(dto.registrationNumber) : null,
            department: dto.department ? this.clean(dto.department) : null,
            active: true,
            deletedAt: null,
            ...(staged
              ? {
                  imageStorageKey: staged.storageKey,
                  mimeType: staged.mimeType,
                  originalFileName: staged.originalFileName,
                  fileSize: staged.fileSize,
                }
              : {}),
          },
          select: SIGNATURE_INTERNAL_SELECT,
        });
        await tx.auditLog.create({
          data: this.auditInput(
            user.institutionalSignature
              ? SIGNATURE_AUDIT_ACTIONS.SIGNATURE_UPDATED
              : SIGNATURE_AUDIT_ACTIONS.SIGNATURE_CREATED,
            actor,
            context,
            {
              signatureId: signature.id,
              userId: actor.id,
              selfManaged: true,
              imageUploaded: Boolean(staged),
            },
          ),
        });
        return signature;
      });
      if (staged && user.institutionalSignature?.imageStorageKey) {
        await this.assets.delete(user.institutionalSignature.imageStorageKey).catch(() => undefined);
      }
      return this.toResponse(saved);
    } catch (error) {
      if (staged) await this.discardStagedImage(staged.storageKey);
      throw error;
    }
  }

  async downloadOwnImage(
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<SignatureImageResponse> {
    const own = await this.prisma.signature.findUnique({
      where: { userId: actor.id },
      select: { id: true, active: true, deletedAt: true },
    });
    const resolvedId =
      own && own.active && !own.deletedAt
        ? own.id
        : (await this.resolveInstitutionalFallback(actor))?.id ?? null;
    if (!resolvedId) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_NOT_FOUND,
        'Sua assinatura técnica ainda não foi configurada',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.downloadImage(resolvedId, actor, context);
  }

  async create(
    dto: CreateSignatureDto,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<SignatureResponse> {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!organization) throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organização não encontrada', HttpStatus.NOT_FOUND);
      await this.assertOwnerLinkAvailable(tx, dto.userId ?? null);
      if (dto.isDefault) await tx.signature.updateMany({ where: { organizationId: organization.id, isDefault: true }, data: { isDefault: false } });
      const created = await tx.signature.create({
        data: {
          organizationId: organization.id,
          userId: dto.userId ?? null,
          name: this.clean(dto.name),
          title: this.clean(dto.title),
          profession: dto.profession ? this.clean(dto.profession) : null,
          professionalCouncil: dto.professionalCouncil ? this.clean(dto.professionalCouncil) : null,
          registrationNumber: dto.registrationNumber ? this.clean(dto.registrationNumber) : null,
          department: dto.department ? this.clean(dto.department) : null,
          active: dto.active ?? true,
          isDefault: dto.isDefault ?? false,
          position: dto.position ?? 0,
        },
        select: SIGNATURE_INTERNAL_SELECT,
      });
      await tx.auditLog.create({
        data: this.auditInput(SIGNATURE_AUDIT_ACTIONS.SIGNATURE_CREATED, actor, context, {
          signatureId: created.id,
        }),
      });
      return this.toResponse(created);
    });
  }

  async update(
    id: string,
    dto: UpdateSignatureDto,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<SignatureResponse> {
    await this.signatureOrThrow(id, { includeDeleted: false });
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.signature.findUniqueOrThrow({ where: { id }, select: { organizationId: true, userId: true } });
      if (dto.userId !== undefined && dto.userId !== current.userId) {
        await this.assertOwnerLinkAvailable(tx, dto.userId, id);
      }
      if (dto.isDefault) await tx.signature.updateMany({ where: { organizationId: current.organizationId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      const updated = await tx.signature.update({
        where: { id },
        data: {
          ...(dto.userId !== undefined ? { userId: dto.userId } : {}),
          ...(dto.name !== undefined ? { name: this.clean(dto.name) } : {}),
          ...(dto.title !== undefined ? { title: this.clean(dto.title) } : {}),
          ...(dto.profession !== undefined ? { profession: this.clean(dto.profession) || null } : {}),
          ...(dto.professionalCouncil !== undefined ? { professionalCouncil: this.clean(dto.professionalCouncil) || null } : {}),
          ...(dto.registrationNumber !== undefined ? { registrationNumber: this.clean(dto.registrationNumber) || null } : {}),
          ...(dto.department !== undefined ? { department: this.clean(dto.department) || null } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.position !== undefined ? { position: dto.position } : {}),
        },
        select: SIGNATURE_INTERNAL_SELECT,
      });
      await tx.auditLog.create({
        data: this.auditInput(SIGNATURE_AUDIT_ACTIONS.SIGNATURE_UPDATED, actor, context, {
          signatureId: id,
          changedFields: Object.keys(dto),
        }),
      });
      return this.toResponse(updated);
    });
  }

  private async assertOwnerLinkAvailable(
    tx: Prisma.TransactionClient,
    userId: string | null,
    currentSignatureId?: string,
  ): Promise<void> {
    if (!userId) return;
    const owner = await tx.user.findFirst({
      where: { id: userId, role: Role.OWNER, isActive: true, disabledAt: null },
      select: { id: true },
    });
    if (!owner) {
      throw new ApplicationException(
        ERROR_CODES.USER_NOT_FOUND,
        'Selecione um OWNER ativo como responsável por esta assinatura',
        HttpStatus.BAD_REQUEST,
      );
    }
    const linked = await tx.signature.findFirst({
      where: {
        userId,
        deletedAt: null,
        ...(currentSignatureId ? { id: { not: currentSignatureId } } : {}),
      },
      select: { id: true },
    });
    if (linked) {
      throw new ApplicationException(
        ERROR_CODES.USER_CONFLICT,
        'Este responsável técnico já possui uma assinatura vinculada',
        HttpStatus.CONFLICT,
        { userId },
      );
    }
  }

  async remove(
    id: string,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<{ deleted: true }> {
    await this.signatureOrThrow(id, { includeDeleted: false });
    await this.prisma.$transaction([
      this.prisma.signature.update({
        where: { id },
        data: { active: false, deletedAt: new Date(), userId: null },
      }),
      this.prisma.auditLog.create({
        data: this.auditInput(SIGNATURE_AUDIT_ACTIONS.SIGNATURE_DELETED, actor, context, {
          signatureId: id,
          softDelete: true,
        }),
      }),
    ]);
    return { deleted: true };
  }

  async uploadImage(
    id: string,
    file: UploadedSignatureFile | undefined,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<SignatureResponse> {
    const signature = await this.signatureInternalOrThrow(id, { includeDeleted: false });
    this.validateImage(file);
    const validFile = file as UploadedSignatureFile;
    const extension = this.extensionFor(validFile);
    const stored = await this.assets.saveSignatureImage({ content: validFile.buffer, extension });
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.signature.update({
          where: { id },
          data: {
            imageStorageKey: stored.storageKey,
            mimeType: validFile.mimetype,
            originalFileName: this.sanitizeOriginalName(validFile.originalname),
            fileSize: validFile.size,
          },
          select: SIGNATURE_INTERNAL_SELECT,
        });
        await tx.auditLog.create({
          data: this.auditInput(SIGNATURE_AUDIT_ACTIONS.SIGNATURE_IMAGE_UPLOADED, actor, context, {
            signatureId: id,
            fileSize: validFile.size,
            mimeType: validFile.mimetype,
          }),
        });
        return saved;
      });
      if (signature.imageStorageKey)
        await this.assets.delete(signature.imageStorageKey).catch(() => undefined);
      return this.toResponse(updated);
    } catch (error) {
      await this.assets.delete(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async downloadImage(
    id: string,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
  ): Promise<SignatureImageResponse> {
    const signature = await this.signatureInternalOrThrow(id, { includeDeleted: false });
    if (!signature.imageStorageKey) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_IMAGE_REQUIRED,
        'A imagem de assinatura não foi enviada',
        HttpStatus.CONFLICT,
      );
    }
    const stored = await this.assets.getSignatureImage(signature.imageStorageKey);
    await this.prisma.auditLog.create({
      data: this.auditInput(SIGNATURE_AUDIT_ACTIONS.SIGNATURE_IMAGE_DOWNLOADED, actor, context, {
        signatureId: id,
      }),
    });
    return {
      ...this.toResponse(signature),
      contentBase64: stored.content.toString('base64'),
    };
  }

  async stageUserSignatureImage(file: UploadedSignatureFile | undefined): Promise<StagedSignatureImage> {
    this.validateImage(file);
    const validFile = file as UploadedSignatureFile;
    const stored = await this.assets.saveSignatureImage({
      content: validFile.buffer,
      extension: this.extensionFor(validFile),
    });
    return {
      storageKey: stored.storageKey,
      mimeType: validFile.mimetype,
      originalFileName: this.sanitizeOriginalName(validFile.originalname),
      fileSize: validFile.size,
    };
  }

  async discardStagedImage(storageKey: string): Promise<void> {
    await this.assets.delete(storageKey).catch(() => undefined);
  }

  private async signatureOrThrow(
    id: string,
    options: { includeDeleted: boolean } = { includeDeleted: false },
  ): Promise<SignatureResponse> {
    return this.toResponse(await this.signatureInternalOrThrow(id, options));
  }

  private async signatureInternalOrThrow(
    id: string,
    options: { includeDeleted: boolean } = { includeDeleted: false },
  ): Promise<SignatureInternal> {
    const signature = await this.prisma.signature.findUnique({ where: { id }, select: SIGNATURE_INTERNAL_SELECT });
    if (!signature || (!options.includeDeleted && signature.deletedAt)) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_NOT_FOUND,
        'Assinatura não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return signature;
  }

  private toResponse(signature: SignatureInternal): SignatureResponse {
    const { imageStorageKey, ...safe } = signature;
    void imageStorageKey;
    return { ...safe, hasImage: Boolean(signature.imageStorageKey) };
  }

  private validateImage(file: UploadedSignatureFile | undefined): void {
    if (!file) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_IMAGE_REQUIRED,
        'O arquivo da imagem de assinatura é obrigatório',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size <= 0 || file.size > MAX_SIGNATURE_IMAGE_SIZE_BYTES) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        'A imagem de assinatura está vazia ou excede o limite de 2 MiB',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!SIGNATURE_IMAGE_MIME_TYPES.includes(file.mimetype as never)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'Tipo MIME da imagem de assinatura não permitido',
        HttpStatus.BAD_REQUEST,
      );
    }
    const extension = extname(file.originalname).toLowerCase().replace('.', '');
    if (!SIGNATURE_IMAGE_EXTENSIONS.includes(extension as never)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_EXTENSION,
        'Extensão da imagem de assinatura não permitida',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.hasValidBinarySignature(file.buffer, file.mimetype)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'A assinatura binária da imagem de assinatura é inválida',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private hasValidBinarySignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'image/png') {
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  private extensionFor(file: UploadedSignatureFile): 'png' | 'jpg' | 'jpeg' {
    const extension = extname(file.originalname).toLowerCase().replace('.', '');
    return extension === 'jpeg' ? 'jpeg' : file.mimetype === 'image/png' ? 'png' : 'jpg';
  }

  private sanitizeOriginalName(name: string): string {
    const fallback = 'signature-image';
    const sanitized = name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim();
    return (sanitized || fallback).slice(0, 255);
  }

  private clean(input: string): string {
    return input
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private auditInput(
    action: string,
    actor: AuthenticatedUser,
    context: SignatureAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource: SIGNATURE_RESOURCE,
      actor: actor.id,
      metadata: {
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
        ...metadata,
      },
    };
  }
}

export function signatureContextFromRequest(request: RequestWithId): SignatureAuditContext {
  return {
    requestId: request.requestId,
    ip: request.ip || null,
    userAgent: request.get('user-agent') ?? null,
  };
}
