import { Controller, Get, HttpStatus, Param, ParseEnumPipe, ParseUUIDPipe } from '@nestjs/common';
import { DocumentTemplateType, Role } from '@prisma/client';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type { AuthenticatedUser } from '../../../shared/types/authenticated-user.type';
import { DocumentConfigurationService } from './document-configuration.service';

@Controller('documents/configuration')
export class DocumentConfigurationController {
  constructor(private readonly configuration: DocumentConfigurationService) {}

  @Roles(Role.OWNER, Role.MANAGER, Role.VIEWER)
  @Get()
  list(): Promise<unknown[]> {
    return this.configuration.listPublicConfigurations();
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('types/:type')
  getByType(
    @Param('type', new ParseEnumPipe(DocumentTemplateType)) type: DocumentTemplateType,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<unknown> {
    if (actor.role === Role.OPERATOR && type !== DocumentTemplateType.PMOC) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'O operador só pode consultar a política de assinatura do PMOC',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.configuration.getPublicConfigurationForType(type);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.VIEWER)
  @Get('templates/:templateId')
  getByTemplate(
    @Param('templateId', new ParseUUIDPipe({ version: '4' })) templateId: string,
  ): Promise<unknown> {
    return this.configuration.getPublicConfigurationByTemplate(templateId);
  }
}
