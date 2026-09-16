import {
  DocumentTemplateType,
  EquipmentType,
  OperationMaintenanceType,
  PrismaClient,
  Role,
  SignatureMode,
  TechnicalCatalogArea,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from './infra/security/argon2.constants';
import { MIN_PASSWORD_LENGTH } from './shared/constants/users.constants';
import { SYSTEM_SERVICE_TYPE_SEED } from './shared/constants/service-types.constants';

const prisma = new PrismaClient();

type OwnerBootstrapInput = {
  email: string;
  username: string;
  name: string;
  password: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to bootstrap the initial OWNER`);
  return value;
}

function ownerBootstrapInput(): OwnerBootstrapInput {
  const input = {
    email: requiredEnvironment('OWNER_EMAIL').toLowerCase(),
    username: requiredEnvironment('OWNER_USERNAME').toLowerCase(),
    name: requiredEnvironment('OWNER_NAME'),
    password: requiredEnvironment('OWNER_PASSWORD'),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254) {
    throw new Error('OWNER_EMAIL must be a valid email address with at most 254 characters');
  }
  if (!/^[a-z0-9._-]{3,50}$/.test(input.username)) {
    throw new Error(
      'OWNER_USERNAME must contain 3 to 50 lowercase letters, numbers, dots, underscores or hyphens',
    );
  }
  if (input.name.length < 2 || input.name.length > 150) {
    throw new Error('OWNER_NAME must contain between 2 and 150 characters');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 128) {
    throw new Error(
      `OWNER_PASSWORD must contain between ${MIN_PASSWORD_LENGTH} and 128 characters`,
    );
  }
  const normalizedPassword = input.password.toLowerCase();
  if (
    ['replace_with', 'change_me', 'changeme', 'example', 'password'].some((fragment) =>
      normalizedPassword.includes(fragment),
    )
  ) {
    throw new Error('OWNER_PASSWORD must not use a placeholder or example value');
  }

  return input;
}

async function main(): Promise<void> {
  const input = ownerBootstrapInput();
  // The whole application assumes a single Organization exists (profile, settings,
  // templates all resolve `findFirst`). Guarantee one so first login works.
  await ensureDefaultOrganization();
  await ensureEquipmentTypeDefaults();
  await ensureActivePmocTemplate();
  await ensureRvtChecklistDefaults();
  const [emailUser, usernameUser, userCount] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email } }),
    prisma.user.findUnique({ where: { username: input.username } }),
    prisma.user.count(),
  ]);

  if (emailUser || usernameUser) {
    if (!emailUser || !usernameUser || emailUser.id !== usernameUser.id) {
      throw new Error('OWNER_EMAIL and OWNER_USERNAME belong to different existing users');
    }
    if (emailUser.role !== Role.OWNER) {
      throw new Error('The configured bootstrap user exists but is not an OWNER');
    }
    if (!emailUser.isActive || emailUser.disabledAt) {
      throw new Error('The configured bootstrap OWNER is disabled');
    }

    await ensureOwnerFoundation(emailUser.id);
    process.stdout.write(
      `${JSON.stringify({
        event: 'owner_bootstrap_skipped',
        reason: 'owner_already_exists',
        userId: emailUser.id,
      })}\n`,
    );
    return;
  }

  if (userCount > 0) {
    throw new Error(
      'The database already contains users. The bootstrap seed can only create the first OWNER',
    );
  }

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
  const owner = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      name: input.name,
      passwordHash,
      role: Role.OWNER,
      isActive: true,
      mustChangePassword: true,
      preferences: { create: {} },
      permission: {
        create: {
          canFinancial: true,
          canUsers: true,
          canReports: true,
          canSchedules: true,
          canTemplates: true,
        },
      },
    },
    select: { id: true, email: true, username: true, name: true, role: true },
  });

  process.stdout.write(
    `${JSON.stringify({
      event: 'owner_bootstrap_created',
      user: owner,
      mustChangePassword: true,
    })}\n`,
  );
}

/**
 * Cria APENAS o que faltar para o owner (preferências e permissões) — nunca
 * sobrescreve dados já existentes. Os blocos `update` são intencionalmente vazios
 * (no-op): se o registro já existe, é preservado exatamente como está. Assim o
 * seed é seguro em produção mesmo com owner/org já criados.
 */
async function ensureOwnerFoundation(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.userPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    }),
    prisma.userPermission.upsert({
      where: { userId },
      create: {
        userId,
        canFinancial: true,
        canUsers: true,
        canReports: true,
        canSchedules: true,
        canTemplates: true,
      },
      // Não altera permissões já existentes — só cria quando ainda não há registro.
      update: {},
    }),
  ]);
}

type OrganizationBootstrapInput = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  primaryColor: string;
  secondaryColor: string;
  segment: string | null;
  language: string;
  timezone: string;
  currency: string;
  documentPrefix: string;
};

/** Read an optional environment variable, falling back to a default when unset. */
function optionalEnvironment(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/**
 * Read the initial Organization from the environment — same approach as the OWNER
 * bootstrap. Identity fields are required; presentational/locale fields fall back
 * to sensible defaults. Validated against the schema column limits.
 */
function organizationBootstrapInput(): OrganizationBootstrapInput {
  const input: OrganizationBootstrapInput = {
    legalName: requiredEnvironment('ORGANIZATION_LEGAL_NAME'),
    tradeName: requiredEnvironment('ORGANIZATION_TRADE_NAME'),
    cnpj: requiredEnvironment('ORGANIZATION_CNPJ'),
    email: requiredEnvironment('ORGANIZATION_EMAIL').toLowerCase(),
    phone: requiredEnvironment('ORGANIZATION_PHONE'),
    city: requiredEnvironment('ORGANIZATION_CITY'),
    state: requiredEnvironment('ORGANIZATION_STATE').toUpperCase(),
    primaryColor: optionalEnvironment('ORGANIZATION_PRIMARY_COLOR', '#2563EB'),
    secondaryColor: optionalEnvironment('ORGANIZATION_SECONDARY_COLOR', '#1E3A8A'),
    segment: process.env.ORGANIZATION_SEGMENT?.trim() || null,
    language: optionalEnvironment('ORGANIZATION_LANGUAGE', 'pt-BR'),
    timezone: optionalEnvironment('ORGANIZATION_TIMEZONE', 'America/Sao_Paulo'),
    currency: optionalEnvironment('ORGANIZATION_CURRENCY', 'BRL').toUpperCase(),
    documentPrefix: optionalEnvironment('ORGANIZATION_DOCUMENT_PREFIX', 'DOC'),
  };

  if (input.legalName.length < 2 || input.legalName.length > 180) {
    throw new Error('ORGANIZATION_LEGAL_NAME must contain between 2 and 180 characters');
  }
  if (input.tradeName.length < 2 || input.tradeName.length > 120) {
    throw new Error('ORGANIZATION_TRADE_NAME must contain between 2 and 120 characters');
  }
  if (input.cnpj.length < 14 || input.cnpj.length > 18) {
    throw new Error('ORGANIZATION_CNPJ must contain between 14 and 18 characters');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254) {
    throw new Error('ORGANIZATION_EMAIL must be a valid email address with at most 254 characters');
  }
  if (input.phone.length < 8 || input.phone.length > 30) {
    throw new Error('ORGANIZATION_PHONE must contain between 8 and 30 characters');
  }
  if (input.city.length < 2 || input.city.length > 100) {
    throw new Error('ORGANIZATION_CITY must contain between 2 and 100 characters');
  }
  if (!/^[A-Z]{2}$/.test(input.state)) {
    throw new Error('ORGANIZATION_STATE must be a 2-letter state code (e.g. SP)');
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(input.primaryColor) || !/^#[0-9a-fA-F]{6}$/.test(input.secondaryColor)) {
    throw new Error('ORGANIZATION_PRIMARY_COLOR and ORGANIZATION_SECONDARY_COLOR must be hex colors (e.g. #2563EB)');
  }
  if (input.segment && input.segment.length > 80) {
    throw new Error('ORGANIZATION_SEGMENT must contain at most 80 characters');
  }
  if (input.language.length > 10) throw new Error('ORGANIZATION_LANGUAGE must contain at most 10 characters');
  if (input.timezone.length > 80) throw new Error('ORGANIZATION_TIMEZONE must contain at most 80 characters');
  if (input.currency.length !== 3) throw new Error('ORGANIZATION_CURRENCY must be a 3-letter code (e.g. BRL)');
  if (input.documentPrefix.length < 1 || input.documentPrefix.length > 20) {
    throw new Error('ORGANIZATION_DOCUMENT_PREFIX must contain between 1 and 20 characters');
  }

  return input;
}

/**
 * Guarantee a single Organization (+ settings) from the environment. Every request
 * path resolves the organization via `findFirst`, so the app is unusable without
 * one. Idempotent: does nothing when an organization already exists (so it never
 * requires the ORGANIZATION_* variables on subsequent runs) and repairs databases
 * bootstrapped before this step existed.
 */
/**
 * Garante um modelo de documento PMOC ativo e padrão. Idempotente: se já existir
 * um PMOC ativo, não faz nada; senão cria um (política FIXED — somente o
 * responsável técnico assina, sem assinatura do cliente), marca como padrão,
 * ativo e de sistema. Roda sempre (mesmo em bases já existentes) para que o
 * wizard de PMOC nunca reporte "Nenhum modelo PMOC ativo foi encontrado".
 */
async function ensureActivePmocTemplate(): Promise<void> {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!organization) return;

  const active = await prisma.documentTemplate.findFirst({
    where: { organizationId: organization.id, type: DocumentTemplateType.PMOC, isActive: true },
    select: { id: true },
  });
  if (active) return;

  await prisma.documentTemplate.create({
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
  process.stdout.write(
    `${JSON.stringify({ event: 'pmoc_default_template_created', organizationId: organization.id })}\n`,
  );
}

async function ensureDefaultOrganization(): Promise<void> {
  const existing = await prisma.organization.findFirst({ select: { id: true } });
  if (existing) return;

  const input = organizationBootstrapInput();
  const organization = await prisma.organization.create({
    data: {
      legalName: input.legalName,
      tradeName: input.tradeName,
      cnpj: input.cnpj,
      email: input.email,
      phone: input.phone,
      city: input.city,
      state: input.state,
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      segment: input.segment,
      isActive: true,
      settings: {
        create: {
          language: input.language,
          timezone: input.timezone,
          currency: input.currency,
          documentPrefix: input.documentPrefix,
        },
      },
    },
    select: { id: true },
  });
  // Tipos de serviço do sistema (Preventiva/Corretiva/Instalação/Projeto). A
  // migração cuida das orgs existentes; aqui cobrimos a criação de uma org nova.
  await prisma.serviceType.createMany({
    data: SYSTEM_SERVICE_TYPE_SEED.map((t) => ({
      organizationId: organization.id,
      key: t.key,
      label: t.label,
      isSystem: true,
      sortOrder: t.sortOrder,
      generatesReminder: t.generatesReminder,
      reminderIntervalMonths: t.reminderIntervalMonths,
    })),
    skipDuplicates: true,
  });
  process.stdout.write(
    `${JSON.stringify({ event: 'organization_bootstrap_created', organizationId: organization.id })}\n`,
  );
}

const EQUIPMENT_TYPE_DEFAULTS: Array<{
  legacyType: EquipmentType;
  title: string;
  sortOrder: number;
}> = [
  { legacyType: EquipmentType.SPLIT, title: 'Split', sortOrder: 0 },
  { legacyType: EquipmentType.CHILLER, title: 'Chiller', sortOrder: 1 },
  { legacyType: EquipmentType.CONDENSER, title: 'Condensadora', sortOrder: 2 },
  { legacyType: EquipmentType.EVAPORATOR, title: 'Evaporadora', sortOrder: 3 },
  { legacyType: EquipmentType.AIR_HANDLER, title: 'Fan Coil / AHU', sortOrder: 4 },
  { legacyType: EquipmentType.SOLAR_INVERTER, title: 'Inversor Solar', sortOrder: 5 },
  { legacyType: EquipmentType.ELECTRICAL_PANEL, title: 'Quadro Elétrico', sortOrder: 6 },
  { legacyType: EquipmentType.GENERATOR, title: 'Gerador', sortOrder: 7 },
  { legacyType: EquipmentType.OTHER, title: 'Outro', sortOrder: 8 },
];

async function ensureEquipmentTypeDefaults(): Promise<void> {
  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) throw new Error('Organization is required before equipment type bootstrap');
  const existing = await prisma.technicalCatalog.findMany({
    where: {
      organizationId: organization.id,
      type: TechnicalCatalogType.EQUIPMENT_TYPE,
    },
    select: { id: true, tags: true },
  });
  const existingTags = new Set(existing.flatMap((item) => item.tags));
  const missing = EQUIPMENT_TYPE_DEFAULTS.filter(
    ({ legacyType }) =>
      !existingTags.has(`legacy-${legacyType.toLowerCase().replaceAll('_', '-')}`),
  );
  if (missing.length > 0) {
    await prisma.technicalCatalog.createMany({
      data: missing.map(({ legacyType, title, sortOrder }) => ({
        organizationId: organization.id,
        type: TechnicalCatalogType.EQUIPMENT_TYPE,
        title,
        description: 'Tipo de equipamento preservado da classificação oficial V1.',
        tags: [
          'equipment-type',
          `legacy-${legacyType.toLowerCase().replaceAll('_', '-')}`,
        ],
        areas: [TechnicalCatalogArea.GENERAL],
        workflows: [TechnicalCatalogWorkflow.GENERAL],
        sortOrder,
        active: true,
      })),
    });
  }
  const catalogs = await prisma.technicalCatalog.findMany({
    where: {
      organizationId: organization.id,
      type: TechnicalCatalogType.EQUIPMENT_TYPE,
    },
    select: { id: true, tags: true },
  });
  for (const { legacyType } of EQUIPMENT_TYPE_DEFAULTS) {
    const tag = `legacy-${legacyType.toLowerCase().replaceAll('_', '-')}`;
    const catalog = catalogs.find((item) => item.tags.includes(tag));
    if (!catalog) continue;
    await prisma.equipment.updateMany({
      where: { type: legacyType, equipmentTypeCatalogId: null },
      data: { equipmentTypeCatalogId: catalog.id },
    });
  }
}

const RVT_CHECKLIST_DEFAULTS: Array<{
  maintenanceType: OperationMaintenanceType;
  title: string;
  sortOrder: number;
}> = [
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Desinstalação dos equipamentos internos', sortOrder: 0 },
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Limpeza total dos trocadores de calor (com produtos químicos não corrosivos)', sortOrder: 1 },
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Lubrificação do motor ventilador', sortOrder: 2 },
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Aplicação de banho de borracha no chassi', sortOrder: 3 },
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Limpeza dos ventiladores dos evaporadores e lubrificação dos mancais', sortOrder: 4 },
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Substituição (quando necessário) dos terminais de fios carbonizados', sortOrder: 5 },
  { maintenanceType: OperationMaintenanceType.SEMIANNUAL, title: 'Recomendação para execução dos serviços', sortOrder: 6 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Limpeza de filtro de ar', sortOrder: 0 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Limpeza dos painéis de comando', sortOrder: 1 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Limpeza exterior dos equipamentos', sortOrder: 2 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Desobstrução do dreno', sortOrder: 3 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Verificar ruídos mecânicos estranhos', sortOrder: 4 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Verificar o estado das fiações nas instalações elétricas', sortOrder: 5 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Verificar aperto de todos os terminais', sortOrder: 6 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Medir tensão de alimentação elétrica, corrente nominal dos compressores e ventiladores', sortOrder: 7 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Verificar e regular relés térmicos, sensores de temperatura, termostato, circuito elétrico de comando e pressostato', sortOrder: 8 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Verificar folga dos eixos dos ventiladores', sortOrder: 9 },
  { maintenanceType: OperationMaintenanceType.WEEKLY, title: 'Recomendação para execução dos serviços', sortOrder: 10 },
];

/**
 * Defaults de produção para instalações novas. A migration cobre organizações
 * existentes; este bootstrap cobre a organização criada depois do migrate em um
 * banco vazio. Itens removidos pelo Owner não são recriados.
 */
async function ensureRvtChecklistDefaults(): Promise<void> {
  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) throw new Error('Organization is required before RVT checklist bootstrap');
  const existing = await prisma.technicalCatalog.findMany({
    where: {
      organizationId: organization.id,
      type: TechnicalCatalogType.CHECKLIST,
      maintenanceType: { in: [OperationMaintenanceType.WEEKLY, OperationMaintenanceType.SEMIANNUAL] },
      workflows: { has: TechnicalCatalogWorkflow.TECHNICAL_REPORT },
    },
    select: { maintenanceType: true, title: true },
  });
  const keys = new Set(
    existing.map((item) => `${item.maintenanceType}:${item.title.trim().toLocaleLowerCase('pt-BR')}`),
  );
  const missing = RVT_CHECKLIST_DEFAULTS.filter(
    (item) => !keys.has(`${item.maintenanceType}:${item.title.toLocaleLowerCase('pt-BR')}`),
  );
  if (!missing.length) return;
  await prisma.technicalCatalog.createMany({
    data: missing.map((item) => ({
      organizationId: organization.id,
      type: TechnicalCatalogType.CHECKLIST,
      title: item.title,
      tags: ['rvt', 'manutencao', item.maintenanceType.toLowerCase()],
      areas: [TechnicalCatalogArea.GENERAL, TechnicalCatalogArea.HVAC],
      workflows: [TechnicalCatalogWorkflow.TECHNICAL_REPORT],
      maintenanceType: item.maintenanceType,
      sortOrder: item.sortOrder,
      active: true,
    })),
  });
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: 'owner_bootstrap_failed',
        message: error instanceof Error ? error.message : 'Unknown bootstrap error',
      })}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
