import { HttpStatus, Injectable } from '@nestjs/common';
import { BrandAssetType, DocumentTemplateType, Prisma, SignatureMode } from '@prisma/client';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import { PrismaService } from '../../database/prisma.service';
import { DocumentAssetResolver } from '../assets/document-asset-resolver.service';
import {
  DocumentConfigurationService,
  type DocumentConfiguration,
  type DocumentConfigurationTemplate,
} from '../configuration/document-configuration.service';

const DOCUMENT_CONTEXT_OPERATION_INCLUDE = {
  customer: {
    include: {
      addresses: {
        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
        take: 5,
      },
      contacts: {
        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
        take: 5,
      },
    },
  },
  address: true,
  equipment: {
    include: {
      customer: { select: { id: true, name: true } },
      address: true,
      parent: { select: { id: true, name: true, tag: true } },
      children: {
        select: { id: true, name: true, tag: true, status: true },
        orderBy: { name: 'asc' as const },
      },
      metrics: { orderBy: { recordedAt: 'desc' as const }, take: 12 },
      attachments: { orderBy: { createdAt: 'desc' as const }, take: 12 },
    },
  },
  operator: { select: { id: true, name: true, email: true, username: true, jobTitle: true } },
  assignments: {
    where: { isPrimary: true },
    include: {
      assigner: { select: { id: true, name: true, username: true, jobTitle: true } },
      assignee: { select: { id: true, name: true, username: true, jobTitle: true } },
      history: {
        orderBy: { createdAt: 'asc' as const },
        take: 20,
        include: { actor: { select: { id: true, name: true, username: true, jobTitle: true } } },
      },
    },
  },
  maintenanceExecution: {
    include: {
      plan: {
        include: {
          pmocPlan: {
            include: {
              signatureOverride: {
                select: {
                  id: true,
                  name: true,
                  title: true,
                  professionalCouncil: true,
                  department: true,
                  imageStorageKey: true,
                  mimeType: true,
                  fileSize: true,
                  active: true,
                  deletedAt: true,
                },
              },
              environments: {
                orderBy: { name: 'asc' as const },
                take: 20,
                include: {
                  equipments: {
                    include: {
                      equipment: {
                        select: { id: true, name: true, tag: true, type: true, status: true },
                      },
                    },
                  },
                },
              },
              equipments: {
                include: {
                  equipment: {
                    select: { id: true, name: true, tag: true, type: true, status: true },
                  },
                },
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
      executionNumber: true,
    },
  },
  // Numeração do relatório PMOC segue a ordem da execução POR EQUIPAMENTO
  // (equipmentExecutionNumber) — nunca o contador global de operações. Ambas as
  // relações apontam para a mesma execução; a primeira presente é usada.
  pmocExecutionRequest: {
    select: { equipmentExecutionNumber: true, executionNumber: true },
  },
  generatedPmocExecutionRequest: {
    select: { equipmentExecutionNumber: true, executionNumber: true },
  },
  parts: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          brand: true,
          model: true,
          category: true,
        },
      },
      inventoryItem: { select: { id: true, location: true } },
    },
  },
  photos: { orderBy: { createdAt: 'asc' as const } },
  cancellations: {
    orderBy: { requestedAt: 'desc' as const },
    take: 1,
    include: {
      requestedBy: { select: { id: true, name: true, username: true, jobTitle: true } },
      resolvedBy: { select: { id: true, name: true, username: true, jobTitle: true } },
      technicalSignature: true,
      photos: { orderBy: { createdAt: 'asc' as const } },
    },
  },
  documents: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      technicalSignature: {
        select: {
          id: true,
          name: true,
          title: true,
          profession: true,
          professionalCouncil: true,
          registrationNumber: true,
          department: true,
          imageStorageKey: true,
          mimeType: true,
          fileSize: true,
          active: true,
          deletedAt: true,
        },
      },
    },
  },
  maintenanceChecklistItems: {
    orderBy: [{ maintenanceType: 'asc' as const }, { position: 'asc' as const }],
    include: { equipment: { select: { id: true, name: true, tag: true } } },
  },
  inspectedEquipments: {
    orderBy: { position: 'asc' as const },
    include: { equipment: { select: { id: true, name: true, type: true } } },
  },
} satisfies Prisma.OperationInclude;

