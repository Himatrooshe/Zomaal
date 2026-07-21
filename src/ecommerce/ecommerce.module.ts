import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceSyncService } from './ecommerce-sync.service';
import { EcommerceService } from './ecommerce.service';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';

@Module({
  imports: [ShopifyModule],
  controllers: [EcommerceController],
  providers: [EcommerceService, EcommerceSyncService, ShopifyRevenueAdapter],
})
export class EcommerceModule {}
