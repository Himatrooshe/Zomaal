import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NotificationsSchedulerGuard } from './notifications-scheduler.guard';
import {
  NotificationEvaluatorService,
  type EvaluationSummary,
} from './notification-evaluator.service';

@ApiExcludeController()
@UseGuards(NotificationsSchedulerGuard)
@Controller('internal/notifications')
export class NotificationsSchedulerController {
  constructor(private readonly evaluator: NotificationEvaluatorService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  run(): Promise<EvaluationSummary> {
    return this.evaluator.runAll();
  }
}
