import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  CustomerPortalTicketStatus,
  DocumentTemplateType,
  OperationStatus,
  OperationType,
  Prisma,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { OperationsService, type OperationAuditContext } from '../operations/operations.service';
import { PasswordService } from '../auth/password.service';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { CreateOperationDto } from '../operations/dto/operation.dto';
import type {
  CustomerPortalChangePasswordDto,
  CreateCustomerTicketDto,
  CustomerPortalLoginDto,
  ListCustomerPortalAccountsQueryDto,
  ListCustomerTicketsQueryDto,
  UpsertCustomerPortalAccountDto,
} from './dto/customer-portal.dto';
import type { AuthenticatedCustomerPortalAccount } from './customer-portal.types';

type CustomerAccessPayload = {
  sub: string;
  customerId: string;
  organizationId: string;
  type: 'customer-access';
  jti: string;
  sid: string;
};

type CustomerRefreshPayload = {
  sub: string;
  type: 'customer-refresh';
  jti: string;
};

const TICKET_INCLUDE = {
  customer: { select: { id: true, name: true, tradeName: true, cpf: true, cnpj: true } },
  account: { select: { id: true, name: true, email: true, phone: true } },
  address: true,
  operation: { select: { id: true, number: true, status: true, operator: { select: { id: true, name: true } } } },
} satisfies Prisma.CustomerServiceTicketInclude;

const CUSTOMER_OPERATION_SELECT = {
  id: true,
  number: true,
  type: true,
  requestedDocumentType: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
  reportedIssue: true,
  serviceDescription: true,
  observations: true,
  createdAt: true,
  updatedAt: true,
  address: true,
  equipment: {
    select: { id: true, name: true, tag: true, manufacturer: true, model: true, capacity: true, sector: true },
  },
  inspectedEquipments: {
    orderBy: { position: 'asc' as const },
    select: {
      position: true,
      sector: true,
      equipment: {
        select: { id: true, name: true, tag: true, manufacturer: true, model: true, capacity: true, sector: true },
      },
    },
  },
  operator: { select: { id: true, name: true } },
  documents: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, type: true, number: true, status: true, revision: true, renderedAt: true, createdAt: true },
  },
  pmocExecutionRequest: {
    select: {
      id: true,
      executionNumber: true,
      equipmentExecutionNumber: true,
      scheduledFor: true,
      status: true,
      pmocPlan: { select: { id: true, number: true, startDate: true, endDate: true } },
    },
  },
  rvtExecution: {
    select: {
      id: true,
      executionNumber: true,
      scheduledAt: true,
      status: true,
      rvtPlan: { select: { id: true, number: true, name: true, startDate: true, endDate: true } },
    },
  },
} satisfies Prisma.OperationSelect;

const CUSTOMER_EQUIPMENT_SELECT = {
  id: true,
  type: true,
  status: true,
  name: true,
  tag: true,
  manufacturer: true,
  model: true,
  serialNumber: true,
  capacity: true,
  sector: true,
  voltage: true,
  installationDate: true,
  warrantyExpiration: true,
  observations: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  address: true,
  equipmentTypeCatalog: { select: { id: true, title: true } },
} satisfies Prisma.EquipmentSelect;

