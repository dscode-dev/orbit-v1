import { Module } from '@nestjs/common';
import { FinancialModule } from '../financial/financial.module';
import { ReceiptService } from './receipt.service';
import { StorageModule } from '../../infra/storage/storage.module';
import { AssetLifecycleModule } from '../asset-lifecycle/asset-lifecycle.module';
import { OperationAccessModule } from '../operation-access/operation-access.module';
import { DocumentAssetResolver } from './assets/document-asset-resolver.service';
import { DocumentBuilderService } from './builder/document-builder.service';
import { DocumentConfigurationController } from './configuration/document-configuration.controller';
import { DocumentConfigurationService } from './configuration/document-configuration.service';
import { DocumentContextService } from './context/document-context.service';
import { LayoutEngine } from './layout/layout-engine.service';
import { DocumentMeasureService } from './measurement/document-measure.service';
import { DefaultSignaturePolicyResolver } from './signatures/default-signature-policy.resolver';
import { DocumentEngineController } from './document-engine.controller';
import { DocumentEngineService } from './document-engine.service';
import { DocumentHandoffService } from './document-handoff.service';
import { PdfEngineService } from './pdf/pdf-engine.service';
import { DocumentRendererService } from './renderer/document-renderer.service';

@Module({
  imports: [StorageModule, AssetLifecycleModule, OperationAccessModule, FinancialModule],
  controllers: [DocumentEngineController, DocumentConfigurationController],
  providers: [
    ReceiptService,
    DocumentEngineService,
    DocumentHandoffService,
    DocumentBuilderService,
    DocumentRendererService,
    PdfEngineService,
    DefaultSignaturePolicyResolver,
    DocumentAssetResolver,
    LayoutEngine,
    DocumentMeasureService,
    DocumentConfigurationService,
    DocumentContextService,
  ],
  exports: [
    DocumentEngineService,
    PdfEngineService,
    DocumentAssetResolver,
    LayoutEngine,
    DocumentMeasureService,
    DocumentConfigurationService,
    DocumentContextService,
  ],
})
export class DocumentEngineModule {}
