import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BudgetStatus,
  DocumentTemplateType,
  OperationMaintenanceType,
  OperationStatus,
  Prisma,
  SignatureMode,
} from '@prisma/client';
import {
  DOCUMENT_MAX_COMPONENTS,
  DOCUMENT_MAX_SECTIONS,
  DOCUMENT_MAX_TABLE_ROWS,
} from '../../../shared/constants/document-engine.constants';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import {
  formatDocumentNumber,
  OPERATION_DOCUMENT_PREFIX,
} from '../../../shared/constants/operations.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type {
  DocumentBlueprint,
  DocumentBlueprintComponent,
  DocumentSection,
  DocumentVisualStyle,
} from '../blueprint/document-blueprint.types';
import {
  DocumentContextService,
  type BudgetContext,
  type DocumentBuildContext,
  type DocumentContext,
  type DocumentContextOperation,
  type TemplatePreviewContext,
} from '../context/document-context.service';

type ChecklistItem = { label: string; done: boolean; note: string | null };
type BuilderOrganization = DocumentContext['configuration']['organization'];
type BuilderLogo = DocumentContext['assets']['logo'];

const OPERATION_STATUS_LABEL: Record<OperationStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  REVIEW: 'Em revisão',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
};

const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  EXPIRED: 'Expirado',
  CANCELED: 'Cancelado',
};

@Injectable()
export class DocumentBuilderService {
  constructor(private readonly context: DocumentContextService) {}

  async buildFromOperation(
    operationId: string,
    type: DocumentTemplateType,
  ): Promise<DocumentBlueprint> {
    const context = await this.context.create(operationId, type);
    return this.buildFromContext(context);
  }

  async buildFromTemplate(templateId: string): Promise<DocumentBlueprint> {
    const context = await this.context.buildTemplatePreviewContext(templateId);
    return this.buildFromContext(context);
  }

  async buildBudget(budgetId: string): Promise<DocumentBlueprint> {
    const context = await this.context.buildBudgetContext(budgetId);
    return this.buildFromContext(context);
  }

  private buildFromContext(context: DocumentBuildContext): DocumentBlueprint {
    if (context.kind === 'templatePreview') {
      return this.buildTemplatePreviewBlueprint(context);
    }
    if (context.kind === 'budget') {
      return this.buildBudgetBlueprint(context);
    }
    return this.buildOperationBlueprint(context);
  }

  private buildOperationBlueprint(context: DocumentContext): DocumentBlueprint {
    const { operation, configuration } = context;
    const { organization, settings } = configuration;
    const { type } = configuration;

    const document = operation.documents.find((item) => item.type === type) ?? {
      id: null,
      number: formatDocumentNumber(OPERATION_DOCUMENT_PREFIX[type], operation.number),
    };

    // Número exibido no documento. Para o PMOC, segue a ordem da execução POR
    // EQUIPAMENTO (PMOC-001, PMOC-002, ...), reiniciando a cada equipamento e
    // nunca reaproveitando o contador global de operações/OS. Calculado a cada
    // render (resiliente a regeneração); a identidade persistida permanece em
    // `document.number`.
    const displayNumber =
      type === DocumentTemplateType.PMOC
        ? this.pmocDisplayNumber(operation, document.number)
        : document.number;

    const generatedAt = new Date().toISOString();
    const sections = this.sections(context, generatedAt, displayNumber);
    this.assertBlueprintLimits(sections);

    return {
      version: '1.0',
      metadata: {
        operationId: operation.id,
        documentId: document.id,
        documentType: type,
        documentNumber: document.number,
        sourceKind: 'operation',
        sourceId: operation.id,
        templateId: context.template?.id ?? null,
        templateUpdatedAt: context.template?.updatedAt
          ? new Date(context.template.updatedAt).toISOString()
          : null,
        generatedAt,
        locale: 'pt-BR',
        timezone: settings.timezone,
        currency: settings.currency,
        organization: {
          legalName: this.clean(organization.legalName),
          tradeName: this.clean(organization.tradeName),
          cnpj: this.clean(organization.cnpj),
          stateRegistration: this.clean(organization.stateRegistration ?? ''),
          email: this.clean(organization.email),
          phone: this.clean(organization.phone),
          phoneNumbers: this.organizationPhones(organization),
          website: this.clean(organization.website ?? ''),
          address: this.organizationAddress(organization),
          zipCode: this.clean(organization.zipCode ?? ''),
          city: this.clean(organization.city),
          state: this.clean(organization.state),
          primaryColor: organization.primaryColor,
          secondaryColor: organization.secondaryColor,
        },
      },
      header: this.documentHeader(
        organization,
        context.assets.logo,
        this.titleFor(type),
        displayNumber,
        `Operação ${String(operation.number).padStart(6, '0')}`,
      ),
      footer: {
        content: this.clean(
          type === DocumentTemplateType.RECEIPT
            ? ''
            : type === DocumentTemplateType.PMOC
            ? `${organization.tradeName || organization.legalName} · ${organization.phone} · ${organization.email} · ${displayNumber} · Versão documental 1 · Emissão ${this.date(generatedAt)}`
            : context.template?.footerContent ||
                `${organization.tradeName || organization.legalName} · ${displayNumber}`,
        ),
        generatedAt,
      },
      visualStyle: this.visualStyle(organization.primaryColor),
      sections,
    };
  }

  private buildTemplatePreviewBlueprint(context: TemplatePreviewContext): DocumentBlueprint {
    const { configuration, template, placeholders } = context;
    const { organization, settings } = configuration;
    const generatedAt = placeholders.generatedAt;
    const sections = this.templatePreviewSections(context);
    this.assertBlueprintLimits(sections);

    return {
      version: '1.0',
      metadata: {
        operationId: null,
        documentId: null,
        documentType: template.type,
        documentNumber: placeholders.documentNumber,
        sourceKind: 'template',
        sourceId: template.id,
        templateId: template.id,
        templateUpdatedAt: new Date(template.updatedAt).toISOString(),
        generatedAt,
        locale: 'pt-BR',
        timezone: settings.timezone,
        currency: settings.currency,
        organization: {
          legalName: this.clean(organization.legalName),
          tradeName: this.clean(organization.tradeName),
          cnpj: this.clean(organization.cnpj),
          stateRegistration: this.clean(organization.stateRegistration ?? ''),
          email: this.clean(organization.email),
          phone: this.clean(organization.phone),
          phoneNumbers: this.organizationPhones(organization),
          website: this.clean(organization.website ?? ''),
          address: this.organizationAddress(organization),
          zipCode: this.clean(organization.zipCode ?? ''),
          city: this.clean(organization.city),
          state: this.clean(organization.state),
          primaryColor: organization.primaryColor,
          secondaryColor: organization.secondaryColor,
        },
      },
      header: this.documentHeader(
        organization,
        context.assets.logo,
        this.clean(template.name || this.titleFor(template.type)),
        placeholders.documentNumber,
        'Pré-visualização de modelo',
      ),
      footer: {
        content: this.clean(
          template.footerContent || `Modelo gerado por ${organization.tradeName}`,
        ),
        generatedAt,
      },
      visualStyle: this.visualStyle(organization.primaryColor),
      sections,
    };
  }

  private buildBudgetBlueprint(context: BudgetContext): DocumentBlueprint {
    const { budget, configuration } = context;
    const { organization, settings } = configuration;
    const generatedAt = new Date().toISOString();
    const number = budget.document?.number ?? `ORC-${String(budget.number).padStart(6, '0')}`;
    const sections = this.budgetSections(context);
    this.assertBlueprintLimits(sections);

    return {
      version: '1.0',
      metadata: {
        operationId: budget.operationId,
        budgetId: budget.id,
        documentId: budget.document?.id ?? null,
        documentType: DocumentTemplateType.BUDGET,
        documentNumber: number,
        sourceKind: 'budget',
        sourceId: budget.id,
        templateId: context.template?.id ?? null,
        templateUpdatedAt: context.template?.updatedAt
          ? new Date(context.template.updatedAt).toISOString()
          : null,
        generatedAt,
        locale: 'pt-BR',
        timezone: settings.timezone,
        currency: settings.currency,
        organization: {
          legalName: this.clean(organization.legalName),
          tradeName: this.clean(organization.tradeName),
          cnpj: this.clean(organization.cnpj),
          stateRegistration: this.clean(organization.stateRegistration ?? ''),
          email: this.clean(organization.email),
          phone: this.clean(organization.phone),
          phoneNumbers: this.organizationPhones(organization),
          website: this.clean(organization.website ?? ''),
          address: this.organizationAddress(organization),
          zipCode: this.clean(organization.zipCode ?? ''),
          city: this.clean(organization.city),
          state: this.clean(organization.state),
          primaryColor: organization.primaryColor,
          secondaryColor: organization.secondaryColor,
        },
      },
      header: this.documentHeader(
        organization,
        context.assets.logo,
        'Orçamento',
        number,
        budget.operation
          ? `Operação ${String(budget.operation.number).padStart(6, '0')}`
          : budget.title,
      ),
      footer: {
        content: this.clean(
          context.template?.footerContent ||
            `Gerado por ${organization.tradeName} · ${organization.email}`,
        ),
        generatedAt,
      },
      visualStyle: this.visualStyle(organization.primaryColor),
      sections,
    };
  }

