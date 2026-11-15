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
import { MAX_EQUIPMENT_ATTACHMENT_SIZE_BYTES } from '../../shared/constants/equipments.constants';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  CreateEquipmentDto,
  CreateEquipmentMetricDto,
  ListEquipmentsQueryDto,
  UpdateEquipmentDto,
  UploadEquipmentAttachmentDto,
} from './dto/equipment.dto';
import { EquipmentsService, type EquipmentAuditContext } from './equipments.service';
import type { UploadedEquipmentFile } from './types/uploaded-equipment-file.type';

@Controller('equipments')
export class EquipmentsController {
  constructor(private readonly equipments: EquipmentsService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get()
  list(@Query() query: ListEquipmentsQueryDto, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.equipments.list(query, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('stats')
  stats(): Promise<Record<string, unknown>> {
    return this.equipments.stats();
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post()
  create(
    @Body() body: CreateEquipmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.create(body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/disable')
  disable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.disable(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id/enable')
  enable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.enable(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Post(':id/metrics')
  createMetric(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateEquipmentMetricDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.createMetric(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get(':id/metrics')
  metrics(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.equipments.listMetrics(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id/metrics/:metricId')
  deleteMetric(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('metricId', new ParseUUIDPipe({ version: '4' })) metricId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.equipments.deleteMetric(id, metricId, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_EQUIPMENT_ATTACHMENT_SIZE_BYTES, files: 1 },
    }),
  )
  uploadAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UploadEquipmentAttachmentDto,
    @UploadedFile() file: UploadedEquipmentFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.uploadAttachment(id, body.category, file, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('attachments/:attachmentId')
  getAttachment(
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    return this.equipments.getAttachment(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Delete('attachments/:attachmentId')
  deleteAttachment(
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.equipments.deleteAttachment(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('lookup/:qrCode')
  lookup(@Param('qrCode') qrCode: string, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.equipments.lookupByQrCode(decodeURIComponent(qrCode), actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.equipments.get(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateEquipmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.update(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.equipments.remove(id, actor, this.context(request));
  }

  private context(request: RequestWithId): EquipmentAuditContext {
    return {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
