import { Controller, Get, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { RawResponse } from '../../shared/decorators/raw-response.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import {
  DocumentsPdfExportQueryDto,
  EquipmentsPdfExportQueryDto,
  OperationsPdfExportQueryDto,
} from './dto/list-export.dto';
import { ListExportService, type PdfExportResult } from './list-export.service';

@Controller()
export class ListExportController {
  constructor(private readonly exports: ListExportService) {}

  /*
   * Exportação é relatório gerencial: sai da plataforma, que só owner e gestor
   * acessam (o app do operador não exporta nada). Manter OPERATOR/VIEWER aqui
   * entregava a carteira inteira num PDF — o de equipamentos nem escopo tinha.
   * O escopo por atribuição continua no serviço, como defesa em profundidade.
   */

  @RawResponse()
  @Roles(Role.OWNER, Role.MANAGER)
  @Get('operations/export')
  async operations(
    @Query() query: OperationsPdfExportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    this.send(response, await this.exports.operations(query, actor));
  }

  @RawResponse()
  @Roles(Role.OWNER, Role.MANAGER)
  @Get('equipments/export')
  async equipments(
    @Query() query: EquipmentsPdfExportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    this.send(response, await this.exports.equipments(query, actor));
  }

  @RawResponse()
  @Roles(Role.OWNER, Role.MANAGER)
  @Get('documents/export')
  async documents(
    @Query() query: DocumentsPdfExportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    this.send(response, await this.exports.documents(query, actor));
  }

  private send(response: Response, result: PdfExportResult): void {
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.setHeader('Content-Length', String(result.buffer.length));
    response.setHeader('X-Export-Record-Count', String(result.recordCount));
    response.setHeader('X-Export-Page-Count', String(result.pageCount));
    response.end(result.buffer);
  }
}
