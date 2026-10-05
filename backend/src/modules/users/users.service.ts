import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  STORAGE_PROVIDER_TOKEN,
  type StorageProviderContract,
} from '../../infra/storage/storage-provider.type';
import {
  ALLOWED_AVATAR_EXTENSIONS,
  ALLOWED_AVATAR_MIME_TYPES,
  GENERATED_PASSWORD_BYTES,
  MAX_AVATAR_SIZE_BYTES,
  USER_AUDIT_ACTIONS,
  USER_AVATAR_RESOURCE,
  USER_PREFERENCES_RESOURCE,
  USER_RESOURCE,
} from '../../shared/constants/users.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../database/prisma.service';
import { SIGNATURE_AUDIT_ACTIONS, SIGNATURE_RESOURCE } from '../../shared/constants/signatures.constants';
import { SignaturesService } from '../signatures/signatures.service';
import { USER_FOOTPRINT_SELECT, userHistory } from './user-history';
import type {
  ChangePasswordDto,
  CompleteFirstAccessDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdatePreferencesDto,
  UpdateUserDto,
  UserPermissionDto,
} from './dto/user.dto';
import type { UploadedAvatarFile } from './types/uploaded-avatar.type';
import type { UploadedSignatureFile } from '../signatures/types/uploaded-signature-file.type';

export interface UserAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const PERMISSION_SELECT = {
  canFinancial: true,
  canUsers: true,
  canReports: true,
  canSchedules: true,
  canTemplates: true,
} satisfies Prisma.UserPermissionSelect;

const PREFERENCES_SELECT = {
  id: true,
  userId: true,
  theme: true,
  notificationsEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserPreferencesSelect;

const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  avatarAssetId: true,
  phone: true,
  jobTitle: true,
  notes: true,
  mustChangePassword: true,
  isActive: true,
  disabledAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  permission: { select: PERMISSION_SELECT },
  preferences: { select: PREFERENCES_SELECT },
} satisfies Prisma.UserSelect;

const AVATAR_PUBLIC_SELECT = {
  id: true,
  mimeType: true,
  originalFileName: true,
  fileSize: true,
  createdAt: true,
} satisfies Prisma.UserAvatarAssetSelect;

const AVATAR_SELECT = {
  ...AVATAR_PUBLIC_SELECT,
  storageKey: true,
} satisfies Prisma.UserAvatarAssetSelect;

