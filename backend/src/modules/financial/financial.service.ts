import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AssetLifecycleEventType,
  FinancialAccountType,
  FinancialCategoryType,
  FinancialEntryOrigin,
  FinancialEntryStatus,
  FinancialEntryType,
  FinancialHistoryAction,
  Prisma,
} from '@prisma/client';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import {
  FINANCIAL_ACCOUNT_RESOURCE,
  FINANCIAL_AUDIT_ACTIONS,
  FINANCIAL_CATEGORY_RESOURCE,
  FINANCIAL_ENTRY_RESOURCE,
} from '../../shared/constants/financial.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse, type PaginatedResponse } from '../../shared/types/pagination.types';
import { LifecyclePublisher } from '../asset-lifecycle/lifecycle-publisher.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CancelFinancialEntryDto,
  CreateFinancialAccountDto,
  CreateFinancialCategoryDto,
  CreateFinancialEntryDto,
  ImportReceiptsDto,
  ListFinancialAccountsQueryDto,
  ListFinancialCategoriesQueryDto,
  ListFinancialEntriesQueryDto,
  PayFinancialEntryDto,
  UpdateFinancialAccountDto,
  UpdateFinancialCategoryDto,
  UpdateFinancialEntryDto,
} from './dto/financial.dto';

export interface FinancialAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const ACCOUNT_INCLUDE = {
  organization: { select: { id: true, tradeName: true, legalName: true } },
} satisfies Prisma.FinancialAccountInclude;

const CATEGORY_INCLUDE = {
  organization: { select: { id: true, tradeName: true, legalName: true } },
} satisfies Prisma.FinancialCategoryInclude;

