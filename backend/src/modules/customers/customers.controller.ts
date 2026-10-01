import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { MAX_CUSTOMER_ATTACHMENT_SIZE_BYTES } from '../../shared/constants/customers.constants';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RequirePermission } from '../../shared/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  CreateCustomerDto,
  CreateWalkInCustomerDto,
  CustomerAddressDto,
  CustomerContactDto,
  ListCustomersQueryDto,
  UpdateCustomerAddressDto,
  UpdateCustomerContactDto,
  UpdateCustomerDto,
  UploadCustomerAttachmentDto,
} from './dto/customer.dto';
import type { UploadedCustomerFile } from './types/uploaded-customer-file.type';
import { CustomersService, type CustomerAuditContext } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get()
  list(
    @Query() query: ListCustomersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.customers.list(query, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('stats')
  stats(): Promise<Record<string, number>> {
    return this.customers.stats();
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post()
  create(
    @Body() body: CreateCustomerDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.create(body, actor, this.context(request));
  }

  // OS avulso: operador registra um cliente novo em campo (fica em Revisão).
  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Post('walk-in')
  createWalkIn(
    @Body() body: CreateWalkInCustomerDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.createWalkIn(body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/disable')
  disable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.disable(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/enable')
  enable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.enable(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':id/addresses')
  createAddress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CustomerAddressDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.createAddress(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/addresses/:addressId')
  updateAddress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('addressId', new ParseUUIDPipe({ version: '4' })) addressId: string,
    @Body() body: UpdateCustomerAddressDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.updateAddress(id, addressId, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id/addresses/:addressId')
  deleteAddress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('addressId', new ParseUUIDPipe({ version: '4' })) addressId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.customers.deleteAddress(id, addressId, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':id/contacts')
  createContact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CustomerContactDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.createContact(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/contacts/:contactId')
  updateContact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('contactId', new ParseUUIDPipe({ version: '4' })) contactId: string,
    @Body() body: UpdateCustomerContactDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.updateContact(id, contactId, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id/contacts/:contactId')
  deleteContact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('contactId', new ParseUUIDPipe({ version: '4' })) contactId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.customers.deleteContact(id, contactId, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CUSTOMER_ATTACHMENT_SIZE_BYTES, files: 1 },
    }),
  )
  uploadAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UploadCustomerAttachmentDto,
    @UploadedFile() file: UploadedCustomerFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.uploadAttachment(id, body.category, file, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('attachments/:attachmentId')
  getAttachment(
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
  ): Promise<unknown> {
    return this.customers.getAttachment(attachmentId);
  }

  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @Delete('attachments/:attachmentId')
  deleteAttachment(
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.customers.deleteAttachment(attachmentId, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.customers.get(id);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateCustomerDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.update(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.customers.remove(id, actor, this.context(request));
  }

  private context(request: RequestWithId): CustomerAuditContext {
    return {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
