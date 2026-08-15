import { Module } from '@nestjs/common';
import { ForceLogController } from './forcelog.controller';
import { ForceLogClient } from './forcelog.client';
import { ForceLogConnectionService } from './forcelog-connection.service';
import { ForceLogShipmentService } from './forcelog-shipment.service';
import { ForceLogOverviewService } from './forcelog-overview.service';
import { OzoneExpressController } from './ozoneexpress.controller';
import { OzoneExpressClient } from './ozoneexpress.client';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import { OzoneExpressShipmentService } from './ozoneexpress-shipment.service';
import { OzoneExpressOverviewService } from './ozoneexpress-overview.service';
import { QuickLivraisonController } from './quicklivraison.controller';
import { QuickLivraisonWebhookController } from './quicklivraison-webhook.controller';
import { QuickLivraisonClient } from './quicklivraison.client';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { QuickLivraisonShipmentService } from './quicklivraison-shipment.service';
import { QuickLivraisonSyncService } from './quicklivraison-sync.service';
import { QuickLivraisonOverviewService } from './quicklivraison-overview.service';
import { QuickLivraisonSchedulerController } from './quicklivraison-scheduler.controller';
import { QuickLivraisonSchedulerGuard } from './quicklivraison-scheduler.guard';
import { SenditWebhookController } from './sendit-webhook.controller';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShippingIntegrationsController } from './shipping-integrations.controller';
import { ShippingIntegrationsService } from './shipping-integrations.service';
import { ShippingDashboardController } from './shipping-dashboard.controller';
import { ShippingDashboardService } from './shipping-dashboard.service';
import { SenditClient } from './sendit.client';
import { SenditConnectionService } from './sendit-connection.service';
import { SenditShipmentService } from './sendit-shipment.service';
import { SenditSyncService } from './sendit-sync.service';
import { SenditOverviewService } from './sendit-overview.service';
import { AmeexController } from './ameex.controller';
import { AmeexWebhookController } from './ameex-webhook.controller';
import { AmeexClient } from './ameex.client';
import { AmeexConnectionService } from './ameex-connection.service';
import { AmeexShipmentService } from './ameex-shipment.service';
import { AmeexOverviewService } from './ameex-overview.service';
import { ShippingProviderController } from './shipping-provider.controller';
import { ShippingProviderService } from './shipping-provider.service';

@Module({
  controllers: [
    ShippingController,
    SenditWebhookController,
    QuickLivraisonController,
    QuickLivraisonWebhookController,
    QuickLivraisonSchedulerController,
    ForceLogController,
    OzoneExpressController,
    AmeexController,
    AmeexWebhookController,
    ShippingIntegrationsController,
    ShippingDashboardController,
    ShippingProviderController,
  ],
  providers: [
    ShippingService,
    SenditClient,
    SenditConnectionService,
    SenditShipmentService,
    SenditSyncService,
    SenditOverviewService,
    QuickLivraisonClient,
    QuickLivraisonConnectionService,
    QuickLivraisonShipmentService,
    QuickLivraisonSyncService,
    QuickLivraisonOverviewService,
    QuickLivraisonSchedulerGuard,
    ForceLogClient,
    ForceLogConnectionService,
    ForceLogShipmentService,
    ForceLogOverviewService,
    OzoneExpressClient,
    OzoneExpressConnectionService,
    OzoneExpressShipmentService,
    OzoneExpressOverviewService,
    AmeexClient,
    AmeexConnectionService,
    AmeexShipmentService,
    AmeexOverviewService,
    ShippingIntegrationsService,
    ShippingDashboardService,
    ShippingProviderService,
  ],
  exports: [
    ShippingService,
    SenditClient,
    QuickLivraisonClient,
    ForceLogClient,
    OzoneExpressClient,
    AmeexClient,
  ],
})
export class ShippingModule {}
