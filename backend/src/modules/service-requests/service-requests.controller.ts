import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { CreateOperationDto } from '../operations/dto/operation.dto';
import {
  CreateCustomerPortalAccountDto,
  CreateServiceRequestDto,
  ListServiceRequestsDto,
  UpdateServiceRequestDto,
} from './dto/service-request.dto';
import { ServiceRequestsService } from './service-requests.service';

@Controller()
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Roles(Role.CUSTOMER)
  @Get('customer-portal/dashboard')
  dashboard(@CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.requests.portalDashboard(actor);
  }

  @Roles(Role.CUSTOMER)
  @Post('customer-portal/service-requests')
  create(@Body() body: CreateServiceRequestDto, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.requests.createForCustomer(body, actor);
  }

  @Roles(Role.OWNER)
  @Post('customer-portal/accounts/:customerId')
  createAccount(@Param('customerId', new ParseUUIDPipe({ version: '4' })) customerId: string, @Body() body: CreateCustomerPortalAccountDto): Promise<unknown> {
    return this.requests.createAccount(customerId, body);
  }

  @Roles(Role.OWNER)
  @Get('service-requests')
  list(@Query() query: ListServiceRequestsDto): Promise<unknown> {
    return this.requests.list(query);
  }

  @Roles(Role.OWNER)
  @Get('service-requests/:id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.requests.get(id);
  }

  @Roles(Role.OWNER)
  @Patch('service-requests/:id')
  update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateServiceRequestDto): Promise<unknown> {
    return this.requests.update(id, body);
  }

  @Roles(Role.OWNER)
  @Post('service-requests/:id/operation')
  createOperation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.requests.createOperation(id, body, actor, {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
