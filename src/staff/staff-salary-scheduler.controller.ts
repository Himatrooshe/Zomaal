import { Controller, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StaffSalarySchedulerGuard } from './staff-salary-scheduler.guard';
import { StaffSalaryService } from './staff-salary.service';

@ApiExcludeController()
@UseGuards(StaffSalarySchedulerGuard)
@Controller('internal/staff-salary')
export class StaffSalarySchedulerController {
  constructor(private readonly salary: StaffSalaryService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  run(): Promise<{ processed: number; skippedInactive: number }> {
    return this.salary.runAutomaticPayments();
  }
}