const DOCUMENT_CONTEXT_BUDGET_INCLUDE = {
  customer: {
    include: {
      addresses: {
        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
        take: 5,
      },
      contacts: {
        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
        take: 5,
      },
    },
  },
  customerAddress: true,
  equipment: {
    include: {
      customer: { select: { id: true, name: true } },
      address: true,
      parent: { select: { id: true, name: true, tag: true } },
      children: {
        select: { id: true, name: true, tag: true, status: true },
        orderBy: { name: 'asc' as const },
      },
      metrics: { orderBy: { recordedAt: 'desc' as const }, take: 12 },
      attachments: { orderBy: { createdAt: 'desc' as const }, take: 12 },
    },
  },
  equipments: {
    include: {
      equipment: {
        select: { id: true, name: true, tag: true, type: true, manufacturer: true, model: true, capacity: true, serialNumber: true, qrCode: true },
      },
    },
    orderBy: { position: 'asc' as const },
  },
  operation: { select: { id: true, number: true, type: true, status: true, equipmentId: true } },
  creator: { select: { id: true, name: true, email: true, username: true, jobTitle: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          brand: true,
          model: true,
          category: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  document: {
    include: {
      technicalSignature: {
        select: {
          id: true,
          name: true,
          title: true,
          profession: true,
          professionalCouncil: true,
          registrationNumber: true,
          department: true,
          imageStorageKey: true,
          mimeType: true,
          fileSize: true,
        },
      },
    },
  },
} satisfies Prisma.BudgetInclude;

export type DocumentContextOperation = Prisma.OperationGetPayload<{
  include: typeof DOCUMENT_CONTEXT_OPERATION_INCLUDE;
}>;

export type DocumentContextBudget = Prisma.BudgetGetPayload<{
  include: typeof DOCUMENT_CONTEXT_BUDGET_INCLUDE;
}>;

export interface ResolvedDocumentAsset {
  storageKey: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface DocumentSignatureContext {
  requiresSignature: boolean;
  signatureMode: SignatureMode;
  signatureId: string | null;
  fixedSignature: {
    id: string;
    name: string;
    title: string;
    image: ResolvedDocumentAsset;
  } | null;
  institutionalSignatures: Array<{
    id: string;
    name: string;
    title: string;
    profession: string | null;
    professionalCouncil: string | null;
    registrationNumber: string | null;
    department: string | null;
    image: ResolvedDocumentAsset;
  }>;
  collectedSignature: {
    label: string;
    name: string | null;
    title: string | null;
    signedAt: string | null;
    caption: string | null;
    image: ResolvedDocumentAsset | null;
  } | null;
  executionSignatures: Array<{
    role: 'client' | 'technician' | 'operator';
    label: string;
    name: string | null;
    title: string | null;
    signedAt: string | null;
    caption: string | null;
    image: ResolvedDocumentAsset | null;
  }>;
}

export interface DocumentContext {
  kind: 'operation';
  operation: DocumentContextOperation;
  configuration: DocumentConfiguration;
  template: DocumentConfigurationTemplate | null;
  signature: DocumentSignatureContext;
  assets: {
    signature: ResolvedDocumentAsset | null;
    logo: ResolvedDocumentAsset | null;
    watermark: ResolvedDocumentAsset | null;
    qrCode: ResolvedDocumentAsset | null;
    images: ResolvedDocumentAsset[];
  };
}

export interface TemplatePreviewContext {
  kind: 'templatePreview';
  configuration: DocumentConfiguration;
  template: DocumentConfigurationTemplate;
  signature: DocumentSignatureContext;
  placeholders: {
    documentNumber: string;
    generatedAt: string;
    customerName: string;
    equipmentName: string;
    operatorName: string;
  };
  assets: {
    signature: ResolvedDocumentAsset | null;
    logo: ResolvedDocumentAsset | null;
    watermark: ResolvedDocumentAsset | null;
    qrCode: ResolvedDocumentAsset | null;
    images: ResolvedDocumentAsset[];
  };
}

export interface BudgetContext {
  kind: 'budget';
  budget: DocumentContextBudget;
  configuration: DocumentConfiguration;
  template: DocumentConfigurationTemplate | null;
  signature: DocumentSignatureContext;
  assets: {
    signature: ResolvedDocumentAsset | null;
    logo: ResolvedDocumentAsset | null;
    watermark: ResolvedDocumentAsset | null;
    qrCode: ResolvedDocumentAsset | null;
    images: ResolvedDocumentAsset[];
  };
}

export type DocumentBuildContext = DocumentContext | TemplatePreviewContext | BudgetContext;

@Injectable()
export class DocumentContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: DocumentConfigurationService,
    private readonly assets: DocumentAssetResolver,
  ) {}

  async create(operationId: string, type: DocumentTemplateType): Promise<DocumentContext> {
    const [operation, configuration] = await Promise.all([
      this.prisma.operation.findUnique({
        where: { id: operationId },
        include: DOCUMENT_CONTEXT_OPERATION_INCLUDE,
      }),
      this.configuration.getConfigurationForType(type),
    ]);

    if (!operation) {
      throw new ApplicationException(
        ERROR_CODES.OPERATION_NOT_FOUND,
        'Operation was not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const template = configuration.defaultTemplate;
    const handoff = operation.documents.find((document) => document.type === type) ?? null;
    const signature = await this.resolveSignature(
      template,
      operation,
      type === DocumentTemplateType.PMOC
        ? operation.maintenanceExecution?.plan.pmocPlan?.signatureOverride
        : null,
      handoff,
    );
    const cancellation = operation.cancellations?.[0] ?? null;
    const cancellationDocument = cancellation?.status === 'REQUESTED' || cancellation?.status === 'APPROVED';
    // Evidências de uma tentativa cancelada nunca vazam para uma execução
    // posteriormente reagendada. O mesmo Context alimenta Preview e PDF.
    operation.photos = operation.photos.filter((photo) =>
      cancellationDocument ? photo.cancellationId === cancellation.id : (photo.cancellationId ?? null) === null,
    );
    const usesOperationPhotos = true;
    const usesEquipmentQr =
      type !== DocumentTemplateType.TECHNICAL_REPORT &&
      type !== DocumentTemplateType.TECHNICAL_OPINION &&
      type !== DocumentTemplateType.WORK_ORDER;
    const [images, logo, qrCode] = await Promise.all([
      usesOperationPhotos
        ? Promise.all(
            operation.photos.map((photo) =>
              this.assets.resolveDocumentImage(photo.storageKey, {
                mimeType: photo.mimeType,
                fileSize: photo.fileSize,
              }),
            ),
          )
        : Promise.resolve([]),
      this.resolveLatestBrandAsset(configuration.organization.id, BrandAssetType.LOGO),
      usesEquipmentQr && operation.equipment?.qrCode
        ? this.assets.generateQrCode(operation.equipment.qrCode)
        : Promise.resolve(null),
    ]);

    return {
      kind: 'operation',
      operation,
      configuration,
      template,
      signature,
      assets: {
        signature: signature.fixedSignature?.image ?? null,
        logo,
        watermark: null,
        qrCode,
        images,
      },
    };
  }

  async buildTemplatePreviewContext(templateId: string): Promise<TemplatePreviewContext> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id: templateId },
      select: {
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
        createdAt: true,
        updatedAt: true,
        signature: {
          select: {
            id: true,
            name: true,
            title: true,
            imageStorageKey: true,
            mimeType: true,
            fileSize: true,
            active: true,
            professionalCouncil: true,
            department: true,
          },
        },
        institutionalSignatures: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            signature: {
              select: {
                id: true,
                name: true,
                title: true,
                professionalCouncil: true,
                department: true,
                imageStorageKey: true,
                mimeType: true,
                fileSize: true,
                active: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (!template) {
      throw new ApplicationException(
        ERROR_CODES.TEMPLATE_NOT_FOUND,
        'Document template was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!template.isActive) {
      throw new ApplicationException(
        ERROR_CODES.TEMPLATE_INACTIVE,
        'Document template is inactive and cannot be previewed',
        HttpStatus.CONFLICT,
      );
    }

    const [configuration, logo] = await Promise.all([
      this.configuration.getConfigurationForType(template.type),
      this.resolveLatestBrandAsset(template.organizationId, BrandAssetType.LOGO),
    ]);
    const signature = await this.resolveSignature(template, null);

    return {
      kind: 'templatePreview',
      configuration: {
        ...configuration,
        defaultTemplate: template,
      },
      template,
      signature,
      placeholders: {
        documentNumber: `MODELO-${template.type}`,
        generatedAt: new Date().toISOString(),
        customerName: 'Cliente',
        equipmentName: 'Equipamento',
        operatorName: 'Operador',
      },
      assets: {
        signature: signature.fixedSignature?.image ?? null,
        logo,
        watermark: null,
        qrCode: null,
        images: [],
      },
    };
  }

  async buildBudgetContext(budgetId: string): Promise<BudgetContext> {
    const [budget, configuration] = await Promise.all([
      this.prisma.budget.findUnique({
        where: { id: budgetId },
        include: DOCUMENT_CONTEXT_BUDGET_INCLUDE,
      }),
      this.configuration.getConfigurationForType(DocumentTemplateType.BUDGET),
    ]);

    if (!budget) {
      throw new ApplicationException(
        ERROR_CODES.BUDGET_NOT_FOUND,
        'Budget was not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const template = configuration.defaultTemplate;
    const signature = budget.document
      ? await this.resolveBudgetHandoffSignatures(
          budget.document,
          budget.customer?.tradeName?.trim() || budget.customer?.name?.trim() || null,
        )
      : await this.resolveSignature(template, null);
    const logo = await this.resolveLatestBrandAsset(
      configuration.organization.id,
      BrandAssetType.LOGO,
    );

    return {
      kind: 'budget',
      budget,
      configuration,
      template,
      signature,
      assets: {
        signature: signature.fixedSignature?.image ?? null,
        logo,
        watermark: null,
        qrCode: null,
        images: [],
      },
    };
  }

  private async resolveSignature(
    template: DocumentConfigurationTemplate | null,
    operation: DocumentContextOperation | null,
    institutionalOverride: {
      id: string;
      name: string;
      title: string;
      professionalCouncil: string | null;
      department: string | null;
      imageStorageKey: string | null;
      mimeType: string | null;
      fileSize: number | null;
      active: boolean;
      deletedAt: Date | null;
    } | null = null,
    handoff: DocumentContextOperation['documents'][number] | null = null,
  ): Promise<DocumentSignatureContext> {
    if (
      operation &&
      handoff &&
      (handoff.submittedAt || handoff.technicalSignatureId || handoff.technicalSignatureSnapshot)
    ) {
      return this.resolveHandoffSignatures(operation, handoff);
    }
    const mode = template?.signatureMode ?? SignatureMode.NONE;
    const executionSignature = this.resolveExecutionSignature(operation);
    const acceptsExecutionSignatures =
      mode === SignatureMode.COLLECTED || mode === SignatureMode.HYBRID;
    const hideUnsignedRvtClient =
      template?.type === DocumentTemplateType.TECHNICAL_REPORT && !executionSignature;
    const clientEnabled = Boolean(
      acceptsExecutionSignatures &&
      !hideUnsignedRvtClient &&
      (template?.executionSignatureClient ||
        mode === SignatureMode.COLLECTED ||
        mode === SignatureMode.HYBRID),
    );
    const executionSignatures: DocumentSignatureContext['executionSignatures'] = [
      ...(clientEnabled
        ? [
            {
              role: 'client' as const,
              label: 'Assinatura do cliente/responsável',
              name: operation?.customerSignerName ?? null,
              title: this.composeClientSignerTitle(operation?.customerSignerRole, this.operationCompanyName(operation)),
              signedAt: operation?.signedAt?.toISOString() ?? null,
              caption: executionSignature
                ? 'Assinatura coletada na execução'
                : 'Espaço reservado para assinatura do cliente',
              image: executionSignature?.image ?? null,
            },
          ]
        : []),
      ...(acceptsExecutionSignatures && template?.executionSignatureTechnician
        ? [
            {
              role: 'technician' as const,
              label: 'Assinatura do técnico',
              name: operation?.operator?.name ?? null,
              title: operation?.operator?.jobTitle ?? null,
              signedAt: null,
              caption: 'Espaço reservado para assinatura do técnico',
              image: null,
            },
          ]
        : []),
      ...(acceptsExecutionSignatures && template?.executionSignatureOperator
        ? [
            {
              role: 'operator' as const,
              label: 'Assinatura do operador',
              name: operation?.operator?.name ?? null,
              title: operation?.operator?.jobTitle ?? null,
              signedAt: null,
              caption: 'Espaço reservado para assinatura do operador',
              image: null,
            },
          ]
        : []),
    ];
    const executionSignatureApplies = executionSignatures.length > 0;
    const effectiveMode = mode;
    const requiresSignature = Boolean(
      (template?.requiresSignature && effectiveMode !== SignatureMode.NONE) ||
      executionSignatureApplies,
    );
    const collectedSignature =
      clientEnabled &&
      (effectiveMode === SignatureMode.COLLECTED || effectiveMode === SignatureMode.HYBRID)
        ? {
            label: 'Assinatura do cliente/responsável',
            name: operation?.customerSignerName ?? null,
            title: this.composeClientSignerTitle(operation?.customerSignerRole, this.operationCompanyName(operation)),
            signedAt: operation?.signedAt?.toISOString() ?? null,
            caption: executionSignature
              ? 'Assinatura coletada na execução'
              : 'Espaço reservado para assinatura coletada',
            image: executionSignature?.image ?? null,
          }
        : null;

    if (!requiresSignature || effectiveMode === SignatureMode.NONE) {
      return {
        requiresSignature: false,
        signatureMode: SignatureMode.NONE,
        signatureId: null,
        fixedSignature: null,
        institutionalSignatures: [],
        collectedSignature: null,
        executionSignatures: [],
      };
    }

    if (effectiveMode === SignatureMode.COLLECTED) {
      return {
        requiresSignature,
        signatureMode: effectiveMode,
        signatureId: null,
        fixedSignature: null,
        institutionalSignatures: [],
        collectedSignature,
        executionSignatures,
      };
    }

    const configured = institutionalOverride
      ? [institutionalOverride].filter((signature) => signature.active && !signature.deletedAt)
      : (template?.institutionalSignatures
          ?.map((link) => link.signature)
          .filter((signature) => signature.active && !signature.deletedAt) ?? []);
    const signatures =
      configured.length > 0 ? configured : template?.signature ? [template.signature] : [];
    if (signatures.length === 0) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_NOT_FOUND,
        'Document template requires a fixed signature, but no active signature is configured',
        HttpStatus.CONFLICT,
      );
    }
    if (signatures.some((signature) => !signature.active)) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_INACTIVE,
        'Configured signature is inactive',
        HttpStatus.CONFLICT,
      );
    }
    if (
      signatures.some(
        (signature) => !signature.imageStorageKey || !signature.mimeType || !signature.fileSize,
      )
    ) {
      throw new ApplicationException(
        ERROR_CODES.SIGNATURE_IMAGE_REQUIRED,
        'Configured signature image was not uploaded',
        HttpStatus.CONFLICT,
      );
    }

    const institutionalSignatures = await Promise.all(
      signatures.map(async (signature) => ({
        id: signature.id,
        name: signature.name,
        title: signature.title,
        profession: null,
        professionalCouncil: signature.professionalCouncil ?? null,
        registrationNumber: null,
        department: signature.department ?? null,
        image: await this.assets.resolveSignature(signature.imageStorageKey!, {
          mimeType: signature.mimeType!,
          fileSize: signature.fileSize!,
        }),
      })),
    );
    const first = institutionalSignatures[0];

    return {
      requiresSignature,
      signatureMode: effectiveMode,
      signatureId: first.id,
      fixedSignature: {
        id: first.id,
        name: first.name,
        title: first.title,
        image: first.image,
      },
      institutionalSignatures,
      collectedSignature,
      executionSignatures,
    };
  }

  /** Nome comercial (ou razão social) do cliente da operação. */
  private operationCompanyName(operation: DocumentContextOperation | null): string | null {
    const customer = operation?.customer;
    if (!customer) return null;
    return customer.tradeName?.trim() || customer.name?.trim() || null;
  }

  /**
   * Rótulo do signatário do cliente no relatório: cargo/função ao lado do nome
   * do cliente/empresa. Ex.: "Gerente | Empresa X". Omite as partes vazias.
   */
  private composeClientSignerTitle(
    role: string | null | undefined,
    companyName: string | null | undefined,
  ): string | null {
    const parts = [role?.trim() || null, companyName?.trim() || null].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length > 0 ? parts.join(' | ') : null;
  }

  private async resolveHandoffSignatures(
    operation: DocumentContextOperation,
    handoff: DocumentContextOperation['documents'][number],
  ): Promise<DocumentSignatureContext> {
    // Modelos exibem cliente (esq.) + responsável técnico (dir.) ao final, exceto:
    // Recibo (RECEIPT) e Laudo Técnico (TECHNICAL_OPINION) — só institucional; e
    // **PMOC** — decisão do owner: só o responsável técnico, sem assinatura do
    // cliente (nem no preview nem no PDF). Quando o owner oculta a assinatura do
    // cliente num documento específico, o bloco do cliente também some.
    const customer = this.signatureSnapshot(handoff.customerSignatureSnapshot);
    const executionSignature = this.resolveExecutionSignature(operation);
    const customerSigned = Boolean(customer || executionSignature);
    const customerRequired =
      !handoff.customerSignatureHidden &&
      ([
        DocumentTemplateType.WORK_ORDER,
        DocumentTemplateType.TECHNICAL_REPORT,
        DocumentTemplateType.BUDGET,
        DocumentTemplateType.REPORT,
        DocumentTemplateType.QUOTE,
      ] as DocumentTemplateType[]).includes(handoff.type) &&
      (handoff.type !== DocumentTemplateType.TECHNICAL_REPORT || customerSigned);
    const technical = this.signatureSnapshot(handoff.technicalSignatureSnapshot);
    const collectedImage = customer
      ? await this.assets.resolveSignature(customer.storageKey, {
          mimeType: customer.mimeType,
          fileSize: customer.fileSize,
        })
      : executionSignature?.image ?? null;
    const technicalSource = technical ??
      (handoff.technicalSignature?.imageStorageKey && handoff.technicalSignature.mimeType && handoff.technicalSignature.fileSize
        ? {
            id: handoff.technicalSignature.id,
            name: handoff.technicalSignature.name,
            title: handoff.technicalSignature.title,
            profession: handoff.technicalSignature.profession,
            professionalCouncil: handoff.technicalSignature.professionalCouncil,
            registrationNumber: handoff.technicalSignature.registrationNumber,
            department: handoff.technicalSignature.department,
            storageKey: handoff.technicalSignature.imageStorageKey,
            mimeType: handoff.technicalSignature.mimeType,
            fileSize: handoff.technicalSignature.fileSize,
          }
        : null);
    const institutional = technicalSource
      ? [{
          id: technicalSource.id ?? handoff.technicalSignatureId ?? `snapshot:${handoff.id}`,
          name: technicalSource.name,
          title: technicalSource.title ?? '',
          profession: technicalSource.profession ?? null,
          professionalCouncil: technicalSource.professionalCouncil ?? null,
          registrationNumber: technicalSource.registrationNumber ?? null,
          department: technicalSource.department ?? null,
          image: await this.assets.resolveSignature(technicalSource.storageKey, {
            mimeType: technicalSource.mimeType,
            fileSize: technicalSource.fileSize,
          }),
        }]
      : [];
    const collected = customerRequired
      ? {
          label: 'Assinatura do cliente/responsável',
          name: customer?.name ?? operation.customerSignerName ?? null,
          title: this.composeClientSignerTitle(customer?.title ?? operation.customerSignerRole, this.operationCompanyName(operation)),
          signedAt: customer?.collectedAt ?? operation.signedAt?.toISOString() ?? null,
          caption: collectedImage ? 'Assinatura coletada na execução' : 'Assinatura do cliente pendente',
          image: collectedImage,
        }
      : null;
    const mode = customerRequired ? SignatureMode.HYBRID : SignatureMode.FIXED;
    return {
      requiresSignature: true,
      signatureMode: mode,
      signatureId: institutional[0]?.id ?? null,
      fixedSignature: institutional[0]
        ? { id: institutional[0].id, name: institutional[0].name, title: institutional[0].title, image: institutional[0].image }
        : null,
      institutionalSignatures: institutional,
      collectedSignature: collected,
      executionSignatures: collected
        ? [{ role: 'client', label: collected.label, name: collected.name, title: collected.title, signedAt: collected.signedAt, caption: collected.caption, image: collected.image }]
        : [],
    };
  }

  private async resolveBudgetHandoffSignatures(
    handoff: NonNullable<DocumentContextBudget['document']>,
    companyName: string | null = null,
  ): Promise<DocumentSignatureContext> {
    const customer = this.signatureSnapshot(handoff.customerSignatureSnapshot);
    const technical = this.signatureSnapshot(handoff.technicalSignatureSnapshot);
    const collectedImage = customer
      ? await this.assets.resolveSignature(customer.storageKey, {
          mimeType: customer.mimeType,
          fileSize: customer.fileSize,
        })
      : null;
    const technicalSource =
      technical ??
      (handoff.technicalSignature?.imageStorageKey &&
      handoff.technicalSignature.mimeType &&
      handoff.technicalSignature.fileSize
        ? {
            id: handoff.technicalSignature.id,
            name: handoff.technicalSignature.name,
            title: handoff.technicalSignature.title,
            profession: handoff.technicalSignature.profession,
            professionalCouncil: handoff.technicalSignature.professionalCouncil,
            registrationNumber: handoff.technicalSignature.registrationNumber,
            department: handoff.technicalSignature.department,
            storageKey: handoff.technicalSignature.imageStorageKey,
            mimeType: handoff.technicalSignature.mimeType,
            fileSize: handoff.technicalSignature.fileSize,
          }
        : null);
    const institutional = technicalSource
      ? [
          {
            id: technicalSource.id ?? handoff.technicalSignatureId ?? `snapshot:${handoff.id}`,
            name: technicalSource.name,
            title: technicalSource.title ?? '',
            profession: technicalSource.profession ?? null,
            professionalCouncil: technicalSource.professionalCouncil ?? null,
            registrationNumber: technicalSource.registrationNumber ?? null,
            department: technicalSource.department ?? null,
            image: await this.assets.resolveSignature(technicalSource.storageKey, {
              mimeType: technicalSource.mimeType,
              fileSize: technicalSource.fileSize,
            }),
          },
        ]
      : [];
    const collected = {
      label: 'Assinatura do cliente/responsável',
      name: customer?.name ?? null,
      title: this.composeClientSignerTitle(customer?.title, companyName),
      signedAt: customer?.collectedAt ?? null,
      caption: collectedImage ? 'Assinatura do cliente' : 'Assinatura do cliente pendente',
      image: collectedImage,
    };
    return {
      requiresSignature: true,
      signatureMode: SignatureMode.HYBRID,
      signatureId: institutional[0]?.id ?? null,
      fixedSignature: institutional[0]
        ? {
            id: institutional[0].id,
            name: institutional[0].name,
            title: institutional[0].title,
            image: institutional[0].image,
          }
        : null,
      institutionalSignatures: institutional,
      collectedSignature: collected,
      executionSignatures: [
        {
          role: 'client',
          label: collected.label,
          name: collected.name,
          title: collected.title,
          signedAt: collected.signedAt,
          caption: collected.caption,
          image: collected.image,
        },
      ],
    };
  }

  private signatureSnapshot(value: Prisma.JsonValue | null): {
    id?: string;
    name: string;
    title?: string | null;
    profession?: string | null;
    professionalCouncil?: string | null;
    registrationNumber?: string | null;
    department?: string | null;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    collectedAt?: string;
  } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, Prisma.JsonValue>;
    if (typeof item.name !== 'string' || typeof item.storageKey !== 'string' || typeof item.mimeType !== 'string' || typeof item.fileSize !== 'number') return null;
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      name: item.name,
      title: typeof item.title === 'string' ? item.title : null,
      profession: typeof item.profession === 'string' ? item.profession : null,
      professionalCouncil: typeof item.professionalCouncil === 'string' ? item.professionalCouncil : null,
      registrationNumber: typeof item.registrationNumber === 'string' ? item.registrationNumber : null,
      department: typeof item.department === 'string' ? item.department : null,
      storageKey: item.storageKey,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      collectedAt: typeof item.collectedAt === 'string' ? item.collectedAt : undefined,
    };
  }

  private resolveExecutionSignature(
    operation: DocumentContextOperation | null,
  ): { image: ResolvedDocumentAsset } | null {
    if (!operation?.signatureData) return null;

    const dataUrl = operation.signatureData.trim();
    const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
    if (!match) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'Execution signature must be a PNG or JPEG data URL',
        HttpStatus.CONFLICT,
      );
    }

    const mimeType = match[1].toLowerCase();
    const base64 = match[2].replace(/\s/g, '');
    const buffer = Buffer.from(base64, 'base64');
    if (!this.isValidSignatureBinary(buffer, mimeType)) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'Execution signature binary is invalid',
        HttpStatus.CONFLICT,
      );
    }

    return {
      image: {
        storageKey: `operation-signature:${operation.id}`,
        mimeType,
        fileSize: buffer.length,
        contentBase64: buffer.toString('base64'),
      },
    };
  }

  private isValidSignatureBinary(buffer: Buffer, mimeType: string): boolean {
    if (buffer.length === 0 || buffer.length > 2_000_000) return false;
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

  private async resolveLatestBrandAsset(
    organizationId: string,
    type: BrandAssetType,
  ): Promise<ResolvedDocumentAsset | null> {
    const asset = await this.prisma.brandAsset.findFirst({
      where: { organizationId, type },
      orderBy: { createdAt: 'desc' },
      select: { storageKey: true, mimeType: true, fileSize: true },
    });
    if (!asset) return null;
    return this.assets.resolveLogo(asset.storageKey, {
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
    });
  }
}
