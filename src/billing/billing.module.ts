import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BillingController } from './billing.controller';
import { SubscriptionService } from './subscription.service';
import { PlansService } from './plans.service';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import {
  StripeBillingController,
  StripeWebhookController,
} from './stripe-billing.controller';
import { StripeBillingService } from './stripe-billing.service';
import { StripeClientService } from './stripe-client.service';

@Module({
  controllers: [
    BillingController,
    StripeBillingController,
    StripeWebhookController,
  ],
  providers: [
    SubscriptionService,
    PlansService,
    StripeClientService,
    StripeBillingService,
    { provide: APP_INTERCEPTOR, useClass: SubscriptionAccessInterceptor },
  ],
  // StoresModule (trial + store limit) and SuperAdminModule (manual
  // activation, plans). Depends only on Prisma/Access/Config — no cycles.
  exports: [SubscriptionService, PlansService],
})
export class BillingModule {}
