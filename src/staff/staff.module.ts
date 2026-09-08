import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffSalaryController } from './staff-salary.controller';
import { StaffSalaryService } from './staff-salary.service';
import { StaffSalarySchedulerController } from './staff-salary-scheduler.controller';
import { StaffSalarySchedulerGuard } from './staff-salary-scheduler.guard';

@Module({
  controllers: [StaffController, StaffSalaryController, StaffSalarySchedulerController],
  providers: [StaffService, StaffSalaryService, StaffSalarySchedulerGuard],
  exports: [StaffSalaryService],
})
export class StaffModule {}
