import { HttpStatus, Injectable } from '@nestjs/common';
import { DocumentTemplateType, Prisma, Role } from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { PrismaService } from '../database/prisma.service';
import { FinancialService } from '../financial/financial.service';
import type { DocumentAuditContext } from './document-engine.service';
import type { ReceiptRevisionDto, UpdateReceiptDto } from './dto/receipt.dto';

const RECEIPT_INCLUDE = {
  operation: {
    select: {
      receiptIssuedAt: true,
      completedAt: true,
      receiptAmount: true,
      receiptAmountInWords: true,
      receiptDescription: true,
      receiptService: true,
      receiptWarrantyDays: true,
      receiptDeclaration: true,
      sourceSaleId: true,
      customer: { select: { name: true, tradeName: true } },
    },
  },
} as const;

type ReceiptDocument = Prisma.OperationDocumentGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

@Injectable()
export class ReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  async get(id: string, actor: AuthenticatedUser): Promise<unknown> {
    this.assertManagement(actor);
    const document = await this.receiptOrThrow(this.prisma, id);
    return {
      id: document.id,
      number: document.number,
      revision: document.revision,
      canceledAt: document.canceledAt,
      ...document.operation,
      receiptIssuedAt:
        document.operation?.receiptIssuedAt ??
        document.finalizedAt ??
        document.operation?.completedAt ??
        document.createdAt,
    };
  }

  async update(
    id: string,
    dto: UpdateReceiptDto,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    return this.mutate(id, dto, actor, context, false);
  }

  async cancel(
    id: string,
    dto: ReceiptRevisionDto,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
  ): Promise<unknown> {
    return this.mutate(id, dto, actor, context, true);
  }

  private async mutate(
    id: string,
    dto: ReceiptRevisionDto | UpdateReceiptDto,
    actor: AuthenticatedUser,
    context: DocumentAuditContext,
    cancel: boolean,
  ): Promise<unknown> {
    this.assertManagement(actor);
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.receiptOrThrow(tx, id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.operationId!}))`;
      const document = await this.receiptOrThrow(tx, id);
      if (cancel && document.canceledAt) return document;
      if (document.canceledAt || document.revision !== dto.revision) {
        throw new ApplicationException(
          ERROR_CODES.OPERATION_INVALID_TRANSITION,
          document.canceledAt
            ? 'O recibo está cancelado'
            : 'O recibo mudou. Reabra a edição para carregar os dados atuais',
          HttpStatus.CONFLICT,
        );
      }
      const operationId = document.operationId!;
      const changedFields = cancel
        ? ['canceledAt']
        : Object.keys(dto).filter((key) => key !== 'revision');
      if (!cancel) {
        const fields = dto as UpdateReceiptDto;
        if (!fields.receiptAmountInWords.trim() || !fields.receiptDescription.trim()) {
          throw new ApplicationException(
            ERROR_CODES.VALIDATION_ERROR,
            'Informe o valor por extenso e a descrição do recibo',
            HttpStatus.BAD_REQUEST,
          );
        }
        await tx.operation.update({
          where: { id: operationId },
          data: {
            receiptAmount: fields.receiptAmount,
            receiptAmountInWords: fields.receiptAmountInWords,
            receiptDescription: fields.receiptDescription,
            ...(fields.receiptIssuedAt
              ? { receiptIssuedAt: new Date(fields.receiptIssuedAt) }
              : {}),
            ...(fields.receiptWarrantyDays !== undefined
              ? { receiptWarrantyDays: fields.receiptWarrantyDays }
              : {}),
            // An old declaration can embed the old amount; regenerate it unless supplied.
            receiptDeclaration: fields.receiptDeclaration?.trim() || null,
          },
        });
      }
      const updated = await tx.operationDocument.update({
        where: { id },
        data: {
          ...(cancel ? { canceledAt: new Date() } : {}),
          editorialStatus: document.renderedAt ? 'STALE' : 'PENDING',
          revision: { increment: 1 },
        },
      });
      await this.financial.syncReceiptEntryTx(tx, operationId, actor.id, context);
      await tx.documentRevision.create({
        data: {
          documentId: id,
          revision: updated.revision,
          action: document.renderedAt ? 'MARKED_STALE' : 'REVIEW_UPDATED',
          origin: 'PLATFORM',
          actorId: actor.id,
          changedFields,
          snapshot: {
            canceledAt: updated.canceledAt?.toISOString() ?? null,
            previousAmount: document.operation?.receiptAmount?.toString() ?? null,
            ...(!cancel ? { amount: (dto as UpdateReceiptDto).receiptAmount } : {}),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: cancel ? 'RECEIPT_CANCELED' : 'RECEIPT_UPDATED',
          resource: 'operation_document',
          actor: actor.id,
          metadata: {
            documentId: id,
            operationId,
            changedFields,
            requestId: context.requestId,
            ip: context.ip,
            userAgent: context.userAgent,
          },
        },
      });
      return updated;
    });
  }

  private async receiptOrThrow(
    client: Prisma.TransactionClient,
    id: string,
  ): Promise<ReceiptDocument> {
    const document = await client.operationDocument.findUnique({
      where: { id },
      include: RECEIPT_INCLUDE,
    });
    if (!document || document.type !== DocumentTemplateType.RECEIPT || !document.operationId) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_NOT_FOUND,
        'Recibo não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return document;
  }

  private assertManagement(actor: AuthenticatedUser): void {
    if (actor.role !== Role.OWNER && actor.role !== Role.MANAGER) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'Somente a gestão pode ajustar recibos',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
