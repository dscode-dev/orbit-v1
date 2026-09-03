import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DocumentHandoffOrigin, DocumentRevisionAction, DocumentTemplateType, EquipmentStatus, EquipmentType, OperationStatus, OperationType, Prisma, Role, TechnicalCatalogType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  STORAGE_PROVIDER_TOKEN,
  type StorageProviderContract,
} from '../../infra/storage/storage-provider.type';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES, DOCUMENT_ONLY_DOCUMENT_TYPES, OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES, SKIP_AUTO_WORK_ORDER_DOCUMENT_TYPES } from '../../shared/constants/document-engine.constants';
import { PMOC_MIN_PROCEDURE_IMAGES } from '../../shared/constants/pmoc.constants';
import {
  MAX_OPERATION_PHOTOS,
  MAX_OPERATION_SIGNATURE_SIZE_BYTES,
  OPERATION_AUDIT_ACTIONS,
  OPERATION_PHOTO_RESOURCE,
  OPERATION_RESOURCE,
  OPERATION_SIGNATURE_MIME_TYPES,
} from '../../shared/constants/operations.constants';
import { reserveDocumentNumber } from '../../shared/utils/document-number.util';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { FinancialService } from '../financial/financial.service';
import { PrismaService } from '../database/prisma.service';
import { MaintenancePlanningService } from '../maintenance-planning/maintenance-planning.service';
import { MaintenanceRemindersService } from '../maintenance-reminders/maintenance-reminders.service';
import { OperationAccessService } from '../operation-access/operation-access.service';
import type {
  CreateOperationDto,
  CreateOperationFieldEquipmentsDto,
  ListOperationsQueryDto,
  OperationChecklistItemDto,
  OperationPhotoInputDto,
  OperationStatsQueryDto,
  UpdateOperationDto,
} from './dto/operation.dto';
import { decodeOperationPhoto } from './operation-media.utils';

export interface OperationAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export type OperationCreationTransactionHook = (
  tx: Prisma.TransactionClient,
  operationId: string,
) => Promise<void>;

const OPERATION_INCLUDE = {
  customer: { select: { id: true, name: true, tradeName: true, phone: true, secondaryPhone: true } },
  address: true,
  equipment: {
    select: {
      id: true,
      name: true,
      tag: true,
      type: true,
      sector: true,
      manufacturer: true,
      model: true,
      capacity: true,
    },
  },
  operator: { select: { id: true, name: true } },
  photos: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      caption: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, role: true } },
    },
  },
  maintenanceChecklistItems: {
    orderBy: [{ maintenanceType: 'asc' as const }, { position: 'asc' as const }],
    include: { equipment: { select: { id: true, name: true, tag: true } } },
  },
  inspectedEquipments: {
    orderBy: { position: 'asc' as const },
    include: {
      equipment: {
        select: {
          id: true,
          name: true,
          type: true,
          sector: true,
          manufacturer: true,
          model: true,
          capacity: true,
        },
      },
    },
  },
  documents: { orderBy: { createdAt: 'asc' as const } },
  maintenanceExecution: {
    include: {
      pmocExecutionRequest: {
        select: { id: true, executionNumber: true, executionYear: true, status: true, origin: true },
      },
      plan: {
        include: {
          pmocPlan: {
            select: {
              id: true,
              number: true,
              periodicity: true,
              generationMode: true,
              serviceTypes: true,
              responsibleTechnician: true,
              contractNumber: true,
              artNumber: true,
              equipments: {
                select: { equipment: { select: { id: true, name: true, tag: true } } },
              },
            },
          },
        },
      },
    },
  },
  rvtExecution: {
    select: {
      id: true,
      rvtPlanId: true,
      executionNumber: true,
      status: true,
      rvtPlan: {
        select: {
          responsibleTechnician: {
            select: {
              institutionalSignature: {
                select: { id: true, name: true, title: true, professionalCouncil: true, registrationNumber: true },
              },
            },
          },
        },
      },
    },
  },
  assignments: {
    orderBy: [{ isPrimary: 'desc' as const }, { assignedAt: 'asc' as const }],
    select: { id: true, assignedBy: true, assignedTo: true, isPrimary: true, status: true, assignee: { select: { id: true, name: true, role: true } } },
  },
  cancellations: {
    orderBy: { requestedAt: 'desc' as const },
    take: 1,
    select: {
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
    },
  },
  sourceSale: { select: { id: true, number: true, status: true, soldAt: true, warrantyDays: true, warrantyStartsAt: true, warrantyEndsAt: true, total: true } },
} satisfies Prisma.OperationInclude;

const OPERATION_LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  equipment: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true } },
  documents: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { photos: true, documents: true } },
  cancellations: { orderBy: { requestedAt: 'desc' as const }, take: 1, select: { id: true, status: true, reason: true, requestedAt: true, rescheduledFor: true } },
} satisfies Prisma.OperationInclude;

