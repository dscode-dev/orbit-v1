import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AssetLifecycleEventType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  STORAGE_PROVIDER_TOKEN,
  type StorageProviderContract,
} from '../../infra/storage/storage-provider.type';
import {
  ASSET_LIFECYCLE_ATTACHMENT_EXTENSIONS,
  ASSET_LIFECYCLE_ATTACHMENT_MIME_TYPES,
  ASSET_LIFECYCLE_ATTACHMENT_RESOURCE,
  ASSET_LIFECYCLE_AUDIT_ACTIONS,
  ASSET_LIFECYCLE_STORAGE_PREFIX,
  MAX_ASSET_LIFECYCLE_ATTACHMENT_SIZE_BYTES,
} from '../../shared/constants/asset-lifecycle.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginationMeta } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import {
  ASSET_LIFECYCLE_EVENT_INCLUDE,
  type AssetLifecycleAuditContext,
  type AssetLifecycleEventPayload,
} from './asset-lifecycle.types';
import type {
  CreateAssetLifecycleEventDto,
  ListAssetLifecycleQueryDto,
} from './dto/asset-lifecycle.dto';
import { LifecyclePublisher } from './lifecycle-publisher.service';
import { TimelineAssembler } from './timeline-assembler.service';
import type { UploadedAssetLifecycleFile } from './types/uploaded-asset-lifecycle-file.type';

const INTERVENTION_EVENT_TYPES: AssetLifecycleEventType[] = [
  AssetLifecycleEventType.PREVENTIVE,
  AssetLifecycleEventType.CORRECTIVE,
  AssetLifecycleEventType.MAINTENANCE,
  AssetLifecycleEventType.PART_REPLACEMENT,
  AssetLifecycleEventType.INSPECTION,
];

const MAINTENANCE_EVENT_TYPES: AssetLifecycleEventType[] = [
  AssetLifecycleEventType.PREVENTIVE,
  AssetLifecycleEventType.CORRECTIVE,
  AssetLifecycleEventType.MAINTENANCE,
];

