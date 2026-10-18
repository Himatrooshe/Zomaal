import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MetaWhatsAppApiService } from './meta-whatsapp-api.service';
import { WhatsAppBalanceService } from './whatsapp-balance.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppDispatchService } from './whatsapp-dispatch.service';
import { WhatsAppInsightsService } from './whatsapp-insights.service';
import { WhatsAppMockInterceptor } from './mock/whatsapp-mock.interceptor';
import { WhatsAppMockService } from './mock/whatsapp-mock.service';
import { WhatsAppSchedulerController } from './whatsapp-scheduler.controller';
import { WhatsAppSchedulerGuard } from './whatsapp-scheduler.guard';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { WhatsAppTokenEncryptionService } from './whatsapp-token-encryption.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [NotificationsModule],
  controllers: [
    WhatsAppController,
    WhatsAppWebhookController,
    WhatsAppSchedulerController,
  ],
  providers: [
    MetaWhatsAppApiService,
    WhatsAppTokenEncryptionService,
    WhatsAppBalanceService,
    WhatsAppConnectionService,
    WhatsAppSettingsService,
    WhatsAppInsightsService,
    WhatsAppDispatchService,
    WhatsAppWebhookService,
    WhatsAppSchedulerGuard,
    // TEMPORARY frontend preview data (WHATSAPP_MOCK_DATA) — remove with src/whatsapp/mock/.
    WhatsAppMockService,
    WhatsAppMockInterceptor,
  ],
  exports: [WhatsAppBalanceService],
})
export class WhatsAppModule {}
