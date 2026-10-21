import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DocumentTemplateType, Prisma, SignatureMode } from '@prisma/client';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import { PrismaService } from '../../database/prisma.service';

const CONFIG_TEMPLATE_SELECT = {
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
    orderBy: { position: 'asc' as const },
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
} satisfies Prisma.DocumentTemplateSelect;

const CONFIG_ORGANIZATION_SELECT = {
  id: true,
  legalName: true,
  tradeName: true,
  cnpj: true,
  stateRegistration: true,
  email: true,
  phone: true,
  phoneNumbers: true,
  website: true,
  zipCode: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  city: true,
  state: true,
  primaryColor: true,
  secondaryColor: true,
} satisfies Prisma.OrganizationSelect;

const CONFIG_SETTINGS_SELECT = {
  id: true,
  language: true,
  timezone: true,
  currency: true,
  documentPrefix: true,
} satisfies Prisma.OrganizationSettingsSelect;

export type DocumentConfigurationTemplate = Prisma.DocumentTemplateGetPayload<{
  select: typeof CONFIG_TEMPLATE_SELECT;
}>;

export type DocumentConfiguration = {
  type: DocumentTemplateType;
  organization: Prisma.OrganizationGetPayload<{ select: typeof CONFIG_ORGANIZATION_SELECT }>;
  settings: Prisma.OrganizationSettingsGetPayload<{ select: typeof CONFIG_SETTINGS_SELECT }>;
  defaultTemplate: DocumentConfigurationTemplate | null;
  templates: DocumentConfigurationTemplate[];
};

@Injectable()
export class DocumentConfigurationService implements OnModuleInit {
  private readonly logger = new Logger(DocumentConfigurationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Garante que exista um modelo PMOC ativo assim que a aplicação inicia, para
    // que o wizard de PMOC nunca reporte "Nenhum modelo PMOC ativo".
    await this.ensureSystemPmocTemplate().catch((error: unknown) => {
      this.logger.warn(
        `Could not ensure default PMOC template: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /**
   * Garante o modelo PMOC padrão do sistema, ativo por padrão. O PMOC usa política
   * FIXED: somente o responsável técnico institucional assina — **sem** assinatura
   * do cliente (assim o PMOC pode ser finalizado sem essa coleta). A assinatura
   * institucional efetiva é escolhida por PMOC (signatureOverrideId); o modelo só
   * define a política. Idempotente: cria se não existir e reconcilia o modelo de
   * sistema caso ainda esteja com política antiga (HYBRID/COLLECTED). Não altera
   * modelos criados manualmente pela gestão.
   */
  private async ensureSystemPmocTemplate(): Promise<void> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) return;

    const systemTemplate = await this.prisma.documentTemplate.findFirst({
      where: {
        organizationId: organization.id,
        type: DocumentTemplateType.PMOC,
        isSystem: true,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, isActive: true, signatureMode: true, executionSignatureClient: true },
    });
    if (systemTemplate) {
      if (
        !systemTemplate.isActive ||
        systemTemplate.signatureMode !== SignatureMode.FIXED ||
        systemTemplate.executionSignatureClient
      ) {
        await this.prisma.documentTemplate.update({
          where: { id: systemTemplate.id },
          data: {
            isActive: true,
            requiresSignature: true,
            signatureMode: SignatureMode.FIXED,
            executionSignatureClient: false,
            executionSignatureTechnician: true,
          },
        });
        this.logger.log('Default PMOC document template reconciled to FIXED (technical-only) policy.');
      }
      return;
    }

    // Respeita um modelo PMOC ativo criado manualmente pela gestão.
    const anyActive = await this.prisma.documentTemplate.findFirst({
      where: {
        organizationId: organization.id,
        type: DocumentTemplateType.PMOC,
        isActive: true,
      },
      select: { id: true },
    });
    if (anyActive) return;

    await this.prisma.documentTemplate.create({
      data: {
        organizationId: organization.id,
        type: DocumentTemplateType.PMOC,
        name: 'PMOC — Modelo padrão',
        headerContent: '',
        footerContent: '',
        observations: '',
        isDefault: true,
        isSystem: true,
        isActive: true,
        requiresSignature: true,
        signatureMode: SignatureMode.FIXED,
        executionSignatureClient: false,
        executionSignatureTechnician: true,
      },
    });
    this.logger.log('Default active PMOC document template created (technical-only signature).');
  }

  async listConfigurations(): Promise<DocumentConfiguration[]> {
    const types = Object.values(DocumentTemplateType);
    return Promise.all(types.map((type) => this.getConfigurationForType(type)));
  }

  async listPublicConfigurations(): Promise<unknown[]> {
    return (await this.listConfigurations()).map((configuration) =>
      this.publicConfiguration(configuration),
    );
  }

  async getPublicConfigurationForType(type: DocumentTemplateType): Promise<unknown> {
    return this.publicConfiguration(await this.getConfigurationForType(type));
  }

  async getPublicConfigurationByTemplate(templateId: string): Promise<unknown> {
    return this.publicConfiguration(await this.getConfigurationByTemplate(templateId));
  }

  async getConfigurationForType(type: DocumentTemplateType): Promise<DocumentConfiguration> {
    const [organization, settings, templates] = await Promise.all([
      this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: CONFIG_ORGANIZATION_SELECT,
      }),
      this.prisma.organizationSettings.findFirst({
        orderBy: { createdAt: 'asc' },
        select: CONFIG_SETTINGS_SELECT,
      }),
      this.prisma.documentTemplate.findMany({
        where: { type, isActive: true },
        select: CONFIG_TEMPLATE_SELECT,
        orderBy: [{ isDefault: 'desc' }, { isSystem: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    if (!organization || !settings) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Cadastre a organização antes de configurar documentos',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      type,
      organization,
      settings,
      defaultTemplate: templates.find((template) => template.isDefault) ?? templates[0] ?? null,
      templates,
    };
  }

  async getConfigurationByTemplate(templateId: string): Promise<DocumentConfiguration> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id: templateId },
      select: { type: true },
    });
    if (!template) {
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Modelo de documento não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.getConfigurationForType(template.type);
  }

  private publicConfiguration(configuration: DocumentConfiguration): Record<string, unknown> {
    const sanitizeTemplate = (template: DocumentConfigurationTemplate): Record<string, unknown> => ({
      ...template,
      signature: template.signature ? this.publicSignature(template.signature) : null,
      institutionalSignatures: template.institutionalSignatures.map((link) => ({
        position: link.position,
        signature: this.publicSignature(link.signature),
      })),
    });
    return {
      ...configuration,
      defaultTemplate: configuration.defaultTemplate
        ? sanitizeTemplate(configuration.defaultTemplate)
        : null,
      templates: configuration.templates.map(sanitizeTemplate),
    };
  }

  private publicSignature(signature: {
    id: string;
    name: string;
    title: string;
    professionalCouncil: string | null;
    department: string | null;
    mimeType: string | null;
    fileSize: number | null;
    active: boolean;
    deletedAt?: Date | null;
  }): Record<string, unknown> {
    return {
      id: signature.id,
      name: signature.name,
      title: signature.title,
      professionalCouncil: signature.professionalCouncil,
      department: signature.department,
      active: signature.active,
      hasImage: Boolean(signature.mimeType && signature.fileSize),
      ...(signature.deletedAt !== undefined ? { deletedAt: signature.deletedAt } : {}),
    };
  }
}
