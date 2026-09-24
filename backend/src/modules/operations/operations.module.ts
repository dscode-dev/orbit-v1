import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module';
import { AssetLifecycleModule } from '../asset-lifecycle/asset-lifecycle.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { FinancialModule } from '../financial/financial.module';
import { MaintenancePlanningModule } from '../maintenance-planning/maintenance-planning.module';
import { MaintenanceRemindersModule } from '../maintenance-reminders/maintenance-reminders.module';
import { OperationAccessModule } from '../operation-access/operation-access.module';
import { ServiceTypesModule } from '../service-types/service-types.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperatorExecutionsController } from './operator-executions.controller';
import { OperatorExecutionsService } from './operator-executions.service';
import { CommissionsService } from './commissions.service';
import { OperationCancellationsService } from './operation-cancellations.service';

@Module({
  imports: [StorageModule, AssetLifecycleModule, MaintenancePlanningModule, MaintenanceRemindersModule, AssignmentsModule, OperationAccessModule, FinancialModule, ServiceTypesModule],
  controllers: [OperationsController, OperatorExecutionsController],
  providers: [OperationsService, OperatorExecutionsService, OperationCancellationsService, CommissionsService],
  exports: [OperationsService],
})
export class OperationsModule {}