type UserResponse = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
type AvatarInternalResponse = Prisma.UserAvatarAssetGetPayload<{ select: typeof AVATAR_SELECT }>;
type AvatarResponse = Prisma.UserAvatarAssetGetPayload<{ select: typeof AVATAR_PUBLIC_SELECT }>;
type PreferencesResponse = Prisma.UserPreferencesGetPayload<{ select: typeof PREFERENCES_SELECT }>;
type PermissionResponse = {
  canFinancial: boolean;
  canUsers: boolean;
  canReports: boolean;
  canSchedules: boolean;
  canTemplates: boolean;
};
type NormalizedUserResponse = Omit<UserResponse, 'permission'> & {
  permission: PermissionResponse;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(STORAGE_PROVIDER_TOKEN)
    private readonly storage: StorageProviderContract,
    @Optional() private readonly signatures?: SignaturesService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<PaginatedResponse<NormalizedUserResponse>> {
    // Usuários excluídos com histórico (arquivados) não aparecem na lista;
    // os apenas desativados continuam, com status inativo.
    const where: Prisma.UserWhereInput = query.search
      ? {
          deletedAt: null,
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { username: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
            { jobTitle: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : { deletedAt: null };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildPaginatedResponse(
      items.map((user) => this.withEffectivePermissions(user)),
      total,
      query.page,
      query.limit,
    );
  }

  async get(id: string): Promise<NormalizedUserResponse> {
    return this.withEffectivePermissions(await this.getUserOrThrow(id));
  }

  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
    context: UserAuditContext,
  ): Promise<{ user: NormalizedUserResponse; temporaryPassword: string }> {
    const temporaryPassword = this.generatePassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const permissions = this.permissionsForRole(dto.role, dto.permissions ?? {});

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            email: dto.email,
            username: dto.username,
            name: dto.name,
            passwordHash,
            role: dto.role,
            phone: dto.phone,
            jobTitle: dto.jobTitle,
            notes: dto.notes,
            mustChangePassword: true,
            preferences: { create: {} },
            permission: { create: permissions },
          },
          select: USER_SELECT,
        });
        await transaction.auditLog.create({
          data: this.auditData(USER_AUDIT_ACTIONS.USER_CREATED, USER_RESOURCE, actor.id, context, {
            targetUserId: created.id,
            role: created.role,
          }),
        });
        return created;
      });
      return { user: this.withEffectivePermissions(user), temporaryPassword };
    } catch (error: unknown) {
      this.throwConflictIfUnique(error);
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    context: UserAuditContext,
  ): Promise<NormalizedUserResponse> {
    const existing = await this.getUserOrThrow(id);
    const nextRole = dto.role ?? existing.role;
    if (existing.role === Role.OWNER && nextRole !== Role.OWNER) {
      await this.ensureAnotherActiveOwner(id);
    }
    const { permissions, ...userData } = dto;

    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.update({
          where: { id },
          data: {
            ...userData,
            permission: {
              upsert: {
                create: this.permissionsForRole(nextRole, permissions ?? {}),
                update: this.permissionsForRole(nextRole, permissions ?? existing.permission ?? {}),
              },
            },
          },
          select: USER_SELECT,
        });
        await transaction.auditLog.create({
          data: this.auditData(USER_AUDIT_ACTIONS.USER_UPDATED, USER_RESOURCE, actor.id, context, {
            targetUserId: id,
            changedFields: Object.keys(dto),
          }),
        });
        return user;
      });
      return this.withEffectivePermissions(updated);
    } catch (error: unknown) {
      this.throwConflictIfUnique(error);
      throw error;
    }
  }

  async disable(
    id: string,
    actor: AuthenticatedUser,
    context: UserAuditContext,
  ): Promise<NormalizedUserResponse> {
    return this.setActive(id, false, actor, context, USER_AUDIT_ACTIONS.USER_DISABLED);
  }

  async enable(
    id: string,
    actor: AuthenticatedUser,
    context: UserAuditContext,
  ): Promise<NormalizedUserResponse> {
    return this.setActive(id, true, actor, context, USER_AUDIT_ACTIONS.USER_ENABLED);
  }

  /**
   * Exclusão de usuário.
   * - Sem histórico: apaga de vez o usuário, a assinatura (com a imagem), a foto
   *   de perfil, sessões, preferências e notificações.
   * - Com histórico (atendimentos, documentos, financeiro…) ou assinatura já
   *   usada em documentos/modelos: arquiva — inativo, fora da lista, sessões
   *   revogadas e assinatura desativada — para manter a auditoria íntegra.
   *   E-mail e usuário são liberados para um novo cadastro.
   */
  async remove(
    id: string,
    actor: AuthenticatedUser,
    context: UserAuditContext,
  ): Promise<{ deleted: true; mode: 'deleted' | 'archived' }> {
    this.ensureNotSelf(id, actor.id);
    const existing = await this.getUserOrThrow(id);
    if (existing.role === Role.OWNER && existing.isActive) {
      await this.ensureAnotherActiveOwner(id);
    }
    const footprint = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: USER_FOOTPRINT_SELECT,
    });
    const history = userHistory(footprint);
    const now = new Date();
    const signature = footprint.institutionalSignature;
    const avatar = footprint.avatarAsset;

    if (Object.keys(history).length === 0) {
      await this.prisma.$transaction(async (tx) => {
        if (signature) await tx.signature.delete({ where: { id: signature.id } });
        // Sessões, preferências, permissões e notificações saem em cascata.
        await tx.user.delete({ where: { id } });
        if (avatar) await tx.userAvatarAsset.delete({ where: { id: avatar.id } });
        await tx.auditLog.create({
          data: this.auditData(USER_AUDIT_ACTIONS.USER_DELETED, USER_RESOURCE, actor.id, context, {
            targetUserId: id,
            mode: 'deleted',
            name: existing.name,
            email: existing.email,
            username: existing.username,
            role: existing.role,
            signatureId: signature?.id ?? null,
          }),
        });
      });
      // Arquivos só depois do commit; falha aqui não desfaz a exclusão.
      for (const key of [signature?.imageStorageKey, avatar?.storageKey]) {
        if (key) await this.storage.delete(key).catch(() => undefined);
      }
      return { deleted: true, mode: 'deleted' };
    }

    const suffix = id.slice(0, 8);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          isActive: false,
          disabledAt: existing.disabledAt ?? now,
          deletedAt: now,
          // Libera e-mail e usuário para um novo cadastro; os originais ficam na auditoria.
          email: `${existing.email.slice(0, 200)}#excluido-${suffix}`,
          username: `excluido-${suffix}-${existing.username}`.slice(0, 50),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
      // A assinatura sai de uso, mas continua nos documentos já emitidos.
      this.prisma.signature.updateMany({
        where: { userId: id, deletedAt: null },
        data: { active: false, deletedAt: now },
      }),
      this.prisma.auditLog.create({
        data: this.auditData(USER_AUDIT_ACTIONS.USER_DELETED, USER_RESOURCE, actor.id, context, {
          targetUserId: id,
          mode: 'archived',
          email: existing.email,
          username: existing.username,
          history,
        }),
      }),
    ]);
    return { deleted: true, mode: 'archived' };
  }

  async resetPassword(
    id: string,
    actor: AuthenticatedUser,
    context: UserAuditContext,
  ): Promise<{ userId: string; temporaryPassword: string; mustChangePassword: true }> {
    await this.getUserOrThrow(id);
    const temporaryPassword = this.generatePassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditLog.create({
        data: this.auditData(USER_AUDIT_ACTIONS.PASSWORD_RESET, USER_RESOURCE, actor.id, context, {
          targetUserId: id,
        }),
      }),
    ]);
    return { userId: id, temporaryPassword, mustChangePassword: true };
  }

  async changePassword(
    id: string,
    dto: ChangePasswordDto,
    context: UserAuditContext,
  ): Promise<{ changed: true; reauthenticationRequired: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { passwordHash: true },
    });
    if (!user || !(await this.passwords.verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new ApplicationException(
        ERROR_CODES.PASSWORD_CURRENT_INVALID,
        'Senha atual inválida',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (await this.passwords.verify(user.passwordHash, dto.newPassword)) {
      throw new ApplicationException(
        ERROR_CODES.PASSWORD_REUSE_NOT_ALLOWED,
        'A nova senha deve ser diferente da senha atual',
        HttpStatus.BAD_REQUEST,
      );
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditLog.create({
        data: this.auditData(USER_AUDIT_ACTIONS.PASSWORD_CHANGED, USER_RESOURCE, id, context, {
          targetUserId: id,
          sessionsRevoked: true,
        }),
      }),
    ]);
    return { changed: true, reauthenticationRequired: true };
  }

  async completeFirstAccess(
    id: string,
    dto: CompleteFirstAccessDto,
    file: UploadedSignatureFile | undefined,
    context: UserAuditContext,
  ): Promise<{ completed: true; signatureId: string; reauthenticationRequired: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        passwordHash: true,
        mustChangePassword: true,
        institutionalSignature: { select: { id: true, imageStorageKey: true } },
      },
    });
    if (!user) throw this.userNotFound();
    if (!user.mustChangePassword) {
      throw new ApplicationException(
        ERROR_CODES.BAD_REQUEST,
        'O primeiro acesso já foi concluído',
        HttpStatus.CONFLICT,
      );
    }
    if (!(await this.passwords.verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new ApplicationException(
        ERROR_CODES.PASSWORD_CURRENT_INVALID,
        'Senha atual inválida',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (await this.passwords.verify(user.passwordHash, dto.newPassword)) {
      throw new ApplicationException(
        ERROR_CODES.PASSWORD_REUSE_NOT_ALLOWED,
        'A nova senha deve ser diferente da senha atual',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.signatures) {
      throw new ApplicationException(
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        'Serviço de assinatura indisponível',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const signatures = this.signatures;
    const passwordHash = await this.passwords.hash(dto.newPassword);
    const staged = await signatures.stageUserSignatureImage(file);
    const now = new Date();
    try {
      const signature = await this.prisma.$transaction(async (tx) => {
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
        const saved = await tx.signature.upsert({
          where: { userId: id },
          create: {
            organizationId: organization.id,
            userId: id,
            name: user.name,
            title: dto.signatureTitle || user.jobTitle || 'Técnico',
            profession: dto.profession || null,
            professionalCouncil: dto.professionalCouncil || null,
            registrationNumber: dto.registrationNumber || null,
            department: dto.department || null,
            imageStorageKey: staged.storageKey,
            mimeType: staged.mimeType,
            originalFileName: staged.originalFileName,
            fileSize: staged.fileSize,
            active: true,
          },
          update: {
            name: user.name,
            title: dto.signatureTitle || user.jobTitle || 'Técnico',
            profession: dto.profession || null,
            professionalCouncil: dto.professionalCouncil || null,
            registrationNumber: dto.registrationNumber || null,
            department: dto.department || null,
            imageStorageKey: staged.storageKey,
            mimeType: staged.mimeType,
            originalFileName: staged.originalFileName,
            fileSize: staged.fileSize,
            active: true,
            deletedAt: null,
          },
          select: { id: true },
        });
        await tx.user.update({
          where: { id },
          data: { passwordHash, mustChangePassword: false },
        });
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.auditLog.createMany({
          data: [
            this.auditData(USER_AUDIT_ACTIONS.PASSWORD_CHANGED, USER_RESOURCE, id, context, {
              targetUserId: id,
              sessionsRevoked: true,
              firstAccess: true,
            }),
            this.auditData(
              user.institutionalSignature
                ? SIGNATURE_AUDIT_ACTIONS.SIGNATURE_UPDATED
                : SIGNATURE_AUDIT_ACTIONS.SIGNATURE_CREATED,
              SIGNATURE_RESOURCE,
              id,
              context,
              { signatureId: saved.id, userId: id, firstAccess: true, imageUploaded: true },
            ),
          ],
        });
        return saved;
      });
      if (user.institutionalSignature?.imageStorageKey) {
        await signatures.discardStagedImage(user.institutionalSignature.imageStorageKey);
      }
      return { completed: true, signatureId: signature.id, reauthenticationRequired: true };
    } catch (error) {
      await signatures.discardStagedImage(staged.storageKey);
      throw error;
    }
  }

  async getPreferences(userId: string): Promise<PreferencesResponse> {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: PREFERENCES_SELECT,
    });
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
    context: UserAuditContext,
  ): Promise<PreferencesResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const preferences = await transaction.userPreferences.upsert({
        where: { userId },
        create: { userId, ...dto },
        update: dto,
        select: PREFERENCES_SELECT,
      });
      await transaction.auditLog.create({
        data: this.auditData(
          USER_AUDIT_ACTIONS.PREFERENCES_UPDATED,
          USER_PREFERENCES_RESOURCE,
          userId,
          context,
          { targetUserId: userId, changedFields: Object.keys(dto) },
        ),
      });
      return preferences;
    });
  }

  async profile(userId: string): Promise<{
    user: {
      id: string;
      email: string;
      username: string;
      name: string;
      avatarAssetId: string | null;
      phone: string | null;
      jobTitle: string | null;
      role: Role;
      isActive: boolean;
      mustChangePassword: boolean;
    };
    organization: {
      id: string;
      legalName: string;
      tradeName: string;
      segment: string | null;
      primaryColor: string;
      secondaryColor: string;
      isActive: boolean;
    };
    role: Role;
    permissions: PermissionResponse;
    preferences: PreferencesResponse | null;
  }> {
    const [user, organization] = await Promise.all([
      this.getUserOrThrow(userId),
      this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          segment: true,
          primaryColor: true,
          secondaryColor: true,
          isActive: true,
        },
      }),
    ]);
    if (!organization) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organização não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    const normalized = this.withEffectivePermissions(user);
    return {
      user: {
        id: normalized.id,
        email: normalized.email,
        username: normalized.username,
        name: normalized.name,
        avatarAssetId: normalized.avatarAssetId,
        phone: normalized.phone,
        jobTitle: normalized.jobTitle,
        role: normalized.role,
        isActive: normalized.isActive,
        mustChangePassword: normalized.mustChangePassword,
      },
      organization,
      role: normalized.role,
      permissions: normalized.permission,
      preferences: normalized.preferences,
    };
  }

  async uploadAvatar(
    userId: string,
    file: UploadedAvatarFile | undefined,
    context: UserAuditContext,
  ): Promise<AvatarResponse> {
    this.validateAvatar(file);
    const validFile = file as UploadedAvatarFile;
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarAsset: { select: AVATAR_SELECT } },
    });
    if (!current) {
      throw this.userNotFound();
    }
    const extension = this.avatarExtension(validFile);
    const storageKey = `users/avatar/${randomUUID()}.${extension}`;
    await this.storage.save({ storageKey, content: validFile.buffer });

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const avatar = await transaction.userAvatarAsset.create({
          data: {
            storageKey,
            mimeType: validFile.mimetype,
            originalFileName: this.sanitizeName(validFile.originalname),
            fileSize: validFile.size,
          },
          select: AVATAR_SELECT,
        });
        await transaction.user.update({
          where: { id: userId },
          data: { avatarAssetId: avatar.id },
        });
        if (current.avatarAsset) {
          await transaction.userAvatarAsset.delete({ where: { id: current.avatarAsset.id } });
        }
        await transaction.auditLog.create({
          data: this.auditData(
            USER_AUDIT_ACTIONS.AVATAR_UPDATED,
            USER_AVATAR_RESOURCE,
            userId,
            context,
            { targetUserId: userId, avatarAssetId: avatar.id, operation: 'UPLOAD' },
          ),
        });
        return avatar;
      });
      if (current.avatarAsset) {
        await this.storage.delete(current.avatarAsset.storageKey);
      }
      return this.toAvatarResponse(created);
    } catch (error: unknown) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async getAvatar(id: string): Promise<AvatarResponse & { contentBase64: string }> {
    const avatar = await this.prisma.userAvatarAsset.findUnique({
      where: { id },
      select: AVATAR_SELECT,
    });
    if (!avatar) {
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Avatar não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    const stored = await this.storage.get(avatar.storageKey);
    return { ...this.toAvatarResponse(avatar), contentBase64: stored.content.toString('base64') };
  }

  async deleteAvatar(userId: string, context: UserAuditContext): Promise<{ deleted: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarAsset: { select: AVATAR_SELECT } },
    });
    if (!user) {
      throw this.userNotFound();
    }
    if (!user.avatarAsset) {
      return { deleted: true };
    }
    const avatar = user.avatarAsset;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { avatarAssetId: null } }),
      this.prisma.userAvatarAsset.delete({ where: { id: avatar.id } }),
      this.prisma.auditLog.create({
        data: this.auditData(
          USER_AUDIT_ACTIONS.AVATAR_UPDATED,
          USER_AVATAR_RESOURCE,
          userId,
          context,
          { targetUserId: userId, avatarAssetId: avatar.id, operation: 'DELETE' },
        ),
      }),
    ]);
    await this.storage.delete(avatar.storageKey);
    return { deleted: true };
  }

  private async setActive(
    id: string,
    active: boolean,
    actor: AuthenticatedUser,
    context: UserAuditContext,
    action: string,
  ): Promise<NormalizedUserResponse> {
    if (!active) {
      this.ensureNotSelf(id, actor.id);
    }
    const existing = await this.getUserOrThrow(id);
    if (!active && existing.role === Role.OWNER && existing.isActive) {
      await this.ensureAnotherActiveOwner(id);
    }
    const now = new Date();
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.user.update({
        where: { id },
        data: { isActive: active, disabledAt: active ? null : now },
      }),
      this.prisma.auditLog.create({
        data: this.auditData(action, USER_RESOURCE, actor.id, context, { targetUserId: id }),
      }),
    ];
    if (!active) {
      operations.push(
        this.prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        }),
      );
    }
    await this.prisma.$transaction(operations);
    return this.get(id);
  }

  /** Usuário ativo ou desativado; arquivados (excluídos com histórico) não existem mais aqui. */
  private async getUserOrThrow(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: USER_SELECT });
    if (!user) {
      throw this.userNotFound();
    }
    return user;
  }

  private userNotFound(): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.USER_NOT_FOUND,
      'Usuário não encontrado',
      HttpStatus.NOT_FOUND,
    );
  }

  private withEffectivePermissions(user: UserResponse): NormalizedUserResponse {
    return {
      ...user,
      permission: this.permissionsForRole(user.role, user.permission ?? {}),
    };
  }

  private permissionsForRole(role: Role, input: UserPermissionDto): PermissionResponse {
    // Proprietário tem acesso pleno, sempre. Os demais papéis (Gestor, Operador,
    // Visualizador) usam exatamente as permissões concedidas — ex.: operador com
    // Relatórios/Agendamentos. Antes, apenas Gestor respeitava o input e Operador
    // ficava sempre com tudo bloqueado.
    if (role === Role.OWNER) {
      return {
        canFinancial: true,
        canUsers: true,
        canReports: true,
        canSchedules: true,
        canTemplates: true,
      };
    }
    return {
      canFinancial: input.canFinancial ?? false,
      canUsers: input.canUsers ?? false,
      canReports: input.canReports ?? false,
      canSchedules: input.canSchedules ?? false,
      canTemplates: input.canTemplates ?? false,
    };
  }

  private ensureNotSelf(targetId: string, actorId: string): void {
    if (targetId === actorId) {
      throw new ApplicationException(
        ERROR_CODES.USER_SELF_ACTION_FORBIDDEN,
        'Você não pode desativar ou excluir a própria conta',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async ensureAnotherActiveOwner(excludedId: string): Promise<void> {
    const count = await this.prisma.user.count({
      where: { id: { not: excludedId }, role: Role.OWNER, isActive: true },
    });
    if (count === 0) {
      throw new ApplicationException(
        ERROR_CODES.USER_LAST_OWNER,
        'O último proprietário ativo não pode ser desativado, excluído ou rebaixado',
        HttpStatus.CONFLICT,
      );
    }
  }

  private throwConflictIfUnique(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApplicationException(
        ERROR_CODES.USER_CONFLICT,
        'E-mail ou nome de usuário já está em uso',
        HttpStatus.CONFLICT,
        { fields: error.meta?.target ?? [] },
      );
    }
  }

  private generatePassword(): string {
    return randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url');
  }

  private validateAvatar(file: UploadedAvatarFile | undefined): void {
    if (!file) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_REQUIRED,
        'Envie um arquivo',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        'O avatar excede o limite de 2 MiB',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      !ALLOWED_AVATAR_MIME_TYPES.includes(
        file.mimetype as (typeof ALLOWED_AVATAR_MIME_TYPES)[number],
      )
    ) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'Tipo MIME do avatar não permitido',
        HttpStatus.BAD_REQUEST,
      );
    }
    const extension = extname(file.originalname).slice(1).toLowerCase();
    if (
      !ALLOWED_AVATAR_EXTENSIONS.includes(extension as (typeof ALLOWED_AVATAR_EXTENSIONS)[number])
    ) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_EXTENSION,
        'Extensão de arquivo do avatar não permitida',
        HttpStatus.BAD_REQUEST,
      );
    }
    const png =
      file.buffer.length >= 8 &&
      file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg =
      file.buffer.length >= 3 &&
      file.buffer[0] === 0xff &&
      file.buffer[1] === 0xd8 &&
      file.buffer[2] === 0xff;
    if ((file.mimetype === 'image/png' && !png) || (file.mimetype === 'image/jpeg' && !jpeg)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'O conteúdo do avatar não corresponde ao tipo de imagem declarado',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private avatarExtension(file: UploadedAvatarFile): 'png' | 'jpg' {
    return file.mimetype === 'image/png' ? 'png' : 'jpg';
  }

  private toAvatarResponse(avatar: AvatarInternalResponse): AvatarResponse {
    const { storageKey, ...safe } = avatar;
    void storageKey;
    return safe;
  }

  private sanitizeName(name: string): string {
    const sanitized = name
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 255);
    return sanitized || 'avatar';
  }

  private auditData(
    action: string,
    resource: string,
    actor: string,
    context: UserAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource,
      actor,
      metadata: {
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
        ...metadata,
      },
    };
  }
}