type DecodedPhoto = { buffer: Buffer; mimeType: string; ext: string; caption: string | null };
type OperationAssignment = {
  operatorId: string;
  delegated: boolean;
  ignoredOperatorId?: string;
};
type InspectedEquipmentSnapshot = {
  equipmentId: string;
  position: number;
  sector: string;
  brandSnapshot: string | null;
  modelSnapshot: string | null;
  capacitySnapshot: string | null;
  tagSnapshot: string | null;
  serialSnapshot: string | null;
  systemTypeSnapshot: string | null;
  currentSituationSnapshot: string | null;
};

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly storage: StorageProviderContract,
    private readonly lifecycle: LifecyclePublisher,
    private readonly maintenance: MaintenancePlanningService,
    private readonly reminders: MaintenanceRemindersService,
    private readonly assignments: AssignmentsService,
    private readonly access: OperationAccessService,
    private readonly financial: FinancialService,
  ) {}

  async list(query: ListOperationsQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const filters: Prisma.OperationWhereInput[] = [];
    if (query.equipmentId) filters.push({ OR: [{ equipmentId: query.equipmentId }, { inspectedEquipments: { some: { equipmentId: query.equipmentId } } }] });
    if (query.status === 'CANCELED') filters.push({ OR: [{ status: 'CANCELED' }, { cancellations: { some: { status: 'REQUESTED' } } }] });
    const where: Prisma.OperationWhereInput = {
      ...this.access.operationScope(actor),
      // Recibo/RVT são apenas relatórios — não poluem a lista de Operações da
      // gestão. Mas o operador precisa ver os próprios RVTs (na tela de
      // Documentos do app), então a exclusão não se aplica ao papel OPERATOR.
      ...(actor.role === Role.OPERATOR
        ? {}
        : { requestedDocumentType: { notIn: [...DOCUMENT_ONLY_DOCUMENT_TYPES] as DocumentTemplateType[] } }),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      // Filtro por equipamento inclui o equipamento principal E os inspecionados,
      // para o histórico de operações do equipamento ser completo.
      ...(query.operatorId ? { operatorId: query.operatorId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status && query.status !== 'CANCELED' ? { status: query.status } : {}),
      ...(filters.length ? { AND: filters } : {}),
      ...(query.search
        ? {
            OR: [
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
              { equipment: { name: { contains: query.search, mode: 'insensitive' } } },
              { operator: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operation.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: OPERATION_LIST_INCLUDE,
      }),
      this.prisma.operation.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async stats(
    query: OperationStatsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const where: Prisma.OperationWhereInput = {
      ...this.access.operationScope(actor),
      requestedDocumentType: { notIn: [...DOCUMENT_ONLY_DOCUMENT_TYPES] as DocumentTemplateType[] },
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const [total, draft, pending, inProgress, review, completed, canceled] = await this.prisma.$transaction([
      this.prisma.operation.count({ where }),
      this.prisma.operation.count({ where: { ...where, status: 'DRAFT' } }),
      this.prisma.operation.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.operation.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      this.prisma.operation.count({ where: { ...where, status: 'REVIEW' } }),
      this.prisma.operation.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.operation.count({ where: { ...where, OR: [{ status: 'CANCELED' }, { cancellations: { some: { status: 'REQUESTED' } } }] } }),
    ]);
    return {
      total,
      byStatus: {
        DRAFT: draft,
        PENDING: pending,
        IN_PROGRESS: inProgress,
        REVIEW: review,
        COMPLETED: completed,
        CANCELED: canceled,
      },
    };
  }

  async get(id: string, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    await this.access.assertOperationAccess(actor, id, {
      resource: OPERATION_RESOURCE,
      resourceId: id,
      context,
    });
    const operation = await this.operationOrThrow(id);
    return operation;
  }

  async create(
    dto: CreateOperationDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
    transactionHook?: OperationCreationTransactionHook,
  ): Promise<unknown> {
    const requestedDocumentType = dto.documentType ?? DocumentTemplateType.WORK_ORDER;
    // Recibo é apenas relatório: sem atendimento (Assignment) e oculto das
    // visões operacionais. O RVT mantém seu atendimento, mas nenhum dos dois
    // cria a OS (WORK_ORDER) automaticamente.
    const isDocumentOnly = DOCUMENT_ONLY_DOCUMENT_TYPES.includes(
      requestedDocumentType as (typeof DOCUMENT_ONLY_DOCUMENT_TYPES)[number],
    );
    const skipAutoWorkOrder = SKIP_AUTO_WORK_ORDER_DOCUMENT_TYPES.includes(
      requestedDocumentType as (typeof SKIP_AUTO_WORK_ORDER_DOCUMENT_TYPES)[number],
    );
    if (
      actor.role === Role.OPERATOR &&
      !OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES.includes(
        requestedDocumentType as (typeof OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES)[number],
      )
    ) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_OPERATOR_DOCUMENT_TYPE_FORBIDDEN,
        'O operador pode iniciar somente Ordem de Serviço ou Relatório de Visita Técnica',
        HttpStatus.FORBIDDEN,
        { allowedTypes: [...OPERATOR_DIRECT_COMPLETION_DOCUMENT_TYPES] },
      );
    }
    if (actor.role === Role.OPERATOR && dto.status && dto.status !== 'DRAFT') {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_INVALID_TRANSITION,
        'Um atendimento iniciado pelo operador deve começar como rascunho',
        HttpStatus.CONFLICT,
      );
    }
    if (actor.role === Role.OPERATOR && dto.serviceValue !== undefined) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_SERVICE_VALUE_FORBIDDEN,
        'Somente a gestão pode definir o valor operacional do serviço',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.validateRelations(dto.customerId, dto.addressId, dto.equipmentId);
    this.validateReferencePeriod(dto.referenceMonth, dto.referenceYear);
    const inspectedEquipments = await this.resolveInspectedEquipments(
      dto.customerId,
      dto.inspectedEquipments,
    );
    await this.validateChecklistEquipments(dto.customerId, dto.maintenanceChecklist);
    const photos = (dto.photos ?? []).map((p) => this.decodePhoto(p));
    if (photos.length > MAX_OPERATION_PHOTOS) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_INVALID,
        `A maximum of ${MAX_OPERATION_PHOTOS} photos is allowed`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const assignment = await this.resolveOperatorAssignment(dto.operatorId, actor);
    const sourceSale = dto.sourceSaleId
      ? await this.prisma.sale.findFirst({ where: { id: dto.sourceSaleId, customerId: dto.customerId, status: 'COMPLETED' } })
      : null;
    if (dto.sourceSaleId && !sourceSale) {
      throw new ApplicationException(
        ERROR_CODES.SALE_INVALID_RELATIONSHIP,
        'Completed sale does not belong to the selected customer',
        HttpStatus.CONFLICT,
      );
    }
    const signatureData = this.normalizeSignatureData(dto.signatureData);
    if (
      actor.role === Role.OPERATOR &&
      CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES.includes(
        requestedDocumentType as (typeof CUSTOMER_SIGNATURE_REQUIRED_DOCUMENT_TYPES)[number],
      ) &&
      (!signatureData || !dto.customerSignerName?.trim())
    ) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED,
        'A assinatura e o nome do cliente/responsável são obrigatórios',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Operation + auto Work Order draft are created atomically. The OS number is
    // derived from the operation sequential number.
    const operationId = await this.prisma.$transaction(async (tx) => {
      const operation = await tx.operation.create({
        data: {
          customerId: dto.customerId,
          sourceSaleId: sourceSale?.id ?? null,
          addressId: dto.addressId ?? null,
          equipmentId: dto.equipmentId ?? null,
          operatorId: assignment.operatorId,
          type: dto.type,
          requestedDocumentType: dto.documentType ?? DocumentTemplateType.WORK_ORDER,
          serviceTypes: this.operationTypes(dto.type, dto.serviceTypes),
          status: dto.status ?? 'DRAFT',
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
          completedAt: dto.completedAt ? new Date(dto.completedAt) : null,
          checklist: this.normalizeChecklist(dto.checklist),
          observations: dto.observations ?? null,
          reportedIssue: dto.reportedIssue ?? null,
          serviceDescription: dto.serviceDescription ?? null,
          serviceValue: dto.serviceValue ?? null,
          receiptNumber: dto.receiptNumber ?? null,
          receiptIssuedAt: dto.receiptIssuedAt ? new Date(dto.receiptIssuedAt) : null,
          receiptAmount: dto.receiptAmount ?? null,
          receiptAmountInWords: dto.receiptAmountInWords ?? null,
          receiptService: dto.receiptService ?? null,
          receiptDescription: dto.receiptDescription ?? null,
          receiptWarrantyDays: dto.receiptWarrantyDays ?? null,
          receiptDeclaration: dto.receiptDeclaration ?? null,
          technicalDiagnosis: dto.technicalDiagnosis ?? null,
          technicalRecommendations: dto.technicalRecommendations ?? null,
          technicalOpinionObjective: dto.technicalOpinionObjective ?? null,
          technicalOpinionObjectiveItems: dto.technicalOpinionObjectiveItems ?? [],
          technicalOpinionConditions: dto.technicalOpinionConditions ?? null,
          technicalOpinionAnalysis: dto.technicalOpinionAnalysis ?? null,
          technicalOpinionConclusion: dto.technicalOpinionConclusion ?? null,
          technicalOpinionConclusionItems: dto.technicalOpinionConclusionItems ?? [],
          technicalOpinionRecommendations: dto.technicalOpinionRecommendations ?? null,
          technicalOpinionResponsible: dto.technicalOpinionResponsible ?? null,
          technicalOpinionCrea: dto.technicalOpinionCrea ?? null,
          referenceMonth: dto.referenceMonth ?? null,
          referenceYear: dto.referenceYear ?? null,
          maintenanceType: dto.maintenanceType ?? null,
          maintenanceChecklistItems: {
            create: (dto.maintenanceChecklist ?? []).map((item, position) => ({
              maintenanceType: item.maintenanceType,
              description: item.description,
              executed: item.executed,
              result: item.result ?? (item.executed ? 'YES' : 'NO'),
              equipmentId: item.equipmentId ?? null,
              pmocUnit: item.pmocUnit ?? null,
              observations: item.observations ?? null,
              position,
            })),
          },
          inspectedEquipments: { create: inspectedEquipments },
          signatureData,
          customerSignerName: signatureData ? (dto.customerSignerName ?? null) : null,
          customerSignerRole: signatureData ? (dto.customerSignerRole ?? null) : null,
          signedAt: signatureData ? (dto.signedAt ? new Date(dto.signedAt) : new Date()) : null,
        },
      });
      await this.completeMissingEquipmentProfilesTx(
        tx,
        operation.id,
        dto.inspectedEquipments,
        actor,
        context,
      );
      if (sourceSale) {
        await tx.saleHistory.create({
          data: {
            saleId: sourceSale.id,
            actorId: actor.id,
            action: 'RECEIPT_LINKED',
            metadata: { operationId: operation.id, operationNumber: operation.number },
          },
        });
      }
      // A OS (documento WORK_ORDER) nunca é criada junto com Recibo ou RVT — pode
      // ser gerada depois, manualmente, a partir do relatório.
      if (!skipAutoWorkOrder) {
        await tx.operationDocument.create({
          data: {
            operationId: operation.id,
            type: DocumentTemplateType.WORK_ORDER,
            number: await reserveDocumentNumber(tx, DocumentTemplateType.WORK_ORDER),
            status: 'DRAFT',
          },
        });
      }
      if (dto.documentType && dto.documentType !== DocumentTemplateType.WORK_ORDER) {
        await tx.operationDocument.create({
          data: {
            operationId: operation.id,
            type: dto.documentType,
            number: await reserveDocumentNumber(
              tx,
              dto.documentType,
              dto.documentType === DocumentTemplateType.RECEIPT ? dto.receiptNumber : null,
            ),
            status: 'DRAFT',
          },
        });
      }
      await tx.auditLog.create({
        data: this.audit(
          OPERATION_AUDIT_ACTIONS.OPERATION_CREATED,
          OPERATION_RESOURCE,
          actor,
          context,
          {
            operationId: operation.id,
            number: operation.number,
            customerId: operation.customerId,
            createdBy: actor.id,
            operatorId: operation.operatorId,
            requestedDocumentType: operation.requestedDocumentType,
            delegated: assignment.delegated,
            ignoredOperatorId: assignment.ignoredOperatorId ?? null,
          },
        ),
      });
      if (assignment.delegated) {
        await tx.auditLog.create({
          data: this.audit(
            OPERATION_AUDIT_ACTIONS.OPERATION_DELEGATED,
            OPERATION_RESOURCE,
            actor,
            context,
            {
              operationId: operation.id,
              number: operation.number,
              customerId: operation.customerId,
              createdBy: actor.id,
              operatorId: operation.operatorId,
              delegatedUserId: operation.operatorId,
            },
          ),
        });
      }
      // Relatórios document-only (Recibo/RVT) não geram atendimento nem lembrete:
      // não têm operador executor e ficam fora do fluxo operacional.
      if (!isDocumentOnly) {
        await this.assignments.createForOperationTx(
          tx,
          {
            operationId: operation.id,
            assignedBy: actor.id,
            assignedTo: operation.operatorId,
            notes: dto.observations ?? null,
            isPrimary: true,
          },
          actor.id,
          context,
        );
        // Técnicos auxiliares: recebem/visualizam a mesma demanda (view-only quando
        // sem permissão de relatórios). Nunca duplica o executor primário.
        const auxiliaryIds = [...new Set(dto.auxiliaryOperatorIds ?? [])].filter(
          (id) => id !== operation.operatorId,
        );
        for (const auxiliaryId of auxiliaryIds) {
          await this.assignments.createForOperationTx(
            tx,
            {
              operationId: operation.id,
              assignedBy: actor.id,
              assignedTo: auxiliaryId,
              notes: dto.observations ?? null,
              isPrimary: false,
            },
            actor.id,
            context,
          );
        }
        // Lembrete de manutenção: registra a previsão da próxima execução para OS
        // Preventiva/Instalação (exceto origem PMOC, que tem agenda própria).
        await this.reminders.syncFromOperationTx(tx, operation.id);
      }
      // Integrações que vinculam entidades dependentes (ex.: PMOC →
      // MaintenanceExecution) precisam terminar antes dos efeitos de conclusão.
      // Assim, a sincronização encontra o grafo completo dentro da mesma transação.
      await transactionHook?.(tx, operation.id);
      if (operation.status === 'COMPLETED') {
        await this.lifecycle.publishOperationCompletedTx(tx, operation.id, actor.id, context);
        await this.maintenance.syncOperationCompletedTx(tx, operation.id, actor.id, context);
      }
      return operation.id;
    });

    // Photos are persisted via the storage provider (non-transactional) after the
    // operation exists. A failed photo never blocks the operation.
    for (const photo of photos) {
      const storageKey = `operations/${operationId}/photos/${randomUUID()}.${photo.ext}`;
      try {
        await this.storage.save({ storageKey, content: photo.buffer });
        await this.prisma.operationPhoto.create({
          data: {
            operationId,
            createdById: actor.id,
            storageKey,
            caption: photo.caption,
            mimeType: photo.mimeType,
            fileSize: photo.buffer.length,
          },
        });
      } catch {
        await this.storage.delete(storageKey).catch(() => undefined);
      }
    }

    // Recibo emitido: extrai o valor total e lança automaticamente como ENTRADA
    // na conta geral (idempotente). Falha aqui nunca bloqueia o recibo.
    if (requestedDocumentType === DocumentTemplateType.RECEIPT && dto.receiptAmount != null) {
      await this.financial.syncReceiptEntry(operationId, actor.id, context).catch(() => undefined);
    }

    return this.operationOrThrow(operationId);
  }

  async update(
    id: string,
    dto: UpdateOperationDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    await this.access.assertOperationAccess(actor, id, {
      resource: OPERATION_RESOURCE,
      resourceId: id,
      context,
    });
    const existing = await this.prisma.operation.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        operatorId: true,
        status: true,
        type: true,
        serviceTypes: true,
        referenceMonth: true,
        referenceYear: true,
        equipmentId: true,
        inspectedEquipments: { select: { equipmentId: true } },
        maintenanceExecution: { select: { plan: { select: { pmocPlan: { select: { id: true } } } } } },
        _count: { select: { photos: true } },
      },
    });
    if (!existing)
      throw new ApplicationException(
        ERROR_CODES.OPERATION_NOT_FOUND,
        'Operation was not found',
        HttpStatus.NOT_FOUND,
      );
    if (dto.auxiliaryOperatorIds !== undefined && actor.role !== Role.OWNER && actor.role !== Role.MANAGER) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'Somente OWNER e MANAGER podem definir auxiliares técnicos',
        HttpStatus.FORBIDDEN,
      );
    }
    this.validateReferencePeriod(
      dto.referenceMonth ?? existing.referenceMonth ?? undefined,
      dto.referenceYear ?? existing.referenceYear ?? undefined,
    );
    const inspectedEquipments =
      dto.inspectedEquipments === undefined
        ? null
        : await this.resolveInspectedEquipments(existing.customerId, dto.inspectedEquipments);
    if (actor.role === Role.OPERATOR && dto.inspectedEquipments !== undefined) {
      const allowedEquipmentIds = new Set([
        ...(existing.equipmentId ? [existing.equipmentId] : []),
        ...existing.inspectedEquipments.map((item) => item.equipmentId),
      ]);
      const unexpectedEquipment = dto.inspectedEquipments.find(
        (item) => !allowedEquipmentIds.has(item.equipmentId),
      );
      if (unexpectedEquipment) {
        throw new ApplicationException(
          ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
          'O operador pode complementar somente equipamentos vinculados à Ordem de Serviço',
          HttpStatus.FORBIDDEN,
          { equipmentId: unexpectedEquipment.equipmentId },
        );
      }
    }
    await this.validateChecklistEquipments(existing.customerId, dto.maintenanceChecklist);
    const photos = (dto.photos ?? []).map((p) => this.decodePhoto(p));
    if (existing._count.photos + photos.length > MAX_OPERATION_PHOTOS) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_INVALID,
        `A maximum of ${MAX_OPERATION_PHOTOS} photos is allowed per Operation`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const signatureData = this.normalizeSignatureData(dto.signatureData);
    if (
      dto.status === 'COMPLETED' &&
      existing.maintenanceExecution?.plan.pmocPlan &&
      existing._count.photos + photos.length < PMOC_MIN_PROCEDURE_IMAGES
    ) {
      throw new ApplicationException(
        ERROR_CODES.PMOC_EVIDENCE_REQUIRED,
        `A execução PMOC precisa de pelo menos ${PMOC_MIN_PROCEDURE_IMAGES} imagens antes da conclusão`,
        HttpStatus.CONFLICT,
        {
          required: PMOC_MIN_PROCEDURE_IMAGES,
          current: existing._count.photos + photos.length,
        },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.operation.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.serviceTypes !== undefined
            ? { serviceTypes: this.operationTypes(existing.type, dto.serviceTypes) }
            : {}),
          ...(dto.startedAt ? { startedAt: new Date(dto.startedAt) } : {}),
          ...(dto.completedAt ? { completedAt: new Date(dto.completedAt) } : {}),
          ...(dto.checklist ? { checklist: this.normalizeChecklist(dto.checklist) } : {}),
          ...(dto.observations !== undefined ? { observations: dto.observations } : {}),
          ...(dto.reportedIssue !== undefined ? { reportedIssue: dto.reportedIssue } : {}),
          ...(dto.serviceDescription !== undefined
            ? { serviceDescription: dto.serviceDescription }
            : {}),
          ...(dto.receiptNumber !== undefined ? { receiptNumber: dto.receiptNumber } : {}),
          ...(dto.receiptIssuedAt !== undefined
            ? { receiptIssuedAt: new Date(dto.receiptIssuedAt) }
            : {}),
          ...(dto.receiptAmount !== undefined ? { receiptAmount: dto.receiptAmount } : {}),
          ...(dto.receiptAmountInWords !== undefined
            ? { receiptAmountInWords: dto.receiptAmountInWords }
            : {}),
          ...(dto.receiptService !== undefined ? { receiptService: dto.receiptService } : {}),
          ...(dto.receiptDescription !== undefined
            ? { receiptDescription: dto.receiptDescription }
            : {}),
          ...(dto.receiptWarrantyDays !== undefined
            ? { receiptWarrantyDays: dto.receiptWarrantyDays }
            : {}),
          ...(dto.receiptDeclaration !== undefined
            ? { receiptDeclaration: dto.receiptDeclaration }
            : {}),
          ...(dto.technicalDiagnosis !== undefined
            ? { technicalDiagnosis: dto.technicalDiagnosis }
            : {}),
          ...(dto.technicalRecommendations !== undefined
            ? { technicalRecommendations: dto.technicalRecommendations }
            : {}),
          ...(dto.technicalOpinionObjective !== undefined
            ? { technicalOpinionObjective: dto.technicalOpinionObjective }
            : {}),
          ...(dto.technicalOpinionObjectiveItems !== undefined
            ? { technicalOpinionObjectiveItems: dto.technicalOpinionObjectiveItems }
            : {}),
          ...(dto.technicalOpinionConditions !== undefined
            ? { technicalOpinionConditions: dto.technicalOpinionConditions }
            : {}),
          ...(dto.technicalOpinionAnalysis !== undefined
            ? { technicalOpinionAnalysis: dto.technicalOpinionAnalysis }
            : {}),
          ...(dto.technicalOpinionConclusion !== undefined
            ? { technicalOpinionConclusion: dto.technicalOpinionConclusion }
            : {}),
          ...(dto.technicalOpinionConclusionItems !== undefined
            ? { technicalOpinionConclusionItems: dto.technicalOpinionConclusionItems }
            : {}),
          ...(dto.technicalOpinionRecommendations !== undefined
            ? { technicalOpinionRecommendations: dto.technicalOpinionRecommendations }
            : {}),
          ...(dto.technicalOpinionResponsible !== undefined
            ? { technicalOpinionResponsible: dto.technicalOpinionResponsible }
            : {}),
          ...(dto.technicalOpinionCrea !== undefined
            ? { technicalOpinionCrea: dto.technicalOpinionCrea }
            : {}),
          ...(dto.referenceMonth !== undefined ? { referenceMonth: dto.referenceMonth } : {}),
          ...(dto.referenceYear !== undefined ? { referenceYear: dto.referenceYear } : {}),
          ...(dto.maintenanceType !== undefined ? { maintenanceType: dto.maintenanceType } : {}),
          ...(signatureData
            ? {
                signatureData,
                customerSignerName: dto.customerSignerName ?? null,
                customerSignerRole: dto.customerSignerRole ?? null,
                signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
              }
            : {}),
        },
      });
      if (dto.auxiliaryOperatorIds !== undefined) {
        await this.assignments.syncAuxiliaryAssignmentsTx(
          tx,
          id,
          existing.operatorId,
          dto.auxiliaryOperatorIds,
          actor.id,
          context,
        );
      }
      const documentChangedFields = Object.keys(dto).filter((field) => field !== 'auxiliaryOperatorIds');
      if (documentChangedFields.length > 0) await this.markDocumentsChangedTx(tx, id, actor, documentChangedFields);
      if (dto.maintenanceChecklist !== undefined) {
        await tx.operationMaintenanceChecklistItem.deleteMany({ where: { operationId: id } });
        if (dto.maintenanceChecklist.length > 0) {
          await tx.operationMaintenanceChecklistItem.createMany({
            data: dto.maintenanceChecklist.map((item, position) => ({
              operationId: id,
              maintenanceType: item.maintenanceType,
              description: item.description,
              executed: item.executed,
              result: item.result ?? (item.executed ? 'YES' : 'NO'),
              equipmentId: item.equipmentId ?? null,
              pmocUnit: item.pmocUnit ?? null,
              observations: item.observations ?? null,
              position,
            })),
          });
        }
      }
      if (inspectedEquipments !== null) {
        await this.completeMissingEquipmentProfilesTx(
          tx,
          id,
          dto.inspectedEquipments,
          actor,
          context,
        );
        await tx.operationInspectedEquipment.deleteMany({ where: { operationId: id } });
        if (inspectedEquipments.length > 0) {
          await tx.operationInspectedEquipment.createMany({
            data: inspectedEquipments.map((item) => ({ operationId: id, ...item })),
          });
        }
      }
      await tx.auditLog.create({
        data: this.audit(
          OPERATION_AUDIT_ACTIONS.OPERATION_UPDATED,
          OPERATION_RESOURCE,
          actor,
          context,
          {
            operationId: id,
            changedFields: Object.keys(dto),
          },
        ),
      });
      if (dto.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        await this.lifecycle.publishOperationCompletedTx(tx, id, actor.id, context);
        await this.maintenance.syncOperationCompletedTx(tx, id, actor.id, context);
        await this.reminders.syncFromOperationTx(tx, id);
      }
    });
    for (const photo of photos) {
      const storageKey = `operations/${id}/photos/${randomUUID()}.${photo.ext}`;
      try {
        await this.storage.save({ storageKey, content: photo.buffer });
        await this.prisma.operationPhoto.create({
          data: {
            operationId: id,
            createdById: actor.id,
            storageKey,
            caption: photo.caption,
            mimeType: photo.mimeType,
            fileSize: photo.buffer.length,
          },
        });
        await this.prisma.auditLog.create({
          data: this.audit(OPERATION_AUDIT_ACTIONS.OPERATION_PHOTO_UPLOADED, OPERATION_PHOTO_RESOURCE, actor, context, { operationId: id, caption: photo.caption }),
        });
      } catch (error) {
        await this.storage.delete(storageKey).catch(() => undefined);
        throw error;
      }
    }
    // Recibo emitido a partir de uma OS existente (atualiza a operação com o
    // valor): lança automaticamente a ENTRADA na conta geral (idempotente).
    if (dto.receiptAmount != null) {
      await this.financial.syncReceiptEntry(id, actor.id, context).catch(() => undefined);
    }
    return this.operationOrThrow(id);
  }

  async addFieldEquipments(
    id: string,
    dto: CreateOperationFieldEquipmentsDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    await this.access.assertOperationAccess(actor, id, {
      resource: OPERATION_RESOURCE,
      resourceId: id,
      context,
    });
    const existingIds = [...new Set(dto.existingEquipmentIds ?? [])];
    const drafts = dto.newEquipments ?? [];
    if (existingIds.length + drafts.length === 0 || existingIds.length + drafts.length > 20) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
        'Selecione ou cadastre ao menos um equipamento, respeitando o limite de 20 itens',
        HttpStatus.BAD_REQUEST,
      );
    }
    for (const item of drafts) {
      if (!item.manufacturer?.trim() && !item.model?.trim()) {
        throw new ApplicationException(
          ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
          'Informe ao menos a marca ou o modelo de cada novo equipamento',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const operation = await tx.operation.findUnique({
          where: { id },
          select: {
            id: true,
            customerId: true,
            addressId: true,
            equipmentId: true,
            status: true,
            inspectedEquipments: { select: { equipmentId: true } },
            rvtExecution: { select: { rvtPlanId: true } },
          },
        });
        if (!operation) {
          throw new ApplicationException(
            ERROR_CODES.OPERATION_NOT_FOUND,
            'Operation was not found',
            HttpStatus.NOT_FOUND,
          );
        }
        if (operation.status !== OperationStatus.IN_PROGRESS) {
          throw new ApplicationException(
            ERROR_CODES.OPERATION_INVALID_TRANSITION,
            'Os equipamentos só podem ser coletados durante um atendimento em execução',
            HttpStatus.CONFLICT,
          );
        }
        if ((operation.equipmentId || operation.inspectedEquipments.length > 0) && !operation.rvtExecution) {
          throw new ApplicationException(
            ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
            'Esta Ordem de Serviço já possui equipamentos definidos',
            HttpStatus.CONFLICT,
          );
        }

        const existing = existingIds.length
          ? await tx.equipment.findMany({
              where: {
                id: { in: existingIds },
                customerId: operation.customerId,
                isActive: true,
                disabledAt: null,
              },
              select: {
                id: true,
                sector: true,
                manufacturer: true,
                model: true,
                capacity: true,
                tag: true,
                serialNumber: true,
              },
            })
          : [];
        if (existing.length !== existingIds.length) {
          throw new ApplicationException(
            ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
            'Um dos equipamentos selecionados não pertence ao cliente ou não está ativo',
            HttpStatus.BAD_REQUEST,
          );
        }

        const catalogIds = [...new Set(drafts.map((item) => item.equipmentTypeCatalogId))];
        const catalogs = catalogIds.length
          ? await tx.technicalCatalog.findMany({
              where: {
                id: { in: catalogIds },
                type: TechnicalCatalogType.EQUIPMENT_TYPE,
                active: true,
                deletedAt: null,
              },
              select: { id: true, title: true, tags: true },
            })
          : [];
        const catalogById = new Map(catalogs.map((item) => [item.id, item]));
        if (catalogs.length !== catalogIds.length) {
          throw new ApplicationException(
            ERROR_CODES.TECHNICAL_CATALOG_NOT_FOUND,
            'Um dos tipos de equipamento não está disponível',
            HttpStatus.BAD_REQUEST,
          );
        }

        const created: typeof existing = [];
        for (const item of drafts) {
          const catalog = catalogById.get(item.equipmentTypeCatalogId)!;
          const qrToken = randomUUID();
          const manufacturer = item.manufacturer?.trim() || null;
          const model = item.model?.trim() || null;
          const equipment = await tx.equipment.create({
            data: {
              customerId: operation.customerId,
              addressId: operation.addressId,
              equipmentTypeCatalogId: catalog.id,
              type: this.equipmentTypeFromTags(catalog.tags),
              status: EquipmentStatus.ACTIVE,
              name: ([manufacturer, model].filter(Boolean).join(' ') || catalog.title).slice(0, 180),
              sector: item.sector?.trim() || null,
              tag: item.tag?.trim() || null,
              manufacturer,
              model,
              serialNumber: item.serialNumber?.trim() || null,
              capacity: item.capacity?.trim() || null,
              voltage: item.voltage?.trim() || null,
              observations: item.observations?.trim() || null,
              qrToken,
              qrCode: `equipment:${qrToken}`,
            },
            select: {
              id: true,
              sector: true,
              manufacturer: true,
              model: true,
              capacity: true,
              tag: true,
              serialNumber: true,
              type: true,
            },
          });
          created.push(equipment);
          await tx.auditLog.create({
            data: this.audit('EQUIPMENT_CREATED', 'EQUIPMENT', actor, context, {
              equipmentId: equipment.id,
              customerId: operation.customerId,
              operationId: id,
              source: 'FIELD_OPERATION',
            }),
          });
        }

        const selected = [...existing, ...created];
        await tx.operation.update({ where: { id }, data: { equipmentId: selected[0].id } });
        if (operation.inspectedEquipments.length > 0) {
          await tx.operationInspectedEquipment.deleteMany({ where: { operationId: id } });
        }
        await tx.operationInspectedEquipment.createMany({
          data: selected.map((item, position) => ({
            operationId: id,
            equipmentId: item.id,
            position,
            sector: item.sector?.trim() || 'Não informado',
            brandSnapshot: item.manufacturer?.trim() || null,
            modelSnapshot: item.model?.trim() || null,
            capacitySnapshot: item.capacity?.trim() || null,
            tagSnapshot: item.tag,
            serialSnapshot: item.serialNumber,
          })),
        });
        if (operation.rvtExecution && created.length > 0) {
          const lastPosition = await tx.rvtPlanEquipment.aggregate({ where: { rvtPlanId: operation.rvtExecution.rvtPlanId }, _max: { position: true } });
          await tx.rvtPlanEquipment.createMany({
            data: created.map((item, index) => ({ rvtPlanId: operation.rvtExecution!.rvtPlanId, equipmentId: item.id, position: (lastPosition._max.position ?? -1) + index + 1 })),
            skipDuplicates: true,
          });
        }
        await this.markDocumentsChangedTx(tx, id, actor, ['equipmentId', 'inspectedEquipments']);
        await tx.auditLog.create({
          data: this.audit('OPERATION_FIELD_EQUIPMENTS_ATTACHED', OPERATION_RESOURCE, actor, context, {
            operationId: id,
            equipmentIds: selected.map((item) => item.id),
            createdEquipmentIds: created.map((item) => item.id),
          }),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.operationOrThrow(id);
  }

  /**
   * Technical-responsible approval: REVIEW → COMPLETED. Fires the completion
   * side-effects (asset lifecycle event + maintenance/PMOC execution sync) that
   * are intentionally deferred while the operation awaits review.
   */
  async approve(
    id: string,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    const cancellation = await this.prisma.operationCancellation.findFirst({ where: { operationId: id, status: 'REQUESTED' }, select: { id: true } });
    if (cancellation) throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'Use a decisão de cancelamento para concluir esta análise', HttpStatus.CONFLICT);
    await this.prisma.$transaction(async (tx) => {
      const transition = await tx.operation.updateMany({
        where: { id, status: 'REVIEW' },
        data: { status: 'COMPLETED' },
      });
      if (transition.count !== 1) {
        const exists = await tx.operation.findUnique({ where: { id }, select: { status: true } });
        if (!exists)
          throw new ApplicationException(
            ERROR_CODES.OPERATION_NOT_FOUND,
            'Operation was not found',
            HttpStatus.NOT_FOUND,
          );
        throw new ApplicationException(
          ERROR_CODES.OPERATION_INVALID_TRANSITION,
          'Only operations awaiting review can be approved',
          HttpStatus.CONFLICT,
          { status: exists.status },
        );
      }
      await tx.auditLog.create({
        data: this.audit(
          OPERATION_AUDIT_ACTIONS.OPERATION_APPROVED,
          OPERATION_RESOURCE,
          actor,
          context,
          { operationId: id },
        ),
      });
      await this.lifecycle.publishOperationCompletedTx(tx, id, actor.id, context);
      await this.maintenance.syncOperationCompletedTx(tx, id, actor.id, context);
      await this.reminders.syncFromOperationTx(tx, id);
    });
    return this.operationOrThrow(id);
  }

  async getPhoto(
    photoId: string,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    await this.access.assertPhotoAccess(actor, photoId, {
      resource: OPERATION_PHOTO_RESOURCE,
      resourceId: photoId,
      context,
    });
    const photo = await this.prisma.operationPhoto.findUnique({
      where: { id: photoId },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });
    if (!photo)
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_NOT_FOUND,
        'Operation photo was not found',
        HttpStatus.NOT_FOUND,
      );
    const stored = await this.storage.get(photo.storageKey);
    return {
      id: photo.id,
      caption: photo.caption,
      mimeType: photo.mimeType,
      fileSize: photo.fileSize,
      createdAt: photo.createdAt,
      createdBy: photo.createdBy,
      contentBase64: stored.content.toString('base64'),
    };
  }

  async updatePhoto(photoId: string, caption: string, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    this.assertPhotoManagement(actor);
    const photo = await this.photoOrThrow(photoId);
    await this.prisma.$transaction(async (tx) => {
      await tx.operationPhoto.update({ where: { id: photoId }, data: { caption: caption || null } });
      await this.markDocumentsChangedTx(tx, photo.operationId, actor, ['photos.caption']);
      await tx.auditLog.create({ data: this.audit(OPERATION_AUDIT_ACTIONS.OPERATION_PHOTO_CAPTION_UPDATED, OPERATION_PHOTO_RESOURCE, actor, context, { operationId: photo.operationId, photoId, previousCaption: photo.caption, caption: caption || null }) });
    });
    return this.operationOrThrow(photo.operationId);
  }

  async deletePhoto(photoId: string, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    this.assertPhotoManagement(actor);
    const photo = await this.photoOrThrow(photoId);
    await this.prisma.$transaction(async (tx) => {
      await tx.operationPhoto.delete({ where: { id: photoId } });
      await this.markDocumentsChangedTx(tx, photo.operationId, actor, ['photos']);
      await tx.auditLog.create({ data: this.audit(OPERATION_AUDIT_ACTIONS.OPERATION_PHOTO_DELETED, OPERATION_PHOTO_RESOURCE, actor, context, { operationId: photo.operationId, photoId, caption: photo.caption }) });
    });
    await this.storage.delete(photo.storageKey).catch(() => undefined);
    return this.operationOrThrow(photo.operationId);
  }

  private normalizeChecklist(items?: OperationChecklistItemDto[]): Prisma.InputJsonValue {
    return (items ?? []).map((item) => ({
      label: item.label,
      done: item.done,
      note: item.note ?? null,
    }));
  }

  private operationTypes(primary: OperationType, values?: OperationType[]): OperationType[] {
    return [...new Set([primary, ...(values ?? [])])];
  }

  private equipmentTypeFromTags(tags: string[]): EquipmentType {
    for (const type of Object.values(EquipmentType)) {
      const tag = `legacy-${type.toLowerCase().replaceAll('_', '-')}`;
      if (tags.includes(tag)) return type;
    }
    return EquipmentType.OTHER;
  }

  private validateReferencePeriod(month?: number, year?: number): void {
    if ((month === undefined) !== (year === undefined)) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_REFERENCE_PERIOD_INVALID,
        'Reference month and year must be provided together',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async resolveInspectedEquipments(
    customerId: string,
    items?: Array<{
      equipmentId: string;
      sector?: string;
      systemType?: string;
      currentSituation?: string;
      manufacturer?: string;
      model?: string;
      capacity?: string;
    }>,
  ): Promise<InspectedEquipmentSnapshot[]> {
    if (!items?.length) return [];
    const uniqueIds = [...new Set(items.map((item) => item.equipmentId))];
    if (uniqueIds.length !== items.length) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
        'Inspected equipment cannot be duplicated',
        HttpStatus.BAD_REQUEST,
      );
    }
    const equipments = await this.prisma.equipment.findMany({
      where: { id: { in: uniqueIds }, customerId, isActive: true, disabledAt: null },
      select: {
        id: true,
        sector: true,
        manufacturer: true,
        model: true,
        capacity: true,
        tag: true,
        serialNumber: true,
      },
    });
    const byId = new Map(equipments.map((equipment) => [equipment.id, equipment]));
    if (byId.size !== uniqueIds.length) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
        'Every inspected equipment must be active and belong to the Operation customer',
        HttpStatus.BAD_REQUEST,
      );
    }
    return items.map((item, position) => {
      const equipment = byId.get(item.equipmentId)!;
      return {
        equipmentId: item.equipmentId,
        position,
        // O setor do relatório vem do cadastro do equipamento; o valor enviado
        // (histórico/manual) é apenas fallback quando o equipamento não tem setor.
        sector: equipment.sector?.trim() || item.sector?.trim() || 'Não informado',
        brandSnapshot: equipment.manufacturer?.trim() || item.manufacturer?.trim() || null,
        modelSnapshot: equipment.model?.trim() || item.model?.trim() || null,
        capacitySnapshot: equipment.capacity?.trim() || item.capacity?.trim() || null,
        tagSnapshot: equipment.tag,
        serialSnapshot: equipment.serialNumber,
        systemTypeSnapshot: item.systemType || null,
        currentSituationSnapshot: item.currentSituation || null,
      };
    });
  }

  private async completeMissingEquipmentProfilesTx(
    tx: Prisma.TransactionClient,
    operationId: string,
    items: CreateOperationDto['inspectedEquipments'],
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<void> {
    for (const item of items ?? []) {
      const fields = [
        ['manufacturer', item.manufacturer],
        ['model', item.model],
        ['capacity', item.capacity],
      ] as const;
      const completedFields: string[] = [];
      for (const [field, rawValue] of fields) {
        const value = rawValue?.trim();
        if (!value) continue;
        const updated = await tx.equipment.updateMany({
          where: {
            id: item.equipmentId,
            OR: [{ [field]: null }, { [field]: '' }],
          },
          data: { [field]: value },
        });
        if (updated.count === 1) completedFields.push(field);
      }
      if (completedFields.length > 0) {
        await tx.auditLog.create({
          data: this.audit(
            'EQUIPMENT_PROFILE_COMPLETED_FROM_OPERATION',
            'equipment',
            actor,
            context,
            {
              operationId,
              equipmentId: item.equipmentId,
              changedFields: completedFields,
            },
          ),
        });
      }
    }
  }

  private async validateChecklistEquipments(
    customerId: string,
    items?: Array<{ equipmentId?: string }>,
  ): Promise<void> {
    const ids = [...new Set((items ?? []).map((item) => item.equipmentId).filter(Boolean))] as string[];
    if (ids.length === 0) return;
    const count = await this.prisma.equipment.count({
      where: { id: { in: ids }, customerId, isActive: true, disabledAt: null },
    });
    if (count !== ids.length) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_EQUIPMENT_INVALID,
        'Every checklist equipment must be active and belong to the Operation customer',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private decodePhoto(input: OperationPhotoInputDto): DecodedPhoto {
    return decodeOperationPhoto(input);
  }

  private normalizeSignatureData(value?: string): string | null {
    if (!value) return null;
    const dataUrl = value.trim();
    const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
    if (!match)
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_INVALID,
        'Signature must be a PNG or JPEG data URL',
        HttpStatus.BAD_REQUEST,
      );

    const mimeType = match[1].toLowerCase();
    if (!OPERATION_SIGNATURE_MIME_TYPES.includes(mimeType as never))
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_INVALID,
        'Signature MIME type is not allowed',
        HttpStatus.BAD_REQUEST,
      );

    const base64 = match[2].replace(/\s/g, '');
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_OPERATION_SIGNATURE_SIZE_BYTES)
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_INVALID,
        'Signature is empty or exceeds the 2 MiB limit',
        HttpStatus.BAD_REQUEST,
      );
    if (!this.isValidSignatureBinary(buffer, mimeType))
      throw new ApplicationException(
        ERROR_CODES.OPERATION_PHOTO_INVALID,
        'Signature binary is invalid',
        HttpStatus.BAD_REQUEST,
      );

    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private isValidSignatureBinary(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === 'image/png') {
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === 'image/jpeg') {
      return (
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[buffer.length - 2] === 0xff &&
        buffer[buffer.length - 1] === 0xd9
      );
    }
    return false;
  }

  private async validateRelations(
    customerId: string,
    addressId?: string,
    equipmentId?: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer)
      throw new ApplicationException(
        ERROR_CODES.CUSTOMER_NOT_FOUND,
        'Customer was not found',
        HttpStatus.NOT_FOUND,
      );
    if (addressId) {
      const address = await this.prisma.customerAddress.findFirst({
        where: { id: addressId, customerId },
        select: { id: true },
      });
      if (!address)
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Address does not belong to the selected customer',
          HttpStatus.BAD_REQUEST,
        );
    }
    if (equipmentId) {
      const equipment = await this.prisma.equipment.findFirst({
        where: { id: equipmentId, customerId },
        select: { id: true },
      });
      if (!equipment)
        throw new ApplicationException(
          ERROR_CODES.VALIDATION_ERROR,
          'Equipment does not belong to the selected customer',
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  private async resolveOperatorAssignment(
    requestedOperatorId: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<OperationAssignment> {
    if (!requestedOperatorId) {
      return { operatorId: actor.id, delegated: false };
    }

    if (actor.role === Role.OPERATOR) {
      return { operatorId: actor.id, delegated: false, ignoredOperatorId: requestedOperatorId };
    }

    if (actor.role !== Role.OWNER && actor.role !== Role.MANAGER) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'Only OWNER and MANAGER users can delegate operations',
        HttpStatus.FORBIDDEN,
      );
    }

    const operator = await this.prisma.user.findUnique({
      where: { id: requestedOperatorId },
      select: { id: true, role: true, isActive: true, disabledAt: true },
    });
    if (!operator || !operator.isActive || operator.disabledAt) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_OPERATOR_INVALID,
        'Assigned operator must exist and be active',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      operator.role !== Role.OWNER &&
      operator.role !== Role.MANAGER &&
      operator.role !== Role.OPERATOR
    ) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_OPERATOR_INVALID,
        'Assigned operator must have an operational role',
        HttpStatus.BAD_REQUEST,
      );
    }

    return { operatorId: operator.id, delegated: operator.id !== actor.id };
  }

  private async operationOrThrow(id: string): Promise<unknown> {
    const operation = await this.prisma.operation.findUnique({
      where: { id },
      include: OPERATION_INCLUDE,
    });
    if (!operation)
      throw new ApplicationException(
        ERROR_CODES.OPERATION_NOT_FOUND,
        'Operation was not found',
        HttpStatus.NOT_FOUND,
      );
    const { signatureData: _privateSignature, assignments, ...safeOperation } = operation;
    const primaryAssignment = assignments?.find((item) => item.isPrimary) ?? null;
    const auxiliaryAssignments = assignments?.filter((item) => !item.isPrimary) ?? [];
    return {
      ...safeOperation,
      ...(assignments ? { assignment: primaryAssignment, auxiliaryAssignments } : {}),
      signatureCaptured: Boolean(_privateSignature),
    };
  }

  private async photoOrThrow(photoId: string): Promise<{ id: string; operationId: string; storageKey: string; caption: string | null }> {
    const photo = await this.prisma.operationPhoto.findUnique({ where: { id: photoId } });
    if (!photo) {
      throw new ApplicationException(ERROR_CODES.OPERATION_PHOTO_NOT_FOUND, 'Operation photo was not found', HttpStatus.NOT_FOUND);
    }
    return photo;
  }

  private assertPhotoManagement(actor: AuthenticatedUser): void {
    if (actor.role !== Role.OWNER && actor.role !== Role.MANAGER) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Only OWNER and MANAGER can manage historical evidence', HttpStatus.FORBIDDEN);
    }
  }

  private async markDocumentsChangedTx(
    tx: Prisma.TransactionClient,
    operationId: string,
    actor: AuthenticatedUser,
    changedFields: string[],
  ): Promise<void> {
    const affectedDocuments = await tx.operationDocument.findMany({
      where: { operationId, submittedAt: { not: null } },
      select: { id: true, renderedAt: true },
    });
    for (const document of affectedDocuments) {
      const editorialStatus = document.renderedAt ? 'STALE' : 'PENDING';
      const revisioned = await tx.operationDocument.update({
        where: { id: document.id },
        data: { editorialStatus, revision: { increment: 1 } },
        select: { revision: true },
      });
      await tx.documentRevision.create({
        data: {
          documentId: document.id,
          revision: revisioned.revision,
          action: document.renderedAt ? DocumentRevisionAction.MARKED_STALE : DocumentRevisionAction.REVIEW_UPDATED,
          origin: actor.role === Role.OPERATOR ? DocumentHandoffOrigin.OPERATOR : DocumentHandoffOrigin.PLATFORM,
          actorId: actor.id,
          changedFields,
          snapshot: { editorialStatus, operationId },
        },
      });
    }
  }

  private audit(
    action: string,
    resource: string,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
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
