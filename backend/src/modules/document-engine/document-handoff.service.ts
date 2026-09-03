import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DocumentEditorialStatus,
  DocumentHandoffOrigin,
  DocumentRevisionAction,
  DocumentTemplateType,
  NotificationEntityType,
  NotificationSeverity,
  NotificationType,
  Prisma,
  Role,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES,
  DOCUMENT_ENGINE_AUDIT_ACTIONS,
  DOCUMENT_ENGINE_RESOURCE,
  OPERATOR_HANDOFF_DOCUMENT_TYPES,
  OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES,
} from '../../shared/constants/document-engine.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { dateRangeFilter } from '../../shared/utils/date-range.util';
import { PMOC_MIN_PROCEDURE_IMAGES } from '../../shared/constants/pmoc.constants';
import { reserveDocumentNumber } from '../../shared/utils/document-number.util';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import type {
  CollectCustomerSignatureDto,
  ListDocumentHandoffsQueryDto,
  SaveDocumentHandoffDto,
} from './dto/document-handoff.dto';
import { DocumentAssetResolver } from './assets/document-asset-resolver.service';
import type { DocumentAuditContext } from './document-engine.service';

const MANAGEMENT_ROLES: Role[] = [Role.OWNER, Role.MANAGER];
const OPERATOR_TYPES = new Set<DocumentTemplateType>(
  [...OPERATOR_HANDOFF_DOCUMENT_TYPES] as DocumentTemplateType[],
);
const OPERATOR_DIRECT_COMPLETION_TYPES = new Set<DocumentTemplateType>(
  [...OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES] as DocumentTemplateType[],
);
const CUSTOMER_SIGNATURE_TYPES = new Set<DocumentTemplateType>(
  [...CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES] as DocumentTemplateType[],
);

type SignatureSnapshot = {
  storageKey: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  name: string;
  title?: string | null;
  profession?: string | null;
  professionalCouncil?: string | null;
  registrationNumber?: string | null;
  department?: string | null;
  collectedAt?: string;
  timezone?: string;
  collectedBy?: string;
  origin: DocumentHandoffOrigin;
};

const DOCUMENT_HANDOFF_INCLUDE = {
  budget: {
    select: {
      id: true,
      number: true,
      status: true,
      customer: { select: { id: true, name: true, tradeName: true } },
    },
  },
  operation: {
    include: {
      customer: { select: { id: true, name: true, tradeName: true } },
      operator: { select: { id: true, name: true } },
      equipment: { select: { id: true, name: true, tag: true } },
      inspectedEquipments: { select: { id: true, equipmentId: true } },
      photos: { select: { id: true } },
      assignments: { where: { isPrimary: true }, select: { id: true, assignedBy: true, assignedTo: true } },
      maintenanceExecution: { select: { id: true, plan: { select: { pmocPlan: { select: { id: true } } } } } },
    },
  },
  collectedBy: { select: { id: true, name: true, role: true } },
  reviewedBy: { select: { id: true, name: true, role: true } },
  finalizedBy: { select: { id: true, name: true, role: true } },
  technicalSignature: {
    select: {
      id: true, name: true, title: true, profession: true, professionalCouncil: true,
      registrationNumber: true, department: true, active: true, imageStorageKey: true,
      mimeType: true, fileSize: true,
    },
  },
  _count: { select: { revisions: true } },
} satisfies Prisma.OperationDocumentInclude;

const COLLECTION_OPERATION_INCLUDE = {
  customer: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true } },
  inspectedEquipments: { select: { equipmentId: true } },
  photos: { select: { id: true } },
  documents: {
    select: {
      id: true,
      type: true,
      number: true,
      renderedAt: true,
      collectedById: true,
      technicalSignatureId: true,
    },
  },
  assignments: { where: { isPrimary: true }, select: { assignedBy: true, assignedTo: true } },
  maintenanceExecution: {
    select: {
      plan: {
        select: {
          pmocPlan: { select: { signatureOverrideId: true } },
        },
      },
    },
  },
} satisfies Prisma.OperationInclude;

