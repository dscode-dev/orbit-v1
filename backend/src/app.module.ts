import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from './infra/logger/logger.module';
import { RequestIdMiddleware } from './infra/security/request-id.middleware';
import { AppConfigModule } from './modules/config/app-config.module';
import { AppConfigService } from './modules/config/app-config.service';
import { DatabaseModule } from './modules/database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RoleGuard } from './modules/auth/guards/role.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { PasswordChangeRequiredGuard } from './modules/auth/guards/password-change-required.guard';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { EquipmentsModule } from './modules/equipments/equipments.module';
import { OperationsModule } from './modules/operations/operations.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { DocumentEngineModule } from './modules/document-engine/document-engine.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { AssetLifecycleModule } from './modules/asset-lifecycle/asset-lifecycle.module';
import { MaintenancePlanningModule } from './modules/maintenance-planning/maintenance-planning.module';
import { MaintenanceRemindersModule } from './modules/maintenance-reminders/maintenance-reminders.module';
import { MaintenanceChecklistTemplatesModule } from './modules/maintenance-checklist-templates/maintenance-checklist-templates.module';
import { TechnicalCatalogsModule } from './modules/technical-catalogs/technical-catalogs.module';
import { PmocComplianceModule } from './modules/pmoc-compliance/pmoc-compliance.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { FinancialModule } from './modules/financial/financial.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { ListExportModule } from './modules/list-exports/list-export.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SalesModule } from './modules/sales/sales.module';
import { RvtPlanningModule } from './modules/rvt-planning/rvt-planning.module';
import { CustomerPortalModule } from './modules/customer-portal/customer-portal.module';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { RequestLoggingInterceptor } from './shared/interceptors/request-logging.interceptor';
import { ResponseEnvelopeInterceptor } from './shared/interceptors/response-envelope.interceptor';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        {
          ttl: config.rateLimitTtlMs,
          limit: config.rateLimitMax,
        },
      ],
    }),
    LoggerModule,
    DatabaseModule,
    AuthModule,
    OrganizationModule,
    UsersModule,
    CustomersModule,
    ListExportModule,
    EquipmentsModule,
    OperationsModule,
    AssignmentsModule,
    DocumentEngineModule,
    SignaturesModule,
    AssetLifecycleModule,
    MaintenancePlanningModule,
    MaintenanceRemindersModule,
    MaintenanceChecklistTemplatesModule,
    TechnicalCatalogsModule,
    PmocComplianceModule,
    InventoryModule,
    PricingModule,
    BudgetsModule,
    FinancialModule,
    ProcurementModule,
    NotificationsModule,
    SalesModule,
    RvtPlanningModule,
    CustomerPortalModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PasswordChangeRequiredGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