  private sections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const sections =
      context.configuration.type === DocumentTemplateType.RECEIPT
        ? this.receiptSections(context, generatedAt, documentNumber)
        : context.configuration.type === DocumentTemplateType.WORK_ORDER
        ? this.workOrderSections(context, generatedAt, documentNumber)
        : context.configuration.type === DocumentTemplateType.TECHNICAL_REPORT
          ? this.visitReportSections(context, generatedAt, documentNumber)
          : context.configuration.type === DocumentTemplateType.TECHNICAL_OPINION
            ? this.technicalOpinionSections(context, generatedAt, documentNumber)
            : context.configuration.type === DocumentTemplateType.PMOC
              ? this.pmocReportSections(context, generatedAt, documentNumber)
            : this.sharedIdentitySections(context);

    switch (context.configuration.type) {
      case DocumentTemplateType.WORK_ORDER:
        break;
      case DocumentTemplateType.TECHNICAL_REPORT:
        break;
      case DocumentTemplateType.REPORT:
        sections.push(...this.legacyReportSections(context));
        break;
      case DocumentTemplateType.TECHNICAL_OPINION:
        break;
      case DocumentTemplateType.PMOC:
        break;
      case DocumentTemplateType.RECEIPT:
        break;
      case DocumentTemplateType.QUOTE:
        sections.push(...this.operationQuoteSections(context));
        break;
      case DocumentTemplateType.BUDGET:
        sections.push(...this.executionReportSections(context));
        break;
    }

    if (context.configuration.type !== DocumentTemplateType.RECEIPT) {
      sections.push(...this.evidenceAndRelatedSections(context));
    }

    const signature = this.signatureComponent(
      context,
      context.configuration.type === DocumentTemplateType.TECHNICAL_OPINION
        ? new Date(context.operation.createdAt).toISOString()
        : null,
    );
    if (signature) {
      sections.push({
        id: 'signature',
        title:
          context.configuration.type === DocumentTemplateType.RECEIPT
            ? 'Responsável técnico'
            : 'Assinatura',
        critical: true,
        components: [signature],
      });
    }

