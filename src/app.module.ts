import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StoresModule } from './stores/stores.module';
import { ShippingModule } from './shipping/shipping.module';
import { validateEnvironment } from './config/env.validation';
import { ShopifyModule } from './shopify/shopify.module';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { YouCanModule } from './youcan/youcan.module';
import { LightfunnelsModule } from './lightfunnels/lightfunnels.module';
import { CurrencyModule } from './currency/currency.module';
import { WarehouseModule } from './warehouse/warehouse.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    StoresModule,
    ShippingModule,
    ShopifyModule,
    EcommerceModule,
    YouCanModule,
    LightfunnelsModule,
    CurrencyModule,
    WarehouseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