const ENTRY_INCLUDE = {
  organization: { select: { id: true, tradeName: true, legalName: true } },
  account: { select: { id: true, name: true, type: true, currentBalance: true, active: true } },
  category: { select: { id: true, name: true, type: true, color: true, icon: true, active: true } },
  creator: { select: { id: true, name: true, email: true, username: true, role: true } },
  allocations: { include: { category: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FinancialEntryInclude;

type EntryWithRelations = Prisma.FinancialEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

@Injectable()
export class FinancialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: LifecyclePublisher,
  ) {}

  async listAccounts(query: ListFinancialAccountsQueryDto): Promise<PaginatedResponse<unknown>> {
    const where: Prisma.FinancialAccountWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialAccount.findMany({
        where,
        include: ACCOUNT_INCLUDE,
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.financialAccount.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async createAccount(
    dto: CreateFinancialAccountDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    const openingBalance = this.money(dto.openingBalance ?? 0);
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.create({
        data: {
          organizationId,
          name: this.clean(dto.name),
          type: dto.type,
          description: this.optionalClean(dto.description),
          openingBalance,
          currentBalance: openingBalance,
          active: dto.active ?? true,
        },
        include: ACCOUNT_INCLUDE,
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ACCOUNT_CREATED, FINANCIAL_ACCOUNT_RESOURCE, actor, context, {
        accountId: account.id,
        type: account.type,
        openingBalance: account.openingBalance.toString(),
      });
      return account;
    });
  }

  async updateAccount(
    id: string,
    dto: UpdateFinancialAccountDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<unknown> {
    await this.accountOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: this.clean(dto.name) } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.description !== undefined ? { description: this.optionalClean(dto.description) } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        include: ACCOUNT_INCLUDE,
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ACCOUNT_UPDATED, FINANCIAL_ACCOUNT_RESOURCE, actor, context, {
        accountId: id,
        changedFields: Object.keys(dto),
      });
      return account;
    });
  }

  async deleteAccount(id: string, actor: AuthenticatedUser, context: FinancialAuditContext): Promise<{ deleted: true }> {
    await this.accountOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.financialAccount.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ACCOUNT_DELETED, FINANCIAL_ACCOUNT_RESOURCE, actor, context, { accountId: id });
    });
    return { deleted: true };
  }

  async listCategories(query: ListFinancialCategoriesQueryDto): Promise<PaginatedResponse<unknown>> {
    const where: Prisma.FinancialCategoryWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialCategory.findMany({
        where,
        include: CATEGORY_INCLUDE,
        orderBy: [{ active: 'desc' }, { type: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.financialCategory.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async createCategory(
    dto: CreateFinancialCategoryDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<unknown> {
    const organizationId = await this.organizationId();
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.financialCategory.create({
        data: {
          organizationId,
          name: this.clean(dto.name),
          type: dto.type,
          color: this.optionalClean(dto.color),
          icon: this.optionalClean(dto.icon),
          active: dto.active ?? true,
        },
        include: CATEGORY_INCLUDE,
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.CATEGORY_CREATED, FINANCIAL_CATEGORY_RESOURCE, actor, context, {
        categoryId: category.id,
        type: category.type,
      });
      return category;
    });
  }

  async updateCategory(
    id: string,
    dto: UpdateFinancialCategoryDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<unknown> {
    await this.categoryOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.financialCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: this.clean(dto.name) } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.color !== undefined ? { color: this.optionalClean(dto.color) } : {}),
          ...(dto.icon !== undefined ? { icon: this.optionalClean(dto.icon) } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        include: CATEGORY_INCLUDE,
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.CATEGORY_UPDATED, FINANCIAL_CATEGORY_RESOURCE, actor, context, {
        categoryId: id,
        changedFields: Object.keys(dto),
      });
      return category;
    });
  }

  async deleteCategory(id: string, actor: AuthenticatedUser, context: FinancialAuditContext): Promise<{ deleted: true }> {
    await this.categoryOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.financialCategory.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.CATEGORY_DELETED, FINANCIAL_CATEGORY_RESOURCE, actor, context, { categoryId: id });
    });
    return { deleted: true };
  }

  async listEntries(query: ListFinancialEntriesQueryDto): Promise<PaginatedResponse<unknown>> {
    const where = this.entriesWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.financialEntry.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async getEntry(id: string): Promise<EntryWithRelations> {
    return this.entryOrThrow(id);
  }

  async createEntry(
    dto: CreateFinancialEntryDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<EntryWithRelations> {
    const organizationId = await this.organizationId();
    const status = FinancialEntryStatus.PENDING;
    const amount = this.money(dto.amount);
    const accountId = dto.accountId ?? (await this.getOrCreateGeneralAccountId(organizationId));
    const categoryId = dto.categoryId ?? null;
    await this.assertAccountCategory(organizationId, accountId, categoryId, dto.type);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.financialEntry.create({
        data: {
          organizationId,
          accountId,
          categoryId,
          type: dto.type,
          origin: dto.origin ?? FinancialEntryOrigin.MANUAL,
          originId: dto.originId ?? null,
          amount,
          dueDate: new Date(dto.dueDate),
          paidAt: null,
          description: this.clean(dto.description),
          notes: this.optionalClean(dto.notes),
          status,
          createdBy: actor.id,
        },
        include: ENTRY_INCLUDE,
      });
      await this.createHistoryTx(tx, entry.id, actor.id, FinancialHistoryAction.CREATED, null, entry.status, {
        amount: entry.amount.toString(),
        accountId: entry.accountId,
        categoryId: entry.categoryId,
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ENTRY_CREATED, FINANCIAL_ENTRY_RESOURCE, actor, context, {
        entryId: entry.id,
        status: entry.status,
        amount: entry.amount.toString(),
      });
      await this.lifecycle.publishFinancialEntryEventTx(
        tx,
        {
          entryId: entry.id,
          actorId: actor.id,
          type: AssetLifecycleEventType.FINANCIAL_ENTRY_CREATED,
          description: `Financial entry ${entry.description} created`,
        },
        context,
      );
      return entry;
    });
  }

  /**
   * Recibos emitidos (operações com valor total) ainda não lançados na conta
   * geral. Serve a importação manual; a extração é idempotente por operação.
   */
  async listImportableReceipts(): Promise<unknown> {
    const organizationId = await this.organizationId();
    const imported = await this.prisma.financialEntry.findMany({
      where: { organizationId, origin: FinancialEntryOrigin.RECEIPT, canceledAt: null, deletedAt: null },
      select: { originId: true },
    });
    const importedIds = new Set(imported.map((entry) => entry.originId).filter(Boolean));
    const operations = await this.prisma.operation.findMany({
      where: { receiptAmount: { not: null }, status: { not: 'CANCELED' }, documents: { none: { type: 'RECEIPT', canceledAt: { not: null } } } },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        receiptNumber: true,
        receiptAmount: true,
        receiptService: true,
        completedAt: true,
        createdAt: true,
        customer: { select: { id: true, name: true, tradeName: true } },
      },
    });
    return operations
      .filter((operation) => !importedIds.has(operation.id))
      .map((operation) => ({
        operationId: operation.id,
        receiptNumber: operation.receiptNumber,
        amount: operation.receiptAmount?.toString() ?? '0',
        service: operation.receiptService,
        customerName: operation.customer?.tradeName ?? operation.customer?.name ?? null,
        date: (operation.completedAt ?? operation.createdAt).toISOString(),
      }));
  }

  /** Importa manualmente uma lista de recibos como entradas na conta geral. */
  async importReceipts(
    dto: ImportReceiptsDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<{ imported: number }> {
    let imported = 0;
    for (const operationId of [...new Set(dto.operationIds)]) {
      if (await this.syncReceiptEntry(operationId, actor.id, context)) {
        imported += 1;
      }
    }
    return { imported };
  }

  /** Synchronizes the receipt and its balance under the same operation lock. */
  async syncReceiptEntry(
    operationId: string,
    actorId: string,
    context: FinancialAuditContext,
  ): Promise<boolean> {
    return this.prisma.$transaction((tx) =>
      this.syncReceiptEntryTx(tx, operationId, actorId, context),
    );
  }

  async syncReceiptEntryTx(
    tx: Prisma.TransactionClient,
    operationId: string,
    actorId: string,
    context: FinancialAuditContext,
  ): Promise<boolean> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationId}))`;
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      select: {
        receiptAmount: true,
        receiptNumber: true,
        receiptService: true,
        receiptIssuedAt: true,
        completedAt: true,
        createdAt: true,
        status: true,
        documents: { where: { type: 'RECEIPT' }, select: { canceledAt: true } },
      },
    });
    if (!operation) return false;
    const organizationId = await this.organizationId(tx);
    const entries = await tx.financialEntry.findMany({
      where: {
        organizationId,
        origin: FinancialEntryOrigin.RECEIPT,
        originId: operationId,
        canceledAt: null,
        deletedAt: null,
      },
    });
    const canceled =
      operation.status === 'CANCELED' ||
      operation.documents.some((document) => document.canceledAt);
    const actor = { id: actorId } as AuthenticatedUser;
    if (canceled) {
      for (const entry of entries) {
        if (entry.status === FinancialEntryStatus.PAID) {
          await this.applyBalanceTx(tx, entry.accountId, entry.type, entry.amount, 'reverse');
        }
        await tx.financialEntry.update({
          where: { id: entry.id },
          data: { status: FinancialEntryStatus.CANCELED, canceledAt: new Date() },
        });
        await this.createHistoryTx(
          tx,
          entry.id,
          actorId,
          FinancialHistoryAction.CANCELED,
          entry.status,
          FinancialEntryStatus.CANCELED,
          { operationId, amount: entry.amount.toString() },
        );
        await this.auditTx(
          tx,
          FINANCIAL_AUDIT_ACTIONS.ENTRY_CANCELED,
          FINANCIAL_ENTRY_RESOURCE,
          actor,
          context,
          { entryId: entry.id, operationId, origin: 'RECEIPT' },
        );
      }
      return entries.length > 0;
    }
    if (operation.receiptAmount == null) return false;
    const amount = new Prisma.Decimal(this.money(Number(operation.receiptAmount)));
    const when = operation.receiptIssuedAt ?? operation.completedAt ?? operation.createdAt;
    const description =
      `Recibo ${operation.receiptNumber ?? ''}${operation.receiptService ? ` · ${operation.receiptService}` : ''}`
        .trim()
        .slice(0, 180) || 'Recibo';
    const existing = entries[0];
    if (existing) {
      if (
        existing.amount.equals(amount) &&
        existing.description === description &&
        existing.dueDate.getTime() === when.getTime()
      )
        return false;
      if (existing.status === FinancialEntryStatus.PAID) {
        await this.applyBalanceTx(
          tx,
          existing.accountId,
          existing.type,
          amount.minus(existing.amount),
          'apply',
        );
      }
      await tx.financialEntry.update({
        where: { id: existing.id },
        data: {
          amount,
          description,
          dueDate: when,
          ...(existing.status === FinancialEntryStatus.PAID ? { paidAt: when } : {}),
        },
      });
      await this.createHistoryTx(
        tx,
        existing.id,
        actorId,
        FinancialHistoryAction.UPDATED,
        existing.status,
        existing.status,
        { operationId, previousAmount: existing.amount.toString(), amount: amount.toString() },
      );
      await this.auditTx(
        tx,
        FINANCIAL_AUDIT_ACTIONS.ENTRY_UPDATED,
        FINANCIAL_ENTRY_RESOURCE,
        actor,
        context,
        {
          entryId: existing.id,
          operationId,
          previousAmount: existing.amount.toString(),
          amount: amount.toString(),
          origin: 'RECEIPT',
        },
      );
      return true;
    }
    const accountId = await this.getOrCreateGeneralAccountId(organizationId, tx);
    const entry = await tx.financialEntry.create({
      data: {
        organizationId,
        accountId,
        categoryId: null,
        type: FinancialEntryType.RECEIVABLE,
        origin: FinancialEntryOrigin.RECEIPT,
        originId: operationId,
        amount,
        dueDate: when,
        paidAt: when,
        description,
        status: FinancialEntryStatus.PAID,
        createdBy: actorId,
      },
    });
    await this.applyBalanceTx(tx, accountId, entry.type, entry.amount, 'apply');
    await this.createHistoryTx(
      tx,
      entry.id,
      actorId,
      FinancialHistoryAction.CREATED,
      null,
      entry.status,
      { amount: entry.amount.toString(), origin: 'RECEIPT', operationId },
    );
    await this.auditTx(
      tx,
      FINANCIAL_AUDIT_ACTIONS.ENTRY_CREATED,
      FINANCIAL_ENTRY_RESOURCE,
      actor,
      context,
      { entryId: entry.id, origin: 'RECEIPT', amount: entry.amount.toString(), operationId },
    );
    return true;
  }

  async updateEntry(
    id: string,
    dto: UpdateFinancialEntryDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<EntryWithRelations> {
    const current = await this.entryOrThrow(id);
    this.assertWritable(current);
    const organizationId = current.organizationId;
    const accountId = dto.accountId ?? current.accountId;
    const categoryId = dto.categoryId ?? current.categoryId;
    const type = dto.type ?? current.type;
    await this.assertAccountCategory(organizationId, accountId, categoryId, type);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.financialEntry.update({
        where: { id },
        data: {
          ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.origin !== undefined ? { origin: dto.origin } : {}),
          ...(dto.originId !== undefined ? { originId: dto.originId } : {}),
          ...(dto.amount !== undefined ? { amount: this.money(dto.amount) } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
          ...(dto.description !== undefined ? { description: this.clean(dto.description) } : {}),
          ...(dto.notes !== undefined ? { notes: this.optionalClean(dto.notes) } : {}),
        },
        include: ENTRY_INCLUDE,
      });
      await this.createHistoryTx(tx, id, actor.id, FinancialHistoryAction.UPDATED, current.status, entry.status, {
        changedFields: Object.keys(dto),
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ENTRY_UPDATED, FINANCIAL_ENTRY_RESOURCE, actor, context, {
        entryId: id,
        changedFields: Object.keys(dto),
      });
      return entry;
    });
  }

  async payEntry(
    id: string,
    dto: PayFinancialEntryDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<EntryWithRelations> {
    return this.runSerializable(async () => this.prisma.$transaction(async (tx) => {
      const current = await tx.financialEntry.findFirst({ where: { id, deletedAt: null }, include: ENTRY_INCLUDE });
      if (!current) {
        throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_NOT_FOUND, 'Lançamento financeiro não encontrado', HttpStatus.NOT_FOUND);
      }
      this.assertPayable(current.status);
      const transition = await tx.financialEntry.updateMany({
        where: {
          id,
          deletedAt: null,
          status: current.status,
        },
        data: {
          status: FinancialEntryStatus.PAID,
          paidAt: new Date(dto.paidAt ?? new Date()),
          ...(dto.notes !== undefined ? { notes: this.optionalClean(dto.notes) } : {}),
        },
      });
      if (transition.count !== 1) {
        throw this.staleFinancialTransition('Financial entry payment was already processed or changed');
      }
      const entry = await tx.financialEntry.findFirstOrThrow({ where: { id, deletedAt: null }, include: ENTRY_INCLUDE });
      await this.applyBalanceTx(tx, entry.accountId, entry.type, entry.amount, 'apply');
      await this.createHistoryTx(tx, id, actor.id, FinancialHistoryAction.PAID, current.status, entry.status, {
        paidAt: entry.paidAt?.toISOString() ?? null,
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ENTRY_PAID, FINANCIAL_ENTRY_RESOURCE, actor, context, {
        entryId: id,
        previousStatus: current.status,
      });
      await this.lifecycle.publishFinancialEntryEventTx(
        tx,
        {
          entryId: entry.id,
          actorId: actor.id,
          type: AssetLifecycleEventType.FINANCIAL_ENTRY_PAID,
          description: `Financial entry ${entry.description} paid`,
        },
        context,
      );
      return entry;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async cancelEntry(
    id: string,
    dto: CancelFinancialEntryDto,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
  ): Promise<EntryWithRelations> {
    return this.runSerializable(async () => this.prisma.$transaction(async (tx) => {
      const current = await tx.financialEntry.findFirst({ where: { id, deletedAt: null }, include: ENTRY_INCLUDE });
      if (!current) {
        throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_NOT_FOUND, 'Lançamento financeiro não encontrado', HttpStatus.NOT_FOUND);
      }
      this.assertCancelable(current.status);
      const transition = await tx.financialEntry.updateMany({
        where: {
          id,
          deletedAt: null,
          status: current.status,
        },
        data: {
          status: FinancialEntryStatus.CANCELED,
          canceledAt: new Date(),
        },
      });
      if (transition.count !== 1) {
        throw this.staleFinancialTransition('Financial entry cancellation was already processed or changed');
      }
      const entry = await tx.financialEntry.findFirstOrThrow({ where: { id, deletedAt: null }, include: ENTRY_INCLUDE });
      await this.createHistoryTx(tx, id, actor.id, FinancialHistoryAction.CANCELED, current.status, entry.status, {
        reason: this.optionalClean(dto.reason),
      });
      await this.auditTx(tx, FINANCIAL_AUDIT_ACTIONS.ENTRY_CANCELED, FINANCIAL_ENTRY_RESOURCE, actor, context, {
        entryId: id,
        previousStatus: current.status,
      });
      await this.lifecycle.publishFinancialEntryEventTx(
        tx,
        {
          entryId: entry.id,
          actorId: actor.id,
          type: AssetLifecycleEventType.FINANCIAL_ENTRY_CANCELED,
          description: `Financial entry ${entry.description} canceled`,
        },
        context,
      );
      return entry;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async stats(): Promise<Record<string, unknown>> {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    // Janela da evolução (Saúde financeira): últimos 6 meses.
    const flowStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const pending: Prisma.FinancialEntryWhereInput = { deletedAt: null, status: FinancialEntryStatus.PENDING };
    const [accounts, receivableToday, payableToday, overdueReceivable, overduePayable, incomeMonth, expenseMonth, pendingEntries, flowEntries] =
      await this.prisma.$transaction([
        this.prisma.financialAccount.findMany({ where: { deletedAt: null, active: true }, select: { currentBalance: true } }),
        this.sumAmount({ ...pending, type: FinancialEntryType.RECEIVABLE, dueDate: { gte: startToday, lte: endToday } }),
        this.sumAmount({ ...pending, type: FinancialEntryType.PAYABLE, dueDate: { gte: startToday, lte: endToday } }),
        this.sumAmount({ ...pending, type: FinancialEntryType.RECEIVABLE, dueDate: { lt: startToday } }),
        this.sumAmount({ ...pending, type: FinancialEntryType.PAYABLE, dueDate: { lt: startToday } }),
        this.sumAmount({ deletedAt: null, type: FinancialEntryType.RECEIVABLE, status: FinancialEntryStatus.PAID, paidAt: { gte: monthStart, lte: monthEnd } }),
        this.sumAmount({ deletedAt: null, type: FinancialEntryType.PAYABLE, status: FinancialEntryStatus.PAID, paidAt: { gte: monthStart, lte: monthEnd } }),
        this.prisma.financialEntry.findMany({
          where: pending,
          select: { type: true, amount: true, dueDate: true },
          orderBy: { dueDate: 'asc' },
          take: 500,
        }),
        // Evolução: todos os lançamentos ativos (pagos e pendentes) da janela,
        // considerados na data efetiva (paidAt quando pago, senão dueDate).
        this.prisma.financialEntry.findMany({
          where: {
            deletedAt: null,
            status: { not: FinancialEntryStatus.CANCELED },
            OR: [
              { paidAt: { gte: flowStart } },
              { AND: [{ paidAt: null }, { dueDate: { gte: flowStart } }] },
            ],
          },
          select: { type: true, amount: true, dueDate: true, paidAt: true },
          orderBy: { dueDate: 'asc' },
          take: 2000,
        }),
      ]);
    const currentBalance = accounts.reduce((sum, item) => sum + Number(item.currentBalance), 0);
    const projectedBalance = pendingEntries.reduce((sum, item) => sum + this.signedAmount(item.type, item.amount), currentBalance);
    const monthlyFlow = this.monthlyFlow(flowEntries);
    return {
      receivableToday: this.moneyString(receivableToday._sum.amount),
      payableToday: this.moneyString(payableToday._sum.amount),
      overdue: {
        receivable: this.moneyString(overdueReceivable._sum.amount),
        payable: this.moneyString(overduePayable._sum.amount),
      },
      currentBalance: this.moneyString(currentBalance),
      projectedBalance: this.moneyString(projectedBalance),
      income: this.moneyString(incomeMonth._sum.amount),
      expenses: this.moneyString(expenseMonth._sum.amount),
      monthlyFlow,
    };
  }

  async history(entryId: string, query: ListFinancialEntriesQueryDto): Promise<PaginatedResponse<unknown>> {
    await this.entryOrThrow(entryId);
    const where: Prisma.FinancialHistoryWhereInput = { entryId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialHistory.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.financialHistory.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  private entriesWhere(query: ListFinancialEntriesQueryDto): Prisma.FinancialEntryWhereInput {
    return {
      deletedAt: null,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { dueDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private async accountOrThrow(id: string): Promise<Prisma.FinancialAccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>> {
    const account = await this.prisma.financialAccount.findFirst({ where: { id, deletedAt: null }, include: ACCOUNT_INCLUDE });
    if (!account) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND, 'Conta financeira não encontrada', HttpStatus.NOT_FOUND);
    }
    return account;
  }

  private async categoryOrThrow(id: string): Promise<Prisma.FinancialCategoryGetPayload<{ include: typeof CATEGORY_INCLUDE }>> {
    const category = await this.prisma.financialCategory.findFirst({ where: { id, deletedAt: null }, include: CATEGORY_INCLUDE });
    if (!category) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_CATEGORY_NOT_FOUND, 'Categoria financeira não encontrada', HttpStatus.NOT_FOUND);
    }
    return category;
  }

  private async entryOrThrow(id: string): Promise<EntryWithRelations> {
    const entry = await this.prisma.financialEntry.findFirst({ where: { id, deletedAt: null }, include: ENTRY_INCLUDE });
    if (!entry) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_NOT_FOUND, 'Lançamento financeiro não encontrado', HttpStatus.NOT_FOUND);
    }
    return entry;
  }

  private async assertAccountCategory(
    organizationId: string,
    accountId: string,
    categoryId: string | null,
    entryType: FinancialEntryType,
  ): Promise<void> {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: accountId, organizationId, active: true, deletedAt: null }, select: { id: true } });
    if (!account) throw new ApplicationException(ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND, 'Conta financeira não encontrada ou inativa', HttpStatus.NOT_FOUND);
    // Categoria é opcional no fluxo simplificado; só valida quando informada.
    if (!categoryId) return;
    const category = await this.prisma.financialCategory.findFirst({ where: { id: categoryId, organizationId, active: true, deletedAt: null }, select: { id: true, type: true } });
    if (!category) throw new ApplicationException(ERROR_CODES.FINANCIAL_CATEGORY_NOT_FOUND, 'Categoria financeira não encontrada ou inativa', HttpStatus.NOT_FOUND);
    if (
      (entryType === FinancialEntryType.RECEIVABLE && category.type !== FinancialCategoryType.INCOME) ||
      (entryType === FinancialEntryType.PAYABLE && category.type !== FinancialCategoryType.EXPENSE) ||
      (entryType === FinancialEntryType.TRANSFER && category.type !== FinancialCategoryType.TRANSFER)
    ) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_INVALID_RELATIONSHIP, 'O tipo da categoria financeira não corresponde ao tipo do lançamento', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Conta geral única da organização (fluxo simplificado). Auto-provisionada:
   * reaproveita a conta ativa existente ou cria "Conta Geral". Sem cadastro
   * manual de contas por enquanto.
   */
  private async getOrCreateGeneralAccountId(organizationId: string, client: Prisma.TransactionClient = this.prisma): Promise<string> {
    if (client !== this.prisma) await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receipt-account:${organizationId}`}))`;
    const existing = await client.financialAccount.findFirst({
      where: { organizationId, active: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await client.financialAccount.create({
      data: { organizationId, name: 'Conta Geral', type: FinancialAccountType.CASH },
      select: { id: true },
    });
    return created.id;
  }

  private assertWritable(entry: EntryWithRelations): void {
    if (entry.status === FinancialEntryStatus.PAID || entry.status === FinancialEntryStatus.CANCELED) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_INVALID_STATE, 'Lançamentos financeiros finalizados não podem ser editados', HttpStatus.CONFLICT);
    }
  }

  private assertPayable(status: FinancialEntryStatus): void {
    if (status === FinancialEntryStatus.PAID) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_INVALID_STATE, 'O lançamento financeiro já está pago', HttpStatus.CONFLICT);
    }
    if (status === FinancialEntryStatus.CANCELED) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_INVALID_STATE, 'Lançamentos financeiros cancelados não podem ser pagos', HttpStatus.CONFLICT);
    }
  }

  private assertCancelable(status: FinancialEntryStatus): void {
    if (status === FinancialEntryStatus.CANCELED) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_INVALID_STATE, 'O lançamento financeiro já está cancelado', HttpStatus.CONFLICT);
    }
    if (status === FinancialEntryStatus.PAID) {
      throw new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_INVALID_STATE, 'Lançamentos financeiros pagos não podem ser cancelados nesta versão', HttpStatus.CONFLICT);
    }
  }

  private staleFinancialTransition(message: string): ApplicationException {
    return new ApplicationException(ERROR_CODES.FINANCIAL_ENTRY_INVALID_STATE, message, HttpStatus.CONFLICT);
  }

  private async runSerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryablePersistenceConflict(error) || attempt === attempts) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  private isRetryablePersistenceConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
  }

  private async applyBalanceTx(
    tx: Prisma.TransactionClient,
    accountId: string,
    type: FinancialEntryType,
    amount: Prisma.Decimal,
    mode: 'apply' | 'reverse',
  ): Promise<void> {
    const multiplier = mode === 'apply' ? 1 : -1;
    const delta = this.signedAmount(type, amount) * multiplier;
    if (delta === 0) return;
    await tx.financialAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: this.money(delta) } },
    });
  }

  private signedAmount(type: FinancialEntryType, amount: Prisma.Decimal | number): number {
    const value = Number(amount);
    if (type === FinancialEntryType.RECEIVABLE) return value;
    if (type === FinancialEntryType.PAYABLE) return -value;
    return 0;
  }

  private sumAmount(where: Prisma.FinancialEntryWhereInput): Prisma.PrismaPromise<{ _sum: { amount: Prisma.Decimal | null } }> {
    return this.prisma.financialEntry.aggregate({ where, _sum: { amount: true } });
  }

  private monthlyFlow(
    entries: Array<{ dueDate: Date; paidAt?: Date | null; type: FinancialEntryType; amount: Prisma.Decimal }>,
    monthsBack = 6,
  ): Array<Record<string, string>> {
    const now = new Date();
    const monthKey = (date: Date): string =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    // Pré-preenche os últimos `monthsBack` meses (inclui o atual) em ordem, para
    // a evolução renderizar uma linha contínua mesmo em meses sem lançamentos.
    const months = new Map<string, { income: number; expenses: number; net: number }>();
    for (let offset = monthsBack - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.set(monthKey(date), { income: 0, expenses: 0, net: 0 });
    }
    for (const entry of entries) {
      // Data efetiva: quando pago, usa a data do pagamento; senão, o vencimento.
      const effective = entry.paidAt ?? entry.dueDate;
      const current = months.get(monthKey(effective));
      if (!current) continue; // fora da janela
      const signed = this.signedAmount(entry.type, entry.amount);
      if (signed >= 0) current.income += signed;
      else current.expenses += Math.abs(signed);
      current.net += signed;
    }
    return [...months.entries()].map(([month, value]) => ({
      month,
      income: this.moneyString(value.income),
      expenses: this.moneyString(value.expenses),
      net: this.moneyString(value.net),
    }));
  }

  private async createHistoryTx(
    tx: Prisma.TransactionClient,
    entryId: string,
    actorId: string,
    action: FinancialHistoryAction,
    previousStatus: FinancialEntryStatus | null,
    newStatus: FinancialEntryStatus,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.financialHistory.create({
      data: { entryId, actorId, action, previousStatus, newStatus, metadata },
    });
  }

  private async auditTx(
    tx: Prisma.TransactionClient,
    action: string,
    resource: string,
    actor: AuthenticatedUser,
    context: FinancialAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        action,
        resource,
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

  private async organizationId(client: Prisma.TransactionClient = this.prisma): Promise<string> {
    const organization = await client.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!organization) {
      throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organização não encontrada', HttpStatus.NOT_FOUND);
    }
    return organization.id;
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private optionalClean(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const clean = this.clean(value);
    return clean.length ? clean : null;
  }

  private money(value: number): string {
    return value.toFixed(2);
  }

  private moneyString(value: Prisma.Decimal | number | null | undefined): string {
    return Number(value ?? 0).toFixed(2);
  }
}
