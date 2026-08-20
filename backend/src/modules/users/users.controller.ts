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
import { MAX_AVATAR_SIZE_BYTES } from '../../shared/constants/users.constants';
import { MAX_SIGNATURE_IMAGE_SIZE_BYTES } from '../../shared/constants/signatures.constants';
import { AllowPasswordChangeRequired } from '../../shared/decorators/allow-password-change-required.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import {
  ChangePasswordDto,
  CompleteFirstAccessDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdatePreferencesDto,
  UpdateUserDto,
} from './dto/user.dto';
import type { UploadedAvatarFile } from './types/uploaded-avatar.type';
import type { UploadedSignatureFile } from '../signatures/types/uploaded-signature-file.type';
import { UsersService, type UserAuditContext } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.VIEWER)
  @Get()
  list(@Query() query: ListUsersQueryDto): Promise<unknown> {
    return this.users.list(query);
  }

  @Roles(Role.OWNER)
  @Post()
  create(
    @Body() body: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.create(body, actor, this.context(request));
  }

  @AllowPasswordChangeRequired()
  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER, Role.CUSTOMER)
  @Get('me')
  profile(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.users.profile(user.id);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('me/preferences')
  preferences(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.users.getPreferences(user.id);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Patch('me/preferences')
  updatePreferences(
    @Body() body: UpdatePreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.updatePreferences(user.id, body, this.context(request));
  }

  @AllowPasswordChangeRequired()
  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Patch('change-password')
  changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.changePassword(user.id, body, this.context(request));
  }

  @AllowPasswordChangeRequired()
  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Post('complete-first-access')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIGNATURE_IMAGE_SIZE_BYTES, files: 1 },
    }),
  )
  completeFirstAccess(
    @Body() body: CompleteFirstAccessDto,
    @UploadedFile() file: UploadedSignatureFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.completeFirstAccess(user.id, body, file, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_SIZE_BYTES, files: 1 },
    }),
  )
  uploadAvatar(
    @UploadedFile() file: UploadedAvatarFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.uploadAvatar(user.id, file, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('avatar/:id')
  getAvatar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.users.getAvatar(id);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @HttpCode(HttpStatus.OK)
  @Delete('avatar')
  deleteAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.deleteAvatar(user.id, this.context(request));
  }

  @Roles(Role.OWNER)
  @Patch(':id/disable')
  disable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.disable(id, actor, this.context(request));
  }

  @Roles(Role.OWNER)
  @Patch(':id/enable')
  enable(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.enable(id, actor, this.context(request));
  }

  @Roles(Role.OWNER)
  @Patch(':id/reset-password')
  resetPassword(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.resetPassword(id, actor, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.VIEWER)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<unknown> {
    return this.users.get(id);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.update(id, body, actor, this.context(request));
  }

  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.users.remove(id, actor, this.context(request));
  }

  private context(request: RequestWithId): UserAuditContext {
    return {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
