import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CustomerType, EquipmentType, Prisma, Role, TechnicalCatalogType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  STORAGE_PROVIDER_TOKEN,
  type StorageProviderContract,
} from '../../infra/storage/storage-provider.type';
import {
  CUSTOMER_ADDRESS_RESOURCE,
  CUSTOMER_ATTACHMENT_EXTENSIONS,
  CUSTOMER_ATTACHMENT_MIME_TYPES,
  CUSTOMER_ATTACHMENT_RESOURCE,
  CUSTOMER_AUDIT_ACTIONS,
  CUSTOMER_CONTACT_RESOURCE,
  CUSTOMER_RESOURCE,
  MAX_CUSTOMER_ATTACHMENT_SIZE_BYTES,
} from '../../shared/constants/customers.constants';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import { buildPaginatedResponse } from '../../shared/types/pagination.types';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateCustomerDto,
  CreateWalkInCustomerDto,
  CustomerAddressDto,
  CustomerContactDto,
  ListCustomersQueryDto,
  UpdateCustomerAddressDto,
  UpdateCustomerContactDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import type { UploadedCustomerFile } from './types/uploaded-customer-file.type';

export interface CustomerAuditContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const CUSTOMER_INCLUDE = {
  addresses: { orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
  attachments: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.CustomerInclude;

/** Identificação mínima: o bastante para listar e escolher um cliente. */
const CUSTOMER_LIST_BASE = {
  id: true,
  name: true,
  tradeName: true,
  type: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { addresses: true, contacts: true, attachments: true } },
} satisfies Prisma.CustomerSelect;

/** A tabela de Clientes (owner/gestor) mostra documento e contato. */
const CUSTOMER_LIST_PRIVILEGED = {
  ...CUSTOMER_LIST_BASE,
  cpf: true,
  cnpj: true,
  email: true,
  phone: true,
  secondaryPhone: true,
} satisfies Prisma.CustomerSelect;

function customerListSelect(actor: AuthenticatedUser): Prisma.CustomerSelect {
  return actor.role === Role.OWNER || actor.role === Role.MANAGER
    ? CUSTOMER_LIST_PRIVILEGED
    : CUSTOMER_LIST_BASE;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly storage: StorageProviderContract,
  ) {}

  /**
   * Listagem: devolve só o necessário para identificar e escolher um cliente.
   *
   * Antes trazia o registro inteiro (CPF, CNPJ, e-mail, telefones, anotações)
   * para qualquer autenticado — um técnico podia paginar a base e levar os
   * dados pessoais de todos os clientes. Documento e contato continuam na
   * lista para owner/gestor, que é quem tem a tela de Clientes e precisa deles
   * na tabela; o DETALHE (`/customers/:id`) segue completo para todos, porque
   * o operador depende dele (endereços) no atendimento avulso.
   */
  async list(query: ListCustomersQueryDto, actor: AuthenticatedUser): Promise<unknown> {
    const where: Prisma.CustomerWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { tradeName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
            { secondaryPhone: { contains: query.search, mode: 'insensitive' } },
            { cpf: { contains: query.search } },
            { cnpj: { contains: query.search } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: customerListSelect(actor),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<unknown> {
    return this.getCustomerOrThrow(id);
  }

  async stats(): Promise<Record<string, number>> {
    const [total, active, inactive, people, companies] = await this.prisma.$transaction([
      this.prisma.customer.count(),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.customer.count({ where: { isActive: false } }),
      this.prisma.customer.count({ where: { type: CustomerType.PERSON } }),
      this.prisma.customer.count({ where: { type: CustomerType.COMPANY } }),
    ]);
    return { total, active, inactive, people, companies };
  }

  async create(
    dto: CreateCustomerDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({ data: dto, include: CUSTOMER_INCLUDE });
        await tx.auditLog.create({
          data: this.audit(
            CUSTOMER_AUDIT_ACTIONS.CUSTOMER_CREATED,
            CUSTOMER_RESOURCE,
            actor,
            context,
            {
              customerId: customer.id,
              type: customer.type,
            },
          ),
        });
        return customer;
      });
    } catch (error: unknown) {
      this.handleConflict(error);
      throw error;
    }
  }

