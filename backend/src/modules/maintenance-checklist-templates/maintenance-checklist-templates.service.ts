import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  TechnicalCatalogArea,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import {
  MAINTENANCE_CHECKLIST_TEMPLATE_AUDIT_ACTIONS,
  MAINTENANCE_CHECKLIST_TEMPLATE_RESOURCE,
} from '../../shared/constants/maintenance-checklist-templates.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateMaintenanceChecklistTemplateDto,
  ListMaintenanceChecklistTemplatesQueryDto,
  UpdateMaintenanceChecklistTemplateDto,
} from './dto/maintenance-checklist-template.dto';

const CATALOG_SELECT = {
  id: true,
  organizationId: true,
  maintenanceType: true,
  title: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TechnicalCatalogSelect;

type ChecklistCatalog = Prisma.TechnicalCatalogGetPayload<{ select: typeof CATALOG_SELECT }>;

export interface MaintenanceChecklistTemplateAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class MaintenanceChecklistTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMaintenanceChecklistTemplatesQueryDto): Promise<unknown> {
    const organizationId = await this.organizationId();
    const where: Prisma.TechnicalCatalogWhereInput = {
      organizationId,
      type: TechnicalCatalogType.CHECKLIST,
      deletedAt: null,
      ...(query.maintenanceType ? { maintenanceType: query.maintenanceType } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [catalogs, total] = await this.prisma.$transaction([
      this.prisma.technicalCatalog.findMany({
        where,
        select: CATALOG_SELECT,
        orderBy: [{ maintenanceType: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.technicalCatalog.count({ where }),
    ]);
    return buildPaginatedResponse(
      catalogs.map((item) => this.compatible(item)),
      total,
      query.page,
      query.limit,
    );
  }

  async get(id: string): Promise<unknown> {
    return this.compatible(await this.templateOrThrow(id, await this.organizationId()));
  }

  async create(
    dto: CreateMaintenanceChecklistTemplateDto,
    actor: AuthenticatedUser,
    context: MaintenanceChecklistTemplateAuditContext,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    const max = await this.prisma.technicalCatalog.aggregate({
      where: {
        organizationId,
        type: TechnicalCatalogType.CHECKLIST,
        maintenanceType: dto.maintenanceType,
        deletedAt: null,
      },
      _max: { sortOrder: true },
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.technicalCatalog.create({
          data: {
            organizationId,
            type: TechnicalCatalogType.CHECKLIST,
            maintenanceType: dto.maintenanceType,
            title: this.clean(dto.description),
            tags: ['manutencao'],
            areas: [TechnicalCatalogArea.GENERAL],
            workflows: [
              TechnicalCatalogWorkflow.GENERAL,
              TechnicalCatalogWorkflow.MAINTENANCE,
              TechnicalCatalogWorkflow.WORK_ORDER,
              TechnicalCatalogWorkflow.TECHNICAL_REPORT,
              TechnicalCatalogWorkflow.PMOC,
            ],
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            active: dto.active ?? true,
          },
          select: CATALOG_SELECT,
        });
        await tx.auditLog.create({
          data: this.audit(MAINTENANCE_CHECKLIST_TEMPLATE_AUDIT_ACTIONS.CREATED, actor, context, {
            templateId: created.id,
            maintenanceType: created.maintenanceType,
            technicalCatalog: true,
          }),
        });
        return this.compatible(created);
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(
    id: string,
    dto: UpdateMaintenanceChecklistTemplateDto,
    actor: AuthenticatedUser,
    context: MaintenanceChecklistTemplateAuditContext,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    await this.templateOrThrow(id, organizationId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.technicalCatalog.update({
          where: { id },
          data: {
            ...(dto.maintenanceType !== undefined ? { maintenanceType: dto.maintenanceType } : {}),
            ...(dto.description !== undefined ? { title: this.clean(dto.description) } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
          },
          select: CATALOG_SELECT,
        });
        await tx.auditLog.create({
          data: this.audit(MAINTENANCE_CHECKLIST_TEMPLATE_AUDIT_ACTIONS.UPDATED, actor, context, {
            templateId: id,
            changedFields: Object.keys(dto),
            technicalCatalog: true,
          }),
        });
        return this.compatible(updated);
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async deactivate(
    id: string,
    actor: AuthenticatedUser,
    context: MaintenanceChecklistTemplateAuditContext,
  ): Promise<{ deactivated: true }> {
    const organizationId = await this.organizationId();
    await this.templateOrThrow(id, organizationId);
    await this.prisma.$transaction([
      this.prisma.technicalCatalog.update({ where: { id }, data: { active: false } }),
      this.prisma.auditLog.create({
        data: this.audit(MAINTENANCE_CHECKLIST_TEMPLATE_AUDIT_ACTIONS.DEACTIVATED, actor, context, {
          templateId: id,
          softDelete: false,
          technicalCatalog: true,
        }),
      }),
    ]);
    return { deactivated: true };
  }

  private compatible(item: ChecklistCatalog): {
    id: string;
    organizationId: string;
    maintenanceType: ChecklistCatalog['maintenanceType'];
    description: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: item.id,
      organizationId: item.organizationId,
      maintenanceType: item.maintenanceType,
      description: item.title,
      active: item.active,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private async organizationId(): Promise<string> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organização não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization.id;
  }

  private async templateOrThrow(id: string, organizationId: string): Promise<ChecklistCatalog> {
    const template = await this.prisma.technicalCatalog.findFirst({
      where: { id, organizationId, type: TechnicalCatalogType.CHECKLIST, deletedAt: null },
      select: CATALOG_SELECT,
    });
    if (!template) {
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_CHECKLIST_TEMPLATE_NOT_FOUND,
        'Modelo de checklist de manutenção não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return template;
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApplicationException(
        ERROR_CODES.MAINTENANCE_CHECKLIST_TEMPLATE_CONFLICT,
        'Já existe um item de checklist igual para este tipo de manutenção',
        HttpStatus.CONFLICT,
      );
    }
    throw error;
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

  private audit(
    action: string,
    actor: AuthenticatedUser,
    context: MaintenanceChecklistTemplateAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource: MAINTENANCE_CHECKLIST_TEMPLATE_RESOURCE,
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

export function checklistTemplateContextFromRequest(
  request: RequestWithId,
): MaintenanceChecklistTemplateAuditContext {
  return {
    requestId: request.requestId,
    ip: request.ip || null,
    userAgent: request.get('user-agent') ?? null,
  };
}
