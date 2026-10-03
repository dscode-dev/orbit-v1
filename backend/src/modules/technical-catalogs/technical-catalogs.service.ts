import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  TechnicalCatalogArea,
  TechnicalCatalogType,
  TechnicalCatalogWorkflow,
} from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateTechnicalCatalogDto,
  ListTechnicalCatalogsQueryDto,
  ReorderTechnicalCatalogDto,
  UpdateTechnicalCatalogDto,
} from './dto/technical-catalog.dto';

const CATALOG_SELECT = {
  id: true,
  organizationId: true,
  type: true,
  title: true,
  description: true,
  tags: true,
  areas: true,
  workflows: true,
  maintenanceType: true,
  pmocUnit: true,
  sortOrder: true,
  active: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TechnicalCatalogSelect;

const TYPE_LABELS: Record<TechnicalCatalogType, string> = {
  CHECKLIST: 'Checklists de manutenção',
  OBJECTIVE: 'Objetivos',
  SITE_CONDITION: 'Condições Observadas',
  CONCLUSION: 'Conclusões',
  RECOMMENDATION: 'Recomendações',
  PLAN_SCOPE: 'Escopos de plano',
  EQUIPMENT_TYPE: 'Checklists de Equipamentos',
  BUDGET_MATERIAL_DESCRIPTION: 'Descrições de materiais',
};

const AREA_LABELS: Record<TechnicalCatalogArea, string> = {
  GENERAL: 'Geral',
  HVAC: 'Climatização (HVAC)',
  ELECTRICAL: 'Elétrica',
  REFRIGERATION: 'Refrigeração',
  MECHANICAL: 'Mecânica',
  HYDRAULIC: 'Hidráulica',
  SAFETY: 'Segurança',
};

const WORKFLOW_LABELS: Record<TechnicalCatalogWorkflow, string> = {
  GENERAL: 'Geral',
  WORK_ORDER: 'Ordem de Serviço',
  TECHNICAL_REPORT: 'Relatório de Visita Técnica',
  TECHNICAL_OPINION: 'Laudo Técnico',
  PMOC: 'PMOC',
  MAINTENANCE: 'Manutenção',
};

export type TechnicalCatalogAuditContext = {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
};

@Injectable()
export class TechnicalCatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  types(): Array<{ value: TechnicalCatalogType; label: string }> {
    return Object.values(TechnicalCatalogType).map((value) => ({
      value,
      label: TYPE_LABELS[value],
    }));
  }

  taxonomy(): {
    areas: Array<{ value: TechnicalCatalogArea; label: string }>;
    workflows: Array<{ value: TechnicalCatalogWorkflow; label: string }>;
  } {
    return {
      areas: Object.values(TechnicalCatalogArea).map((value) => ({
        value,
        label: AREA_LABELS[value],
      })),
      workflows: Object.values(TechnicalCatalogWorkflow).map((value) => ({
        value,
        label: WORKFLOW_LABELS[value],
      })),
    };
  }

  async list(query: ListTechnicalCatalogsQueryDto): Promise<unknown> {
    const organizationId = await this.organizationId();
    const areaCompatibility = query.areas?.length
      ? {
          OR: [
            { areas: { hasSome: query.areas } },
            ...(query.includeGeneral ? [{ areas: { has: TechnicalCatalogArea.GENERAL } }] : []),
          ],
        }
      : {};
    const requestedWorkflows = query.workflowsAny?.length
      ? query.workflowsAny
      : query.workflow
        ? [query.workflow]
        : [];
    const workflowCompatibility = requestedWorkflows.length
      ? {
          OR: [
            { workflows: { hasSome: requestedWorkflows } },
            ...(query.includeGeneral
              ? [{ workflows: { has: TechnicalCatalogWorkflow.GENERAL } }]
              : []),
          ],
        }
      : {};
    const where: Prisma.TechnicalCatalogWhereInput = {
      organizationId,
      deletedAt: null,
      AND: [areaCompatibility, workflowCompatibility],
      ...(query.type ? { type: query.type } : {}),
      ...(query.maintenanceType ? { maintenanceType: query.maintenanceType } : {}),
      ...(query.pmocUnit ? { pmocUnit: query.pmocUnit } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { tags: { has: this.normalizeTag(query.search) } },
            ],
          }
        : {}),
    };
    const orderBy = {
      [query.sortBy]: query.order,
    } as Prisma.TechnicalCatalogOrderByWithRelationInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.technicalCatalog.findMany({
        where,
        select: CATALOG_SELECT,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.technicalCatalog.count({ where }),
    ]);
    if (query.areas?.length || query.workflow) {
      items.sort((left, right) => {
        const relevance = (item: (typeof items)[number]): number => {
          const exactArea = query.areas?.some((area) => item.areas.includes(area)) ?? false;
          const exactWorkflow = requestedWorkflows.some((workflow) =>
            item.workflows.includes(workflow),
          );
          return Number(exactArea) + Number(exactWorkflow);
        };
        return relevance(right) - relevance(left) || left.sortOrder - right.sortOrder;
      });
    }
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<unknown> {
    return this.catalogOrThrow(id, await this.organizationId());
  }

  async create(
    dto: CreateTechnicalCatalogDto,
    actor: AuthenticatedUser,
    context: TechnicalCatalogAuditContext,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    this.validateMaintenanceType(dto.type, dto.maintenanceType);
    const max = await this.prisma.technicalCatalog.aggregate({
      where: { organizationId, type: dto.type, deletedAt: null },
      _max: { sortOrder: true },
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.technicalCatalog.create({
          data: {
            organizationId,
            type: dto.type,
            title: this.clean(dto.title),
            description: dto.description ? this.clean(dto.description) : null,
            tags: this.normalizeTags(dto.tags ?? []),
            areas: dto.areas ?? [TechnicalCatalogArea.GENERAL],
            workflows: dto.workflows ?? [TechnicalCatalogWorkflow.GENERAL],
            maintenanceType:
              dto.type === TechnicalCatalogType.CHECKLIST ? dto.maintenanceType : null,
            pmocUnit:
              dto.type === TechnicalCatalogType.CHECKLIST ? (dto.pmocUnit ?? null) : null,
            sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? -1) + 1,
            active: dto.active ?? true,
          },
          select: CATALOG_SELECT,
        });
        await tx.auditLog.create({
          data: this.audit('TECHNICAL_CATALOG_CREATED', actor, context, {
            catalogId: created.id,
            catalogType: created.type,
          }),
        });
        return created;
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(
    id: string,
    dto: UpdateTechnicalCatalogDto,
    actor: AuthenticatedUser,
    context: TechnicalCatalogAuditContext,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    const existing = await this.catalogOrThrow(id, organizationId);
    this.validateMaintenanceType(
      existing.type,
      dto.maintenanceType ?? existing.maintenanceType ?? undefined,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.technicalCatalog.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: this.clean(dto.title) } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description ? this.clean(dto.description) : null }
              : {}),
            ...(dto.tags !== undefined ? { tags: this.normalizeTags(dto.tags) } : {}),
            ...(dto.areas !== undefined ? { areas: dto.areas } : {}),
            ...(dto.workflows !== undefined ? { workflows: dto.workflows } : {}),
            ...(dto.maintenanceType !== undefined ? { maintenanceType: dto.maintenanceType } : {}),
            ...(dto.pmocUnit !== undefined ? { pmocUnit: dto.pmocUnit } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
          },
          select: CATALOG_SELECT,
        });
        await tx.auditLog.create({
          data: this.audit('TECHNICAL_CATALOG_UPDATED', actor, context, {
            catalogId: id,
            catalogType: existing.type,
            changedFields: Object.keys(dto),
          }),
        });
        return updated;
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async reorder(
    dto: ReorderTechnicalCatalogDto,
    actor: AuthenticatedUser,
    context: TechnicalCatalogAuditContext,
  ): Promise<{ reordered: number }> {
    const organizationId = await this.organizationId();
    const ids = dto.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_INVALID_ORDER,
        'A ordenação do catálogo não pode conter identificadores duplicados',
        HttpStatus.BAD_REQUEST,
      );
    }
    const count = await this.prisma.technicalCatalog.count({
      where: { id: { in: ids }, organizationId, type: dto.type, deletedAt: null },
    });
    if (count !== ids.length) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_INVALID_ORDER,
        'Todos os itens de catálogo devem pertencer à mesma organização e ao mesmo tipo',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await tx.technicalCatalog.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        });
      }
      await tx.auditLog.create({
        data: this.audit('TECHNICAL_CATALOG_REORDERED', actor, context, {
          catalogType: dto.type,
          itemCount: dto.items.length,
        }),
      });
    });
    return { reordered: dto.items.length };
  }

  async remove(
    id: string,
    actor: AuthenticatedUser,
    context: TechnicalCatalogAuditContext,
  ): Promise<{ deleted: true }> {
    const organizationId = await this.organizationId();
    const existing = await this.catalogOrThrow(id, organizationId);
    await this.prisma.$transaction([
      this.prisma.technicalCatalog.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: this.audit('TECHNICAL_CATALOG_DELETED', actor, context, {
          catalogId: id,
          catalogType: existing.type,
          softDelete: true,
        }),
      }),
    ]);
    return { deleted: true };
  }

  private validateMaintenanceType(type: TechnicalCatalogType, maintenanceType?: string): void {
    if (type === TechnicalCatalogType.CHECKLIST && !maintenanceType) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_INVALID_TYPE,
        'Itens de catálogo do tipo checklist exigem um tipo de manutenção',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (type !== TechnicalCatalogType.CHECKLIST && maintenanceType) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_INVALID_TYPE,
        'O tipo de manutenção só se aplica a itens de catálogo do tipo checklist',
        HttpStatus.BAD_REQUEST,
      );
    }
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

  private async catalogOrThrow(
    id: string,
    organizationId: string,
  ): Promise<Prisma.TechnicalCatalogGetPayload<{ select: typeof CATALOG_SELECT }>> {
    const catalog = await this.prisma.technicalCatalog.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: CATALOG_SELECT,
    });
    if (!catalog) {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_NOT_FOUND,
        'Item de catálogo técnico não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return catalog;
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApplicationException(
        ERROR_CODES.TECHNICAL_CATALOG_CONFLICT,
        'Já existe um item de catálogo ativo com o mesmo título',
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
      .replace(/[\t ]+/g, ' ')
      .trim();
  }

  private normalizeTags(tags: string[]): string[] {
    return [...new Set(tags.map((tag) => this.normalizeTag(tag)).filter(Boolean))];
  }

  private normalizeTag(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  private audit(
    action: string,
    actor: AuthenticatedUser,
    context: TechnicalCatalogAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource: 'TECHNICAL_CATALOG',
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

export function technicalCatalogContextFromRequest(
  request: RequestWithId,
): TechnicalCatalogAuditContext {
  return {
    requestId: request.requestId,
    ip: request.ip || null,
    userAgent: request.get('user-agent') ?? null,
  };
}
