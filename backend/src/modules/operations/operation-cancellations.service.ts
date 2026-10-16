import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AssignmentEventType, AssignmentStatus, DocumentTemplateType, OperationCancellationStatus, Prisma, Role, type OperationCancellation } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { STORAGE_PROVIDER_TOKEN, type StorageProviderContract } from '../../infra/storage/storage-provider.type';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { MAX_OPERATION_SIGNATURE_SIZE_BYTES } from '../../shared/constants/operations.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { PrismaService } from '../database/prisma.service';
import type { OperationAuditContext } from './operations.service';
import { operationDeletedError } from '../operation-access/operation-access.service';
import { decodeOperationPhoto } from './operation-media.utils';
import type { ApproveOperationCancellationDto, RequestOperationCancellationDto, RescheduleCanceledOperationDto } from './dto/operation-cancellation.dto';

const CANCELLATION_SELECT = {
  id: true,
  operationId: true,
  assignmentId: true,
  status: true,
  reason: true,
  customerSignerName: true,
  customerSignerRole: true,
  customerSignedAt: true,
  requestedAt: true,
  resolvedAt: true,
  rescheduledFor: true,
  resolutionNotes: true,
  createdAt: true,
  updatedAt: true,
  requestedBy: { select: { id: true, name: true, role: true } },
  resolvedBy: { select: { id: true, name: true, role: true } },
  technicalSignature: { select: { id: true, name: true, title: true, profession: true, professionalCouncil: true, registrationNumber: true, department: true, active: true, isDefault: true } },
  photos: { orderBy: { createdAt: 'asc' as const }, select: { id: true, caption: true, mimeType: true, fileSize: true, createdAt: true, createdBy: { select: { id: true, name: true, role: true } } } },
} satisfies Prisma.OperationCancellationSelect;

