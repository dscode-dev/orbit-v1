import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { CreateRvtPlanDto, ListRvtExecutionsQueryDto, ListRvtPlansQueryDto, PrepareRvtExecutionDto, RegisterAdHocRvtDto, UpdateRvtPlanDto } from './dto/rvt-planning.dto';
import { RvtPlanningService } from './rvt-planning.service';

@Controller()
export class RvtPlanningController {
  constructor(private readonly rvt: RvtPlanningService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('rvt-plans')
  list(@Query() query: ListRvtPlansQueryDto): Promise<unknown> {
    return this.rvt.list(query);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post('rvt-plans')
  create(@Body() body: CreateRvtPlanDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.rvt.create(body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('rvt-plans/:id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.rvt.get(id);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch('rvt-plans/:id')
  update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateRvtPlanDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.rvt.update(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Delete('rvt-plans/:id')
  cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<{ deleted: true }> {
    return this.rvt.cancel(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('rvt-plans/:id/executions')
  executions(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query() query: ListRvtExecutionsQueryDto): Promise<unknown> {
    return this.rvt.listExecutions(id, query);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Get('rvt-executions/:id/prefill')
  prefill(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<Record<string, unknown>> {
    return this.rvt.executionPrefill(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Post('rvt-executions/:id/prepare')
  prepare(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: PrepareRvtExecutionDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.rvt.prepareExecution(id, body, actor, this.context(request));
  }

  // Última chamada do atendimento de RVT no app: barrar owner/gestor aqui
  // deixava o atendimento concluído mas terminava com erro de permissão.
  // Quem pode registrar continua sendo só o executor da operação — o serviço
  // filtra por `operatorId = actor.id`.
  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Post('rvt-plans/ad-hoc')
  registerAdHoc(@Body() body: RegisterAdHocRvtDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.rvt.registerAdHoc(body.operationId, actor, this.context(request));
  }

  private context(request: RequestWithId): { requestId: string; ip: string | null; userAgent: string | null } {
    return { requestId: request.requestId, ip: request.ip || null, userAgent: request.get('user-agent') ?? null };
  }
}
