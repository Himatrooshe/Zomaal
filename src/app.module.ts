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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
