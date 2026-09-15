import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { PurchasesController } from './purchases.controller';
import { StorefrontService } from './storefront.service';
import { CartService } from './cart.service';
import { AddressService } from './address.service';
import { CheckoutService } from './checkout.service';
import { ShopOrdersService } from './shop-orders.service';
import { ShopSettingsService } from './shop-settings.service';
import { PurchasesService } from './purchases.service';

/**
 * Merchant side of the Zomaal Shop plus the Purchases module. The admin
 * panel (SuperAdminModule) imports this for order fulfilment and settings,
 * so order lifecycle rules (restock, auto-purchases) live in one place.
 */
@Module({
  controllers: [ShopController, PurchasesController],
  providers: [
    StorefrontService,
    CartService,
    AddressService,
    CheckoutService,
    ShopOrdersService,
    ShopSettingsService,
    PurchasesService,
  ],
  exports: [ShopOrdersService, ShopSettingsService],
})
export class ZomaalShopModule {}
