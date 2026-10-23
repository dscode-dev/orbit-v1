import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RequirePermission } from '../../shared/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  AssignmentNotesDto,
  AuthorizeDemandsDto,
  CreateAssignmentDto,
  ListAssignmentsQueryDto,
  ReassignAssignmentDto,
  RejectAssignmentDto,
} from './dto/assignment.dto';
import { AssignmentsService, type AssignmentAuditContext } from './assignments.service';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get()
  list(
    @Query() query: ListAssignmentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.assignments.list(query, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Get('my')
  my(
    @Query() query: ListAssignmentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.assignments.my(query, actor);
  }

  @Roles(Role.OWNER)
  @Get('agenda')
  agenda(
    @Query() query: ListAssignmentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.assignments.agenda(query, actor);
  }

  // Demandas aguardando o owner autorizar a exibição no app do operador.
  @Roles(Role.OWNER, Role.MANAGER)
  @Get('pending-authorization')
  pendingAuthorization(): Promise<unknown> {
    return this.assignments.pendingAuthorization();
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post('authorize')
  authorize(
    @Body() body: AuthorizeDemandsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ authorized: number }> {
    return this.assignments.authorize(body, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('history/:operationId')
  history(
    @Param('operationId', new ParseUUIDPipe({ version: '4' })) operationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.assignments.history(operationId, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.assignments.get(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post()
  create(
    @Body() body: CreateAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.assignments.create(body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/reassign')
  reassign(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ReassignAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.assignments.reassign(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Patch(':id/accept')
  accept(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.assignments.accept(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Patch(':id/reject')
  reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RejectAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.assignments.reject(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Patch(':id/start')
  start(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.assignments.start(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Patch(':id/complete')
  complete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: AssignmentNotesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.assignments.complete(id, body, actor, this.context(request));
  }

  private context(request: RequestWithId): AssignmentAuditContext {
    return {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
