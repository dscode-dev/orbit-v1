import { HttpStatus, Injectable } from '@nestjs/common';
import { BudgetHistoryAction, BudgetStatus, DocumentTemplateType, type OperationDocument, Prisma, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  DOCUMENT_ENGINE_AUDIT_ACTIONS,
  DOCUMENT_ENGINE_RESOURCE,
  DOCUMENT_MIME_TYPE,
  DOCUMENT_RENDER_RESOURCE,
  FINANCIAL_DOCUMENT_TYPES,
  OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES,
} from '../../shared/constants/document-engine.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { dateRangeFilter } from '../../shared/utils/date-range.util';
import { PMOC_MIN_PROCEDURE_IMAGES } from '../../shared/constants/pmoc.constants';
import { reserveDocumentNumber } from '../../shared/utils/document-number.util';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { AppLoggerService } from '../../infra/logger/app-logger.service';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import { PrismaService } from '../database/prisma.service';
import { DocumentAssetResolver } from './assets/document-asset-resolver.service';
import type { DocumentBlueprint } from './blueprint/document-blueprint.types';
import { DocumentBuilderService } from './builder/document-builder.service';
import { PdfEngineService } from './pdf/pdf-engine.service';
import { DocumentRendererService } from './renderer/document-renderer.service';
import type { ListDocumentsQueryDto } from './dto/document-engine.dto';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';

export interface DocumentAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface DocumentDownload {
  content: Buffer;
  filename: string;
  mimeType: string;
}

type DocumentRequest =
  | { source: 'operation'; operationId: string; type: DocumentTemplateType }
  | { source: 'document'; documentId: string }
  | { source: 'budget'; budgetId: string };

