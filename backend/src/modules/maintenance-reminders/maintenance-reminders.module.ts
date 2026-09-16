import { Module } from '@nestjs/common';
import { MaintenanceRemindersController } from './maintenance-reminders.controller';
import { MaintenanceRemindersService } from './maintenance-reminders.service';
import { ServiceTypesModule } from '../service-types/service-types.module';

@Module({
  imports: [ServiceTypesModule],
  controllers: [MaintenanceRemindersController],
  providers: [MaintenanceRemindersService],
  exports: [MaintenanceRemindersService],
})
export class MaintenanceRemindersModule {}