type HandoffDocument = Prisma.OperationDocumentGetPayload<{ include: typeof DOCUMENT_HANDOFF_INCLUDE }>;
type CollectionOperation = Prisma.OperationGetPayload<{ include: typeof COLLECTION_OPERATION_INCLUDE }>;
type OperationSnapshotSource = Pick<CollectionOperation, 'id' | 'number' | 'status' | 'customerId' | 'operatorId' | 'inspectedEquipments' | 'photos'>;

@Injectable()
export class DocumentHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: DocumentAssetResolver,
    private readonly access: OperationAccessService,
  ) {}

  async list(query: ListDocumentHandoffsQueryDto): Promise<unknown> {
    const where: Prisma.OperationDocumentWhereInput = {
      submittedAt: { not: null },
      ...(query.status ? { editorialStatus: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.origin ? { handoffOrigin: query.origin } : {}),
      ...(query.customerId ? { operation: { customerId: query.customerId } } : {}),
      ...(query.operatorId ? { operation: { operatorId: query.operatorId } } : {}),
      ...(query.from || query.to
        ? { submittedAt: { not: null, ...dateRangeFilter(query.from, query.to) } }
        : {}),
      ...(query.missingTechnicalSignature ? { technicalSignatureId: null } : {}),
      ...(query.missingCustomerSignature ? { customerSignatureSnapshot: { equals: Prisma.DbNull } } : {}),
      ...(query.missingEvidence ? { operation: { photos: { none: {} } } } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { operation: { customer: { name: { contains: query.search, mode: 'insensitive' } } } },
              { operation: { operator: { name: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationDocument.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        include: DOCUMENT_HANDOFF_INCLUDE,
      }),
      this.prisma.operationDocument.count({ where }),
    ]);
    return buildPaginatedResponse(items.map((item) => this.response(item)), total, query.page, query.limit);
  }

  async get(documentId: string, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    await this.assertAccess(document, actor, context);
    return this.response(document, true);
  }

  async saveDraft(
    dto: SaveDocumentHandoffDto,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    this.assertTypeAllowed(dto.type, actor);
    const operation = await this.operationForActor(dto.operationId, actor, context);
    if (
      actor.role === Role.OPERATOR &&
      !OPERATOR_DIRECT_COMPLETION_TYPES.has(dto.type) &&
      operation.assignments?.[0]?.assignedBy === operation.assignments?.[0]?.assignedTo
    ) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_HANDOFF_NOT_ALLOWED,
        'Documentos diferentes de OS e Visita Técnica precisam ser atribuídos pela gestão',
        HttpStatus.FORBIDDEN,
      );
    }
    const origin = actor.role === Role.OPERATOR ? DocumentHandoffOrigin.OPERATOR : DocumentHandoffOrigin.PLATFORM;
    const defaultTechnicalSignatureId = await this.defaultTechnicalSignatureId(
      operation.maintenanceExecution?.plan.pmocPlan?.signatureOverrideId ?? null,
      actor.role === Role.OPERATOR && OPERATOR_DIRECT_COMPLETION_TYPES.has(dto.type)
        ? actor.id
        : null,
    );
    const existingDocument = operation.documents.find((item) => item.type === dto.type) ?? null;
    const document = await this.prisma.$transaction(async (tx) => {
      // Reserva um número (por tipo) só quando o documento ainda não existe;
      // atualizações preservam o número já atribuído, sem consumir a sequência.
      const documentNumber =
        existingDocument?.number ??
        (await reserveDocumentNumber(
          tx,
          dto.type,
          dto.type === DocumentTemplateType.RECEIPT ? operation.receiptNumber : null,
        ));
      const saved = await tx.operationDocument.upsert({
        where: { operationId_type: { operationId: dto.operationId, type: dto.type } },
        create: {
          operationId: dto.operationId,
          type: dto.type,
          number: documentNumber,
          status: 'DRAFT',
          editorialStatus: DocumentEditorialStatus.DRAFT,
          handoffOrigin: origin,
          collectedById: actor.id,
          technicalSignatureId: defaultTechnicalSignatureId,
          collectionSnapshot: this.operationSnapshot(operation),
        },
        update: {
          handoffOrigin: origin,
          ...(existingDocument?.collectedById ? {} : { collectedById: actor.id }),
          ...(existingDocument?.technicalSignatureId
            ? {}
            : { technicalSignatureId: defaultTechnicalSignatureId }),
          collectionSnapshot: this.operationSnapshot(operation),
          ...(existingDocument?.renderedAt
            ? { editorialStatus: DocumentEditorialStatus.STALE }
            : {}),
        },
      });
      await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.DRAFT_SAVED, origin, actor.id, ['collectionSnapshot']);
      await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_DRAFT_SAVED, actor, context, saved.id, dto.operationId) });
      return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
    });
    return this.response(document, true);
  }

  async collectCustomerSignature(
    documentId: string,
    dto: CollectCustomerSignatureDto,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    await this.assertAccess(document, actor, context);
    if (!document.operationId && !document.budgetId) {
      throw this.invalid('O documento não possui uma origem válida');
    }
    const decoded = this.decodeSignature(dto.signatureData);
    const stored = await this.assets.saveSignatureImage({ content: decoded.buffer, extension: decoded.extension });
    const snapshot: SignatureSnapshot = {
      storageKey: stored.storageKey,
      mimeType: decoded.mimeType,
      fileSize: decoded.buffer.length,
      sha256: createHash('sha256').update(decoded.buffer).digest('hex'),
      name: dto.signerName,
      title: dto.signerRole ?? null,
      collectedAt: dto.collectedAt ?? new Date().toISOString(),
      timezone: dto.timezone,
      collectedBy: actor.id,
      origin: actor.role === Role.OPERATOR ? DocumentHandoffOrigin.OPERATOR : DocumentHandoffOrigin.PLATFORM,
    };
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.operationDocument.update({
          where: { id: documentId },
          data: {
            customerSignatureSnapshot: snapshot,
            collectedById: actor.id,
            ...(document.renderedAt
              ? { editorialStatus: DocumentEditorialStatus.STALE }
              : document.submittedAt
                ? { editorialStatus: this.submittedEditorialStatus(document) }
                : {}),
          },
        });
        await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.REVIEW_UPDATED, snapshot.origin, actor.id, ['customerSignature']);
        await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_REVIEW_UPDATED, actor, context, saved.id, document.operationId, { budgetId: document.budgetId, customerSignatureCollected: true, origin: snapshot.origin }) });
        return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
      });
      return this.response(updated, true);
    } catch (error) {
      await this.assets.delete(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async submit(documentId: string, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    let document = await this.documentOrThrow(documentId);
    await this.assertAccess(document, actor, context);
    if (!document.operation) throw this.invalid('Document has no Operation');
    if (
      CUSTOMER_SIGNATURE_TYPES.has(document.type) &&
      !document.customerSignatureHidden &&
      !document.customerSignatureSnapshot &&
      document.operation.signatureData
    ) {
      const settings = await this.prisma.organizationSettings.findFirst({ select: { timezone: true } });
      await this.collectCustomerSignature(
        documentId,
        {
          signerName: document.operation.customerSignerName ?? document.operation.customer.name,
          signerRole: document.operation.customerSignerRole ?? undefined,
          signatureData: document.operation.signatureData,
          collectedAt: document.operation.signedAt?.toISOString(),
          timezone: settings?.timezone ?? 'America/Recife',
        },
        actor,
        context,
      );
      document = await this.documentOrThrow(documentId);
    }
    const operation = document.operation;
    if (!operation) throw this.invalid('Document has no Operation');
    const issues = this.validationIssues(document, false);
    if (issues.includes('CUSTOMER_SIGNATURE_REQUIRED')) {
      throw new ApplicationException(ERROR_CODES.DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED, 'Colete a assinatura do cliente antes de enviar para revisão', HttpStatus.CONFLICT, { issues });
    }
    if (issues.includes('PMOC_EVIDENCE_REQUIRED')) {
      throw new ApplicationException(ERROR_CODES.PMOC_EVIDENCE_REQUIRED, `Registre pelo menos ${PMOC_MIN_PROCEDURE_IMAGES} imagens antes de enviar o PMOC`, HttpStatus.CONFLICT, { issues });
    }
    const origin = actor.role === Role.OPERATOR ? DocumentHandoffOrigin.OPERATOR : DocumentHandoffOrigin.PLATFORM;
    const managementAssigned = this.isManagementAssigned(document);
    const editorialStatus =
      actor.role === Role.OPERATOR && !managementAssigned
        ? DocumentEditorialStatus.DRAFT
        : DocumentEditorialStatus.PENDING;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.operationDocument.update({
        where: { id: documentId },
        data: {
          handoffOrigin: origin,
          collectedById: actor.id,
          submittedAt: new Date(),
          editorialStatus,
          collectionSnapshot: this.operationSnapshot(operation),
          validationIssues: issues,
        },
      });
      await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.SUBMITTED, origin, actor.id, ['submittedAt', 'collectionSnapshot']);
      // Sem notificação aqui: o envio do documento faz parte da conclusão do
      // atendimento — a gestão é notificada uma única vez pelo evento completo
      // ("Atendimento aguardando revisão", ao concluir o assignment).
      await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_SUBMITTED, actor, context, saved.id, document.operationId, { origin, issues, managementAssigned, workflowStatus: this.workflowStatus(editorialStatus) }) });
      return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
    });
    return this.response(updated, true);
  }

  async startReview(documentId: string, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    this.assertReviewer(actor);
    const document = await this.documentOrThrow(documentId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.operationDocument.update({
        where: { id: documentId },
        data: { reviewedById: actor.id, reviewStartedAt: document.reviewStartedAt ?? new Date(), editorialStatus: DocumentEditorialStatus.PENDING },
      });
      await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.REVIEW_STARTED, DocumentHandoffOrigin.PLATFORM, actor.id, ['reviewedById', 'editorialStatus']);
      await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_REVIEW_STARTED, actor, context, saved.id, document.operationId) });
      return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
    });
    return this.response(updated, true);
  }

  async selectTechnicalSignature(documentId: string, signatureId: string, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    const [document, signature] = await Promise.all([
      this.documentOrThrow(documentId),
      this.prisma.signature.findFirst({
        where: { id: signatureId, active: true, deletedAt: null },
        select: { id: true, userId: true, imageStorageKey: true },
      }),
    ]);
    if (!signature || !signature.imageStorageKey) throw new ApplicationException(ERROR_CODES.SIGNATURE_IMAGE_REQUIRED, 'A assinatura técnica selecionada está inativa ou sem imagem', HttpStatus.CONFLICT);
    const operatorSelection = actor.role === Role.OPERATOR;
    if (operatorSelection) {
      await this.assertAccess(document, actor, context);
      if (!OPERATOR_DIRECT_COMPLETION_TYPES.has(document.type)) {
        throw new ApplicationException(
          ERROR_CODES.DOCUMENT_HANDOFF_NOT_ALLOWED,
          'O operador pode selecionar sua assinatura somente em Ordem de Serviço ou Relatório de Visita Técnica',
          HttpStatus.FORBIDDEN,
        );
      }
      if (signature.userId !== actor.id || document.operation?.operatorId !== actor.id) {
        throw new ApplicationException(
          ERROR_CODES.FORBIDDEN,
          'Selecione somente a sua própria assinatura técnica',
          HttpStatus.FORBIDDEN,
        );
      }
    } else {
      this.assertReviewer(actor);
    }
    const origin = operatorSelection
      ? DocumentHandoffOrigin.OPERATOR
      : DocumentHandoffOrigin.PLATFORM;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.operationDocument.update({
        where: { id: documentId },
        data: {
          technicalSignatureId: signatureId,
          technicalSignatureSnapshot: Prisma.DbNull,
          ...(operatorSelection ? {} : { reviewedById: actor.id }),
          editorialStatus: document.renderedAt
            ? DocumentEditorialStatus.STALE
            : operatorSelection
              ? document.editorialStatus
              : DocumentEditorialStatus.PENDING,
        },
      });
      await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.TECHNICAL_SIGNATURE_SELECTED, origin, actor.id, ['technicalSignatureId']);
      await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_TECHNICAL_SIGNATURE_SELECTED, actor, context, saved.id, document.operationId, { signatureId, ownSignature: operatorSelection }) });
      return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
    });
    return this.response(updated, true);
  }

  /**
   * Owner/Manager escolhe ocultar (ou reexibir) a assinatura do cliente neste
   * documento. Apenas oculta — não apaga nenhuma coleta existente; o bloco do
   * cliente deixa de ser exigido e não é renderizado no PDF. Outros fluxos (ex.:
   * operador em campo) continuam coletando/exibindo normalmente.
   */
  async setCustomerSignatureVisibility(documentId: string, hidden: boolean, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    this.assertReviewer(actor);
    if (!CUSTOMER_SIGNATURE_TYPES.has(document.type)) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_HANDOFF_NOT_ALLOWED,
        'Este tipo de documento não possui assinatura do cliente para ocultar',
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.operationDocument.update({
        where: { id: documentId },
        data: {
          customerSignatureHidden: hidden,
          // Alterar a visibilidade muda o documento: se já havia PDF, fica desatualizado.
          ...(document.renderedAt ? { editorialStatus: DocumentEditorialStatus.STALE } : {}),
        },
      });
      await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.REVIEW_UPDATED, DocumentHandoffOrigin.PLATFORM, actor.id, ['customerSignatureHidden']);
      await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_REVIEW_UPDATED, actor, context, saved.id, document.operationId, { customerSignatureHidden: hidden }) });
      return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
    });
    return this.response(updated, true);
  }

  async finalize(documentId: string, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    if (actor.role === Role.OPERATOR) {
      await this.assertAccess(document, actor, context);
      if (!OPERATOR_DIRECT_COMPLETION_TYPES.has(document.type)) {
        throw new ApplicationException(
          ERROR_CODES.DOCUMENT_HANDOFF_NOT_ALLOWED,
          'Somente Ordem de Serviço e Relatório de Visita Técnica podem ser concluídos diretamente pelo operador',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!document.submittedAt || document.operation?.status !== 'COMPLETED') {
        throw new ApplicationException(
          ERROR_CODES.DOCUMENT_REVIEW_INCOMPLETE,
          'Conclua o atendimento e envie os dados antes de emitir o documento',
          HttpStatus.CONFLICT,
        );
      }
    } else {
      this.assertReviewer(actor);
    }
    if (document.editorialStatus === DocumentEditorialStatus.READY && document.finalizedAt) {
      return this.response(document, true);
    }
    const issues = this.validationIssues(document, true);
    if (issues.length) {
      throw new ApplicationException(ERROR_CODES.DOCUMENT_REVIEW_INCOMPLETE, 'A revisão possui pendências obrigatórias', HttpStatus.CONFLICT, { issues });
    }
    const signature = document.technicalSignature!;
    const source = await this.assets.getSignatureImage(signature.imageStorageKey!);
    const copied = await this.assets.saveSignatureImage({ content: source.content, extension: this.extension(signature.mimeType!) });
    const origin = actor.role === Role.OPERATOR
      ? DocumentHandoffOrigin.OPERATOR
      : DocumentHandoffOrigin.PLATFORM;
    const snapshot: SignatureSnapshot = {
      storageKey: copied.storageKey,
      mimeType: signature.mimeType!,
      fileSize: source.content.length,
      sha256: createHash('sha256').update(source.content).digest('hex'),
      name: signature.name,
      title: signature.title,
      profession: signature.profession,
      professionalCouncil: signature.professionalCouncil,
      registrationNumber: signature.registrationNumber,
      department: signature.department,
      collectedBy: actor.id,
      origin,
    };
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.operationDocument.update({
          where: { id: documentId },
          data: {
            editorialStatus: DocumentEditorialStatus.READY,
            finalizedById: actor.id,
            finalizedAt: new Date(),
            ...(actor.role === Role.OPERATOR ? {} : { reviewedById: actor.id }),
            technicalSignatureSnapshot: snapshot,
            validationIssues: [],
          },
        });
        await this.appendRevisionTx(tx, saved.id, DocumentRevisionAction.FINALIZED, origin, actor.id, ['editorialStatus', 'technicalSignatureSnapshot']);
        if (actor.role !== Role.OPERATOR) {
          await this.notifyOperatorReadyTx(tx, saved.id, document.operation?.operatorId ?? null);
        }
        await tx.auditLog.create({ data: this.audit(DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_REVIEW_FINALIZED, actor, context, saved.id, document.operationId) });
        return tx.operationDocument.findUniqueOrThrow({ where: { id: saved.id }, include: DOCUMENT_HANDOFF_INCLUDE });
      });
      return this.response(updated, true);
    } catch (error) {
      await this.assets.delete(copied.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async history(documentId: string, actor: AuthenticatedUser, context: DocumentAuditContext): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    await this.assertAccess(document, actor, context);
    return this.prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { revision: 'asc' },
      select: { id: true, revision: true, action: true, origin: true, changedFields: true, createdAt: true, actor: { select: { id: true, name: true, role: true } } },
    });
  }

  async customerSignatureImage(
    documentId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<{ content: Buffer; mimeType: string; filename: string }> {
    const document = await this.documentOrThrow(documentId);
    await this.assertAccess(document, actor, context);
    const snapshot = document.customerSignatureSnapshot as SignatureSnapshot | null;
    if (!snapshot?.storageKey || !snapshot.mimeType) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED,
        'Este relatório ainda não possui assinatura do cliente',
        HttpStatus.NOT_FOUND,
      );
    }
    const image = await this.assets.getSignatureImage(snapshot.storageKey);
    return {
      content: image.content,
      mimeType: snapshot.mimeType,
      filename: `assinatura-cliente-${document.number}.${this.extension(snapshot.mimeType)}`,
    };
  }

  private async documentOrThrow(id: string): Promise<HandoffDocument> {
    const document = await this.prisma.operationDocument.findUnique({ where: { id }, include: DOCUMENT_HANDOFF_INCLUDE });
    if (!document) throw new ApplicationException(ERROR_CODES.DOCUMENT_NOT_FOUND, 'Documento não encontrado', HttpStatus.NOT_FOUND);
    return document;
  }

  private async operationForActor(
    id: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<CollectionOperation> {
    await this.access.assertOperationAccess(actor, id, {
      resource: DOCUMENT_ENGINE_RESOURCE,
      resourceId: id,
      context,
    });
    const operation = await this.prisma.operation.findUnique({
      where: { id },
      include: COLLECTION_OPERATION_INCLUDE,
    });
    if (!operation) throw new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, 'Operação não encontrada', HttpStatus.NOT_FOUND);
    return operation;
  }

  private async defaultTechnicalSignatureId(
    pmocOverrideId: string | null,
    operatorUserId: string | null = null,
  ): Promise<string | null> {
    if (operatorUserId) {
      const own = await this.prisma.signature.findFirst({
        where: {
          userId: operatorUserId,
          active: true,
          deletedAt: null,
          imageStorageKey: { not: null },
        },
        select: { id: true },
      });
      return own?.id ?? null;
    }
    if (pmocOverrideId) return pmocOverrideId;
    const signatures = await this.prisma.signature.findMany({
      where: { active: true, deletedAt: null, imageStorageKey: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { name: 'asc' }],
      take: 2,
      select: { id: true, isDefault: true },
    });
    return signatures.find((item) => item.isDefault)?.id ?? (signatures.length === 1 ? signatures[0].id : null);
  }

  private async assertAccess(
    document: HandoffDocument,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<void> {
    await this.access.assertOperationBackedResourceAccess(actor, document.operationId, {
      resource: DOCUMENT_ENGINE_RESOURCE,
      resourceId: document.id,
      context,
    });
  }

  private assertReviewer(actor: AuthenticatedUser): void {
    if (!MANAGEMENT_ROLES.includes(actor.role)) throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Somente Owner ou Manager podem revisar e finalizar relatórios', HttpStatus.FORBIDDEN);
  }

  private assertTypeAllowed(type: DocumentTemplateType, actor: AuthenticatedUser): void {
    if (actor.role === Role.OPERATOR && !OPERATOR_TYPES.has(type)) {
      throw new ApplicationException(ERROR_CODES.DOCUMENT_HANDOFF_NOT_ALLOWED, 'Este tipo documental não pode ser preparado pelo Operator', HttpStatus.FORBIDDEN);
    }
  }

  private validationIssues(document: HandoffDocument, final: boolean): string[] {
    const issues: string[] = [];
    if (CUSTOMER_SIGNATURE_TYPES.has(document.type) && !document.customerSignatureHidden && !document.customerSignatureSnapshot) issues.push('CUSTOMER_SIGNATURE_REQUIRED');
    if (final && !document.technicalSignatureId) issues.push('TECHNICAL_SIGNATURE_REQUIRED');
    if (document.type === DocumentTemplateType.PMOC && (document.operation?.photos.length ?? 0) < PMOC_MIN_PROCEDURE_IMAGES) issues.push('PMOC_EVIDENCE_REQUIRED');
    if (!document.operation && !document.budget) issues.push('DOCUMENT_SOURCE_REQUIRED');
    return issues;
  }

  private operationSnapshot(operation: OperationSnapshotSource): Prisma.InputJsonObject {
    return {
      operationId: operation.id,
      number: operation.number,
      status: operation.status,
      customerId: operation.customerId,
      operatorId: operation.operatorId,
      equipmentIds: operation.inspectedEquipments.map((item) => item.equipmentId),
      evidenceCount: operation.photos.length,
      capturedAt: new Date().toISOString(),
    };
  }

  private response(document: HandoffDocument, detail = false): Record<string, unknown> {
    const customerSnapshot = document.customerSignatureSnapshot as SignatureSnapshot | null;
    return {
      id: document.id,
      operationId: document.operationId,
      budgetId: document.budgetId,
      number: document.number,
      type: document.type,
      artifactStatus: document.status,
      editorialStatus: document.editorialStatus,
      workflowStatus: this.workflowStatus(document.editorialStatus),
      assignmentOrigin: document.budgetId
        ? 'MANAGEMENT'
        : this.isManagementAssigned(document)
          ? 'MANAGEMENT'
          : 'OPERATOR',
      origin: document.handoffOrigin,
      submittedAt: document.submittedAt,
      reviewStartedAt: document.reviewStartedAt,
      finalizedAt: document.finalizedAt,
      renderedAt: document.renderedAt,
      revision: document.revision,
      validationIssues: document.validationIssues,
      customerSignature: customerSnapshot ? { name: customerSnapshot.name, role: customerSnapshot.title ?? null, collectedAt: customerSnapshot.collectedAt, timezone: customerSnapshot.timezone, origin: customerSnapshot.origin, available: true, collectedBy: document.collectedBy } : null,
      technicalSignature: document.technicalSignature ? { id: document.technicalSignature.id, name: document.technicalSignature.name, title: document.technicalSignature.title, profession: document.technicalSignature.profession, professionalCouncil: document.technicalSignature.professionalCouncil, registrationNumber: document.technicalSignature.registrationNumber, department: document.technicalSignature.department, active: document.technicalSignature.active, hasImage: Boolean(document.technicalSignature.imageStorageKey) } : null,
      collectedBy: document.collectedBy,
      reviewedBy: document.reviewedBy,
      finalizedBy: document.finalizedBy,
      operation: document.operation ? { id: document.operation.id, number: document.operation.number, status: document.operation.status, customer: document.operation.customer, operator: document.operation.operator, equipment: document.operation.equipment, equipmentCount: document.operation.inspectedEquipments.length, evidenceCount: document.operation.photos.length } : null,
      budget: document.budget
        ? { id: document.budget.id, number: document.budget.number, status: document.budget.status, customer: document.budget.customer }
        : null,
      revisionCount: document._count?.revisions ?? 0,
      customerSignatureHidden: document.customerSignatureHidden,
      ...(detail ? { customerSignatureRequired: CUSTOMER_SIGNATURE_TYPES.has(document.type) && !document.customerSignatureHidden, technicalSignatureRequired: true } : {}),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private async appendRevisionTx(tx: Prisma.TransactionClient, documentId: string, action: DocumentRevisionAction, origin: DocumentHandoffOrigin, actorId: string, changedFields: string[]): Promise<void> {
    const document = await tx.operationDocument.update({ where: { id: documentId }, data: { revision: { increment: 1 } }, select: { revision: true, editorialStatus: true, submittedAt: true, reviewedById: true, finalizedById: true, technicalSignatureId: true, validationIssues: true } });
    await tx.documentRevision.create({ data: { documentId, revision: document.revision, action, origin, actorId, changedFields, snapshot: document } });
  }

  private isManagementAssigned(document: HandoffDocument): boolean {
    const assignment = document.operation?.assignments?.[0];
    return Boolean(assignment && assignment.assignedBy !== assignment.assignedTo);
  }

  private submittedEditorialStatus(document: HandoffDocument): DocumentEditorialStatus {
    return document.reviewStartedAt || this.isManagementAssigned(document)
      ? DocumentEditorialStatus.PENDING
      : DocumentEditorialStatus.DRAFT;
  }

  private workflowStatus(status: DocumentEditorialStatus): 'DRAFT' | 'REVIEW' | 'APPROVED' | 'STALE' {
    if (status === DocumentEditorialStatus.PENDING) return 'REVIEW';
    if (status === DocumentEditorialStatus.READY) return 'APPROVED';
    return status;
  }

  private decodeSignature(dataUrl: string): { buffer: Buffer; mimeType: string; extension: 'png' | 'jpg' } {
    const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
    if (!match) throw this.invalid('A assinatura deve ser uma imagem PNG ou JPEG válida');
    const mimeType = match[1].toLowerCase();
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
    if (buffer.length === 0 || buffer.length > 2_000_000 || (mimeType === 'image/png' ? !png : !jpeg)) throw this.invalid('O conteúdo binário da assinatura é inválido');
    return { buffer, mimeType, extension: mimeType === 'image/png' ? 'png' : 'jpg' };
  }

  private extension(mimeType: string): 'png' | 'jpg' { return mimeType === 'image/png' ? 'png' : 'jpg'; }
  private invalid(message: string): ApplicationException { return new ApplicationException(ERROR_CODES.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST); }

  private audit(action: string, actor: AuthenticatedUser, context: DocumentAuditContext, documentId: string, operationId: string | null, extra: Record<string, unknown> = {}): Prisma.AuditLogCreateInput {
    return { action, resource: DOCUMENT_ENGINE_RESOURCE, actor: actor.id, metadata: { documentId, operationId, requestId: context.requestId, ip: context.ip, userAgent: context.userAgent, ...extra } };
  }

  private async notifyOperatorReadyTx(tx: Prisma.TransactionClient, documentId: string, operatorId: string | null): Promise<void> {
    if (!operatorId) return;
    const organization = await tx.organization.findFirst({ select: { id: true } });
    if (!organization) return;
    await tx.notification.createMany({ data: [{ organizationId: organization.id, recipientUserId: operatorId, type: NotificationType.DOCUMENT_READY, severity: NotificationSeverity.SUCCESS, title: 'Relatório revisado', message: 'O relatório enviado foi revisado e está pronto.', entityType: NotificationEntityType.DOCUMENT, entityId: documentId, actionUrl: '/operator/documents', eventKey: `document:${documentId}:ready` }], skipDuplicates: true });
  }
}