@Injectable()
export class AssetLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly storage: StorageProviderContract,
    private readonly publisher: LifecyclePublisher,
    private readonly timeline: TimelineAssembler,
    private readonly access: OperationAccessService,
  ) {}

  async list(query: ListAssetLifecycleQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const where = { ...this.where(query), ...this.access.lifecycleScope(actor) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.assetLifecycleEvent.findMany({
        where,
        include: ASSET_LIFECYCLE_EVENT_INCLUDE,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.assetLifecycleEvent.count({ where }),
    ]);
    return {
      items: items.map((event) => this.withTimeline(event)),
      timelineGroups: this.timeline.assembleGroups(items),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  }

  async get(id: string, actor: AuthenticatedUser, context: AssetLifecycleAuditContext): Promise<unknown> {
    await this.access.assertLifecycleEventAccess(actor, id, {
      resource: 'asset_lifecycle_event',
      resourceId: id,
      context,
    });
    const event = await this.eventOrThrow(id);
    return this.withTimeline(event);
  }

  listForEquipment(equipmentId: string, query: ListAssetLifecycleQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    return this.list({ ...query, equipmentId }, actor);
  }

  async create(
    dto: CreateAssetLifecycleEventDto,
    actor: AuthenticatedUser,
    context: AssetLifecycleAuditContext,
  ): Promise<unknown> {
    if (dto.operationId) {
      await this.access.assertOperationAccess(actor, dto.operationId, {
        resource: 'asset_lifecycle_event',
        resourceId: dto.operationId,
        context,
      });
    }
    const event = await this.publisher.publishManual(dto, actor.id, context);
    return this.withTimeline(event);
  }

  async listAttachments(eventId: string, actor: AuthenticatedUser, context: AssetLifecycleAuditContext): Promise<unknown> {
    await this.access.assertLifecycleEventAccess(actor, eventId, {
      resource: ASSET_LIFECYCLE_ATTACHMENT_RESOURCE,
      resourceId: eventId,
      context,
    });
    await this.eventOrThrow(eventId);
    const attachments = await this.prisma.assetLifecycleAttachment.findMany({
      where: { eventId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return attachments.map((attachment) => this.publicAttachment(attachment));
  }

  async uploadAttachment(
    eventId: string,
    category: string,
    file: UploadedAssetLifecycleFile | undefined,
    actor: AuthenticatedUser,
    context: AssetLifecycleAuditContext,
  ): Promise<unknown> {
    await this.access.assertLifecycleEventAccess(actor, eventId, {
      resource: ASSET_LIFECYCLE_ATTACHMENT_RESOURCE,
      resourceId: eventId,
      context,
    });
    await this.eventOrThrow(eventId);
    this.validateAttachment(file);
    const validFile = file as UploadedAssetLifecycleFile;
    const extension = this.extensionFor(validFile);
    const storageKey = `${ASSET_LIFECYCLE_STORAGE_PREFIX}/${eventId}/attachments/${randomUUID()}.${extension}`;
    try {
      await this.storage.save({ storageKey, content: validFile.buffer });
      return await this.prisma.$transaction(async (tx) => {
        const attachment = await tx.assetLifecycleAttachment.create({
          data: {
            eventId,
            storageKey,
            originalFileName: this.sanitizeOriginalName(validFile.originalname),
            mimeType: validFile.mimetype,
            fileSize: validFile.size,
            category: this.clean(category).slice(0, 80),
          },
        });
        await tx.auditLog.create({
          data: this.auditInput(
            ASSET_LIFECYCLE_AUDIT_ACTIONS.ATTACHMENT_UPLOADED,
            ASSET_LIFECYCLE_ATTACHMENT_RESOURCE,
            actor.id,
            context,
            {
              eventId,
              attachmentId: attachment.id,
              fileSize: attachment.fileSize,
              mimeType: attachment.mimeType,
            },
          ),
        });
        return this.publicAttachment(attachment);
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async deleteAttachment(
    eventId: string,
    attachmentId: string,
    actor: AuthenticatedUser,
    context: AssetLifecycleAuditContext,
  ): Promise<{ deleted: true }> {
    await this.eventOrThrow(eventId);
    const existing = await this.prisma.assetLifecycleAttachment.findFirst({
      where: { id: attachmentId, eventId, deletedAt: null },
    });
    if (!existing) {
      throw new ApplicationException(
        ERROR_CODES.ASSET_LIFECYCLE_ATTACHMENT_NOT_FOUND,
        'Anexo do histórico do ativo não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.$transaction([
      this.prisma.assetLifecycleAttachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: this.auditInput(
          ASSET_LIFECYCLE_AUDIT_ACTIONS.ATTACHMENT_DELETED,
          ASSET_LIFECYCLE_ATTACHMENT_RESOURCE,
          actor.id,
          context,
          { eventId, attachmentId },
        ),
      }),
    ]);
    await this.storage.delete(existing.storageKey).catch(() => undefined);
    return { deleted: true };
  }

  async stats(equipmentId: string, actor: AuthenticatedUser): Promise<unknown> {
    const events = await this.prisma.assetLifecycleEvent.findMany({
      where: { equipmentId, ...this.access.lifecycleScope(actor) },
      select: { type: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
    const byType = Object.fromEntries(
      Object.values(AssetLifecycleEventType).map((type) => [
        type,
        events.filter((event) => event.type === type).length,
      ]),
    );
    const interventions = events.filter((event) => INTERVENTION_EVENT_TYPES.includes(event.type));
    const gaps = interventions
      .slice(1)
      .map((event, index) => event.occurredAt.getTime() - interventions[index].occurredAt.getTime());
    const averageDays =
      gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length / 86_400_000 : null;
    return {
      equipmentId,
      total: events.length,
      byType,
      preventiveCount: byType.PREVENTIVE,
      correctiveCount: byType.CORRECTIVE,
      documentCount: byType.DOCUMENT,
      inspectionCount: byType.INSPECTION,
      firstInstallation:
        events.find((event) => event.type === AssetLifecycleEventType.INSTALLATION)?.occurredAt ??
        null,
      lastMaintenance:
        [...events]
          .reverse()
          .find((event) => MAINTENANCE_EVENT_TYPES.includes(event.type))?.occurredAt ?? null,
      meanDaysBetweenInterventions: averageDays,
    };
  }

  private where(query: ListAssetLifecycleQueryDto): Prisma.AssetLifecycleEventWhereInput {
    return {
      ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
      ...(query.customerId ? { equipment: { customerId: query.customerId } } : {}),
      ...(query.operationId ? { operationId: query.operationId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.performedBy ? { performedBy: query.performedBy } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }

  private async eventOrThrow(id: string): Promise<AssetLifecycleEventPayload> {
    const event = await this.prisma.assetLifecycleEvent.findUnique({
      where: { id },
      include: ASSET_LIFECYCLE_EVENT_INCLUDE,
    });
    if (!event) {
      throw new ApplicationException(
        ERROR_CODES.ASSET_LIFECYCLE_EVENT_NOT_FOUND,
        'Evento do histórico do ativo não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return event;
  }

  private validateAttachment(file: UploadedAssetLifecycleFile | undefined): void {
    if (!file) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_REQUIRED,
        'O arquivo do anexo do histórico do ativo é obrigatório',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size <= 0 || file.size > MAX_ASSET_LIFECYCLE_ATTACHMENT_SIZE_BYTES) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        'O anexo do histórico do ativo está vazio ou excede o limite de 5 MiB',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!ASSET_LIFECYCLE_ATTACHMENT_MIME_TYPES.includes(file.mimetype as never)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'Tipo MIME do anexo do histórico do ativo não permitido',
        HttpStatus.BAD_REQUEST,
      );
    }
    const extension = this.extensionFor(file);
    if (!ASSET_LIFECYCLE_ATTACHMENT_EXTENSIONS.includes(extension as never)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_EXTENSION,
        'Extensão do anexo do histórico do ativo não permitida',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.hasValidBinarySignature(file.buffer, file.mimetype)) {
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'A assinatura binária do anexo do histórico do ativo é inválida',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private extensionFor(file: UploadedAssetLifecycleFile): string {
    return extname(file.originalname).toLowerCase().replace('.', '');
  }

  private hasValidBinarySignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    if (mimeType === 'image/png')
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  private clean(value: string): string {
    return value
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sanitizeOriginalName(name: string): string {
    return (name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim() || 'attachment').slice(0, 255);
  }

  private publicAttachment(attachment: {
    id: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    category: string;
    createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: attachment.id,
      originalFileName: this.sanitizeOriginalName(attachment.originalFileName),
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      category: attachment.category,
      createdAt: attachment.createdAt,
    };
  }

  private withTimeline(event: AssetLifecycleEventPayload): AssetLifecycleEventPayload & {
    timeline: Record<string, unknown>;
  } {
    const timeline = this.timeline.assemble(event);
    return {
      id: event.id,
      equipmentId: event.equipmentId,
      operationId: event.operationId,
      documentId: event.documentId,
      type: event.type,
      occurredAt: event.occurredAt,
      performedBy: event.performedBy,
      description: event.description,
      createdAt: event.createdAt,
      equipment: event.equipment
        ? {
            id: event.equipment.id,
            name: event.equipment.name,
            tag: event.equipment.tag,
            type: event.equipment.type,
            status: event.equipment.status,
            customer: event.equipment.customer
              ? {
                  id: event.equipment.customer.id,
                  name: event.equipment.customer.name,
                  tradeName: event.equipment.customer.tradeName,
                }
              : null,
          }
        : null,
      operation: event.operation,
      document: event.document,
      performer: event.performer
        ? {
            id: event.performer.id,
            name: event.performer.name,
            username: event.performer.username,
          }
        : null,
      attachments: event.attachments.map((attachment) => this.publicAttachment(attachment)),
      timeline,
    } as AssetLifecycleEventPayload & { timeline: Record<string, unknown> };
  }

  private auditInput(
    action: string,
    resource: string,
    actor: string,
    context: AssetLifecycleAuditContext,
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