  /**
   * OS avulso: cadastro criado pelo operador em campo (cliente novo). Cria em uma
   * transação o cliente (pendingReview=true, sem bloquear atendimento) + endereço
   * + contato + equipamento vinculado. O owner conclui o cadastro depois.
   */
  async createWalkIn(
    dto: CreateWalkInCustomerDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<{
    customerId: string;
    addressId: string;
    addressLabel: string;
    equipmentId: string;
    equipmentName: string;
    equipments: Array<{ id: string; name: string; sector: string | null }>;
  }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const equipmentInputs = dto.equipments?.length
          ? dto.equipments
          : dto.equipment
            ? [dto.equipment]
            : [];
        if (equipmentInputs.length === 0) {
          throw new ApplicationException(
            ERROR_CODES.VALIDATION_ERROR,
            'Informe ao menos um equipamento para o atendimento',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          dto.equipments?.some(
            (item) =>
              !item.equipmentTypeCatalogId ||
              !item.manufacturer?.trim() ||
              !item.model?.trim() ||
              !item.capacity?.trim(),
          )
        ) {
          throw new ApplicationException(
            ERROR_CODES.VALIDATION_ERROR,
            'Informe tipo, marca, modelo e capacidade de todos os equipamentos',
            HttpStatus.BAD_REQUEST,
          );
        }
        const catalogIds = [
          ...new Set(
            equipmentInputs
              .map((item) => item.equipmentTypeCatalogId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const catalogs = catalogIds.length
          ? await tx.technicalCatalog.findMany({
              where: {
                id: { in: catalogIds },
                type: TechnicalCatalogType.EQUIPMENT_TYPE,
                active: true,
                deletedAt: null,
              },
              select: { id: true, tags: true },
            })
          : [];
        if (catalogs.length !== catalogIds.length) {
          throw new ApplicationException(
            ERROR_CODES.TECHNICAL_CATALOG_NOT_FOUND,
            'Um dos tipos de equipamento não está disponível',
            HttpStatus.BAD_REQUEST,
          );
        }
        const catalogById = new Map(catalogs.map((catalog) => [catalog.id, catalog]));

        const customer = await tx.customer.create({
          data: {
            type: dto.type,
            name: dto.name,
            ...(dto.type === CustomerType.COMPANY
              ? { cnpj: dto.document }
              : { cpf: dto.document }),
            pendingReview: true,
          },
        });
        const address = await tx.customerAddress.create({
          data: {
            customerId: customer.id,
            name: 'Local do atendimento',
            zipCode: dto.address.zipCode ?? '',
            street: dto.address.street,
            number: dto.address.number,
            complement: dto.address.complement ?? null,
            referencePoint: dto.address.referencePoint ?? null,
            district: dto.address.district,
            city: dto.address.city,
            state: dto.address.state,
            isPrimary: true,
          },
        });
        await tx.customerContact.create({
          data: {
            customerId: customer.id,
            name: dto.contact.name,
            phone: dto.contact.phone,
            isPrimary: true,
          },
        });
        const equipments: Array<{ id: string; name: string; sector: string | null }> = [];
        for (const input of equipmentInputs) {
          const catalog = input.equipmentTypeCatalogId
            ? catalogById.get(input.equipmentTypeCatalogId)
            : undefined;
          const qrToken = randomUUID();
          const equipmentName =
            (input.name?.trim() ||
              [input.manufacturer, input.model]
                .map((value) => value?.trim())
                .filter(Boolean)
                .join(' ')
                .trim() ||
              'Equipamento').slice(0, 180);
          const equipment = await tx.equipment.create({
            data: {
              customerId: customer.id,
              addressId: address.id,
              equipmentTypeCatalogId: catalog?.id ?? null,
              type: catalog ? this.equipmentTypeFromTags(catalog.tags) : input.type ?? EquipmentType.OTHER,
              name: equipmentName,
              sector: input.sector || null,
              tag: input.tag || null,
              manufacturer: input.manufacturer || null,
              model: input.model || null,
              serialNumber: input.serialNumber || null,
              capacity: input.capacity || null,
              voltage: input.voltage || null,
              observations: input.observations || null,
              qrToken,
              qrCode: `equipment:${qrToken}`,
            },
            select: { id: true, name: true, sector: true },
          });
          equipments.push(equipment);
        }
        const equipment = equipments[0];
        await tx.auditLog.create({
          data: this.audit(CUSTOMER_AUDIT_ACTIONS.CUSTOMER_CREATED, CUSTOMER_RESOURCE, actor, context, {
            customerId: customer.id,
            type: customer.type,
            pendingReview: true,
            origin: 'WALK_IN',
            equipmentId: equipment.id,
            equipmentIds: equipments.map((item) => item.id),
            equipmentCount: equipments.length,
          }),
        });
        return {
          customerId: customer.id,
          addressId: address.id,
          addressLabel: [dto.address.street, dto.address.number, dto.address.district, dto.address.city]
            .filter(Boolean)
            .join(', '),
          equipmentId: equipment.id,
          equipmentName: equipment.name,
          equipments,
        };
      });
    } catch (error: unknown) {
      this.handleConflict(error);
      throw error;
    }
  }

  private equipmentTypeFromTags(tags: string[]): EquipmentType {
    for (const type of Object.values(EquipmentType)) {
      const tag = `legacy-${type.toLowerCase().replaceAll('_', '-')}`;
      if (tags.includes(tag)) return type;
    }
    return EquipmentType.OTHER;
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    await this.getCustomerOrThrow(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.update({
          where: { id },
          // Editar o cliente conclui a revisão do cadastro criado em campo.
          data: { ...dto, pendingReview: false },
          include: CUSTOMER_INCLUDE,
        });
        await tx.auditLog.create({
          data: this.audit(
            CUSTOMER_AUDIT_ACTIONS.CUSTOMER_UPDATED,
            CUSTOMER_RESOURCE,
            actor,
            context,
            {
              customerId: id,
              changedFields: Object.keys(dto),
            },
          ),
        });
        return customer;
      });
    } catch (error: unknown) {
      this.handleConflict(error);
      throw error;
    }
  }

  remove(id: string, actor: AuthenticatedUser, context: CustomerAuditContext): Promise<unknown> {
    return this.setActive(id, false, CUSTOMER_AUDIT_ACTIONS.CUSTOMER_DELETED, actor, context, true);
  }

  disable(id: string, actor: AuthenticatedUser, context: CustomerAuditContext): Promise<unknown> {
    return this.setActive(id, false, CUSTOMER_AUDIT_ACTIONS.CUSTOMER_DISABLED, actor, context);
  }

  enable(id: string, actor: AuthenticatedUser, context: CustomerAuditContext): Promise<unknown> {
    return this.setActive(id, true, CUSTOMER_AUDIT_ACTIONS.CUSTOMER_ENABLED, actor, context);
  }

  async createAddress(
    id: string,
    dto: CustomerAddressDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    await this.getCustomerOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary)
        await tx.customerAddress.updateMany({
          where: { customerId: id },
          data: { isPrimary: false },
        });
      const address = await tx.customerAddress.create({
        data: { customerId: id, ...dto, zipCode: dto.zipCode ?? '' },
      });
      await tx.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_ADDRESS_CREATED,
          CUSTOMER_ADDRESS_RESOURCE,
          actor,
          context,
          { customerId: id, addressId: address.id },
        ),
      });
      return address;
    });
  }

  async updateAddress(
    id: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    await this.addressOrThrow(id, addressId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary)
        await tx.customerAddress.updateMany({
          where: { customerId: id, id: { not: addressId } },
          data: { isPrimary: false },
        });
      const address = await tx.customerAddress.update({ where: { id: addressId }, data: dto });
      await tx.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_ADDRESS_UPDATED,
          CUSTOMER_ADDRESS_RESOURCE,
          actor,
          context,
          { customerId: id, addressId, changedFields: Object.keys(dto) },
        ),
      });
      return address;
    });
  }

  async deleteAddress(
    id: string,
    addressId: string,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<{ deleted: true }> {
    await this.addressOrThrow(id, addressId);
    await this.prisma.$transaction([
      this.prisma.customerAddress.delete({ where: { id: addressId } }),
      this.prisma.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_ADDRESS_DELETED,
          CUSTOMER_ADDRESS_RESOURCE,
          actor,
          context,
          { customerId: id, addressId },
        ),
      }),
    ]);
    return { deleted: true };
  }

  async createContact(
    id: string,
    dto: CustomerContactDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    await this.getCustomerOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary)
        await tx.customerContact.updateMany({
          where: { customerId: id },
          data: { isPrimary: false },
        });
      const contact = await tx.customerContact.create({ data: { customerId: id, ...dto } });
      await tx.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_CONTACT_CREATED,
          CUSTOMER_CONTACT_RESOURCE,
          actor,
          context,
          { customerId: id, contactId: contact.id },
        ),
      });
      return contact;
    });
  }

  async updateContact(
    id: string,
    contactId: string,
    dto: UpdateCustomerContactDto,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    await this.contactOrThrow(id, contactId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary)
        await tx.customerContact.updateMany({
          where: { customerId: id, id: { not: contactId } },
          data: { isPrimary: false },
        });
      const contact = await tx.customerContact.update({ where: { id: contactId }, data: dto });
      await tx.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_CONTACT_UPDATED,
          CUSTOMER_CONTACT_RESOURCE,
          actor,
          context,
          { customerId: id, contactId, changedFields: Object.keys(dto) },
        ),
      });
      return contact;
    });
  }

  async deleteContact(
    id: string,
    contactId: string,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<{ deleted: true }> {
    await this.contactOrThrow(id, contactId);
    await this.prisma.$transaction([
      this.prisma.customerContact.delete({ where: { id: contactId } }),
      this.prisma.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_CONTACT_DELETED,
          CUSTOMER_CONTACT_RESOURCE,
          actor,
          context,
          { customerId: id, contactId },
        ),
      }),
    ]);
    return { deleted: true };
  }

  async uploadAttachment(
    id: string,
    category: string,
    file: UploadedCustomerFile | undefined,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<unknown> {
    await this.getCustomerOrThrow(id);
    this.validateFile(file);
    const valid = file as UploadedCustomerFile;
    const extension =
      valid.mimetype === 'application/pdf' ? 'pdf' : valid.mimetype === 'image/png' ? 'png' : 'jpg';
    const storageKey = `customers/${id}/attachments/${randomUUID()}.${extension}`;
    await this.storage.save({ storageKey, content: valid.buffer });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attachment = await tx.customerAttachment.create({
          data: {
            customerId: id,
            storageKey,
            fileName: this.sanitize(valid.originalname),
            mimeType: valid.mimetype,
            fileSize: valid.size,
            category,
          },
        });
        await tx.auditLog.create({
          data: this.audit(
            CUSTOMER_AUDIT_ACTIONS.CUSTOMER_ATTACHMENT_UPLOADED,
            CUSTOMER_ATTACHMENT_RESOURCE,
            actor,
            context,
            {
              customerId: id,
              attachmentId: attachment.id,
              category,
              mimeType: attachment.mimeType,
              fileSize: attachment.fileSize,
            },
          ),
        });
        return attachment;
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async getAttachment(attachmentId: string): Promise<unknown> {
    const attachment = await this.attachmentOrThrow(attachmentId);
    const stored = await this.storage.get(attachment.storageKey);
    return { ...attachment, contentBase64: stored.content.toString('base64') };
  }

  async deleteAttachment(
    attachmentId: string,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
  ): Promise<{ deleted: true }> {
    const attachment = await this.attachmentOrThrow(attachmentId);
    await this.prisma.$transaction([
      this.prisma.customerAttachment.delete({ where: { id: attachmentId } }),
      this.prisma.auditLog.create({
        data: this.audit(
          CUSTOMER_AUDIT_ACTIONS.CUSTOMER_ATTACHMENT_DELETED,
          CUSTOMER_ATTACHMENT_RESOURCE,
          actor,
          context,
          { customerId: attachment.customerId, attachmentId },
        ),
      }),
    ]);
    await this.storage.delete(attachment.storageKey);
    return { deleted: true };
  }

  private async setActive(
    id: string,
    active: boolean,
    action: string,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
    softDelete = false,
  ): Promise<unknown> {
    await this.getCustomerOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id },
        data: { isActive: active, disabledAt: active ? null : new Date() },
        include: CUSTOMER_INCLUDE,
      });
      await tx.auditLog.create({
        data: this.audit(action, CUSTOMER_RESOURCE, actor, context, {
          customerId: id,
          ...(softDelete ? { softDelete: true } : {}),
        }),
      });
      return softDelete ? { deleted: true } : customer;
    });
  }

  private async getCustomerOrThrow(
    id: string,
  ): Promise<Prisma.CustomerGetPayload<{ include: typeof CUSTOMER_INCLUDE }>> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: CUSTOMER_INCLUDE,
    });
    if (!customer)
      throw new ApplicationException(
        ERROR_CODES.CUSTOMER_NOT_FOUND,
        'Cliente não encontrado',
        HttpStatus.NOT_FOUND,
      );
    return customer;
  }

  private async addressOrThrow(customerId: string, id: string): Promise<void> {
    if (
      !(await this.prisma.customerAddress.findFirst({
        where: { id, customerId },
        select: { id: true },
      }))
    )
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Endereço do cliente não encontrado',
        HttpStatus.NOT_FOUND,
      );
  }

  private async contactOrThrow(customerId: string, id: string): Promise<void> {
    if (
      !(await this.prisma.customerContact.findFirst({
        where: { id, customerId },
        select: { id: true },
      }))
    )
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Contato do cliente não encontrado',
        HttpStatus.NOT_FOUND,
      );
  }

  private async attachmentOrThrow(
    id: string,
  ): Promise<Prisma.CustomerAttachmentGetPayload<object>> {
    const value = await this.prisma.customerAttachment.findUnique({ where: { id } });
    if (!value)
      throw new ApplicationException(
        ERROR_CODES.NOT_FOUND,
        'Anexo do cliente não encontrado',
        HttpStatus.NOT_FOUND,
      );
    return value;
  }

  private validateFile(file: UploadedCustomerFile | undefined): void {
    if (!file)
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_REQUIRED,
        'Envie um arquivo',
        HttpStatus.BAD_REQUEST,
      );
    if (file.size > MAX_CUSTOMER_ATTACHMENT_SIZE_BYTES)
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
        'O anexo excede o limite de 5 MiB',
        HttpStatus.BAD_REQUEST,
      );
    const extension = extname(file.originalname).slice(1).toLowerCase();
    if (!CUSTOMER_ATTACHMENT_EXTENSIONS.includes(extension as never))
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_EXTENSION,
        'Extensão do anexo não permitida',
        HttpStatus.BAD_REQUEST,
      );
    if (!CUSTOMER_ATTACHMENT_MIME_TYPES.includes(file.mimetype as never))
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'Tipo MIME do anexo não permitido',
        HttpStatus.BAD_REQUEST,
      );
    const pdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
    const png =
      file.buffer.length >= 8 &&
      file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg =
      file.buffer.length >= 3 &&
      file.buffer[0] === 0xff &&
      file.buffer[1] === 0xd8 &&
      file.buffer[2] === 0xff;
    if (
      (file.mimetype === 'application/pdf' && !pdf) ||
      (file.mimetype === 'image/png' && !png) ||
      (file.mimetype === 'image/jpeg' && !jpg)
    )
      throw new ApplicationException(
        ERROR_CODES.UPLOAD_INVALID_MIME_TYPE,
        'O conteúdo do anexo não corresponde ao tipo declarado',
        HttpStatus.BAD_REQUEST,
      );
  }

  private sanitize(name: string): string {
    return (
      name
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 255) || 'attachment'
    );
  }

  private handleConflict(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ApplicationException(
        ERROR_CODES.CUSTOMER_CONFLICT,
        'CPF ou CNPJ já está em uso',
        HttpStatus.CONFLICT,
        { fields: error.meta?.target ?? [] },
      );
  }

  private audit(
    action: string,
    resource: string,
    actor: AuthenticatedUser,
    context: CustomerAuditContext,
    metadata: Record<string, unknown>,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      action,
      resource,
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
