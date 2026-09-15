import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SuperAdminAuthController } from './super-admin-auth.controller';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminViewsController } from './super-admin-views.controller';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminJwtStrategy } from './strategies/super-admin-jwt.strategy';
import { SuperAdminBootstrapService } from './super-admin-bootstrap.service';
import { ShopController, ShopMediaController } from './shop/shop.controller';
import { ShopService } from './shop/shop.service';
import { ShopImageStorageService } from './shop/shop-image-storage.service';
import { MerchantsController } from './merchants/merchants.controller';
import { MerchantsService } from './merchants/merchants.service';
import { ActivityLogController } from './activity/activity-log.controller';
import { ActivityLogService } from './activity/activity-log.service';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { ZomaalShopModule } from '../zomaal-shop/zomaal-shop.module';
import { ShopBannersService } from './shop/shop-banners.service';
import { ShopPromoCodesService } from './shop/shop-promo-codes.service';
import { ShopOrdersAdminService } from './shop/shop-orders-admin.service';
import { ShopStorefrontAdminController } from './shop/shop-storefront-admin.controller';

@Module({
  imports: [
    PassportModule,
    ZomaalShopModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('SUPER_ADMIN_JWT_SECRET') ||
          configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [
    SuperAdminAuthController,
    SuperAdminController,
    SuperAdminViewsController,
    ShopController,
    ShopMediaController,
    MerchantsController,
    ActivityLogController,
    PlatformController,
    ShopStorefrontAdminController,
  ],
  providers: [
    SuperAdminAuthService,
    SuperAdminJwtStrategy,
    SuperAdminBootstrapService,
    ActivityLogService,
    ShopService,
    ShopImageStorageService,
    MerchantsService,
    PlatformService,
    ShopBannersService,
    ShopPromoCodesService,
    ShopOrdersAdminService,
  ],
})
export class SuperAdminModule {}
