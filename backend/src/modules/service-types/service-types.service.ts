import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  CreateServiceTypeDto,
  ListServiceTypesQueryDto,
  ReorderServiceTypesDto,
  UpdateServiceTypeDto,
} from './dto/service-type.dto';

export interface ServiceTypeAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const SERVICE_TYPE_SELECT = {
  id: true,
  key: true,
  label: true,
  active: true,
  isSystem: true,
  sortOrder: true,
  generatesReminder: true,
  reminderIntervalMonths: true,
  commissionEligible: true,
  commissionPercent: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceTypeSelect;

export type ServiceTypeResponse = Prisma.ServiceTypeGetPayload<{ select: typeof SERVICE_TYPE_SELECT }>;

/** Configuração de lembrete de um tipo, usada pelos fluxos de operação. */
export interface ServiceTypeReminderConfig {
  generatesReminder: boolean;
  reminderIntervalMonths: number | null;
}

@Injectable()
export class ServiceTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListServiceTypesQueryDto): Promise<{ items: ServiceTypeResponse[] }> {
    const organizationId = await this.organizationId();
    const items = await this.prisma.serviceType.findMany({
      where: { organizationId, deletedAt: null, ...(query.activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: SERVICE_TYPE_SELECT,
    });
    return { items };
  }

  async create(
    dto: CreateServiceTypeDto,
    actor: AuthenticatedUser,
    context: ServiceTypeAuditContext,
  ): Promise<ServiceTypeResponse> {
    const organizationId = await this.organizationId();
    const label = dto.label.trim();
    const key = await this.uniqueKey(organizationId, label);
    const max = await this.prisma.serviceType.aggregate({
      where: { organizationId, deletedAt: null },
      _max: { sortOrder: true },
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.serviceType.create({
          data: {
            organizationId,
            key,
            label,
            active: dto.active ?? true,
            isSystem: false,
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            generatesReminder: dto.generatesReminder ?? false,
            reminderIntervalMonths: dto.generatesReminder ? (dto.reminderIntervalMonths ?? null) : null,
            commissionEligible: dto.commissionEligible ?? true,
            commissionPercent: dto.commissionPercent ?? 0,
          },
          select: SERVICE_TYPE_SELECT,
        });
        await tx.auditLog.create({
          data: this.audit('SERVICE_TYPE_CREATED', actor, context, { serviceTypeId: created.id, key }),
        });
        return created;
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(
    id: string,
    dto: UpdateServiceTypeDto,
    actor: AuthenticatedUser,
    context: ServiceTypeAuditContext,
  ): Promise<ServiceTypeResponse> {
    const organizationId = await this.organizationId();
    const existing = await this.serviceTypeOrThrow(id, organizationId);
    // A chave nunca muda (mantém a integridade com operações já registradas);
    // apenas rótulo, ativação e configuração de lembrete são editáveis — inclusive
    // nos tipos do sistema.
    const generatesReminder = dto.generatesReminder ?? existing.generatesReminder;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceType.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.generatesReminder !== undefined ? { generatesReminder: dto.generatesReminder } : {}),
          // Se o tipo não gera lembrete, zera o intervalo; senão aplica o valor recebido.
          ...(dto.generatesReminder !== undefined || dto.reminderIntervalMonths !== undefined
            ? {
                reminderIntervalMonths: generatesReminder
                  ? (dto.reminderIntervalMonths ?? existing.reminderIntervalMonths ?? null)
                  : null,
              }
            : {}),
          ...(dto.commissionEligible !== undefined ? { commissionEligible: dto.commissionEligible } : {}),
          ...(dto.commissionPercent !== undefined ? { commissionPercent: dto.commissionPercent } : {}),
        },
        select: SERVICE_TYPE_SELECT,
      });
      await tx.auditLog.create({
        data: this.audit('SERVICE_TYPE_UPDATED', actor, context, { serviceTypeId: id }),
      });
      return updated;
    });
  }

  async remove(
    id: string,
    actor: AuthenticatedUser,
    context: ServiceTypeAuditContext,
  ): Promise<{ deleted: true }> {
    const organizationId = await this.organizationId();
    const existing = await this.serviceTypeOrThrow(id, organizationId);
    if (existing.isSystem) {
      throw new ApplicationException(
        ERROR_CODES.SERVICE_TYPE_PROTECTED,
        'Tipos de serviço do sistema não podem ser removidos; desative-o se necessário',
        HttpStatus.CONFLICT,
      );
    }
    // Soft-delete: some do select, mas operações antigas com essa chave continuam válidas.
    await this.prisma.$transaction([
      this.prisma.serviceType.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      }),
      this.prisma.auditLog.create({
        data: this.audit('SERVICE_TYPE_DELETED', actor, context, { serviceTypeId: id }),
      }),
    ]);
    return { deleted: true };
  }

  async reorder(
    dto: ReorderServiceTypesDto,
    actor: AuthenticatedUser,
    context: ServiceTypeAuditContext,
  ): Promise<{ reordered: number }> {
    const organizationId = await this.organizationId();
    const count = await this.prisma.serviceType.count({
      where: { id: { in: dto.ids }, organizationId, deletedAt: null },
    });
    if (count !== dto.ids.length) {
      throw new ApplicationException(
        ERROR_CODES.SERVICE_TYPE_NOT_FOUND,
        'Um ou mais tipos de serviço não foram encontrados',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.ids.map((id, index) =>
          tx.serviceType.update({ where: { id }, data: { sortOrder: index } }),
        ),
      );
      await tx.auditLog.create({
        data: this.audit('SERVICE_TYPE_REORDERED', actor, context, { count: dto.ids.length }),
      });
    });
    return { reordered: dto.ids.length };
  }

  /* ---------- consumido por outros fluxos ---------- */

  /**
   * Config de lembrete de uma chave de tipo. Honra a configuração mesmo que o
   * tipo esteja inativo/removido (a operação continua com aquela chave).
   */
  async getReminderConfigByKey(key: string): Promise<ServiceTypeReminderConfig | null> {
    const organizationId = await this.organizationId();
    const row = await this.prisma.serviceType.findFirst({
      where: { organizationId, key },
      select: { generatesReminder: true, reminderIntervalMonths: true },
    });
    return row ?? null;
  }

  /**
   * Valida que todas as chaves de tipo existem no catálogo — usado ao criar/
   * atualizar operações para rejeitar chaves desconhecidas. Não exige `active`
   * (fluxos internos, ex.: um plano PMOC, podem referenciar um tipo que o owner
   * desativou depois; o select do wizard já só oferece os ativos).
   */
  async assertValidTypeKeys(keys: string[]): Promise<void> {
    const unique = Array.from(new Set(keys.filter((k) => k && k.trim())));
    if (unique.length === 0) return;
    const organizationId = await this.organizationId();
    const found = await this.prisma.serviceType.findMany({
      where: { organizationId, key: { in: unique } },
      select: { key: true },
    });
    const foundKeys = new Set(found.map((r) => r.key));
    const missing = unique.filter((k) => !foundKeys.has(k));
    if (missing.length > 0) {
      throw new ApplicationException(
        ERROR_CODES.SERVICE_TYPE_INVALID,
        `Tipo de serviço inválido ou inativo: ${missing.join(', ')}`,
        HttpStatus.BAD_REQUEST,
        { invalidKeys: missing },
      );
    }
  }

  /* ---------- helpers ---------- */

  private async uniqueKey(organizationId: string, label: string): Promise<string> {
    const base =
      label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'TIPO';
    let candidate = base;
    let suffix = 1;
    // Considera inclusive removidos, pois a unique é (organizationId, key).
    while (
      await this.prisma.serviceType.findFirst({
        where: { organizationId, key: candidate },
        select: { id: true },
      })
    ) {
      suffix += 1;
      candidate = `${base.slice(0, 55)}_${suffix}`;
    }
    return candidate;
  }

  private async serviceTypeOrThrow(id: string, organizationId: string): Promise<ServiceTypeResponse> {
    const row = await this.prisma.serviceType.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: SERVICE_TYPE_SELECT,
    });
    if (!row) {
      throw new ApplicationException(
        ERROR_CODES.SERVICE_TYPE_NOT_FOUND,
        'Tipo de serviço não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private async organizationId(): Promise<string> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) {
      throw new ApplicationException(
        ERROR_CODES.ORGANIZATION_NOT_FOUND,
        'Organization was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization.id;
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApplicationException(
        ERROR_CODES.SERVICE_TYPE_CONFLICT,
        'Já existe um tipo de serviço com esse nome',
        HttpStatus.CONFLICT,
      );
    }
    throw error;
  }

  private audit(
    action: string,
    actor: AuthenticatedUser,
    context: ServiceTypeAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource: 'SERVICE_TYPE',
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

export function serviceTypeContextFromRequest(request: RequestWithId): ServiceTypeAuditContext {
  return {
    requestId: request.requestId,
    ip: request.ip || null,
    userAgent: request.get('user-agent') ?? null,
  };
}