@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
    private readonly operations: OperationsService,
  ) {}

  async login(input: CustomerPortalLoginDto): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const account = await this.prisma.customerPortalAccount.findUnique({
      where: { email: input.email },
      include: { customer: true },
    });
    const passwordValid = await this.passwords.verifyPassword(account?.passwordHash ?? null, input.password);
    if (!account || !passwordValid || !account.isActive || !account.customer.isActive) {
      await this.prisma.auditLog.create({
        data: {
          action: 'CUSTOMER_PORTAL_LOGIN_FAILURE',
          resource: 'CUSTOMER_PORTAL',
          actor: account?.id ?? null,
          metadata: { email: input.email },
        },
      });
      throw new ApplicationException(
        !account || !passwordValid ? ERROR_CODES.AUTH_INVALID_CREDENTIALS : ERROR_CODES.AUTH_USER_INACTIVE,
        !account || !passwordValid ? 'E-mail ou senha incorretos' : 'Acesso do cliente está inativo',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const tokens = await this.issueTokenPair(account);
    await this.prisma.$transaction([
      this.prisma.customerPortalAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.customerPortalRefreshToken.create({ data: tokens.refreshTokenRecord }),
      this.prisma.auditLog.create({
        data: {
          action: 'CUSTOMER_PORTAL_LOGIN_SUCCESS',
          resource: 'CUSTOMER_PORTAL',
          actor: account.id,
          metadata: { customerId: account.customerId },
        },
      }),
    ]);
    return tokens.response;
  }

  async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const payload = await this.verifyRefreshJwt(rawToken);
    const stored = await this.prisma.customerPortalRefreshToken.findUnique({
      where: { id: payload.jti },
      include: { account: { include: { customer: true } } },
    });
    if (!stored || stored.accountId !== payload.sub || stored.revokedAt) {
      throw this.invalidToken();
    }
    const now = new Date();
    const valid = stored.expiresAt > now && (await this.passwords.verify(stored.tokenHash, rawToken));
    if (!valid || !stored.account.isActive || !stored.account.customer.isActive) {
      throw this.invalidToken();
    }
    const tokens = await this.issueTokenPair(stored.account);
    await this.prisma.$transaction([
      this.prisma.customerPortalRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } }),
      this.prisma.customerPortalRefreshToken.create({ data: tokens.refreshTokenRecord }),
    ]);
    return tokens.response;
  }

  async logout(rawToken: string): Promise<{ revoked: true }> {
    const payload = await this.verifyRefreshJwt(rawToken);
    await this.prisma.customerPortalRefreshToken.updateMany({
      where: { id: payload.jti, accountId: payload.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  async validateCustomerAccessToken(rawToken: string): Promise<AuthenticatedCustomerPortalAccount> {
    let payload: CustomerAccessPayload;
    try {
      payload = await this.jwt.verifyAsync<CustomerAccessPayload>(rawToken, {
        secret: this.config.jwtSecret,
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
    } catch {
      throw new ApplicationException(ERROR_CODES.AUTH_INVALID_TOKEN, 'Customer token is invalid or expired', HttpStatus.UNAUTHORIZED);
    }
    if (payload.type !== 'customer-access' || !payload.sid) throw this.invalidToken();
    const session = await this.prisma.customerPortalRefreshToken.findFirst({
      where: { id: payload.sid, accountId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        account: {
          select: {
            id: true,
            organizationId: true,
            customerId: true,
            email: true,
            name: true,
            isActive: true,
            mustChangePassword: true,
            customer: { select: { isActive: true } },
          },
        },
      },
    });
    if (!session?.account.isActive || !session.account.customer.isActive) throw this.invalidToken();
    return {
      id: session.account.id,
      organizationId: session.account.organizationId,
      customerId: session.account.customerId,
      email: session.account.email,
      name: session.account.name,
      isActive: session.account.isActive,
      mustChangePassword: session.account.mustChangePassword,
    };
  }

  async listAccounts(customerId: string): Promise<unknown> {
    return this.prisma.customerPortalAccount.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, customerId: true, email: true, name: true, phone: true, mustChangePassword: true,
        isActive: true, disabledAt: true, lastLoginAt: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async listAccountDirectory(query: ListCustomerPortalAccountsQueryDto): Promise<unknown> {
    const organization = await this.defaultOrganization();
    const where: Prisma.CustomerPortalAccountWhereInput = {
      organizationId: organization.id,
      ...(query.status === 'ACTIVE' ? { isActive: true } : query.status === 'INACTIVE' ? { isActive: false } : {}),
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { tradeName: { contains: query.search, mode: 'insensitive' } } },
        { customer: { cpf: { contains: query.search, mode: 'insensitive' } } },
        { customer: { cnpj: { contains: query.search, mode: 'insensitive' } } },
      ] } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerPortalAccount.findMany({
        where, skip, take: query.limit,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: {
          id: true, customerId: true, email: true, name: true, phone: true, mustChangePassword: true,
          isActive: true, disabledAt: true, lastLoginAt: true, createdAt: true, updatedAt: true,
          customer: { select: {
            id: true, name: true, tradeName: true, cpf: true, cnpj: true, isActive: true,
          } },
        },
      }),
      this.prisma.customerPortalAccount.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async provisionAccount(dto: UpsertCustomerPortalAccountDto, actor: AuthenticatedUser): Promise<unknown> {
    const organization = await this.defaultOrganization();
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, isActive: true } });
    if (!customer) throw new ApplicationException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Cliente não encontrado', HttpStatus.NOT_FOUND);
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const existing = await this.prisma.customerPortalAccount.findUnique({ where: { email: dto.email } });
    if (existing && existing.customerId !== customer.id) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'E-mail já vinculado a outro cliente', HttpStatus.CONFLICT);
    }
    const account = existing
      ? await this.prisma.customerPortalAccount.update({
          where: { id: existing.id },
          data: {
            name: dto.name, phone: dto.phone ?? customer.phone, passwordHash,
            mustChangePassword: true, isActive: true, disabledAt: null,
          },
          select: { id: true, customerId: true, email: true, name: true, phone: true, mustChangePassword: true, isActive: true, createdAt: true, updatedAt: true },
        })
      : await this.prisma.customerPortalAccount.create({
          data: {
        organizationId: organization.id,
        customerId: customer.id,
        email: dto.email,
        name: dto.name,
        phone: dto.phone ?? customer.phone,
        passwordHash,
          },
          select: { id: true, customerId: true, email: true, name: true, phone: true, mustChangePassword: true, isActive: true, createdAt: true, updatedAt: true },
        });
    await this.prisma.customerPortalRefreshToken.updateMany({
      where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'CUSTOMER_PORTAL_ACCOUNT_PROVISIONED',
        resource: 'CUSTOMER_PORTAL_ACCOUNT',
        actor: actor.id,
        metadata: { customerId: customer.id, accountId: account.id },
      },
    });
    return { account, temporaryPassword };
  }

  async disableAccount(id: string, actor: AuthenticatedUser): Promise<unknown> {
    const account = await this.prisma.customerPortalAccount.update({
      where: { id },
      data: { isActive: false, disabledAt: new Date() },
      select: { id: true, customerId: true, email: true, name: true, isActive: true, disabledAt: true },
    });
    await this.prisma.auditLog.create({
      data: { action: 'CUSTOMER_PORTAL_ACCOUNT_DISABLED', resource: 'CUSTOMER_PORTAL_ACCOUNT', actor: actor.id, metadata: { accountId: id } },
    });
    return account;
  }

  async resetAccountPassword(id: string, actor: AuthenticatedUser): Promise<unknown> {
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerPortalAccount.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, isActive: true, disabledAt: null },
        select: { id: true, customerId: true, email: true, name: true, mustChangePassword: true, isActive: true },
      });
      await tx.customerPortalRefreshToken.updateMany({
        where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { action: 'CUSTOMER_PORTAL_PASSWORD_RESET', resource: 'CUSTOMER_PORTAL_ACCOUNT', actor: actor.id, metadata: { accountId: id, customerId: updated.customerId } },
      });
      return updated;
    });
    return { account, temporaryPassword };
  }

  async changePassword(
    dto: CustomerPortalChangePasswordDto,
    account: AuthenticatedCustomerPortalAccount,
  ): Promise<{ changed: true }> {
    const stored = await this.prisma.customerPortalAccount.findUnique({ where: { id: account.id } });
    if (!stored || !(await this.passwords.verifyPassword(stored.passwordHash, dto.currentPassword))) {
      throw new ApplicationException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Senha atual incorreta', HttpStatus.BAD_REQUEST);
    }
    if (await this.passwords.verify(stored.passwordHash, dto.newPassword)) {
      throw new ApplicationException(ERROR_CODES.VALIDATION_ERROR, 'A nova senha deve ser diferente da senha atual', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.customerPortalAccount.update({
      where: { id: account.id },
      data: { passwordHash: await this.passwords.hash(dto.newPassword), mustChangePassword: false },
    });
    await this.prisma.auditLog.create({
      data: { action: 'CUSTOMER_PORTAL_PASSWORD_CHANGED', resource: 'CUSTOMER_PORTAL_ACCOUNT', actor: account.id, metadata: { customerId: account.customerId } },
    });
    return { changed: true };
  }

  async me(account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: account.customerId },
      select: {
        id: true,
        type: true,
        name: true,
        tradeName: true,
        cpf: true,
        cnpj: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        isActive: true,
        createdAt: true,
        addresses: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, role: true, phone: true, email: true, isPrimary: true },
        },
      },
    });
    return {
      account: {
        id: account.id, email: account.email, name: account.name,
        mustChangePassword: account.mustChangePassword,
      },
      customer,
    };
  }

  async customerOperations(account: AuthenticatedCustomerPortalAccount, query: ListCustomerTicketsQueryDto): Promise<unknown> {
    const where: Prisma.OperationWhereInput = {
      customerId: account.customerId,
      ...(query.search
        ? {
            OR: [
              { serviceDescription: { contains: query.search, mode: 'insensitive' } },
              { reportedIssue: { contains: query.search, mode: 'insensitive' } },
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
        select: CUSTOMER_OPERATION_SELECT,
      }),
      this.prisma.operation.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async customerOperation(id: string, account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    const operation = await this.prisma.operation.findFirst({
      where: { id, customerId: account.customerId }, select: CUSTOMER_OPERATION_SELECT,
    });
    if (!operation) throw new ApplicationException(ERROR_CODES.OPERATION_NOT_FOUND, 'Atendimento não encontrado', HttpStatus.NOT_FOUND);
    return operation;
  }

  async customerEquipments(account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    return this.prisma.equipment.findMany({
      where: { customerId: account.customerId, isActive: true },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: CUSTOMER_EQUIPMENT_SELECT,
    });
  }

  async customerEquipment(id: string, account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id, customerId: account.customerId, isActive: true },
      select: {
        ...CUSTOMER_EQUIPMENT_SELECT,
        operations: {
          where: { customerId: account.customerId }, orderBy: { createdAt: 'desc' }, take: 20,
          select: CUSTOMER_OPERATION_SELECT,
        },
      },
    });
    if (!equipment) throw new ApplicationException(ERROR_CODES.EQUIPMENT_NOT_FOUND, 'Equipamento não encontrado', HttpStatus.NOT_FOUND);
    return equipment;
  }

  async listTickets(query: ListCustomerTicketsQueryDto, account?: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    const where: Prisma.CustomerServiceTicketWhereInput = {
      ...(account ? { customerId: account.customerId, organizationId: account.organizationId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerServiceTicket.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: TICKET_INCLUDE,
      }),
      this.prisma.customerServiceTicket.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async createTicket(dto: CreateCustomerTicketDto, account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    await this.validateCustomerTicketRelations(dto, account.customerId);
    const ticket = await this.prisma.customerServiceTicket.create({
      data: {
        organizationId: account.organizationId,
        customerId: account.customerId,
        accountId: account.id,
        addressId: dto.addressId ?? null,
        equipmentIds: dto.equipmentIds ?? [],
        documentType: dto.documentType ?? DocumentTemplateType.WORK_ORDER,
        operationType: dto.operationType ?? OperationType.CORRETIVA,
        serviceTypes: dto.serviceTypes ?? [dto.operationType ?? OperationType.CORRETIVA],
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? null,
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : null,
        contactName: dto.contactName ?? null,
        contactPhone: dto.contactPhone ?? null,
      },
      include: TICKET_INCLUDE,
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'CUSTOMER_SERVICE_TICKET_CREATED',
        resource: 'CUSTOMER_SERVICE_TICKET',
        actor: account.id,
        metadata: { ticketId: ticket.id, customerId: account.customerId },
      },
    });
    return ticket;
  }

  async createOperationFromTicket(
    id: string,
    dto: CreateOperationDto,
    actor: AuthenticatedUser,
    context: OperationAuditContext,
  ): Promise<unknown> {
    const ticket = await this.prisma.customerServiceTicket.findUnique({ where: { id } });
    if (!ticket) throw new ApplicationException(ERROR_CODES.NOT_FOUND, 'Chamado não encontrado', HttpStatus.NOT_FOUND);
    if (ticket.operationId) {
      throw new ApplicationException(ERROR_CODES.OPERATION_INVALID_TRANSITION, 'Chamado já possui operação vinculada', HttpStatus.CONFLICT);
    }
    const operation = (await this.operations.create(
      {
        ...dto,
        customerId: ticket.customerId,
        addressId: dto.addressId ?? ticket.addressId ?? undefined,
        operatorId: dto.operatorId,
        documentType: dto.documentType ?? ticket.documentType,
        type: dto.type ?? ticket.operationType,
        serviceTypes: dto.serviceTypes?.length ? dto.serviceTypes : ticket.serviceTypes.length ? ticket.serviceTypes : [ticket.operationType],
        status: dto.status ?? OperationStatus.PENDING,
        scheduledFor: dto.scheduledFor ?? ticket.preferredDate?.toISOString(),
        reportedIssue: dto.reportedIssue ?? ticket.title,
        serviceDescription: dto.serviceDescription ?? ticket.description,
        inspectedEquipments: dto.inspectedEquipments?.length
          ? dto.inspectedEquipments
          : ticket.equipmentIds.map((equipmentId) => ({ equipmentId, sector: '' })),
      },
      actor,
      context,
      async (tx, operationId) => {
        await tx.customerServiceTicket.update({
          where: { id: ticket.id },
          data: { operationId, status: CustomerPortalTicketStatus.OPERATION_CREATED },
        });
      },
    )) as { id?: string };
    await this.prisma.auditLog.create({
      data: {
        action: 'CUSTOMER_SERVICE_TICKET_CONVERTED',
        resource: 'CUSTOMER_SERVICE_TICKET',
        actor: actor.id,
        metadata: { ticketId: ticket.id, operationId: operation.id ?? null },
      },
    });
    return operation;
  }

  async getTicket(id: string, account?: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    const ticket = await this.prisma.customerServiceTicket.findFirst({
      where: { id, ...(account ? { customerId: account.customerId, organizationId: account.organizationId } : {}) },
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw new ApplicationException(ERROR_CODES.NOT_FOUND, 'Chamado não encontrado', HttpStatus.NOT_FOUND);
    return ticket;
  }

  async ticketOperationPrefill(id: string): Promise<Record<string, unknown>> {
    const ticket = await this.prisma.customerServiceTicket.findUnique({ where: { id }, include: TICKET_INCLUDE });
    if (!ticket) throw new ApplicationException(ERROR_CODES.NOT_FOUND, 'Chamado não encontrado', HttpStatus.NOT_FOUND);
    return {
      customerId: ticket.customerId,
      addressId: ticket.addressId,
      inspectedEquipments: ticket.equipmentIds.map((equipmentId) => ({ equipmentId, sector: '' })),
      type: ticket.operationType,
      serviceTypes: ticket.serviceTypes.length ? ticket.serviceTypes : [ticket.operationType],
      documentType: ticket.documentType,
      scheduledFor: ticket.preferredDate,
      reportedIssue: ticket.title,
      serviceDescription: ticket.description,
    };
  }

  private async issueTokenPair(account: { id: string; customerId: string; organizationId: string; email: string }): Promise<{
    response: { accessToken: string; refreshToken: string; expiresIn: number };
    refreshTokenRecord: Prisma.CustomerPortalRefreshTokenUncheckedCreateInput;
  }> {
    const accessId = randomUUID();
    const refreshId = randomUUID();
    const accessPayload: Omit<CustomerAccessPayload, 'jti'> = {
      sub: account.id,
      customerId: account.customerId,
      organizationId: account.organizationId,
      type: 'customer-access',
      sid: refreshId,
    };
    const refreshPayload: Omit<CustomerRefreshPayload, 'jti'> = {
      sub: account.id,
      type: 'customer-refresh',
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.jwtSecret,
        algorithm: 'HS256',
        expiresIn: this.config.jwtAccessExpiresInSeconds,
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        jwtid: accessId,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.jwtRefreshSecret,
        algorithm: 'HS256',
        expiresIn: this.config.jwtRefreshExpiresInSeconds,
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        jwtid: refreshId,
      }),
    ]);
    return {
      response: { accessToken, refreshToken, expiresIn: this.config.jwtAccessExpiresInSeconds },
      refreshTokenRecord: {
        id: refreshId,
        accountId: account.id,
        tokenHash: await this.passwords.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.config.jwtRefreshExpiresInSeconds * 1000),
      },
    };
  }

  private async verifyRefreshJwt(rawToken: string): Promise<CustomerRefreshPayload> {
    try {
      const payload = await this.jwt.verifyAsync<CustomerRefreshPayload>(rawToken, {
        secret: this.config.jwtRefreshSecret,
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
      if (payload.type !== 'customer-refresh' || !payload.sub || !payload.jti) throw new Error('invalid');
      return payload;
    } catch {
      throw this.invalidToken();
    }
  }

  private async validateCustomerTicketRelations(dto: CreateCustomerTicketDto, customerId: string): Promise<void> {
    if (dto.addressId) {
      const address = await this.prisma.customerAddress.findFirst({ where: { id: dto.addressId, customerId } });
      if (!address) throw new ApplicationException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Endereço não pertence ao cliente', HttpStatus.CONFLICT);
    }
    const equipmentIds = dto.equipmentIds ?? [];
    if (equipmentIds.length) {
      const count = await this.prisma.equipment.count({ where: { id: { in: equipmentIds }, customerId, isActive: true } });
      if (count !== equipmentIds.length) {
        throw new ApplicationException(ERROR_CODES.EQUIPMENT_NOT_FOUND, 'Um dos equipamentos não pertence ao cliente', HttpStatus.CONFLICT);
      }
    }
  }

  private async defaultOrganization(): Promise<{ id: string }> {
    const organization = await this.prisma.organization.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!organization) throw new ApplicationException(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organização não encontrada', HttpStatus.CONFLICT);
    return organization;
  }

  private invalidToken(): ApplicationException {
    return new ApplicationException(ERROR_CODES.AUTH_INVALID_TOKEN, 'Token do portal do cliente inválido ou expirado', HttpStatus.UNAUTHORIZED);
  }

  private generateTemporaryPassword(): string {
    return randomBytes(18).toString('base64url');
  }
}
