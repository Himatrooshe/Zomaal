import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { YouCanModule } from '../youcan/youcan.module';
import { LightfunnelsModule } from '../lightfunnels/lightfunnels.module';
import { CurrencyModule } from '../currency/currency.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceSyncService } from './ecommerce-sync.service';
import { EcommerceService } from './ecommerce.service';
import { LightfunnelsRevenueAdapter } from './lightfunnels-revenue.adapter';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';
import { YouCanRevenueAdapter } from './youcan-revenue.adapter';
import { ShopifyFulfillmentAdapter } from './shopify-fulfillment.adapter';
import { YouCanFulfillmentAdapter } from './youcan-fulfillment.adapter';
import { LightfunnelsFulfillmentAdapter } from './lightfunnels-fulfillment.adapter';
import { EcommerceSchedulerController } from './ecommerce-scheduler.controller';
import { EcommerceSchedulerGuard } from './ecommerce-scheduler.guard';
import { ShippingModule } from '../shipping/shipping.module';
import { EcommerceMetricsService } from './ecommerce-metrics.service';

@Module({
  imports: [
    ShopifyModule,
    YouCanModule,
    LightfunnelsModule,
    CurrencyModule,
    ShippingModule,
  ],
  controllers: [EcommerceController, EcommerceSchedulerController],
  providers: [
    EcommerceService,
    EcommerceSyncService,
    EcommerceMetricsService,
    EcommerceSchedulerGuard,
    LightfunnelsRevenueAdapter,
    ShopifyRevenueAdapter,
    YouCanRevenueAdapter,
    ShopifyFulfillmentAdapter,
    YouCanFulfillmentAdapter,
    LightfunnelsFulfillmentAdapter,
  ],
})
export class EcommerceModule {}
