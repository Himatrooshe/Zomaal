import { ConfigService } from '@nestjs/config';
import { StripeClientService } from './stripe-client.service';

describe('Stripe sandbox isolation', () => {
  const valid = {
    STRIPE_BILLING_ENABLED: 'true',
    STRIPE_BILLING_ENVIRONMENT: 'staging',
    DATABASE_URL: 'postgresql://local/zomaal_stripe_staging',
    STRIPE_SECRET_KEY: 'sk_test_example',
  };
  function client(overrides: Record<string, string> = {}) {
    return new StripeClientService(
      new ConfigService({ ...valid, ...overrides }),
    );
  }
  it('accepts the dedicated sandbox configuration', () => {
    expect(client().get()).toBeDefined();
  });
  it.each([
    { STRIPE_SECRET_KEY: 'sk_live_example' },
    { DATABASE_URL: 'postgresql://local/zomaal' },
    { STRIPE_BILLING_ENABLED: 'false' },
    { STRIPE_BILLING_ENVIRONMENT: 'production' },
  ])('refuses unsafe configuration %j before contacting Stripe', (config) => {
    expect(() => client(config).get()).toThrow();
  });
  it('refuses yearly prices and missing price mapping', () => {
    expect(() => client().priceId('STARTER', 'YEARLY')).toThrow();
    expect(() => client().priceId('STARTER', 'MONTHLY')).toThrow();
  });
});