    return sections;
  }

  private sharedIdentitySections(context: DocumentContext): DocumentSection[] {
    const { operation } = context;
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const primaryContact = operation.customer.contacts[0] ?? null;
    const sections: DocumentSection[] = [
      {
        id: 'document-purpose',
        title: this.purposeTitle(context.configuration.type),
        critical: true,
        components: [
          this.metadata('document-purpose-metadata', [
            ['Documento', this.titleFor(context.configuration.type)],
            ['Operação', String(operation.number).padStart(6, '0')],
            ['Tipo da operação', operation.type],
            ['Status operacional', OPERATION_STATUS_LABEL[operation.status]],
            ['Agendado para', this.date(operation.scheduledFor)],
            ['Conclusão', this.date(operation.completedAt)],
          ]),
        ],
      },
      {
        id: 'customer-location',
        title: 'Cliente e local de atendimento',
        critical: true,
        components: [
          this.metadata('customer-metadata', [
            ['Cliente', operation.customer.tradeName ?? operation.customer.name],
            ['Razão/Nome', operation.customer.name],
            ['Documento', operation.customer.cnpj ?? operation.customer.cpf ?? '—'],
            [
              'Contato',
              primaryContact
                ? `${primaryContact.name}${primaryContact.phone ? ` · ${primaryContact.phone}` : ''}`
                : (operation.customer.phone ?? '—'),
            ],
            ['Endereço', address ? this.address(address) : '—'],
          ]),
        ],
      },
    ];

    if (operation.equipment) sections.push(this.equipmentSection(context));
    return sections;
  }

  private workOrderSections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const { operation } = context;
    const cancellation = operation.cancellations?.[0] ?? null;
    if (cancellation && (cancellation.status === 'REQUESTED' || cancellation.status === 'APPROVED')) {
      return this.canceledWorkOrderSections(context, generatedAt, documentNumber);
    }
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const contact = operation.customer.contacts[0] ?? null;
    const serviceItems = this.lines(operation.serviceDescription);
    const checklistItems = this.checklist(operation.checklist);
    const executionComponents: DocumentBlueprintComponent[] = [];
    if (operation.serviceDescription) {
      executionComponents.push(
        serviceItems.length > 1
          ? { id: 'work-order-services-list', kind: 'list', items: serviceItems }
          : {
              id: 'work-order-services-text',
              kind: 'paragraph',
              text: this.clean(operation.serviceDescription),
              keepTogether: true,
            },
      );
    }
    if (checklistItems.length > 0) {
      executionComponents.push({
        id: 'work-order-execution-checklist',
        kind: 'checklist',
        items: checklistItems,
      });
    }
    if (executionComponents.length === 0) {
      executionComponents.push({
        id: 'work-order-services-empty',
        kind: 'paragraph',
        text: 'Serviços executados não registrados.',
        keepTogether: true,
      });
    }
    return [
      {
        id: 'work-order-identification',
        title: 'Identificação da ordem de serviço',
        critical: true,
        components: [
          this.metadata('work-order-identification-metadata', [
            ['Número', documentNumber],
            ['Data de emissão', this.date(generatedAt)],
            ['Data de criação', this.date(operation.createdAt)],
            ['Data do agendamento', this.date(operation.scheduledFor)],
            ['Status', OPERATION_STATUS_LABEL[operation.status]],
            // Responsável técnico = assinatura selecionada na revisão da Platform.
            ['Responsável técnico', this.technicalResponsibleName(context) ?? 'A definir na revisão'],
            ['Operador em campo', operation.operator.name],
          ]),
        ],
      },
      {
        id: 'work-order-customer',
        title: 'Cliente',
        critical: true,
        components: [
          this.metadata('work-order-customer-metadata', [
            ['Cliente', operation.customer.tradeName ?? operation.customer.name],
            ['Razão/Nome', operation.customer.name],
            ['Documento', operation.customer.cnpj ?? operation.customer.cpf ?? '—'],
            [
              'Contato',
              contact
                ? `${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}`
                : (operation.customer.phone ?? '—'),
            ],
            ['Endereço', address ? this.address(address) : '—'],
          ]),
        ],
      },
      this.inspectedEquipmentSection(operation, 'work-order'),
      {
        id: 'work-order-reported-issue',
        title: 'Defeito ou solicitação informada',
        components: [
          {
            id: 'work-order-reported-issue-text',
            kind: 'observation',
            text: this.clean(operation.reportedIssue || 'Não informado.'),
            keepTogether: true,
          },
        ],
      },
      {
        id: 'work-order-execution',
        title: 'Serviços executados / Checklist da execução',
        components: executionComponents,
      },
      this.observationSection(operation, 'Observações e resultado operacional'),
    ].filter((section): section is DocumentSection => Boolean(section));
  }

  private canceledWorkOrderSections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const { operation } = context;
    const cancellation = operation.cancellations[0];
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const contact = operation.customer.contacts[0] ?? null;
    return [
      {
        id: 'work-order-identification',
        title: 'Identificação da ordem de serviço',
        critical: true,
        components: [this.metadata('work-order-identification-metadata', [
          ['Número', documentNumber],
          ['Data de emissão', this.date(generatedAt)],
          ['Data do agendamento', this.date(operation.scheduledFor)],
          ['Status', 'ATENDIMENTO CANCELADO'],
          ['Operador em campo', cancellation.requestedBy.name],
          ['Responsável técnico', this.technicalResponsibleName(context) ?? cancellation.technicalSignature.name],
        ])],
      },
      {
        id: 'work-order-customer',
        title: 'Cliente',
        critical: true,
        components: [this.metadata('work-order-customer-metadata', [
          ['Cliente', operation.customer.tradeName ?? operation.customer.name],
          ['Razão/Nome', operation.customer.name],
          ['Documento', operation.customer.cnpj ?? operation.customer.cpf ?? '—'],
          ['Contato', contact ? `${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}` : (operation.customer.phone ?? '—')],
          ['Endereço', address ? this.address(address) : '—'],
        ])],
      },
      this.inspectedEquipmentSection(operation, 'work-order-cancellation'),
      {
        id: 'work-order-cancellation-reason',
        title: 'Motivo do cancelamento',
        critical: true,
        components: [{ id: 'work-order-cancellation-reason-text', kind: 'observation', text: this.clean(cancellation.reason), keepTogether: true }],
      },
    ].filter((section): section is DocumentSection => Boolean(section));
  }

  private visitReportSections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const { operation } = context;
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const contact = operation.customer.contacts[0] ?? null;
    const executionNumber = operation.rvtExecution
      ? String(operation.rvtExecution.executionNumber).padStart(3, '0')
      : documentNumber;
    const sections: DocumentSection[] = [
      {
        id: 'technical-report-identification',
        title: 'Identificação do relatório',
        critical: true,
        components: [
          this.metadata('technical-report-identification-metadata', [
            ['Número', `RVT-${executionNumber}`],
            ['Emissão', this.date(generatedAt)],
            ['Responsável técnico', this.technicalResponsibleName(context) ?? 'A definir na revisão'],
            ['Registro profissional', this.technicalResponsibleTitle(context) ?? '—'],
            ['Técnico em campo', operation.operator.name],
            ['Situação', OPERATION_STATUS_LABEL[operation.status]],
            ['Referência operacional', `OP-${String(operation.number).padStart(6, '0')}`],
          ]),
        ],
      },
      {
        id: 'technical-report-customer',
        title: 'Cliente',
        critical: true,
        components: [
          this.metadata('technical-report-customer-metadata', [
            ['Cliente', operation.customer.tradeName ?? operation.customer.name],
            ['Razão/Nome', operation.customer.name],
            ['Documento', operation.customer.cnpj ?? operation.customer.cpf ?? '—'],
            [
              'Contato',
              contact
                ? `${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}`
                : (operation.customer.phone ?? '—'),
            ],
            ['Endereço', address ? this.address(address) : '—'],
          ]),
        ],
      },
      this.inspectedEquipmentSection(operation),
      ...this.maintenanceTypeSection(operation),
      {
        id: 'visit-observations',
        title: 'Observações',
        components: this.technicalNarrative(
          'visit-observations',
          operation.observations,
          'Nenhuma observação registrada.',
        ),
      },
      ...(operation.technicalRecommendations?.trim()
        ? [
            {
              id: 'visit-recommendations',
              title: 'Recomendações técnicas',
              components: this.technicalNarrative(
                'visit-recommendations',
                operation.technicalRecommendations,
                '',
              ),
            },
          ]
        : []),
    ].filter((section): section is DocumentSection => Boolean(section));
    return sections;
  }

  private executionReportSections(context: DocumentContext): DocumentSection[] {
    const { operation } = context;
    return [
      {
        id: 'execution-timeline',
        title: 'Linha de execução',
        critical: true,
        components: [
          this.metadata('execution-timeline-metadata', [
            ['Atribuído para', operation.assignments?.[0]?.assignee.name ?? operation.operator.name],
            ['Atribuído por', operation.assignments?.[0]?.assigner.name ?? '—'],
            ['Aceito em', this.date(operation.assignments?.[0]?.acceptedAt ?? null)],
            [
              'Iniciado em',
              this.date(operation.startedAt ?? operation.assignments?.[0]?.startedAt ?? null),
            ],
            [
              'Concluído em',
              this.date(operation.completedAt ?? operation.assignments?.[0]?.completedAt ?? null),
            ],
          ]),
        ],
      },
      this.assignmentHistorySection(operation),
      this.checklistSection(operation, 'Atividades executadas'),
      this.materialsSection(operation),
      this.observationSection(operation, 'Resultado operacional'),
    ].filter((section): section is DocumentSection => Boolean(section));
  }

  private legacyReportSections(context: DocumentContext): DocumentSection[] {
    return [
      {
        id: 'legacy-report-compatibility',
        title: 'Relatório legado',
        critical: true,
        components: [
          {
            id: 'legacy-report-note',
            kind: 'observation',
            text: this.clean(
              'Documento REPORT preservado para compatibilidade histórica. Novas emissões analíticas devem usar Laudo Técnico (TECHNICAL_OPINION).',
            ),
            keepTogether: true,
          },
        ],
      },
      ...this.executionReportSections(context),
    ];
  }

  private technicalOpinionSections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const { operation } = context;
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const responsible = context.signature.institutionalSignatures[0] ?? null;
    const primaryContact = operation.customer.contacts[0] ?? null;
    const responsibleName =
      operation.technicalOpinionResponsible ?? responsible?.name ?? 'Não informado';
    const professionalCouncil =
      operation.technicalOpinionCrea ?? responsible?.professionalCouncil ?? 'Não informado';
    const inspectionDate =
      operation.startedAt ??
      operation.completedAt ??
      operation.scheduledFor ??
      operation.createdAt ??
      generatedAt;
    const conditions = this.lines(operation.technicalOpinionConditions);

    return [
      {
        id: 'technical-opinion-identification',
        title: 'Identificação do Laudo',
        critical: true,
        components: [
          this.metadata('technical-opinion-identification-metadata', [
            ['Número do Laudo', documentNumber],
            ['Tipo de documento', 'Laudo Técnico'],
            ['Data de emissão', this.dateOnly(generatedAt)],
            ['Data da vistoria', this.dateOnly(inspectionDate)],
            ['Situação', OPERATION_STATUS_LABEL[operation.status]],
            ['Responsável Técnico', responsibleName],
            ['CREA / Registro profissional', professionalCouncil],
          ]),
        ],
      },
      {
        id: 'technical-opinion-requester',
        title: 'Solicitante',
        critical: true,
        components: [
          this.metadata('technical-opinion-requester-metadata', [
            ['Solicitante', operation.customer.tradeName ?? operation.customer.name],
            ['Razão Social', operation.customer.name],
            [
              'Documento (CNPJ/CPF)',
              operation.customer.cnpj ?? operation.customer.cpf ?? 'Não informado',
            ],
            [
              'Contato',
              this.clean(
                [
                  primaryContact?.name,
                  primaryContact?.role,
                  primaryContact?.phone ?? operation.customer.phone,
                  primaryContact?.email ?? operation.customer.email,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Não informado',
              ),
            ],
            ['Endereço completo', address ? this.address(address) : 'Não informado'],
          ]),
        ],
      },
      {
        id: 'technical-opinion-objective',
        title: 'Objetivo',
        critical: true,
        components: this.technicalStatementWithItems(
          'technical-opinion-objective',
          operation.technicalOpinionObjective,
          operation.technicalOpinionObjectiveItems,
          'Objetivo do Laudo Técnico não informado.',
        ),
      },
      this.technicalOpinionEquipmentSection(operation),
      {
        id: 'technical-opinion-site-conditions',
        title: 'Condições observadas no local',
        critical: true,
        components: [
          {
            id: 'technical-opinion-site-conditions-introduction',
            kind: 'paragraph',
            text: this.clean(
              `Durante a vistoria técnica realizada em ${this.dateOnly(inspectionDate)}, foram observadas as seguintes condições:`,
            ),
            keepTogether: true,
          },
          ...(conditions.length > 0
            ? [
                {
                  id: 'technical-opinion-site-conditions-list',
                  kind: 'list' as const,
                  items: conditions,
                },
              ]
            : [
                {
                  id: 'technical-opinion-site-conditions-empty',
                  kind: 'paragraph' as const,
                  text: 'Condições observadas não informadas.',
                  keepTogether: true,
                },
              ]),
        ],
      },
      {
        id: 'technical-opinion-analysis',
        title: 'Análise Técnica',
        critical: true,
        components: this.technicalProse(
          'technical-opinion-analysis',
          operation.technicalOpinionAnalysis,
          'Análise técnica não informada.',
        ),
      },
      {
        id: 'technical-opinion-recommendations',
        title: 'Recomendações Técnicas',
        critical: true,
        components: this.technicalNarrative(
          'technical-opinion-recommendations',
          operation.technicalOpinionRecommendations,
          'Recomendações técnicas não informadas.',
        ),
      },
      {
        id: 'technical-opinion-conclusion',
        title: 'Conclusão',
        critical: true,
        components: this.technicalStatementWithItems(
          'technical-opinion-conclusion',
          operation.technicalOpinionConclusion,
          operation.technicalOpinionConclusionItems,
          'Conclusão técnica não informada.',
        ),
      },
    ];
  }

  private technicalOpinionEquipmentSection(operation: DocumentContextOperation): DocumentSection {
    const inspected = operation.inspectedEquipments ?? [];
    const rows =
      inspected.length > 0
        ? inspected.map((item, index) => ({
            number: String(index + 1).padStart(2, '0'),
            modelCapacity: this.clean(
              [item.capacitySnapshot, item.modelSnapshot].filter(Boolean).join(' – ') ||
                item.equipment.name ||
                'Não informado',
            ),
            systemType: this.clean(
              item.systemTypeSnapshot ?? this.equipmentTypeLabel(item.equipment.type),
            ),
            location: this.clean(item.sector),
            currentSituation: this.clean(item.currentSituationSnapshot ?? 'Não informada'),
          }))
        : operation.equipment
          ? [
              {
                number: '01',
                modelCapacity: this.clean(
                  [operation.equipment.capacity, operation.equipment.model]
                    .filter(Boolean)
                    .join(' – ') || operation.equipment.name,
                ),
                systemType: this.clean(this.equipmentTypeLabel(operation.equipment.type)),
                location: this.clean(
                  operation.equipment.address?.name ??
                    operation.address?.name ??
                    operation.equipment.name,
                ),
                currentSituation: 'Não informada',
              },
            ]
          : [];

    return {
      id: 'technical-opinion-equipments',
      title: 'Descrição dos Equipamentos',
      critical: true,
      components: [
        {
          id: 'technical-opinion-equipments-table',
          kind: 'table',
          columns: [
            { key: 'number', label: 'Nº', width: 0.07 },
            { key: 'modelCapacity', label: 'MODELO / CAPACIDADE', width: 0.25 },
            { key: 'systemType', label: 'TIPO DE SISTEMA', width: 0.23 },
            { key: 'location', label: 'LOCAL DE INSTALAÇÃO', width: 0.2 },
            { key: 'currentSituation', label: 'SITUAÇÃO ATUAL', width: 0.25 },
          ],
          rows,
        },
      ],
    };
  }

  /**
   * Número do relatório PMOC na ordem da execução POR EQUIPAMENTO
   * (PMOC-001, PMOC-002, ...). Cai no número persistido apenas se a execução
   * não estiver vinculada (não deveria ocorrer em documentos PMOC reais).
   */
  private pmocDisplayNumber(operation: DocumentContextOperation, fallback: string): string {
    const request = operation.pmocExecutionRequest ?? operation.generatedPmocExecutionRequest ?? null;
    if (request?.equipmentExecutionNumber == null) return fallback;
    return `PMOC-${String(request.equipmentExecutionNumber).padStart(3, '0')}`;
  }

  /** Título "PMOC — CLIENTE — EQUIPAMENTO" da seção de identificação. */
  private pmocTitle(operation: DocumentContextOperation): string {
    const customer = operation.customer.tradeName ?? operation.customer.name;
    const equipment = operation.equipment;
    const equipmentRef = equipment
      ? `${equipment.name}${equipment.tag ? ` · ${equipment.tag}` : ''}`
      : null;
    return equipmentRef ? `PMOC — ${customer} — ${equipmentRef}` : `PMOC — ${customer}`;
  }

  private pmocReportSections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const { operation } = context;
    const pmoc = operation.maintenanceExecution?.plan.pmocPlan ?? null;
    if (!pmoc) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'PMOC document requires an Operation linked to a PMOC MaintenanceExecution',
        HttpStatus.CONFLICT,
      );
    }
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const contact = operation.customer.contacts[0] ?? null;
    const collectsClientSignature =
      context.signature.signatureMode === SignatureMode.COLLECTED ||
      context.signature.signatureMode === SignatureMode.HYBRID;
    const sections: DocumentSection[] = [
      {
        id: 'pmoc-identification',
        title: 'Identificação do PMOC',
        critical: true,
        components: [
          this.metadata('pmoc-identification-metadata', [
            ['Título', this.pmocTitle(operation)],
            ['Número', documentNumber],
            ['Emissão', this.date(generatedAt)],
            ['Responsável técnico', this.technicalResponsibleName(context) ?? pmoc.responsibleTechnician],
            ['ART/registro', pmoc.artNumber ?? '—'],
            ['Contrato', pmoc.contractNumber ?? '—'],
            ['Cliente', operation.customer.tradeName ?? operation.customer.name],
            ['Endereço', address ? this.address(address) : '—'],
          ]),
        ],
      },
      ...(collectsClientSignature && !operation.signatureData
        ? [{
            id: 'pmoc-signature-pending',
            title: 'Situação da assinatura',
            critical: true,
            components: [{
              id: 'pmoc-signature-pending-warning',
              kind: 'paragraph' as const,
              text: 'DOCUMENTO NÃO ASSINADO. A assinatura do cliente/responsável ainda precisa ser coletada para concluir a política definida no modelo.',
              keepTogether: true,
            }],
          }]
        : []),
      {
        id: 'pmoc-operational-data',
        title: 'Dados operacionais',
        critical: true,
        components: [this.metadata('pmoc-operational-metadata', [
          ['Operação', `OP-${String(operation.number).padStart(6, '0')}`],
          [
            'Execução prevista',
            this.calendarDate(operation.maintenanceExecution?.scheduledAt ?? null),
          ],
          ['Início', this.date(operation.startedAt)],
          ['Técnico em campo', operation.operator.name],
          ['Contato do cliente', contact ? `${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}` : (operation.customer.phone ?? '—')],
          [
            'Vigência',
            `${this.calendarDate(pmoc.startDate)} a ${this.calendarDate(pmoc.endDate)}`,
          ],
          ['Periodicidade', this.maintenanceTypeLabel(operation.maintenanceType ?? 'MONTHLY')],
          [
            'Tipos de serviço',
            (operation.serviceTypes?.length ? operation.serviceTypes : [operation.type])
              .map((type) => this.operationTypeLabel(type))
              .join(' · '),
          ],
        ])],
      },
      this.inspectedEquipmentSection(operation, 'pmoc'),
      this.pmocEnvironmentsSection(operation),
      {
        id: 'pmoc-legal-reference',
        title: 'Referência do plano',
        components: [{ id: 'pmoc-legal-reference-text', kind: 'paragraph', text: 'Plano de Manutenção, Operação e Controle — referência textual: Lei nº 13.589/2018.', keepTogether: true }],
      },
      ...this.pmocChecklistSections(operation),
      this.materialsSection(operation),
      this.observationSection(operation, 'Observações e conclusão da execução'),
    ].filter((section): section is DocumentSection => Boolean(section));
    return sections;
  }

  private pmocChecklistSections(operation: DocumentContextOperation): DocumentSection[] {
    // Seção única "CheckList do Procedimento - Lei nº 13.589/2018"; o conteúdo é
    // uma tabela para cada unidade fixa (Evaporadora/Condensadora), listando
    // todos os procedimentos cadastrados com "Executado" em Sim/Não.
    const UNIT_ORDER: Array<{ unit: 'EVAPORATOR' | 'CONDENSER'; label: string }> = [
      { unit: 'EVAPORATOR', label: 'Unidade Evaporadora' },
      { unit: 'CONDENSER', label: 'Unidade Condensadora' },
    ];
    const components: DocumentBlueprintComponent[] = [];
    for (const { unit, label } of UNIT_ORDER) {
      const items = operation.maintenanceChecklistItems.filter((item) => item.pmocUnit === unit);
      if (items.length === 0) continue;
      components.push({
        id: `pmoc-checklist-heading-${unit.toLowerCase()}`,
        kind: 'paragraph',
        text: label,
        keepTogether: true,
      });
      components.push({
        id: `pmoc-checklist-table-${unit.toLowerCase()}`,
        kind: 'table',
        columns: [
          { key: 'procedure', label: 'PROCEDIMENTO', width: 0.6 },
          { key: 'executed', label: 'EXECUTADO', width: 0.15 },
          { key: 'observation', label: 'OBSERVAÇÃO', width: 0.25 },
        ],
        rows: items.map((item) => ({
          procedure: this.clean(item.description),
          executed: item.result === 'YES' ? 'Sim' : item.result === 'NOT_APPLICABLE' ? 'N.A.' : 'Não',
          observation: this.clean(item.observations ?? '—'),
        })),
      });
    }
    if (components.length === 0) {
      components.push({
        id: 'pmoc-checklist-empty-text',
        kind: 'paragraph',
        text: 'Nenhum procedimento foi registrado para esta execução.',
        keepTogether: true,
      });
    }
    return [
      {
        id: 'pmoc-checklist',
        title: 'CheckList do Procedimento - Lei nº 13.589/2018',
        components,
      },
    ];
  }

  private receiptSections(
    context: DocumentContext,
    generatedAt: string,
    documentNumber: string,
  ): DocumentSection[] {
    const { operation } = context;
    const address = operation.address ?? operation.customer.addresses[0] ?? null;
    const warranty = operation.receiptWarrantyDays
      ? `${operation.receiptWarrantyDays} ${operation.receiptWarrantyDays === 1 ? 'dia' : 'dias'}`
      : 'Sem garantia';
    const amount = operation.receiptAmount
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
          Number(operation.receiptAmount),
        )
      : 'R$ 0,00';
    const customerLabel = this.receiptCustomerLabel(operation.customer);
    const isSaleReceipt = Boolean(operation.sourceSaleId);
    // Campo legado mantido apenas como fallback para recibos históricos.
    const description =
      operation.receiptDescription ?? operation.receiptService ?? 'sem descrição informada';
    const declaration =
      operation.receiptDeclaration ??
      [
        isSaleReceipt
          ? `Recebemos de ${customerLabel} a quantia de ${amount} (${operation.receiptAmountInWords ?? 'valor não informado'}), correspondente à venda realizada. Descrição da venda: ${description}.`
          : `Recebemos de ${customerLabel} a quantia de ${amount} (${operation.receiptAmountInWords ?? 'valor não informado'}), correspondente aos serviços prestados. Descrição dos serviços: ${description}.`,
        operation.receiptWarrantyDays
          ? `Damos, por este recibo, a devida quitação e garantia de ${warranty} ${isSaleReceipt ? 'sobre os produtos fornecidos' : 'sobre os serviços prestados'}, contados a partir da data deste documento.`
          : 'Damos, por este recibo, a devida quitação.',
      ].join('\n\n');
    return [
      {
        id: 'receipt-identification',
        title: 'Identificação do recibo',
        critical: true,
        components: [
          this.metadata('receipt-identification-metadata', [
            ['Número', operation.receiptNumber ?? documentNumber],
            ['Data', this.calendarDate(operation.receiptIssuedAt ?? generatedAt)],
            ['Cliente', operation.customer.tradeName ?? operation.customer.name],
            ['Endereço', address ? this.address(address) : '—'],
            ['Valor', amount],
            ['Valor por extenso', operation.receiptAmountInWords ?? '—'],
            ['Operação relacionada', `OP-${String(operation.number).padStart(6, '0')}`],
          ]),
        ],
      },
      {
        id: 'receipt-declaration',
        title: 'Declaração',
        critical: true,
        components: [
          {
            id: 'receipt-declaration-text',
            kind: 'paragraph',
            text: this.clean(declaration),
            keepTogether: true,
          },
        ],
      },
      {
        id: 'receipt-warranty',
        title: 'Garantia',
        critical: true,
        components: [
          this.metadata('receipt-warranty-metadata', [
            ['Prazo', warranty],
            ['Início da contagem', this.calendarDate(operation.receiptIssuedAt ?? generatedAt)],
          ]),
        ],
      },
    ];
  }

  private operationQuoteSections(context: DocumentContext): DocumentSection[] {
    const { operation } = context;
    return [
      {
        id: 'quote-origin',
        title: 'Origem do orçamento operacional',
        critical: true,
        components: [
          this.metadata('quote-origin-metadata', [
            ['Operação de origem', String(operation.number).padStart(6, '0')],
            ['Cliente', operation.customer.tradeName ?? operation.customer.name],
            ['Equipamento', operation.equipment?.name ?? '—'],
            ['Observação', 'Valores comerciais oficiais devem ser emitidos pelo domínio Budget.'],
          ]),
        ],
      },
      this.observationSection(operation, 'Necessidade identificada'),
    ].filter((section): section is DocumentSection => Boolean(section));
  }

  private evidenceAndRelatedSections(context: DocumentContext): DocumentSection[] {
    const { operation } = context;
    const sections: DocumentSection[] = [];
    if (operation.photos.length > 0) {
      sections.push(this.photosSection(context, 'Evidências fotográficas'));
    }
    const relatedDocuments = operation.documents.filter(
      (document) => document.type !== context.configuration.type,
    );
    if (
      context.configuration.type !== DocumentTemplateType.TECHNICAL_REPORT &&
      context.configuration.type !== DocumentTemplateType.TECHNICAL_OPINION &&
      context.configuration.type !== DocumentTemplateType.WORK_ORDER &&
      context.configuration.type !== DocumentTemplateType.PMOC &&
      relatedDocuments.length > 0
    ) {
      sections.push({
        id: 'related-documents',
        title: 'Documentos relacionados',
        components: [
          {
            id: 'related-documents-list',
            kind: 'list',
            items: relatedDocuments
              .map((doc) => `${doc.number} · ${doc.type} · ${doc.status}`)
              .map((item) => this.clean(item)),
          },
        ],
      });
    }
    return sections;
  }

  private equipmentSection(context: DocumentContext, includeQrImage = true): DocumentSection {
    const { operation } = context;
    const equipment = operation.equipment;
    if (!equipment) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'Equipment section requested without equipment',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const qrCode = context.assets.qrCode;
    if (includeQrImage && !qrCode) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_RENDER_FAILED,
        'Equipment QR image could not be resolved',
        HttpStatus.CONFLICT,
      );
    }
    const components: DocumentBlueprintComponent[] = [
      this.metadata('equipment-metadata', [
        ['Nome', equipment.name],
        ['Tag', equipment.tag ?? '—'],
        ['Tipo', equipment.type],
        ['Fabricante', equipment.manufacturer ?? '—'],
        ['Modelo', equipment.model ?? '—'],
        ['Nº de série', equipment.serialNumber ?? '—'],
        ['Código QR', equipment.qrCode],
      ]),
    ];
    if (includeQrImage && qrCode) {
      components.push({
        id: 'equipment-qr',
        kind: 'qrCode',
        label: 'QR do equipamento',
        value: equipment.qrCode,
        image: {
          mimeType: 'image/png',
          fileSize: qrCode.fileSize,
          contentBase64: qrCode.contentBase64,
        },
        keepTogether: true,
      });
    }
    return {
      id: 'equipment',
      title: 'Equipamento',
      critical: true,
      components,
    };
  }

  private technicalReportEquipmentSections(context: DocumentContext): DocumentSection[] {
    const equipment = this.equipmentSection(context);
    return [
      {
        id: 'technical-report-equipment',
        title: 'Equipamento',
        critical: true,
        pageBreakAfter: true,
        components: equipment.components.filter((component) => component.kind === 'metadata'),
      },
      {
        id: 'technical-report-equipment-qr',
        title: 'Identificação digital do equipamento',
        components: equipment.components.filter((component) => component.kind === 'qrCode'),
      },
    ];
  }

  private checklistSection(
    operation: DocumentContext['operation'],
    title: string,
  ): DocumentSection {
    return {
      id: `checklist-${this.slug(title)}`,
      title,
      components: [
        {
          id: 'operation-checklist',
          kind: 'checklist',
          items: this.checklist(operation.checklist),
        },
      ],
    };
  }

  /**
   * Seção "Tipo de manutenção" no formato do modelo do cliente: colunas lado a
   * lado (Semanal / Semestral / …), cada uma com seu checklist e um marcador
   * ( x ) na coluna do tipo efetivamente executado. As colunas vêm dos itens
   * registrados na operação, agrupados por `maintenanceType`.
   */
  private maintenanceTypeSection(operation: DocumentContextOperation): DocumentSection[] {
    const reportTypes = [
      OperationMaintenanceType.WEEKLY,
      OperationMaintenanceType.SEMIANNUAL,
    ];
    const order: string[] = [...reportTypes];
    const groups = new Map<string, Array<{ label: string; done: boolean }>>();
    const selected = operation.maintenanceType ?? null;
    reportTypes.forEach((type) => groups.set(type, []));
    for (const item of operation.maintenanceChecklistItems ?? []) {
      if (!groups.has(item.maintenanceType)) {
        groups.set(item.maintenanceType, []);
        order.push(item.maintenanceType);
      }
      groups.get(item.maintenanceType)!.push({
        label: this.clean(item.description),
        // O grupo não selecionado é documental: lista o catálogo, mas nunca
        // representa procedimento executado nesta visita.
        done: item.maintenanceType === selected && item.executed,
      });
    }

    if (selected && !groups.has(selected)) {
      groups.set(selected, []);
      order.unshift(selected);
    }

    // Semana e Semestral permanecem sempre visíveis conforme o contrato do RVT.
    // Tipos futuros entram depois deles sem exigir alteração no Renderer.

    return [
      {
        id: 'maintenance-type',
        title: 'Tipo de manutenção',
        critical: true,
        components: [
          {
            id: 'maintenance-type-columns',
            kind: 'checklistColumns',
            columns: order.map((type) => ({
              title: this.maintenanceTypeLabel(type),
              selected: type === selected,
              items: groups.get(type) ?? [],
            })),
          },
        ],
      },
    ];
  }

  private inspectedEquipmentSection(
    operation: DocumentContextOperation,
    idPrefix = 'technical-report',
  ): DocumentSection {
    const inspected = operation.inspectedEquipments ?? [];
    const rows =
      inspected.length > 0
        ? inspected.map((item, index) => ({
            item: String(index + 1).padStart(2, '0'),
            sector: this.clean(item.sector),
            brand: this.clean(item.brandSnapshot ?? '—'),
            model: this.clean(item.modelSnapshot ?? '—'),
            capacity: this.clean(item.capacitySnapshot ?? '—'),
          }))
        : operation.equipment
          ? [
              {
                item: '01',
                sector: this.clean(
                  operation.equipment.sector ??
                    operation.equipment.address?.name ??
                    operation.address?.name ??
                    operation.equipment.name,
                ),
                brand: this.clean(operation.equipment.manufacturer ?? '—'),
                model: this.clean(operation.equipment.model ?? '—'),
                capacity: this.clean(operation.equipment.capacity ?? '—'),
              },
            ]
          : [];
    return {
      id: `${idPrefix}-inspected-equipments`,
      title: 'Equipamentos',
      components: [
        {
          id: `${idPrefix}-inspected-equipments-table`,
          kind: 'table',
          columns: [
            { key: 'item', label: 'ITEM', width: 0.1 },
            { key: 'sector', label: 'SETOR', width: 0.34 },
            { key: 'brand', label: 'MARCA', width: 0.19 },
            { key: 'model', label: 'MODELO', width: 0.19 },
            { key: 'capacity', label: 'CAPACIDADE', width: 0.18 },
          ],
          rows,
        },
      ],
    };
  }

  private referencePeriod(month: number, year: number): string {
    const date = new Date(Date.UTC(year, month - 1, 1));
    const label = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  private maintenanceTypeLabel(type: string): string {
    return (
      {
        WEEKLY: 'Semanal',
        MONTHLY: 'Mensal',
        QUARTERLY: 'Trimestral',
        SEMIANNUAL: 'Semestral',
        ANNUAL: 'Anual',
        CORRECTIVE: 'Corretiva',
      }[type] ?? type
    );
  }

  private observationSection(
    operation: DocumentContext['operation'],
    title: string,
  ): DocumentSection | null {
    if (!operation.observations) return null;
    return {
      id: `observations-${this.slug(title)}`,
      title,
      components: [
        {
          id: 'operation-observations',
          kind: 'observation',
          text: this.clean(operation.observations),
        },
      ],
    };
  }

  private materialsSection(operation: DocumentContext['operation']): DocumentSection | null {
    if (operation.parts.length === 0) return null;
    return {
      id: 'materials-consumed',
      title: 'Materiais utilizados',
      critical: true,
      components: [
        {
          id: 'materials-table',
          kind: 'table',
          columns: [
            { key: 'sku', label: 'SKU', width: 0.18 },
            { key: 'item', label: 'Material', width: 0.36 },
            { key: 'quantity', label: 'Qtd.', width: 0.14 },
            { key: 'location', label: 'Origem', width: 0.18 },
            { key: 'notes', label: 'Obs.', width: 0.14 },
          ],
          rows: operation.parts.map((part) => ({
            sku: this.clean(part.product.sku),
            item: this.clean(part.product.name),
            quantity: `${this.decimal(part.quantity)} ${this.clean(part.product.unit)}`,
            location: this.clean(part.inventoryItem.location ?? '—'),
            notes: this.clean(part.notes ?? '—'),
          })),
        },
      ],
    };
  }

  private assignmentHistorySection(
    operation: DocumentContext['operation'],
  ): DocumentSection | null {
    const history = operation.assignments?.[0]?.history ?? [];
    if (history.length === 0) return null;
    return {
      id: 'assignment-history',
      title: 'Histórico da execução',
      components: [
        {
          id: 'assignment-history-table',
          kind: 'table',
          columns: [
            { key: 'date', label: 'Data', width: 0.24 },
            { key: 'event', label: 'Evento', width: 0.22 },
            { key: 'actor', label: 'Usuário', width: 0.24 },
            { key: 'status', label: 'Status', width: 0.16 },
            { key: 'notes', label: 'Notas', width: 0.14 },
          ],
          rows: history.map((item) => ({
            date: this.date(item.createdAt),
            event: this.clean(item.event),
            actor: this.clean(item.actor.name),
            status: this.clean(item.newStatus),
            notes: this.clean(item.notes ?? '—'),
          })),
        },
      ],
    };
  }

  private maintenanceSection(operation: DocumentContext['operation']): DocumentSection | null {
    const execution = operation.maintenanceExecution;
    if (!execution) return null;
    return {
      id: 'maintenance-execution',
      title: 'Planejamento de manutenção',
      critical: true,
      components: [
        this.metadata('maintenance-execution-metadata', [
          ['Plano', execution.plan.name],
          ['Tipo', execution.plan.type],
          ['Prioridade', execution.plan.priority],
          ['Execução prevista', this.date(execution.scheduledAt)],
          ['Execução realizada', this.date(execution.executedAt)],
          ['Status da execução', execution.status],
          ['Próxima execução', this.date(execution.plan.nextExecution)],
          ['Observações', execution.notes ?? execution.plan.description ?? '—'],
        ]),
      ],
    };
  }

  private pmocEnvironmentsSection(operation: DocumentContext['operation']): DocumentSection | null {
    const pmoc = operation.maintenanceExecution?.plan.pmocPlan ?? null;
    if (!pmoc || pmoc.environments.length === 0) return null;
    return {
      id: 'pmoc-environments',
      title: 'Ambientes monitorados',
      components: [
        {
          id: 'pmoc-environments-table',
          kind: 'table',
          columns: [
            { key: 'name', label: 'Ambiente', width: 0.3 },
            { key: 'area', label: 'Área', width: 0.16 },
            { key: 'occupancy', label: 'Ocupação', width: 0.16 },
            { key: 'equipments', label: 'Equipamentos', width: 0.38 },
          ],
          rows: pmoc.environments.map((environment) => ({
            name: this.clean(environment.name),
            area: this.clean(environment.area ?? '—'),
            occupancy: environment.occupancy != null ? String(environment.occupancy) : '—',
            equipments: this.clean(
              environment.equipments.map((item) => item.equipment.name).join(', ') || '—',
            ),
          })),
        },
      ],
    };
  }

  private photosSection(context: DocumentContext, title: string): DocumentSection {
    const { operation } = context;
    return {
      id: `photos-${this.slug(title)}`,
      title,
      components: [
        {
          id: `photo-gallery-${operation.id}`,
          kind: 'imageGallery',
          columns: context.configuration.type === DocumentTemplateType.PMOC ? 4 : 2,
          images: operation.photos.map((photo) => ({
            sourceId: photo.id,
            caption: photo.caption ? this.clean(photo.caption) : null,
            mimeType: photo.mimeType,
            fileSize: photo.fileSize,
            image: this.imageForPhoto(context, photo.id),
          })),
        },
      ],
    };
  }

  private imageForPhoto(
    context: DocumentContext,
    photoId: string,
  ): { mimeType: string; fileSize: number; contentBase64: string } | null {
    const photo = context.operation.photos.find((item) => item.id === photoId);
    const resolved = photo
      ? context.assets.images.find((image) => image.storageKey === photo.storageKey)
      : null;
    return resolved
      ? {
          mimeType: resolved.mimeType,
          fileSize: resolved.fileSize,
          contentBase64: resolved.contentBase64,
        }
      : null;
  }

  private purposeTitle(type: DocumentTemplateType): string {
    const titles: Record<DocumentTemplateType, string> = {
      BUDGET: 'Finalidade do documento',
      QUOTE: 'Origem do orçamento operacional',
      WORK_ORDER: 'Ordem de serviço',
      RECEIPT: 'Recibo / Garantia',
      REPORT: 'Relatório legado',
      TECHNICAL_REPORT: 'Relatório de visita técnica',
      TECHNICAL_OPINION: 'Laudo técnico',
      PMOC: 'Relatório PMOC',
    };
    return titles[type];
  }

  private templatePreviewSections(context: TemplatePreviewContext): DocumentSection[] {
    const { template, placeholders } = context;
    const sections: DocumentSection[] = [
      {
        id: 'template-summary',
        title: 'Resumo do modelo',
        critical: true,
        components: [
          this.metadata('template-metadata', [
            ['Nome', template.name],
            ['Tipo', template.type],
            ['Status', template.isActive ? 'Ativo' : 'Inativo'],
            ['Template padrão', template.isDefault ? 'Sim' : 'Não'],
            ['Assinatura obrigatória', template.requiresSignature ? 'Sim' : 'Não'],
            ['Modo de assinatura', template.signatureMode],
            ['Atualizado em', this.date(template.updatedAt)],
          ]),
        ],
      },
      {
        id: 'template-content',
        title: 'Conteúdo configurado',
        critical: true,
        components: [
          {
            id: 'template-header-content',
            kind: 'paragraph',
            text: this.clean(template.headerContent || 'Cabeçalho não configurado.'),
            keepTogether: true,
          },
          {
            id: 'template-footer-content',
            kind: 'paragraph',
            text: this.clean(template.footerContent || 'Rodapé não configurado.'),
            keepTogether: true,
          },
          {
            id: 'template-observations',
            kind: 'observation',
            text: this.clean(template.observations || 'Sem observações.'),
            keepTogether: true,
          },
        ],
      },
      {
        id: 'official-placeholders',
        title: 'Placeholders oficiais',
        components: [
          {
            id: 'placeholder-table',
            kind: 'table',
            keepTogether: true,
            columns: [
              { key: 'field', label: 'Campo', width: 0.38 },
              { key: 'value', label: 'Valor de preview', width: 0.62 },
            ],
            rows: [
              { field: 'Cliente', value: placeholders.customerName },
              { field: 'Equipamento', value: placeholders.equipmentName },
              { field: 'Operador', value: placeholders.operatorName },
              { field: 'Número do documento', value: placeholders.documentNumber },
              { field: 'Data de geração', value: generatedDate(placeholders.generatedAt) },
            ].map((row) => ({
              field: this.clean(row.field),
              value: this.clean(row.value),
            })),
          },
        ],
      },
    ];

    if (template.type === DocumentTemplateType.TECHNICAL_REPORT) {
      sections.push(
        {
          id: 'template-reference-period',
          title: 'Período de referência e manutenção',
          components: [
            this.metadata('template-reference-period-metadata', [
              ['Mês e ano de referência', 'Junho de 2026'],
              ['Tipo de manutenção', 'Semestral'],
            ]),
          ],
        },
        {
          id: 'template-maintenance-checklist',
          title: 'Checklist de manutenção',
          components: [
            {
              id: 'template-maintenance-checklist-items',
              kind: 'checklist',
              items: [
                { label: 'Atividade prevista no plano', done: true, note: null },
                { label: 'Atividade pendente', done: false, note: 'Observação opcional' },
              ],
            },
          ],
        },
        {
          id: 'template-inspected-equipments',
          title: 'Equipamentos inspecionados',
          components: [
            {
              id: 'template-inspected-equipments-table',
              kind: 'table',
              columns: [
                { key: 'item', label: 'ITEM', width: 0.1 },
                { key: 'sector', label: 'SETOR', width: 0.34 },
                { key: 'brand', label: 'MARCA', width: 0.19 },
                { key: 'model', label: 'MODELO', width: 0.19 },
                { key: 'capacity', label: 'CAPACIDADE', width: 0.18 },
              ],
              rows: [
                {
                  item: '01',
                  sector: 'Ambiente',
                  brand: 'Marca',
                  model: 'Modelo',
                  capacity: 'Capacidade',
                },
              ],
            },
          ],
        },
      );
    }

    const signature = this.signatureComponent(context);
    if (signature) {
      sections.push({
        id: 'signature',
        title: 'Assinatura',
        critical: true,
        components: [signature],
      });
    }
    return sections;
  }

  private budgetSections(context: BudgetContext): DocumentSection[] {
    const { budget, template } = context;
    const address = budget.customerAddress ?? budget.customer.addresses[0] ?? null;
    const primaryContact = budget.customer.contacts[0] ?? null;
    const services = budget.items.filter((item) => item.type === 'SERVICE');
    const catalogMaterials = budget.items.filter(
      (item) => item.type === 'MATERIAL' && item.source === 'CATALOG',
    );
    const commercialMaterials = budget.items.filter(
      (item) => item.type === 'MATERIAL' && item.source !== 'CATALOG',
    );
    const paymentLabels: Record<string, string> = {
      CASH: 'Espécie',
      PIX: 'PIX',
      CREDIT_CARD: 'Cartão de crédito',
    };
    const itemTable = (
      id: string,
      items: typeof budget.items,
      discount?: { amount: Prisma.Decimal | number | string; description: string | null },
    ): Extract<DocumentBlueprintComponent, { kind: 'table' }> => {
      const rows = items.map((item) => ({
        item: this.clean(item.description || item.product?.name || 'Item'),
        quantity: this.decimal(item.quantity),
        unit: this.clean(item.unit),
        unitPrice: this.money(item.unitPrice),
        total: this.money(item.total),
      }));
      const hasDiscount = discount && Number(discount.amount) > 0;
      if (hasDiscount) {
        rows.push({
          item: this.clean(discount.description || 'Desconto comercial'),
          quantity: '',
          unit: '',
          unitPrice: '',
          total: `- ${this.money(discount.amount)}`,
        });
      }
      return {
        id,
        kind: 'table',
        columns: [
          { key: 'item', label: 'Descrição', width: 0.48 },
          { key: 'quantity', label: 'Qtd.', width: 0.12 },
          { key: 'unit', label: 'Un.', width: 0.1 },
          { key: 'unitPrice', label: 'Valor unit.', width: 0.15 },
          { key: 'total', label: 'Subtotal', width: 0.15 },
        ],
        rows,
        ...(hasDiscount ? { emphasizedRowIndexes: [rows.length - 1] } : {}),
      };
    };
    const descriptionTable = (
      id: string,
      items: typeof budget.items,
    ): Extract<DocumentBlueprintComponent, { kind: 'table' }> => ({
      id,
      kind: 'table',
      columns: [
        { key: 'item', label: 'Descrição', width: 0.82 },
        { key: 'quantity', label: 'Quantidade', width: 0.18 },
      ],
      rows: items.map((item) => ({
        item: this.clean(item.description || 'Material'),
        quantity: this.decimal(item.quantity),
      })),
    });
    const sections: DocumentSection[] = [
      {
        id: 'budget-identification',
        title: 'Identificação do orçamento',
        critical: true,
        components: [
          this.metadata('budget-metadata', [
            ['Número', `ORC-${String(budget.number).padStart(6, '0')}`],
            ['Título', budget.title],
            ['Status', BUDGET_STATUS_LABEL[budget.status]],
            ['Data', this.dateOnly(budget.issuedAt)],
            ['Válido até', this.dateOnly(budget.expirationDate)],
            ['Responsável', budget.creator.name],
          ]),
        ],
      },
      {
        id: 'budget-customer',
        title: 'Cliente e local',
        critical: true,
        components: [
          this.metadata('budget-customer-metadata', [
            ['Razão/Nome', budget.customer.name],
            ['Nome fantasia', budget.customer.tradeName ?? '—'],
            ['Documento', budget.customer.cnpj ?? budget.customer.cpf ?? '—'],
            [
              'Contato',
              primaryContact
                ? `${primaryContact.name}${primaryContact.phone ? ` · ${primaryContact.phone}` : ''}`
                : (budget.customer.phone ?? '—'),
            ],
            ['Endereço', address ? this.address(address) : '—'],
          ]),
        ],
      },
    ];

    const budgetEquipments = budget.equipments ?? [];
    const budgetEquipmentRows =
      budgetEquipments.length > 0
        ? budgetEquipments.map((item, index) => ({
            item: String(index + 1).padStart(2, '0'),
            sector: this.clean(item.sector),
            brand: this.clean(item.brandSnapshot ?? item.equipment.manufacturer ?? '—'),
            model: this.clean(item.modelSnapshot ?? item.equipment.model ?? '—'),
            capacity: this.clean(item.capacitySnapshot ?? item.equipment.capacity ?? '—'),
          }))
        : budget.equipment
          ? [
              {
                item: '01',
                sector: this.clean(budget.equipment.name),
                brand: this.clean(budget.equipment.manufacturer ?? '—'),
                model: this.clean(budget.equipment.model ?? '—'),
                capacity: this.clean(budget.equipment.capacity ?? '—'),
              },
            ]
          : [];

    if (budgetEquipmentRows.length > 0) {
      sections.push({
        id: 'budget-equipments',
        title: 'Equipamentos',
        critical: true,
        components: [
          {
            id: 'budget-equipments-table',
            kind: 'table',
            columns: [
              { key: 'item', label: 'ITEM', width: 0.1 },
              { key: 'sector', label: 'SETOR', width: 0.34 },
              { key: 'brand', label: 'MARCA', width: 0.19 },
              { key: 'model', label: 'MODELO', width: 0.19 },
              { key: 'capacity', label: 'CAPACIDADE', width: 0.18 },
            ],
            rows: budgetEquipmentRows,
          },
        ],
      });
    }

    if (template?.headerContent) {
      sections.push({
        id: 'budget-template-header',
        title: 'Cabeçalho',
        components: [
          {
            id: 'budget-header-content',
            kind: 'paragraph',
            text: this.clean(template.headerContent),
          },
        ],
      });
    }

    sections.push({
      id: 'budget-introduction',
      title: 'Apresentação',
      components: [{ id: 'budget-introduction-text', kind: 'paragraph', text: this.clean(budget.introduction) }],
    });

    if (services.length) {
      sections.push({
        id: 'budget-services',
        title: 'Serviços',
        critical: true,
        components: [
          itemTable('budget-services-table', services, {
            amount: budget.serviceDiscount,
            description: budget.serviceDiscountDescription,
          }),
        ],
      });
    }
    if (budget.description) {
      sections.push({
        id: 'budget-service-description',
        title: 'Descrição do(s) serviço(s)',
        components: [
          {
            id: 'budget-service-description-text',
            kind: 'observation',
            text: this.clean(budget.description),
            keepTogether: true,
          },
        ],
      });
    }
    if (catalogMaterials.length) {
      sections.push({
        id: 'budget-material-descriptions',
        title: 'Descrição dos materiais',
        critical: true,
        components: [
          descriptionTable('budget-material-descriptions-table', catalogMaterials),
        ],
      });
    }
    if (commercialMaterials.length) {
      sections.push({
        id: 'budget-commercial-materials',
        title: 'Materiais e fornecimentos',
        critical: true,
        components: [
          itemTable('budget-commercial-materials-table', commercialMaterials, {
            amount: budget.materialDiscount,
            description: budget.materialDiscountDescription,
          }),
        ],
      });
    }

    sections.push({
      id: 'budget-totals',
      title: 'Valores',
      critical: true,
      components: [
        this.metadata('budget-totals-metadata', [
          ['Subtotal dos serviços', this.money(budget.serviceSubtotal)],
          ...(Number(budget.serviceDiscount) > 0
            ? [['Desconto nos serviços', this.money(budget.serviceDiscount)] as [string, string]]
            : []),
          ['Subtotal de materiais e fornecimentos', this.money(budget.materialSubtotal)],
          ...(Number(budget.materialDiscount) > 0
            ? [['Desconto nos materiais', this.money(budget.materialDiscount)] as [string, string]]
            : []),
          ['Total de descontos', this.money(budget.discount)],
          ['Adicional', this.money(budget.additional)],
          ['Valor total', this.money(budget.total)],
          ['Valor por extenso', budget.amountInWords],
        ]),
      ],
    });

    sections.push({
      id: 'budget-commercial-conditions',
      title: 'Condições comerciais',
      components: [
        this.metadata('budget-commercial-metadata', [
          ['Validade da proposta', `${budget.validityDays} dias`],
          [
            'Formas de pagamento',
            budget.paymentMethods.length
              ? budget.paymentMethods.map((method) => paymentLabels[method] ?? method).join(', ')
              : 'A combinar',
          ],
        ]),
        ...([budget.commercialNotes, budget.observations, template?.observations]
          .filter(Boolean).length
          ? [{
              id: 'budget-commercial-observations',
              kind: 'observation' as const,
              text: this.clean(
                [budget.commercialNotes, budget.observations, template?.observations]
                  .filter(Boolean)
                  .join('\n\n'),
              ),
              keepTogether: true,
            }]
          : []),
      ],
    });

    // Orçamento não coleta assinatura do cliente — só o responsável técnico.
    const signature = this.signatureComponent(context, null, true);
    if (signature) {
      sections.push({
        id: 'signature',
        title: 'Assinatura do responsável técnico',
        critical: true,
        components: [signature],
      });
    }

    return sections;
  }

  /** Nome do responsável técnico = assinatura institucional selecionada na revisão. */
  private technicalResponsibleName(context: DocumentBuildContext): string | null {
    const responsible = context.signature.institutionalSignatures[0] ?? null;
    return responsible ? this.clean(responsible.name) : null;
  }

  /** Título/registro do responsável técnico (profissão · conselho · registro). */
  private technicalResponsibleTitle(context: DocumentBuildContext): string | null {
    const responsible = context.signature.institutionalSignatures[0] ?? null;
    if (!responsible) return null;
    const title = [
      responsible.profession,
      responsible.title,
      responsible.professionalCouncil,
      responsible.registrationNumber,
    ]
      .filter(Boolean)
      .join(' · ');
    return title ? this.clean(title) : null;
  }

  private signatureComponent(
    context: DocumentBuildContext,
    institutionalSignedAt: string | null = null,
    onlyInstitutional = false,
  ): DocumentBlueprintComponent | null {
    const { signature } = context;
    if (signature.signatureMode === SignatureMode.NONE) return null;
    // Orçamento: ignora assinaturas de execução (cliente/técnico em campo) e
    // exige apenas o responsável técnico institucional.
    if (!onlyInstitutional && !signature.requiresSignature) return null;

    const signatures: Extract<DocumentBlueprintComponent, { kind: 'signature' }>['signatures'] = [];
    for (const execution of onlyInstitutional ? [] : signature.executionSignatures) {
      signatures.push({
        id: `execution-signature-${execution.role}`,
        role: 'collected',
        label: this.clean(execution.label),
        name: execution.name ? this.clean(execution.name) : null,
        title: execution.title ? this.clean(execution.title) : null,
        signedAt: execution.signedAt,
        caption: execution.caption ? this.clean(execution.caption) : 'Assinatura coletada em campo',
        image: execution.image
          ? {
              mimeType: execution.image.mimeType,
              fileSize: execution.image.fileSize,
              contentBase64: execution.image.contentBase64,
            }
          : null,
      });
    }
    for (const institutional of signature.institutionalSignatures) {
      signatures.push({
        id: institutional.id,
        role: 'fixed',
        label: 'Responsável técnico',
        name: this.clean(institutional.name),
        title: this.clean(
          [
            institutional.profession,
            institutional.title,
            institutional.professionalCouncil,
            institutional.registrationNumber,
            institutional.department,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        signedAt: institutionalSignedAt,
        caption: 'Responsável técnico',
        image: {
          mimeType: institutional.image.mimeType,
          fileSize: institutional.image.fileSize,
          contentBase64: institutional.image.contentBase64,
        },
      });
    }

    if (onlyInstitutional && signatures.length === 0) return null;
    return {
      id: 'document-signature',
      kind: 'signature',
      mode: onlyInstitutional ? SignatureMode.FIXED : signature.signatureMode,
      signatures,
      keepTogether: true,
    };
  }

  private metadata(id: string, entries: Array<[string, string]>): DocumentBlueprintComponent {
    return {
      id,
      kind: 'metadata',
      items: entries.map(([label, value]) => ({
        label: this.clean(label),
        value: this.clean(value),
      })),
      keepTogether: true,
    };
  }

  private checklist(value: Prisma.JsonValue): ChecklistItem[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, DOCUMENT_MAX_TABLE_ROWS).map((item, index) => {
      const record =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      return {
        label: this.clean(typeof record.label === 'string' ? record.label : `Item ${index + 1}`),
        done: Boolean(record.done),
        note:
          typeof record.note === 'string' && record.note.trim() ? this.clean(record.note) : null,
      };
    });
  }

  private address(address: {
    name?: string | null;
    street: string;
    number: string;
    district: string;
    city: string;
    state: string;
  }): string {
    return this.clean(
      [
        address.name,
        `${address.street}, ${address.number}`,
        address.district,
        `${address.city}/${address.state}`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  private organizationAddress(organization: {
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    district?: string | null;
    city: string;
    state: string;
    zipCode?: string | null;
  }): string {
    return this.clean(
      [
        [organization.street, organization.number].filter(Boolean).join(', '),
        organization.complement,
        organization.district,
        `${organization.city}/${organization.state}`,
        organization.zipCode ? `CEP ${organization.zipCode}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  private organizationPhones(organization: BuilderOrganization): string[] {
    return [...new Set([organization.phone, ...(organization.phoneNumbers ?? [])])]
      .map((phone) => this.clean(phone))
      .filter(Boolean);
  }

  private documentHeader(
    organization: BuilderOrganization,
    logo: BuilderLogo,
    title: string,
    documentNumber: string,
    subtitle?: string,
  ): DocumentBlueprint['header'] {
    const resolvedLogo = logo
      ? {
          mimeType: logo.mimeType,
          fileSize: logo.fileSize,
          contentBase64: logo.contentBase64,
        }
      : null;
    return {
      title: this.clean(title),
      subtitle: subtitle ? this.clean(subtitle) : undefined,
      organizationName: this.clean(organization.tradeName || organization.legalName),
      documentNumber: this.clean(documentNumber),
      logo: resolvedLogo,
      corporate: {
        legalName: this.clean(organization.legalName),
        tradeName: this.clean(organization.tradeName),
        cnpj: this.clean(organization.cnpj),
        stateRegistration: this.clean(organization.stateRegistration ?? ''),
        fullAddress: this.organizationAddress(organization),
        city: this.clean(organization.city),
        state: this.clean(organization.state),
        zipCode: this.clean(organization.zipCode ?? ''),
        phoneNumbers: this.organizationPhones(organization),
        email: this.clean(organization.email),
        website: this.clean(organization.website ?? ''),
        logo: resolvedLogo,
      },
    };
  }

  private visualStyle(primary: string): DocumentVisualStyle {
    return {
      colors: {
        primary,
        text: '#0f172a',
        muted: '#64748b',
        border: '#e2e8f0',
        surface: '#f8fafc',
        background: '#ffffff',
      },
      typography: { title: 16, section: 13, body: 10, label: 9, caption: 8 },
      spacing: { section: 8, component: 12, cardPadding: 8 },
    };
  }

  /**
   * Converts persisted technical prose into Blueprint-native paragraphs and lists.
   * The renderer remains document-agnostic and receives no TECHNICAL_REPORT rules.
   */
  private technicalNarrative(
    id: string,
    value: string | null,
    fallback: string,
  ): DocumentBlueprintComponent[] {
    const source = value?.trim() || fallback;
    const components: DocumentBlueprintComponent[] = [];
    let list: string[] = [];
    let sequence = 0;
    const flushList = (): void => {
      if (list.length === 0) return;
      components.push({ id: `${id}-list-${sequence++}`, kind: 'list', items: list });
      list = [];
    };

    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        flushList();
        continue;
      }
      const bullet = line.match(/^(?:[-*•✓✔]|\d+[.)])\s*(.+)$/u);
      if (bullet) {
        list.push(this.clean(bullet[1]));
        continue;
      }
      flushList();
      components.push({
        id: `${id}-paragraph-${sequence++}`,
        kind: 'paragraph',
        text: this.clean(line),
        keepTogether: true,
      });
    }
    flushList();
    return components;
  }

  /** Preserves authored technical paragraphs without interpreting bullets as operational data. */
  private technicalProse(
    id: string,
    value: string | null,
    fallback: string,
  ): DocumentBlueprintComponent[] {
    const source = value?.trim() || fallback;
    const paragraphs = source
      .split(/\n\s*\n/u)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    return (paragraphs.length > 0 ? paragraphs : [fallback]).map((paragraph, index) => ({
      id: `${id}-paragraph-${index}`,
      kind: 'paragraph',
      text: this.clean(paragraph),
      keepTogether: true,
    }));
  }

  /** Renders the technician's authored statement first and catalog snapshots as a complement. */
  private technicalStatementWithItems(
    id: string,
    statement: string | null,
    selectedItems: string[],
    fallback: string,
  ): DocumentBlueprintComponent[] {
    const components = this.technicalProse(id, statement, fallback);
    const items = selectedItems.map((item) => this.clean(item)).filter(Boolean);
    if (items.length > 0) {
      components.push({
        id: `${id}-complementary-items`,
        kind: 'list',
        items,
      });
    }
    return components;
  }

  private lines(value: string | null): string[] {
    if (!value) return [];
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean)
      .map((line) => this.clean(line));
  }

  private equipmentTypeLabel(value: string): string {
    const labels: Record<string, string> = {
      SPLIT: 'Split',
      CONDENSER: 'Unidade condensadora',
      EVAPORATOR: 'Unidade evaporadora',
      CHILLER: 'Chiller',
      AIR_HANDLER: 'Unidade de tratamento de ar',
      SOLAR_INVERTER: 'Inversor solar',
      ELECTRICAL_PANEL: 'Painel elétrico',
      GENERATOR: 'Gerador',
      OTHER: 'Outro sistema',
    };
    return labels[value] ?? value;
  }

  private operationTypeLabel(value: string): string {
    const labels: Record<string, string> = {
      PREVENTIVA: 'Manutenção preventiva',
      CORRETIVA: 'Manutenção corretiva',
      INSTALACAO: 'Instalação',
      PROJETO: 'Projeto / inspeção técnica',
    };
    return labels[value] ?? value;
  }

  private receiptCustomerLabel(customer: {
    name: string;
    tradeName: string | null;
    cpf: string | null;
    cnpj: string | null;
  }): string {
    const name = customer.tradeName?.trim() || customer.name.trim();
    if (customer.cnpj) return `${name}, CNPJ nº ${this.customerDocument(customer.cnpj)}`;
    if (customer.cpf) return `${name}, CPF nº ${this.customerDocument(customer.cpf)}`;
    return name;
  }

  private customerDocument(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length === 11)
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (digits.length === 14)
      return digits.replace(
        /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
        '$1.$2.$3/$4-$5',
      );
    return value;
  }

  private date(value: Date | string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Recife',
    }).format(new Date(value));
  }

  private dateOnly(value: Date | string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeZone: 'America/Recife',
    }).format(new Date(value));
  }

  /**
   * Datas de cobertura/recorrência representam um dia civil, não um instante.
   * Prisma materializa colunas PostgreSQL DATE em 00:00 UTC; formatá-las em BRT
   * faria 28/07 aparecer como 27/07.
   */
  private calendarDate(value: Date | string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value));
  }

  private decimal(value: Prisma.Decimal | number | string): string {
    return Number(value).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });
  }

  private money(value: Prisma.Decimal | number | string): string {
    return Number(value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  private titleFor(type: DocumentTemplateType): string {
    const titles: Record<DocumentTemplateType, string> = {
      BUDGET: 'Orçamento',
      QUOTE: 'Orçamento',
      WORK_ORDER: 'Ordem de Serviço',
      RECEIPT: 'RECIBO / GARANTIA',
      REPORT: 'Relatório legado',
      TECHNICAL_REPORT: 'Relatório de Visita Técnica',
      TECHNICAL_OPINION: 'Laudo Técnico',
      PMOC: 'PMOC',
    };
    return titles[type];
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
      .trim()
      .slice(0, 5000);
  }

  private slug(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  private assertBlueprintLimits(sections: DocumentSection[]): void {
    const components = sections.flatMap((section) => section.components);
    const tableRows = components
      .filter(
        (component): component is Extract<DocumentBlueprintComponent, { kind: 'table' }> =>
          component.kind === 'table',
      )
      .reduce((total, table) => total + table.rows.length, 0);
    if (
      sections.length > DOCUMENT_MAX_SECTIONS ||
      components.length > DOCUMENT_MAX_COMPONENTS ||
      tableRows > DOCUMENT_MAX_TABLE_ROWS
    ) {
      throw new ApplicationException(
        ERROR_CODES.DOCUMENT_SIZE_LIMIT_EXCEEDED,
        'Document blueprint exceeds production limits',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

function generatedDate(value: string): string {
  return new Date(value).toISOString();
}
