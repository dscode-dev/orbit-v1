import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { OperationsModule } from '../operations/operations.module';
import { DocumentEngineModule } from '../document-engine/document-engine.module';
import {
  CustomerPortalAccountsController,
  CustomerPortalAuthController,
  CustomerPortalController,
  CustomerServiceTicketsController,
} from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalAuthGuard } from './guards/customer-portal-auth.guard';

@Module({
  imports: [AppConfigModule, AuthModule, JwtModule.register({}), OperationsModule, DocumentEngineModule],
  controllers: [
    CustomerPortalAuthController,
    CustomerPortalController,
    CustomerPortalAccountsController,
    CustomerServiceTicketsController,
  ],
  providers: [CustomerPortalService, CustomerPortalAuthGuard],
})
export class CustomerPortalModule {}