@Injectable()
export class DocumentEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: DocumentBuilderService,
    private readonly renderer: DocumentRendererService,
    private readonly pdf: PdfEngineService,
    private readonly logger: AppLoggerService,
    private readonly assets: DocumentAssetResolver,
    private readonly lifecycle: LifecyclePublisher,
    private readonly access: OperationAccessService,
  ) {}

  async listDocuments(query: ListDocumentsQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const period = dateRangeFilter(query.from, query.to);
    const where: Prisma.OperationDocumentWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      // Um status explícito sempre vence. Sem filtro explícito, o catálogo
      // esconde rascunhos (DRAFT) por padrão — inclui-os só com includeDrafts.
      ...(query.editorialStatus
        ? { editorialStatus: query.editorialStatus }
        : query.includeDrafts
          ? {}
          : { editorialStatus: { not: 'DRAFT' } }),
      ...(actor.role === Role.OWNER
        ? {}
        : actor.role === Role.MANAGER
          ? { type: { not: DocumentTemplateType.QUOTE } }
          : { type: { notIn: [...FINANCIAL_DOCUMENT_TYPES] } }),
      ...(query.operatorId ? { operation: { operatorId: query.operatorId } } : {}),
      AND: [
        this.access.documentScope(actor),
        ...(query.from || query.to ? [{ OR: [{ renderedAt: period }, { renderedAt: null, createdAt: period }] }] : []),
        ...(query.customerId ? [{ OR: [{ operation: { customerId: query.customerId } }, { budget: { customerId: query.customerId } }] }] : []),
        ...(query.equipmentId ? [{ OR: [{ operation: { equipmentId: query.equipmentId } }, { budget: { equipmentId: query.equipmentId } }] }] : []),
        ...(query.search ? [{ OR: [
          { number: { contains: query.search, mode: 'insensitive' as const } },
          { operation: { customer: { name: { contains: query.search, mode: 'insensitive' as const } } } },
          { operation: { equipment: { name: { contains: query.search, mode: 'insensitive' as const } } } },
          { budget: { customer: { name: { contains: query.search, mode: 'insensitive' as const } } } },
        ] }] : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationDocument.findMany({
        where, skip: (query.page - 1) * query.limit, take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          operation: { select: { id: true, number: true, customer: { select: { id: true, name: true } }, equipment: { select: { id: true, name: true, tag: true } }, operator: { select: { id: true, name: true } } } },
          budget: { select: { id: true, number: true, customer: { select: { id: true, name: true } }, equipment: { select: { id: true, name: true, tag: true } }, creator: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.operationDocument.count({ where }),
    ]);
    return buildPaginatedResponse(items.map((document) => ({
      id: document.id, number: document.number, type: document.type, status: document.status,
      editorialStatus: document.editorialStatus,
      handoffOrigin: document.handoffOrigin,
      submittedAt: document.submittedAt,
      finalizedAt: document.finalizedAt,
      revision: document.revision,
      origin: document.budget ? 'BUDGET' : 'OPERATION',
      originId: document.budgetId ?? document.operationId,
      customer: document.operation?.customer ?? document.budget?.customer ?? null,
      equipment: document.operation?.equipment ?? document.budget?.equipment ?? null,
      responsible: document.operation?.operator ?? document.budget?.creator ?? null,
      issuedAt: document.renderedAt ?? document.createdAt,
      renderedAt: document.renderedAt, fileSize: document.fileSize,
      version: this.blueprintVersion(document.renderMetadata),
      createdAt: document.createdAt, updatedAt: document.updatedAt,
    })), total, query.page, query.limit);
  }

  private blueprintVersion(metadata: Prisma.JsonValue | null): string {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '1.0';
    const value = metadata.blueprintVersion;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '1.0';
  }

  async previewOperation(
    operationId: string,
    type: DocumentTemplateType,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    this.assertTypeAccess(type, actor);
    await this.assertOperationAccess(operationId, actor, context);
    const blueprint = this.withSourceFingerprint(await this.builder.buildFromOperation(operationId, type));
    await this.audit(
      DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_PREVIEWED,
      DOCUMENT_ENGINE_RESOURCE,
      actor,
      context,
      {
        operationId,
        documentType: type,
        documentId: blueprint.metadata.documentId,
      },
    );
    return blueprint;
  }

  async previewDocument(
    documentId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    this.assertTypeAccess(document.type, actor);
    await this.assertDocumentAccess(document, actor, context);
    if (document.budgetId) {
      const blueprint = await this.builder.buildBudget(document.budgetId);
      await this.audit(
        DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_PREVIEWED,
        DOCUMENT_ENGINE_RESOURCE,
        actor,
        context,
        {
          budgetId: document.budgetId,
          documentType: document.type,
          documentId: blueprint.metadata.documentId,
        },
      );
      return blueprint;
    }
    if (!document.operationId) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_NOT_FOUND,
        'Document is not linked to an operation or budget',
        HttpStatus.CONFLICT,
      );
    }
    return this.previewOperation(document.operationId, document.type, actor, context);
  }

  async previewTemplate(
    templateId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id: templateId },
      select: { type: true },
    });
    if (!template) {
      throw new ApplicationException(
        ERROR_CODES.TEMPLATE_NOT_FOUND,
        'Document template was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    this.assertTypeAccess(template.type, actor);
    const blueprint = this.withSourceFingerprint(await this.builder.buildFromTemplate(templateId));
    await this.audit(
      DOCUMENT_ENGINE_AUDIT_ACTIONS.TEMPLATE_PREVIEWED,
      DOCUMENT_ENGINE_RESOURCE,
      actor,
      context,
      {
        templateId,
        documentType: blueprint.metadata.documentType,
      },
    );
    return blueprint;
  }

  async renderOperation(
    operationId: string,
    type: DocumentTemplateType,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    this.assertTypeAccess(type, actor);
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true, number: true },
    });
    if (!operation) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_NOT_FOUND,
        'Operation was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // Garante o documento para renderização. Se ainda não existir, cria com um
    // número reservado da sequência POR TIPO (não do contador global da Operation).
    const document = await this.prisma.$transaction(async (tx) => {
      const found = await tx.operationDocument.findUnique({
        where: { operationId_type: { operationId, type } },
        select: { id: true },
      });
      if (found) return found;
      return tx.operationDocument.create({
        data: {
          operationId,
          type,
          number: await reserveDocumentNumber(tx, type),
          status: 'DRAFT',
        },
        select: { id: true },
      });
    });
    return this.renderDocument(document.id, actor, context);
  }

  async renderBudget(
    budgetId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    const request: DocumentRequest = { source: 'budget', budgetId };
    this.assertTypeAccess(DocumentTemplateType.BUDGET, actor);
    const budget = await this.budgetOrThrow(budgetId);
    this.assertBudgetRenderable(budget.status);
    const document = await this.prisma.operationDocument.upsert({
      where: { budgetId },
      create: {
        budgetId,
        operationId: null,
        type: DocumentTemplateType.BUDGET,
        number: `ORC-${String(budget.number).padStart(6, '0')}`,
        status: 'DRAFT',
      },
      update: {},
    });
    const rendered = (await this.renderDocumentFromRequest(request, document.id, actor, context)) as Record<string, unknown>;
    const preview = await this.builder.buildBudget(budgetId);
    await this.prisma.budgetHistory.create({
      data: {
        budgetId,
        actorId: actor.id,
        action: BudgetHistoryAction.DOCUMENT_RENDERED,
        previousStatus: budget.status,
        newStatus: budget.status,
        metadata: {
          documentId: document.id,
          documentNumber: document.number,
          renderedAt: new Date().toISOString(),
        },
      },
    });
    return {
      documentId: document.id,
      preview,
      download: `/api/v1/budgets/${budgetId}/download`,
      status: rendered.status,
      document: rendered,
    };
  }

  async previewBudget(
    budgetId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    this.assertTypeAccess(DocumentTemplateType.BUDGET, actor);
    const budget = await this.budgetOrThrow(budgetId);
    this.assertBudgetRenderable(budget.status);
    const document = await this.prisma.operationDocument.upsert({
      where: { budgetId },
      create: {
        budgetId,
        operationId: null,
        type: DocumentTemplateType.BUDGET,
        number: `ORC-${String(budget.number).padStart(6, '0')}`,
        status: 'DRAFT',
      },
      update: {},
    });
    const blueprint = this.withSourceFingerprint(await this.builder.buildBudget(budgetId));
    await this.audit(
      DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_PREVIEWED,
      DOCUMENT_ENGINE_RESOURCE,
      actor,
      context,
      { budgetId, documentId: document.id, documentType: DocumentTemplateType.BUDGET },
    );
    return blueprint;
  }

  async renderDocument(
    documentId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    const document = await this.documentOrThrow(documentId);
    this.assertTypeAccess(document.type, actor);
    await this.assertDocumentAccess(document, actor, context);
    await this.assertRenderer(document, actor);
    const isManagement = actor.role === Role.OWNER || actor.role === Role.MANAGER;
    // Operador só gera após a revisão finalizar (READY). Owner/Manager é a própria
    // revisão: gerar o PDF equivale a finalizar, então pode renderizar mesmo um
    // documento enviado que ainda não foi finalizado (recupera estados travados).
    if (document.submittedAt && document.editorialStatus !== 'READY' && !isManagement) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_REVIEW_INCOMPLETE,
        'Finalize a revisão antes de gerar o PDF oficial',
        HttpStatus.CONFLICT,
        { editorialStatus: document.editorialStatus },
      );
    }
    await this.assertPmocEmissionReady(document.operationId, document.type);
    try {
      if (!document.budgetId && !document.operationId) {
        throw new ApplicationException(
          ERROR_CODES.DOCUMENT_NOT_FOUND,
          'Document is not linked to an operation or budget',
          HttpStatus.CONFLICT,
        );
      }
      const blueprint = this.withSourceFingerprint(await this.buildBlueprintForDocument(document));
      const rendered = this.renderer.render(blueprint);
      const pdf = await this.pdf.create(rendered);
      const stored = await this.assets.saveDocumentPdf({
        operationId: document.operationId,
        sourceId: document.budgetId ?? document.operationId ?? document.id,
        documentType: document.type,
        content: pdf.buffer,
      });

      const updated = await this.prisma.$transaction(async (tx) => {
        const persisted = await tx.operationDocument.updateMany({
          where: { id: document.id, updatedAt: document.updatedAt },
          data: {
            storageKey: stored.storageKey,
            mimeType: DOCUMENT_MIME_TYPE,
            fileSize: pdf.buffer.length,
            renderedAt: new Date(),
            status: 'READY',
            // Gerar o PDF finaliza o documento: sai de "Rascunho" para pronto.
            // Idempotente no fluxo do operador (que só renderiza documentos já READY).
            editorialStatus: 'READY',
            ...(document.finalizedAt ? {} : { finalizedAt: new Date(), finalizedById: actor.id }),
            renderMetadata: {
              engine: 'direct-pdf-v1',
              blueprintVersion: blueprint.version,
              pageCount: pdf.pageCount,
              generatedAt: blueprint.metadata.generatedAt,
              sourceKind: blueprint.metadata.sourceKind ?? (document.budgetId ? 'budget' : 'operation'),
              sourceId: blueprint.metadata.sourceId ?? document.budgetId ?? document.operationId ?? document.id,
              templateId: blueprint.metadata.templateId ?? null,
              templateUpdatedAt: blueprint.metadata.templateUpdatedAt ?? null,
              documentType: blueprint.metadata.documentType,
              documentNumber: blueprint.metadata.documentNumber,
              sourceFingerprint: blueprint.metadata.sourceFingerprint,
            },
          },
        });
        if (persisted.count !== 1) {
          await this.assets.delete(stored.storageKey).catch(() => undefined);
          throw new ApplicationException(
            ERROR_CODES.DOCUMENT_RENDER_FAILED,
            'Document changed while rendering; retry the render request',
            HttpStatus.CONFLICT,
          );
        }
        const saved = await tx.operationDocument.findUniqueOrThrow({ where: { id: document.id } });
        const revisioned = await tx.operationDocument.update({
          where: { id: document.id },
          data: { revision: { increment: 1 } },
          select: { revision: true },
        });
        await tx.documentRevision.create({
          data: {
            documentId: document.id,
            revision: revisioned.revision,
            action: 'RENDERED',
            origin: actor.role === Role.OPERATOR ? 'OPERATOR' : 'PLATFORM',
            actorId: actor.id,
            changedFields: ['renderedAt', 'storageKey', 'renderMetadata'],
            snapshot: { renderedAt: new Date().toISOString(), fileSize: pdf.buffer.length },
          },
        });
        await tx.auditLog.create({
          data: this.auditInput(
            DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_RENDERED,
            DOCUMENT_RENDER_RESOURCE,
            actor,
            context,
            {
              documentId: document.id,
              operationId: document.operationId,
              budgetId: document.budgetId,
              documentType: document.type,
              pageCount: pdf.pageCount,
              fileSize: pdf.buffer.length,
            },
          ),
        });
        await this.lifecycle.publishDocumentRenderedTx(tx, saved.id, actor.id, context);
        return saved;
      });

      if (document.storageKey && document.storageKey !== stored.storageKey) {
        await this.assets.delete(document.storageKey).catch(() => undefined);
      }

      this.logger.info('Document rendered', {
        event: 'document.rendered',
        requestId: context.requestId,
        documentId: updated.id,
        operationId: updated.operationId,
        documentType: updated.type,
        fileSize: updated.fileSize,
      });

      return this.documentPayload(updated);
    } catch (error) {
      this.logger.error('Document render failed', {
        event: 'document.render_failed',
        requestId: context.requestId,
        documentId,
        ...(error instanceof Error ? { error: error.message } : {}),
      });
      if (error instanceof ApplicationException) throw error;
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'Document rendering failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async downloadDocument(
    documentId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<DocumentDownload> {
    const document = await this.documentOrThrow(documentId);
    this.assertTypeAccess(document.type, actor);
    await this.assertDocumentAccess(document, actor, context);
    if (!document.storageKey || !document.mimeType || !document.fileSize) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_DOWNLOAD_NOT_READY,
        'Document has not been rendered yet',
        HttpStatus.CONFLICT,
      );
    }
    const currentBlueprint = this.withSourceFingerprint(await this.buildBlueprintForDocument(document));
    const renderedFingerprint = this.renderedSourceFingerprint(document.renderMetadata);
    if (!renderedFingerprint || renderedFingerprint !== currentBlueprint.metadata.sourceFingerprint) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_STALE,
        'Document is outdated because its source changed; render it again before downloading',
        HttpStatus.CONFLICT,
        {
          documentId: document.id,
          operationId: document.operationId,
          documentType: document.type,
          rerenderRequired: true,
        },
      );
    }
    let stored: { content: Buffer };
    try {
      stored = await this.assets.getDocumentPdf(document.storageKey);
    } catch (error) {
      if (error instanceof ApplicationException) throw error;
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_DOWNLOAD_NOT_READY,
        'Document binary is not available',
        HttpStatus.CONFLICT,
      );
    }
    await this.audit(
      DOCUMENT_ENGINE_AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
      DOCUMENT_RENDER_RESOURCE,
      actor,
      context,
      {
        documentId: document.id,
        operationId: document.operationId,
        documentType: document.type,
      },
    );
    return {
      content: stored.content,
      filename: `${document.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
      mimeType: document.mimeType,
    };
  }

  async downloadBudget(
    budgetId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<DocumentDownload> {
    this.assertTypeAccess(DocumentTemplateType.BUDGET, actor);
    const budget = await this.budgetOrThrow(budgetId);
    this.assertBudgetRenderable(budget.status);
    const document = await this.prisma.operationDocument.findUnique({
      where: { budgetId },
    });
    if (!document) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_NOT_FOUND,
        'Budget document was not rendered yet',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.downloadDocument(document.id, actor, context);
  }

  private assertTypeAccess(type: DocumentTemplateType, actor: AuthenticatedUser): void {
    const forbidden =
      (type === DocumentTemplateType.QUOTE && actor.role !== Role.OWNER) ||
      (type === DocumentTemplateType.RECEIPT &&
        actor.role !== Role.OWNER &&
        actor.role !== Role.MANAGER);
    if (forbidden) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_FORBIDDEN_TYPE,
        'The actor cannot access this financial document type',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async assertRenderer(document: OperationDocument, actor: AuthenticatedUser): Promise<void> {
    if (actor.role === Role.OWNER || actor.role === Role.MANAGER) return;
    const directType = OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES.includes(
      document.type as (typeof OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES)[number],
    );
    const operation = document.operationId
      ? await this.prisma.operation.findUnique({
          where: { id: document.operationId },
          select: {
            status: true,
            operatorId: true,
            cancellations: { where: { status: 'REQUESTED', requestedById: actor.id }, take: 1, select: { id: true } },
          },
        })
      : null;
    const pendingOwnCancellation = Boolean(operation?.cancellations.length);
    if (
      actor.role !== Role.OPERATOR ||
      !directType ||
      document.editorialStatus !== 'READY' ||
      (operation?.status !== 'COMPLETED' && !pendingOwnCancellation) ||
      operation?.operatorId !== actor.id
    ) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'O operador somente pode emitir OS ou Relatório de Visita Técnica concluídos por ele',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async assertOperationAccess(
    operationId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<void> {
    await this.access.assertOperationAccess(actor, operationId, {
      resource: DOCUMENT_ENGINE_RESOURCE,
      resourceId: operationId,
      context,
    });
  }

  private async assertDocumentAccess(
    document: OperationDocument,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<void> {
    await this.access.assertOperationBackedResourceAccess(actor, document.operationId, {
      resource: DOCUMENT_ENGINE_RESOURCE,
      resourceId: document.id,
      context,
    });
  }

  private async assertPmocEmissionReady(
    operationId: string | null,
    type: DocumentTemplateType,
  ): Promise<void> {
    if (type !== DocumentTemplateType.PMOC || !operationId) return;
    const source = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: {
        _count: { select: { photos: true } },
        maintenanceExecution: {
          select: { plan: { select: { pmocPlan: { select: { id: true } } } } },
        },
      },
    });
    if (!source?.maintenanceExecution?.plan.pmocPlan) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'O documento PMOC exige uma execução vinculada a um plano PMOC',
        HttpStatus.CONFLICT,
      );
    }
    if (source._count.photos < PMOC_MIN_PROCEDURE_IMAGES) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EVIDENCE_REQUIRED,
        `Registre pelo menos ${PMOC_MIN_PROCEDURE_IMAGES} imagens do procedimento antes de gerar o PDF final`,
        HttpStatus.CONFLICT,
        { required: PMOC_MIN_PROCEDURE_IMAGES, current: source._count.photos },
      );
    }
  }

  private async documentOrThrow(id: string): Promise<OperationDocument> {
    const document = await this.prisma.operationDocument.findUnique({ where: { id } });
    if (!document) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_NOT_FOUND,
        'Document was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return document;
  }

  private async budgetOrThrow(id: string): Promise<{ id: string; number: number; status: BudgetStatus; operationId: string | null }> {
    const budget = await this.prisma.budget.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, operationId: true },
    });
    if (!budget) {
      throw new ApplicationException(
        ERROR_CODES.BUDGET_NOT_FOUND,
        'Budget was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return budget;
  }

  private assertBudgetRenderable(status: BudgetStatus): void {
    const blockedStatuses: BudgetStatus[] = [BudgetStatus.CANCELED, BudgetStatus.REJECTED];
    if (blockedStatuses.includes(status)) {
      throw new ApplicationException(
        ERROR_CODES.BUDGET_INVALID_STATUS,
        'Canceled or rejected budgets cannot be rendered',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async renderDocumentFromRequest(
    request: DocumentRequest,
    documentId: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    void request;
    return this.renderDocument(documentId, actor, context);
  }

  private async buildBlueprintForDocument(document: OperationDocument): Promise<DocumentBlueprint> {
    if (document.budgetId) {
      return this.builder.buildBudget(document.budgetId);
    }
    if (!document.operationId) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_NOT_FOUND,
        'Document is not linked to an operation or budget',
        HttpStatus.CONFLICT,
      );
    }
    return this.builder.buildFromOperation(document.operationId, document.type);
  }

  private withSourceFingerprint(blueprint: DocumentBlueprint): DocumentBlueprint {
    const sourceFingerprint = createHash('sha256')
      .update(JSON.stringify(this.fingerprintPayload(blueprint)))
      .digest('hex');
    return {
      ...blueprint,
      metadata: { ...blueprint.metadata, sourceFingerprint },
    };
  }

  private fingerprintPayload(blueprint: DocumentBlueprint): unknown {
    const generatedAt = blueprint.metadata.generatedAt;
    const generatedDate = new Date(generatedAt);
    const timezone = blueprint.metadata.timezone || 'America/Recife';
    const generatedValues = [
      generatedAt,
      new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(generatedDate),
      new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeZone: timezone,
      }).format(generatedDate),
    ].filter(Boolean);
    const normalize = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return generatedValues.reduce(
          (result, generatedValue) => result.split(generatedValue).join('[GENERATED_AT]'),
          value,
        );
      }
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            // O fingerprint mede mudança de FONTE, não os bytes renderizados.
            // Bytes/tamanho de imagens são detalhe de renderização (a compressão
            // pode produzir bytes diferentes entre render e download, sobretudo
            // com fotos grandes ou troca de motor sharp↔jimp) e não podem tornar
            // o documento "desatualizado". A identidade das fotos permanece no
            // fingerprint via `sourceId`.
            key === 'sourceFingerprint' || key === 'contentBase64' || key === 'fileSize'
              ? undefined
              : normalize(item),
          ]),
        );
      }
      return value;
    };
    return normalize(blueprint);
  }

  private renderedSourceFingerprint(metadata: Prisma.JsonValue | null): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = metadata.sourceFingerprint;
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }

  private documentPayload(document: {
    id: string;
    operationId: string | null;
    budgetId?: string | null;
    type: DocumentTemplateType;
    number: string;
    status: string;
    storageKey: string | null;
    mimeType: string | null;
    fileSize: number | null;
    renderedAt: Date | null;
    renderMetadata: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): Record<string, unknown> {
    return {
      id: document.id,
      operationId: document.operationId,
      budgetId: document.budgetId ?? null,
      type: document.type,
      number: document.number,
      status: document.status,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      renderedAt: document.renderedAt,
      renderMetadata: document.renderMetadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      downloadReady: Boolean(document.storageKey),
    };
  }

  private async audit(
    action: string,
    resource: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: this.auditInput(action, resource, actor, context, metadata),
    });
  }

  private auditInput(
    action: string,
    resource: string,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource,
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

export function contextFromRequest(request: RequestWithId): DocumentAuditContext {
  return {
    requestId: request.requestId,
    ip: request.ip || null,
    userAgent: request.get('user-agent') ?? null,
  };
}
