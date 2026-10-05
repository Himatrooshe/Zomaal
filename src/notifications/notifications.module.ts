import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsSchedulerController } from './notifications-scheduler.controller';
import { NotificationsSchedulerGuard } from './notifications-scheduler.guard';
import { NotificationsService } from './notifications.service';
import { NotificationEvaluatorService } from './notification-evaluator.service';
import { PushService } from './push.service';

@Module({
  imports: [CurrencyModule],
  controllers: [NotificationsController, NotificationsSchedulerController],
  providers: [
    NotificationsService,
    NotificationEvaluatorService,
    PushService,
    NotificationsSchedulerGuard,
  ],
  // Exported so event-driven producers (e.g. CustomersModule's blacklist
  // warning) can raise alerts directly. Depends only on Prisma/Currency, so
  // importing it never creates a module cycle.
  exports: [NotificationsService],
})
export class NotificationsModule {}
