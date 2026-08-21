import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { CreateOperationDto } from '../operations/dto/operation.dto';
import { CurrentCustomerPortalAccount } from './customer-portal-account.decorator';
import { CustomerPortalService } from './customer-portal.service';
import type { AuthenticatedCustomerPortalAccount } from './customer-portal.types';
import {
  CreateCustomerTicketDto,
  CustomerPortalChangePasswordDto,
  CustomerPortalLoginDto,
  CustomerPortalRefreshDto,
  ListCustomerTicketsQueryDto,
  UpsertCustomerPortalAccountDto,
} from './dto/customer-portal.dto';
import { CustomerPortalAuthGuard } from './guards/customer-portal-auth.guard';

@Controller('customer/auth')
export class CustomerPortalAuthController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() body: CustomerPortalLoginDto): Promise<unknown> {
    return this.portal.login(body);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() body: CustomerPortalRefreshDto): Promise<unknown> {
    return this.portal.refresh(body.refreshToken);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() body: CustomerPortalRefreshDto): Promise<unknown> {
    return this.portal.logout(body.refreshToken);
  }
}

@Public()
@UseGuards(CustomerPortalAuthGuard)
@Controller('customer')
export class CustomerPortalController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Get('me')
  me(@CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    return this.portal.me(account);
  }

  @Post('change-password')
  changePassword(
    @Body() body: CustomerPortalChangePasswordDto,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.changePassword(body, account);
  }

  @Get('operations')
  operations(
    @Query() query: ListCustomerTicketsQueryDto,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.customerOperations(account, query);
  }

  @Get('operations/:id')
  operation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.customerOperation(id, account);
  }

  @Get('equipments')
  equipments(@CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount): Promise<unknown> {
    return this.portal.customerEquipments(account);
  }

  @Get('equipments/:id')
  equipment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.customerEquipment(id, account);
  }

  @Get('tickets')
  tickets(
    @Query() query: ListCustomerTicketsQueryDto,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.listTickets(query, account);
  }

  @Get('tickets/:id')
  ticket(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.getTicket(id, account);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('tickets')
  createTicket(
    @Body() body: CreateCustomerTicketDto,
    @CurrentCustomerPortalAccount() account: AuthenticatedCustomerPortalAccount,
  ): Promise<unknown> {
    return this.portal.createTicket(body, account);
  }
}

@Controller('customer-portal/accounts')
export class CustomerPortalAccountsController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Roles(Role.OWNER, Role.MANAGER)
  @Get()
  list(@Query('customerId', new ParseUUIDPipe({ version: '4' })) customerId: string): Promise<unknown> {
    return this.portal.listAccounts(customerId);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post()
  provision(
    @Body() body: UpsertCustomerPortalAccountDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.portal.provisionAccount(body, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/disable')
  disable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.portal.disableAccount(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/reset-password')
  resetPassword(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.portal.resetAccountPassword(id, actor);
  }
}

@Controller('service-tickets')
export class CustomerServiceTicketsController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.VIEWER)
  @Get()
  list(@Query() query: ListCustomerTicketsQueryDto): Promise<unknown> {
    return this.portal.listTickets(query);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.VIEWER)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.portal.getTicket(id);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Get(':id/operation-prefill')
  prefill(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.portal.ticketOperationPrefill(id);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':id/operation')
  createOperation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.portal.createOperationFromTicket(id, body, actor, {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
