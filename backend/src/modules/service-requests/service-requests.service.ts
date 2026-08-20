import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Role, ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from '../auth/password.service';
import { OperationsService, type OperationAuditContext } from '../operations/operations.service';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { CreateOperationDto } from '../operations/dto/operation.dto';
import type {
  CreateCustomerPortalAccountDto,
  CreateServiceRequestDto,
  ListServiceRequestsDto,
  UpdateServiceRequestDto,
} from './dto/service-request.dto';

const REQUEST_INCLUDE = {
  customer: { select: { id: true, name: true, tradeName: true, phone: true, email: true } },
  address: true,
  equipments: {
    include: {
      equipment: {
        select: { id: true, name: true, tag: true, type: true, sector: true, manufacturer: true, model: true, capacity: true },
      },
    },
  },
  operation: { select: { id: true, number: true, status: true, scheduledFor: true, operator: { select: { id: true, name: true } } } },
} satisfies Prisma.ServiceRequestInclude;

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly operations: OperationsService,
  ) {}

  async portalDashboard(actor: AuthenticatedUser): Promise<unknown> {
    const customerId = this.customerId(actor);
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        addresses: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        equipments: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, type: true, status: true, tag: true, sector: true, manufacturer: true, model: true, serialNumber: true, capacity: true, voltage: true, addressId: true, installationDate: true, warrantyExpiration: true, observations: true },
        },
        operations: {
          orderBy: { createdAt: 'desc' },
          include: {
            address: true,
            equipment: { select: { id: true, name: true, tag: true } },
            operator: { select: { id: true, name: true } },
            inspectedEquipments: { include: { equipment: { select: { id: true, name: true, tag: true } } } },
            documents: { orderBy: { createdAt: 'desc' }, select: { id: true, type: true, number: true, status: true, finalizedAt: true, createdAt: true } },
            pmocExecutionRequest: { select: { id: true, executionNumber: true, executionYear: true, status: true, scheduledFor: true } },
            rvtExecution: { select: { id: true, executionNumber: true, status: true, scheduledAt: true } },
          },
        },
        serviceRequests: { orderBy: { createdAt: 'desc' }, include: REQUEST_INCLUDE },
      },
    });
    if (!customer || !customer.isActive) throw this.notFound();
    return customer;
  }

  async createForCustomer(dto: CreateServiceRequestDto, actor: AuthenticatedUser): Promise<unknown> {
    const customerId = this.customerId(actor);
    await this.validateRelations(customerId, dto.addressId, dto.equipmentIds ?? []);
    return this.prisma.serviceRequest.create({
      data: {
        customerId,
        addressId: dto.addressId ?? null,
        type: dto.type ?? ServiceRequestType.WORK_ORDER,
        subject: dto.subject,
        description: dto.description,
        contactName: dto.contactName ?? actor.name,
        contactPhone: dto.contactPhone ?? null,
        preferredAt: dto.preferredAt ? new Date(dto.preferredAt) : null,
        equipments: { create: (dto.equipmentIds ?? []).map((equipmentId) => ({ equipmentId })) },
      },
      include: REQUEST_INCLUDE,
    });
  }

  async list(query: ListServiceRequestsDto): Promise<unknown> {
    const where: Prisma.ServiceRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search ? { OR: [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceRequest.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: 'desc' }, include: REQUEST_INCLUDE }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<unknown> {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!request) throw this.notFound();
    return request;
  }

  async update(id: string, dto: UpdateServiceRequestDto): Promise<unknown> {
    await this.get(id);
    return this.prisma.serviceRequest.update({
      where: { id },
      data: { status: dto.status, internalNotes: dto.internalNotes },
      include: REQUEST_INCLUDE,
    });
  }

  async createOperation(id: string, dto: CreateOperationDto, actor: AuthenticatedUser, context: OperationAuditContext): Promise<unknown> {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id }, include: { equipments: true, operation: true } });
    if (!request) throw this.notFound();
    if (request.operation) throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Este chamado já possui uma operação vinculada', HttpStatus.CONFLICT);
    const equipmentIds = new Set(request.equipments.map((item) => item.equipmentId));
    const submitted = [dto.equipmentId, ...(dto.inspectedEquipments ?? []).map((item) => item.equipmentId)].filter(Boolean) as string[];
    if (dto.customerId !== request.customerId || submitted.some((equipmentId) => !equipmentIds.has(equipmentId))) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Os dados da operação não pertencem ao chamado', HttpStatus.CONFLICT);
    }
    const operation = await this.operations.create(dto, actor, context) as { id: string };
    await this.prisma.$transaction([
      this.prisma.operation.update({ where: { id: operation.id }, data: { serviceRequestId: id } }),
      this.prisma.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.SCHEDULED } }),
    ]);
    return this.operations.get(operation.id, actor, context);
  }

  async createAccount(customerId: string, dto: CreateCustomerPortalAccountDto): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, isActive: true } });
    if (!customer?.isActive) throw this.notFound();
    const temporaryPassword = `Clima@${randomBytes(6).toString('base64url')}`;
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const usernameBase = dto.email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 35) || 'cliente';
    const username = `${usernameBase.slice(0, 30)}.${randomBytes(4).toString('hex')}`;
    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, username, name: dto.name, passwordHash, role: Role.CUSTOMER, customerId, mustChangePassword: false, preferences: { create: {} }, permission: { create: {} } },
        select: { id: true, email: true, name: true, role: true, customerId: true, isActive: true },
      });
      return { user, temporaryPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApplicationException(ERROR_CODES.USER_CONFLICT, 'Já existe uma conta com este e-mail', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  private customerId(actor: AuthenticatedUser): string {
    if (actor.role !== Role.CUSTOMER || !actor.customerId) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Conta de cliente sem vínculo válido', HttpStatus.FORBIDDEN);
    }
    return actor.customerId;
  }

  private async validateRelations(customerId: string, addressId: string | undefined, equipmentIds: string[]): Promise<void> {
    const [addressCount, equipmentCount] = await Promise.all([
      addressId ? this.prisma.customerAddress.count({ where: { id: addressId, customerId } }) : Promise.resolve(1),
      this.prisma.equipment.count({ where: { id: { in: equipmentIds }, customerId, isActive: true } }),
    ]);
    if (!addressCount || equipmentCount !== equipmentIds.length) {
      throw new ApplicationException(ERROR_CODES.FORBIDDEN, 'Endereço ou equipamento não pertence ao cliente', HttpStatus.CONFLICT);
    }
  }

  private notFound(): ApplicationException {
    return new ApplicationException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Chamado ou cliente não encontrado', HttpStatus.NOT_FOUND);
  }
}
