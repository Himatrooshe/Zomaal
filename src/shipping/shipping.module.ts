import { Module } from '@nestjs/common';
import { ForceLogController } from './forcelog.controller';
import { ForceLogClient } from './forcelog.client';
import { OzoneExpressController } from './ozoneexpress.controller';
import { OzoneExpressClient } from './ozoneexpress.client';
import { QuickLivraisonController } from './quicklivraison.controller';
import { QuickLivraisonWebhookController } from './quicklivraison-webhook.controller';
import { QuickLivraisonClient } from './quicklivraison.client';
import { SenditWebhookController } from './sendit-webhook.controller';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { SenditClient } from './sendit.client';

@Module({
  controllers: [
    ShippingController,
    SenditWebhookController,
    QuickLivraisonController,
    QuickLivraisonWebhookController,
    ForceLogController,
    OzoneExpressController,
  ],
  providers: [
    ShippingService,
    SenditClient,
    QuickLivraisonClient,
    ForceLogClient,
    OzoneExpressClient,
  ],
  exports: [
    ShippingService,
    SenditClient,
    QuickLivraisonClient,
    ForceLogClient,
    OzoneExpressClient,
  ],
})
export class ShippingModule {}
