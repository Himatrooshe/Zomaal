import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { YouCanModule } from '../youcan/youcan.module';
import { LightfunnelsModule } from '../lightfunnels/lightfunnels.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceSyncService } from './ecommerce-sync.service';
import { EcommerceService } from './ecommerce.service';
import { LightfunnelsRevenueAdapter } from './lightfunnels-revenue.adapter';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';
import { YouCanRevenueAdapter } from './youcan-revenue.adapter';

@Module({
  imports: [ShopifyModule, YouCanModule, LightfunnelsModule],
  controllers: [EcommerceController],
  providers: [
    EcommerceService,
    EcommerceSyncService,
    LightfunnelsRevenueAdapter,
    ShopifyRevenueAdapter,
    YouCanRevenueAdapter,
  ],
})
export class EcommerceModule {}