@Injectable()
export class OperationCancellationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly storage: StorageProviderContract,
  ) {}

  async request(operationId: string, dto: RequestOperationCancellationDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    await this.assertNotDeleted(operationId);
    if (actor.role !== Role.OPERATOR) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Somente o técnico responsável pode solicitar o cancelamento', HttpStatus.FORBIDDEN);
    }
    const assignment = await this.prisma.assignment.findFirst({
      where: { operationId, isPrimary: true },
      include: { operation: { select: { id: true, status: true } } },
    });
    if (!assignment || assignment.assignedTo !== actor.id) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Este atendimento não pertence ao operador autenticado', HttpStatus.FORBIDDEN);
    }
    const cancellableStatuses: AssignmentStatus[] = [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED, AssignmentStatus.STARTED, AssignmentStatus.PAUSED];
    if (!cancellableStatuses.includes(assignment.status)) {
      throw new ApplicationException(ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION, 'Somente atendimentos ainda não concluídos podem ser cancelados', HttpStatus.CONFLICT, { status: assignment.status });
    }
    const pending = await this.prisma.operationCancellation.findFirst({ where: { operationId, status: OperationCancellationStatus.REQUESTED }, select: { id: true } });
    if (pending) {
      throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'Já existe uma solicitação de cancelamento aguardando análise', HttpStatus.CONFLICT);
    }
    const signature = await this.prisma.signature.findFirst({
      where: { id: dto.technicalSignatureId, userId: actor.id, active: true, deletedAt: null, imageStorageKey: { not: null } },
      select: { id: true },
    });
    if (!signature) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Selecione sua assinatura técnica ativa', HttpStatus.BAD_REQUEST);
    }
    if (Boolean(dto.customerSignatureData) !== Boolean(dto.customerSignerName?.trim())) {
      throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'Nome e assinatura do cliente devem ser informados juntos', HttpStatus.BAD_REQUEST);
    }
    if (dto.customerSignatureData) this.validateCustomerSignature(dto.customerSignatureData);
    const photos = dto.photos.map(decodeOperationPhoto);
    const cancellationId = randomUUID();
    const stored: Array<{ storageKey: string; photo: (typeof photos)[number] }> = [];
    try {
      for (const photo of photos) {
        const storageKey = `operations/${operationId}/cancellations/${cancellationId}/${randomUUID()}.${photo.ext}`;
        await this.storage.save({ storageKey, content: photo.buffer });
        stored.push({ storageKey, photo });
      }
      await this.prisma.$transaction(async (tx) => {
        const transition = await tx.assignment.updateMany({
          where: { id: assignment.id, assignedTo: actor.id, status: assignment.status },
          data: { status: AssignmentStatus.REJECTED, rejectedAt: new Date(), rejectionReason: dto.reason },
        });
        if (transition.count !== 1) throw new ApplicationException(ERROR_CODES.ASSIGNMENT_INVALID_TRANSITION, 'O atendimento foi alterado por outra requisição', HttpStatus.CONFLICT);
        const cancellation = await tx.operationCancellation.create({
          data: {
            id: cancellationId,
            operationId,
            assignmentId: assignment.id,
            requestedById: actor.id,
            technicalSignatureId: signature.id,
            reason: dto.reason,
            customerSignatureData: dto.customerSignatureData ?? null,
            customerSignerName: dto.customerSignerName?.trim() || null,
            customerSignerRole: dto.customerSignerRole?.trim() || null,
            customerSignedAt: dto.customerSignatureData ? new Date(dto.customerSignedAt ?? Date.now()) : null,
          },
        });
        if (stored.length) await tx.operationPhoto.createMany({ data: stored.map(({ storageKey, photo }) => ({ operationId, cancellationId: cancellation.id, createdById: actor.id, storageKey, caption: photo.caption, mimeType: photo.mimeType, fileSize: photo.buffer.length })) });
        await tx.operation.update({
          where: { id: operationId },
          data: {
            status: 'REVIEW',
            signatureData: dto.customerSignatureData ?? null,
            customerSignerName: dto.customerSignerName?.trim() || null,
            customerSignerRole: dto.customerSignerRole?.trim() || null,
            signedAt: dto.customerSignatureData ? new Date(dto.customerSignedAt ?? Date.now()) : null,
          },
        });
        await tx.operationDocument.updateMany({ where: { operationId, type: DocumentTemplateType.WORK_ORDER }, data: { technicalSignatureId: signature.id, customerSignatureHidden: !dto.customerSignatureData, editorialStatus: 'READY', handoffOrigin: 'OPERATOR', finalizedById: actor.id, finalizedAt: new Date() } });
        await tx.assignmentHistory.create({ data: { assignmentId: assignment.id, operationId, event: AssignmentEventType.REJECTED, actorId: actor.id, previousStatus: assignment.status, newStatus: AssignmentStatus.REJECTED, notes: dto.reason } });
        await tx.auditLog.create({ data: { action: 'OPERATION_CANCELLATION_REQUESTED', resource: `OPERATION:${operationId}`, actor: actor.id, metadata: { operationId, assignmentId: assignment.id, cancellationId, evidenceCount: stored.length, customerSignatureCollected: Boolean(dto.customerSignatureData), requestId: context.requestId, ip: context.ip, userAgent: context.userAgent } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await Promise.all(stored.map(({ storageKey }) => this.storage.delete(storageKey).catch(() => undefined)));
      throw error;
    }
    return this.getLatest(operationId);
  }

  async reschedule(operationId: string, dto: RescheduleCanceledOperationDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    await this.assertNotDeleted(operationId);
    this.assertManager(actor);
    const scheduledFor = new Date(dto.scheduledFor);
    if (scheduledFor.getTime() <= Date.now()) throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'A nova data deve estar no futuro', HttpStatus.BAD_REQUEST);
    const operator = await this.prisma.user.findFirst({ where: { id: dto.assignedTo, isActive: true, disabledAt: null, role: { in: [Role.OWNER, Role.MANAGER, Role.OPERATOR] } }, select: { id: true } });
    if (!operator) throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'O técnico selecionado não está ativo', HttpStatus.BAD_REQUEST);
    await this.prisma.$transaction(async (tx) => {
      const cancellation = await this.pendingOrThrowTx(tx, operationId);
      const now = new Date();
      await tx.operationCancellation.update({ where: { id: cancellation.id }, data: { status: OperationCancellationStatus.RESCHEDULED, resolvedById: actor.id, resolvedAt: now, rescheduledFor: scheduledFor, resolutionNotes: dto.notes ?? null } });
      await tx.assignment.update({ where: { id: cancellation.assignmentId }, data: { assignedBy: actor.id, assignedTo: operator.id, assignedAt: now, status: AssignmentStatus.ASSIGNED, operatorVisible: false, authorizedAt: null, authorizedBy: null, acceptedAt: null, startedAt: null, completedAt: null, canceledAt: null, rejectedAt: null, rejectionReason: null, notes: dto.notes ?? null } });
      await tx.operation.update({ where: { id: operationId }, data: { operatorId: operator.id, scheduledFor, status: 'PENDING', startedAt: null, completedAt: null, signatureData: null, customerSignerName: null, customerSignerRole: null, signedAt: null } });
      await tx.operationDocument.updateMany({ where: { operationId, type: DocumentTemplateType.WORK_ORDER }, data: { technicalSignatureId: null, customerSignatureSnapshot: Prisma.JsonNull, customerSignatureHidden: false, editorialStatus: 'STALE' } });
      await tx.assignmentHistory.create({ data: { assignmentId: cancellation.assignmentId, operationId, event: AssignmentEventType.REASSIGNED, actorId: actor.id, previousStatus: AssignmentStatus.REJECTED, newStatus: AssignmentStatus.ASSIGNED, notes: dto.notes ?? 'Atendimento reagendado após solicitação de cancelamento' } });
      await tx.auditLog.create({ data: { action: 'OPERATION_CANCELLATION_RESCHEDULED', resource: `OPERATION:${operationId}`, actor: actor.id, metadata: { operationId, cancellationId: cancellation.id, assignedTo: operator.id, scheduledFor: scheduledFor.toISOString(), requestId: context.requestId } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.getLatest(operationId);
  }

  async approve(operationId: string, dto: ApproveOperationCancellationDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    await this.assertNotDeleted(operationId);
    this.assertManager(actor);
    await this.prisma.$transaction(async (tx) => {
      const cancellation = await this.pendingOrThrowTx(tx, operationId);
      const now = new Date();
      await tx.operationCancellation.update({ where: { id: cancellation.id }, data: { status: OperationCancellationStatus.APPROVED, resolvedById: actor.id, resolvedAt: now, resolutionNotes: dto.notes ?? null } });
      await tx.assignment.update({ where: { id: cancellation.assignmentId }, data: { status: AssignmentStatus.CANCELED, canceledAt: now } });
      await tx.operation.update({ where: { id: operationId }, data: { status: 'CANCELED', completedAt: now } });
      await tx.assignmentHistory.create({ data: { assignmentId: cancellation.assignmentId, operationId, event: AssignmentEventType.CANCELED, actorId: actor.id, previousStatus: AssignmentStatus.REJECTED, newStatus: AssignmentStatus.CANCELED, notes: dto.notes ?? 'Cancelamento aprovado pela gestão' } });
      await tx.auditLog.create({ data: { action: 'OPERATION_CANCELLATION_APPROVED', resource: `OPERATION:${operationId}`, actor: actor.id, metadata: { operationId, cancellationId: cancellation.id, requestId: context.requestId } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.getLatest(operationId);
  }

  async getLatest(operationId: string): Promise<unknown> {
    return this.prisma.operationCancellation.findFirst({ where: { operationId }, orderBy: { requestedAt: 'desc' }, select: CANCELLATION_SELECT });
  }

  private async assertNotDeleted(operationId: string): Promise<void> {
    const operation = await this.prisma.operation.findUnique({ where: { id: operationId }, select: { deletedAt: true } });
    if (operation?.deletedAt) throw operationDeletedError();
  }

  private async pendingOrThrowTx(tx: Prisma.TransactionClient, operationId: string): Promise<OperationCancellation> {
    const cancellation = await tx.operationCancellation.findFirst({ where: { operationId, status: OperationCancellationStatus.REQUESTED }, orderBy: { requestedAt: 'desc' } });
    if (!cancellation) throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'Não existe solicitação de cancelamento aguardando análise', HttpStatus.CONFLICT);
    return cancellation;
  }

  private assertManager(actor: AuthenticatedUser): void {
    if (actor.role !== Role.OWNER && actor.role !== Role.MANAGER) throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Apenas Owner ou Manager podem decidir o cancelamento', HttpStatus.FORBIDDEN);
  }

  private validateCustomerSignature(dataUrl: string): void {
    const decoded = decodeOperationPhoto({ dataUrl });
    if (decoded.buffer.length > MAX_OPERATION_SIGNATURE_SIZE_BYTES) throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'A assinatura excede o limite de 2 MiB', HttpStatus.BAD_REQUEST);
  }
}
