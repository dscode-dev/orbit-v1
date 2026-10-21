import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { PRICING_AUDIT_ACTIONS, PRICING_RESOURCE } from '../../shared/constants/pricing.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateProductPricingDto,
  ListPricingQueryDto,
  PricingStatsQueryDto,
  UpdateProductPricingDto,
} from './dto/pricing.dto';
import type { PricingConsumer, ResolvedProductPricing } from './pricing.types';

export interface PricingAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const PRICING_INCLUDE = {
  organization: { select: { id: true, tradeName: true, legalName: true } },
  product: {
    select: {
      id: true,
      sku: true,
      internalCode: true,
      name: true,
      unit: true,
      brand: true,
      model: true,
      category: true,
      isActive: true,
      isSellable: true,
    },
  },
} satisfies Prisma.ProductPricingInclude;

type ProductPricingWithRelations = Prisma.ProductPricingGetPayload<{ include: typeof PRICING_INCLUDE }>;

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async listPricing(query: ListPricingQueryDto): Promise<unknown> {
    const now = query.at ? new Date(query.at) : new Date();
    const where: Prisma.ProductPricingWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            product: {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { internalCode: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
                { category: { contains: query.search, mode: 'insensitive' } },
                { brand: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      ...(query.expired
        ? { validUntil: { lt: now } }
        : query.at
          ? { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gte: now } }] }
          : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productPricing.findMany({
        where,
        include: PRICING_INCLUDE,
        orderBy: [{ active: 'desc' }, { validFrom: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.productPricing.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async getPricing(id: string): Promise<ProductPricingWithRelations> {
    return this.pricingOrThrow(id);
  }

  async getProductPricing(productId: string, at = new Date()): Promise<ResolvedProductPricing> {
    await this.productOrThrow(productId);
    return this.resolveActivePricing(productId, at);
  }

  async resolveForConsumer(
    productId: string,
    consumer: PricingConsumer,
    at = new Date(),
  ): Promise<ResolvedProductPricing> {
    const pricing = await this.resolveActivePricing(productId, at);
    return { ...pricing, consumer };
  }

  async createProductPricing(
    productId: string,
    dto: CreateProductPricingDto,
    actor: AuthenticatedUser,
    context: PricingAuditContext,
  ): Promise<ProductPricingWithRelations> {
    const product = await this.productOrThrow(productId);
    if (!product.isActive) {
      throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto inativo', HttpStatus.CONFLICT);
    }
    const organization = await this.organizationOrThrow();
    const period = this.parsePeriod(dto.validFrom, dto.validUntil);
    const prices = this.normalizePrices(dto);
    this.validateCommercialRules(prices, period);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertNoOverlapTx(tx, organization.id, productId, period.validFrom, period.validUntil);
        const pricing = await tx.productPricing.create({
          data: {
            organizationId: organization.id,
            productId,
            ...prices,
            validFrom: period.validFrom,
            validUntil: period.validUntil,
            active: dto.active ?? true,
          },
          include: PRICING_INCLUDE,
        });
        await this.auditTx(tx, PRICING_AUDIT_ACTIONS.PRICING_CREATED, actor, context, {
          pricingId: pricing.id,
          productId,
          sku: product.sku,
          validFrom: period.validFrom,
          validUntil: period.validUntil,
        });
        return pricing;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      this.throwPricingConflict(error);
    }
  }

  async createPricingRevision(
    id: string,
    dto: UpdateProductPricingDto,
    actor: AuthenticatedUser,
    context: PricingAuditContext,
  ): Promise<ProductPricingWithRelations> {
    const current = await this.pricingOrThrow(id);
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validUntil = dto.validUntil !== undefined ? (dto.validUntil ? new Date(dto.validUntil) : null) : current.validUntil;
    const period = { validFrom, validUntil };
    const prices = this.normalizePrices({
      costPrice: dto.costPrice ?? Number(current.costPrice),
      replacementCost: dto.replacementCost ?? Number(current.replacementCost),
      averageCost: dto.averageCost ?? Number(current.averageCost),
      salePrice: dto.salePrice ?? Number(current.salePrice),
      minimumSalePrice: dto.minimumSalePrice ?? Number(current.minimumSalePrice),
      suggestedSalePrice: dto.suggestedSalePrice ?? Number(current.suggestedSalePrice),
      marginPercentage: dto.marginPercentage,
    });
    this.validateCommercialRules(prices, period);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertNoOverlapTx(tx, current.organizationId, current.productId, period.validFrom, period.validUntil, current.id);
        const deactivated = await tx.productPricing.updateMany({
          where: { id: current.id, active: current.active },
          data: {
            active: false,
            validUntil: current.validUntil && current.validUntil < period.validFrom ? current.validUntil : period.validFrom,
          },
        });
        if (deactivated.count !== 1) {
          throw new ApplicationException(ERROR_CODES.PRICING_OVERLAP, 'A revisão da precificação conflitou com outra revisão', HttpStatus.CONFLICT);
        }
        const revision = await tx.productPricing.create({
          data: {
            organizationId: current.organizationId,
            productId: current.productId,
            ...prices,
            validFrom: period.validFrom,
            validUntil: period.validUntil,
            active: dto.active ?? true,
          },
          include: PRICING_INCLUDE,
        });
        await this.auditTx(tx, PRICING_AUDIT_ACTIONS.PRICING_UPDATED, actor, context, {
          previousPricingId: current.id,
          pricingId: revision.id,
          productId: current.productId,
          changedFields: Object.keys(dto),
        });
        await this.auditTx(tx, PRICING_AUDIT_ACTIONS.PRICING_DEACTIVATED, actor, context, {
          pricingId: current.id,
          replacedByPricingId: revision.id,
          productId: current.productId,
        });
        return revision;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      this.throwPricingConflict(error);
    }
  }

  async pricingHistory(productId: string, query: ListPricingQueryDto): Promise<unknown> {
    await this.productOrThrow(productId);
    const where: Prisma.ProductPricingWhereInput = { productId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productPricing.findMany({
        where,
        include: PRICING_INCLUDE,
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.productPricing.count({ where }),
    ]);
    return this.page(items, total, query.page, query.limit);
  }

  async pricingStats(query: PricingStatsQueryDto): Promise<unknown> {
    const now = query.at ? new Date(query.at) : new Date();
    const activeNow: Prisma.ProductPricingWhereInput = {
      active: true,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    };
    const [productsWithoutPrice, expiredPrices, highestMargins, lowestMargins, activeAggregate] =
      await this.prisma.$transaction([
        this.prisma.product.count({
          where: {
            isActive: true,
            pricings: { none: activeNow },
          },
        }),
        this.prisma.productPricing.count({
          where: { active: true, validUntil: { lt: now } },
        }),
        this.prisma.productPricing.findMany({
          where: activeNow,
          include: PRICING_INCLUDE,
          orderBy: { marginPercentage: 'desc' },
          take: 10,
        }),
        this.prisma.productPricing.findMany({
          where: activeNow,
          include: PRICING_INCLUDE,
          orderBy: { marginPercentage: 'asc' },
          take: 10,
        }),
        this.prisma.productPricing.aggregate({
          where: activeNow,
          _avg: { averageCost: true, salePrice: true, marginPercentage: true },
          _count: true,
        }),
      ]);
    return {
      productsWithoutPrice,
      expiredPrices,
      highestMargins,
      lowestMargins,
      averageCost: activeAggregate._avg.averageCost ?? 0,
      averageSalePrice: activeAggregate._avg.salePrice ?? 0,
      averageMarginPercentage: activeAggregate._avg.marginPercentage ?? 0,
      activePricings: activeAggregate._count,
      evaluatedAt: now,
    };
  }

  private async resolveActivePricing(productId: string, at: Date): Promise<ResolvedProductPricing> {
    const pricing = await this.prisma.productPricing.findFirst({
      where: {
        productId,
        active: true,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gte: at } }],
      },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (!pricing) {
      throw new ApplicationException(ERROR_CODES.PRICING_NOT_FOUND, 'Precificação ativa não encontrada', HttpStatus.NOT_FOUND);
    }
    return {
      pricingId: pricing.id,
      organizationId: pricing.organizationId,
      productId: pricing.productId,
      costPrice: pricing.costPrice.toString(),
      replacementCost: pricing.replacementCost.toString(),
      averageCost: pricing.averageCost.toString(),
      salePrice: pricing.salePrice.toString(),
      minimumSalePrice: pricing.minimumSalePrice.toString(),
      suggestedSalePrice: pricing.suggestedSalePrice.toString(),
      marginPercentage: pricing.marginPercentage.toString(),
      validFrom: pricing.validFrom,
      validUntil: pricing.validUntil,
      active: pricing.active,
      resolvedAt: at,
    };
  }

  private async assertNoOverlapTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productId: string,
    validFrom: Date,
    validUntil: Date | null,
    ignoreId?: string,
  ): Promise<void> {
    const overlap = await tx.productPricing.findFirst({
      where: {
        organizationId,
        productId,
        active: true,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        ...(validUntil ? { validFrom: { lt: validUntil } } : {}),
        OR: [{ validUntil: null }, { validUntil: { gt: validFrom } }],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_OVERLAP,
        'O período informado se sobrepõe a uma precificação ativa',
        HttpStatus.CONFLICT,
      );
    }
  }

  private normalizePrices(dto: {
    costPrice: number;
    replacementCost: number;
    averageCost: number;
    salePrice: number;
    minimumSalePrice: number;
    suggestedSalePrice: number;
    marginPercentage?: number;
  }): {
    costPrice: Prisma.Decimal;
    replacementCost: Prisma.Decimal;
    averageCost: Prisma.Decimal;
    salePrice: Prisma.Decimal;
    minimumSalePrice: Prisma.Decimal;
    suggestedSalePrice: Prisma.Decimal;
    marginPercentage: Prisma.Decimal;
  } {
    const salePrice = new Prisma.Decimal(dto.salePrice);
    const averageCost = new Prisma.Decimal(dto.averageCost);
    const computedMargin = salePrice.equals(0)
      ? new Prisma.Decimal(0)
      : salePrice.minus(averageCost).div(salePrice).mul(100).toDecimalPlaces(2);
    return {
      costPrice: new Prisma.Decimal(dto.costPrice),
      replacementCost: new Prisma.Decimal(dto.replacementCost),
      averageCost,
      salePrice,
      minimumSalePrice: new Prisma.Decimal(dto.minimumSalePrice),
      suggestedSalePrice: new Prisma.Decimal(dto.suggestedSalePrice),
      marginPercentage: dto.marginPercentage !== undefined ? new Prisma.Decimal(dto.marginPercentage) : computedMargin,
    };
  }

  private validateCommercialRules(
    prices: {
      averageCost: Prisma.Decimal;
      salePrice: Prisma.Decimal;
      minimumSalePrice: Prisma.Decimal;
      suggestedSalePrice: Prisma.Decimal;
      marginPercentage: Prisma.Decimal;
    },
    period: { validFrom: Date; validUntil: Date | null },
  ): void {
    if (period.validUntil && period.validUntil <= period.validFrom) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_INVALID_PERIOD,
        'O fim da vigência deve ser posterior ao início',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (prices.salePrice.lt(prices.minimumSalePrice)) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_INVALID_MARGIN,
        'O preço de venda não pode ser menor que o preço mínimo de venda',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (prices.suggestedSalePrice.lt(prices.minimumSalePrice)) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_INVALID_MARGIN,
        'O preço de venda sugerido não pode ser menor que o preço mínimo de venda',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (prices.salePrice.lt(prices.averageCost) || prices.marginPercentage.lt(0)) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_INVALID_MARGIN,
        'A precificação resultaria em margem negativa inconsistente',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private parsePeriod(validFrom: string, validUntil?: string): { validFrom: Date; validUntil: Date | null } {
    return { validFrom: new Date(validFrom), validUntil: validUntil ? new Date(validUntil) : null };
  }

  private async pricingOrThrow(id: string): Promise<ProductPricingWithRelations> {
    const pricing = await this.prisma.productPricing.findUnique({ where: { id }, include: PRICING_INCLUDE });
    if (!pricing) {
      throw new ApplicationException(ERROR_CODES.PRICING_NOT_FOUND, 'Precificação não encontrada', HttpStatus.NOT_FOUND);
    }
    return pricing;
  }

  private async productOrThrow(id: string): Promise<{ id: string; sku: string; isActive: boolean }> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true, sku: true, isActive: true } });
    if (!product) {
      throw new ApplicationException(ERROR_CODES.PRODUCT_NOT_FOUND, 'Produto não encontrado', HttpStatus.NOT_FOUND);
    }
    return product;
  }

  private async organizationOrThrow(): Promise<{ id: string }> {
    const organization = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) {
      throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organização não encontrada', HttpStatus.NOT_FOUND);
    }
    return organization;
  }

  private page<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
    return buildPaginatedResponse(items, total, page, limit);
  }

  private async auditTx(
    tx: Prisma.TransactionClient,
    action: string,
    actor: AuthenticatedUser,
    context: PricingAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action,
        resource: PRICING_RESOURCE,
        actor: actor.id,
        metadata: {
          requestId: context.requestId,
          ip: context.ip,
          userAgent: context.userAgent,
          ...metadata,
        },
      },
    });
  }

  private throwPricingConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    ) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_OVERLAP,
        'O período informado se sobrepõe a uma precificação ativa',
        HttpStatus.CONFLICT,
      );
    }
    if (
      error instanceof Prisma.PrismaClientUnknownRequestError &&
      error.message.includes('product_pricings_no_active_overlap')
    ) {
      throw new ApplicationException(
        ERROR_CODES.PRICING_OVERLAP,
        'O período informado se sobrepõe a uma precificação ativa',
        HttpStatus.CONFLICT,
      );
    }
    throw error;
  }
}
