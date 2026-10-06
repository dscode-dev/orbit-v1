import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { RawResponse } from '../../shared/decorators/raw-response.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RequirePermission } from '../../shared/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import { DocumentEngineService, contextFromRequest } from './document-engine.service';
import { DocumentHandoffService } from './document-handoff.service';
import { ReceiptService } from './receipt.service';
import { ReceiptRevisionDto, UpdateReceiptDto } from './dto/receipt.dto';
import {
  CollectCustomerSignatureDto,
  FinalizeDocumentReviewDto,
  SetCustomerSignatureVisibilityDto,
  ListDocumentHandoffsQueryDto,
  SaveDocumentHandoffDto,
  SelectTechnicalSignatureDto,
} from './dto/document-handoff.dto';
import {
  DocumentIdParamsDto,
  ListDocumentsQueryDto,
  OperationDocumentParamsDto,
  TemplatePreviewParamsDto,
} from './dto/document-engine.dto';

@Controller('documents')
export class DocumentEngineController {
  constructor(
    private readonly documents: DocumentEngineService,
    private readonly handoffs: DocumentHandoffService,
    private readonly receipts: ReceiptService,
  ) {}

  @Roles(Role.OWNER, Role.MANAGER)
  @Get(':documentId/receipt')
  getReceipt(@Param('documentId', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.receipts.get(id, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':documentId/receipt')
  updateReceipt(@Param('documentId', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateReceiptDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.receipts.update(id, body, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':documentId/receipt/cancel')
  cancelReceipt(@Param('documentId', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: ReceiptRevisionDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.receipts.cancel(id, body, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Get('handoffs')
  listHandoffs(@Query() query: ListDocumentHandoffsQueryDto): Promise<unknown> {
    return this.handoffs.list(query);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Post('handoffs')
  saveHandoffDraft(@Body() body: SaveDocumentHandoffDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.saveDraft(body, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get()
  listDocuments(@Query() query: ListDocumentsQueryDto, @CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.documents.listDocuments(query, actor);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('operations/:operationId/:type/preview')
  previewOperation(
    @Param() params: OperationDocumentParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.documents.previewOperation(
      params.operationId,
      params.type,
      actor,
      contextFromRequest(request),
    );
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Post('operations/:operationId/:type/render')
  renderOperation(
    @Param() params: OperationDocumentParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.documents.renderOperation(
      params.operationId,
      params.type,
      actor,
      contextFromRequest(request),
    );
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('templates/:templateId/preview')
  previewTemplate(
    @Param() params: TemplatePreviewParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.documents.previewTemplate(params.templateId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get(':documentId/preview')
  previewDocument(
    @Param() params: DocumentIdParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.documents.previewDocument(params.documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Post(':documentId/render')
  renderDocument(
    @Param() params: DocumentIdParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ): Promise<unknown> {
    return this.documents.renderDocument(params.documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Get(':documentId/handoff')
  getHandoff(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.get(documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Patch(':documentId/handoff/customer-signature')
  collectCustomerSignature(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @Body() body: CollectCustomerSignatureDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.collectCustomerSignature(documentId, body, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RawResponse()
  @Get(':documentId/handoff/customer-signature')
  async customerSignatureImage(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.handoffs.customerSignatureImage(documentId, actor, contextFromRequest(request));
    response.setHeader('Content-Type', image.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${image.filename}"`);
    response.setHeader('Content-Length', String(image.content.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(image.content);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Post(':documentId/handoff/submit')
  submitHandoff(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.submit(documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Post(':documentId/handoff/review')
  startReview(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.startReview(documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Patch(':documentId/handoff/technical-signature')
  selectTechnicalSignature(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @Body() body: SelectTechnicalSignatureDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.selectTechnicalSignature(documentId, body.signatureId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':documentId/handoff/customer-signature-visibility')
  setCustomerSignatureVisibility(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @Body() body: SetCustomerSignatureVisibilityDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.setCustomerSignatureVisibility(documentId, body.hidden, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @RequirePermission('canReports')
  @Post(':documentId/handoff/finalize')
  finalizeReview(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @Body() _body: FinalizeDocumentReviewDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.finalize(documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR)
  @Get(':documentId/handoff/history')
  handoffHistory(@Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string, @CurrentUser() actor: AuthenticatedUser, @Req() request: RequestWithId): Promise<unknown> {
    return this.handoffs.history(documentId, actor, contextFromRequest(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @RawResponse()
  @Get(':documentId/download')
  async downloadDocument(
    @Param() params: DocumentIdParamsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.documents.downloadDocument(
      params.documentId,
      actor,
      contextFromRequest(request),
    );
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Content-Length', String(file.content.length));
    response.end(file.content);
  }
}
