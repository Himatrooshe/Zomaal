import { Module } from '@nestjs/common';
import { ForceLogController } from './forcelog.controller';
import { ForceLogClient } from './forcelog.client';
import { ForceLogConnectionService } from './forcelog-connection.service';
import { OzoneExpressController } from './ozoneexpress.controller';
import { OzoneExpressClient } from './ozoneexpress.client';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import { QuickLivraisonController } from './quicklivraison.controller';
import { QuickLivraisonWebhookController } from './quicklivraison-webhook.controller';
import { QuickLivraisonClient } from './quicklivraison.client';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { SenditWebhookController } from './sendit-webhook.controller';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { SenditClient } from './sendit.client';
import { SenditConnectionService } from './sendit-connection.service';

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
    SenditConnectionService,
    QuickLivraisonClient,
    QuickLivraisonConnectionService,
    ForceLogClient,
    ForceLogConnectionService,
    OzoneExpressClient,
    OzoneExpressConnectionService,
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
