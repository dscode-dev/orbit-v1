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
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  CreateServiceTypeDto,
  ListServiceTypesQueryDto,
  ReorderServiceTypesDto,
  UpdateServiceTypeDto,
} from './dto/service-type.dto';
import { serviceTypeContextFromRequest, ServiceTypesService } from './service-types.service';

@Controller('service-types')
export class ServiceTypesController {
  constructor(private readonly serviceTypes: ServiceTypesService) {}

  // Leitura liberada a qualquer autenticado — o select do wizard (plataforma e
  // mobile) consome esta lista.
  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get()
  list(@Query() query: ListServiceTypesQueryDto): Promise<unknown> {
    return this.serviceTypes.list(query);
  }

  @Roles(Role.OWNER)
  @Post()
  create(
    @Body() body: CreateServiceTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.serviceTypes.create(body, actor, serviceTypeContextFromRequest(request));
  }

  @Roles(Role.OWNER)
  @Patch('reorder')
  reorder(
    @Body() body: ReorderServiceTypesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ reordered: number }> {
    return this.serviceTypes.reorder(body, actor, serviceTypeContextFromRequest(request));
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateServiceTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.serviceTypes.update(id, body, actor, serviceTypeContextFromRequest(request));
  }

  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.serviceTypes.remove(id, actor, serviceTypeContextFromRequest(request));
  }
}
