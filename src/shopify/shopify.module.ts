import { Module } from '@nestjs/common';
import {
  ShopifyController,
  ShopifyOAuthController,
} from './shopify.controller';
import { ShopifyApiService } from './shopify-api.service';
import { ShopifyAuthService } from './shopify-auth.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyDataController } from './shopify-data.controller';
import { ShopifyDataService } from './shopify-data.service';
import { ShopifyTokenEncryptionService } from './shopify-token-encryption.service';
import { ShopifyWebhookController } from './shopify-webhook.controller';
import { ShopifyWebhookService } from './shopify-webhook.service';

@Module({
  controllers: [
    ShopifyController,
    ShopifyDataController,
    ShopifyOAuthController,
    ShopifyWebhookController,
  ],
  providers: [
    ShopifyApiService,
    ShopifyAuthService,
    ShopifyConnectionService,
    ShopifyDataService,
    ShopifyTokenEncryptionService,
    ShopifyWebhookService,
  ],
  exports: [ShopifyConnectionService],
})
export class ShopifyModule {}
