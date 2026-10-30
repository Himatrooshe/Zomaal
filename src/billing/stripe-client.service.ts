import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Disabled by default. Sandbox billing is confined to its dedicated database. */
@Injectable()
export class StripeClientService {
  private client?: Stripe;
  constructor(private readonly config: ConfigService) {}

  get(): Stripe {
    const key = this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const database = new URL(
      this.config.get<string>('DATABASE_URL') ??
        'postgresql://invalid/disabled',
    );
    if (
      this.config.get<string>('STRIPE_BILLING_ENABLED') !== 'true' ||
      this.config.get<string>('STRIPE_BILLING_ENVIRONMENT') !== 'staging' ||
      database.pathname !== '/zomaal_stripe_staging' ||
      !/^(sk|rk)_test_/.test(key)
    ) {
      throw new ServiceUnavailableException(
        'Stripe sandbox billing is not enabled for this environment',
      );
    }
    return (this.client ??= new Stripe(key, {
      timeout: 15000,
      maxNetworkRetries: 2,
    }));
  }

  webhookSecret(): string {
    this.get();
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret?.startsWith('whsec_'))
      throw new ServiceUnavailableException('Stripe webhook is not configured');
    return secret;
  }

  priceId(code: string, interval: string): string {
    if (!['STARTER', 'PRO'].includes(code) || interval !== 'MONTHLY') {
      throw new ServiceUnavailableException(
        'This plan or interval is not available through Stripe',
      );
    }
    const id = this.config.get<string>(`STRIPE_${code}_MONTHLY_PRICE_ID`);
    if (!id?.startsWith('price_'))
      throw new ServiceUnavailableException('Stripe price is not configured');
    return id;
  }

  completionUrl(outcome: 'success' | 'cancel'): string {
    const base = this.config.get<string>('STRIPE_PUBLIC_BASE_URL');
    if (!base || !/^https:\/\//.test(base))
      throw new ServiceUnavailableException(
        'Stripe completion URL is not configured',
      );
    return `${base.replace(/\/$/, '')}/billing/stripe/return?outcome=${outcome}`;
  }
}
