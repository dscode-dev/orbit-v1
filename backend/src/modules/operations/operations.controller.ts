import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RequirePermission } from '../../shared/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  CreateOperationDto,
  CreateOperationFieldEquipmentsDto,
  ListOperationsQueryDto,
  OperationStatsQueryDto,
  UpdateOperationDto,
  UpdateOperationPhotoDto,
} from './dto/operation.dto';
import { OperationsService, type OperationAuditContext } from './operations.service';
import { OperationCancellationsService } from './operation-cancellations.service';
import { ApproveOperationCancellationDto, RequestOperationCancellationDto, RescheduleCanceledOperationDto } from './dto/operation-cancellation.dto';

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly cancellations: OperationCancellationsService,
  ) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get()
  list(@Query() query: ListOperationsQueryDto, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.operations.list(query, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('stats')
  stats(
    @Query() query: OperationStatsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.operations.stats(query, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Post()
  create(
    @Body() body: CreateOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.create(body, actor, this.context(request));
  }

  @Roles(Role.OPERATOR)
  @RequirePermission('canReports')
  @Post(':id/equipments')
  addFieldEquipments(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateOperationFieldEquipmentsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.addFieldEquipments(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('photos/:photoId')
  getPhoto(
    @Param('photoId', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.getPhoto(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch('photos/:photoId')
  updatePhoto(
    @Param('photoId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateOperationPhotoDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.updatePhoto(id, body.caption, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Delete('photos/:photoId')
  deletePhoto(
    @Param('photoId', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.deletePhoto(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.get(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/approve')
  approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.approve(id, actor, this.context(request));
  }

  @Roles(Role.OPERATOR)
  @RequirePermission('canReports')
  @Post(':id/cancellation')
  requestCancellation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RequestOperationCancellationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.cancellations.request(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/cancellation/reschedule')
  rescheduleCancellation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RescheduleCanceledOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.cancellations.reschedule(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/cancellation/approve')
  approveCancellation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ApproveOperationCancellationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.cancellations.approve(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.update(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/cancel')
  cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.cancel(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/reactivate')
  reactivate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.operations.reactivate(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.operations.remove(id, actor, this.context(request));
  }

  private context(request: RequestWithId): OperationAuditContext {
    return {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
