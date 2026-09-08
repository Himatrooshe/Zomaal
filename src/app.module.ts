import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AccessModule } from './access/access.module';
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
import { AdsModule } from './ads/ads.module';
import { RolesModule } from './roles/roles.module';
import { StaffModule } from './staff/staff.module';
import { ExpensesModule } from './expenses/expenses.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    AccessModule,
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
    AdsModule,
    RolesModule,
    StaffModule,
    ExpensesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
