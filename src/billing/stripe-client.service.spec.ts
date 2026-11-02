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

  it('keeps checkout returning through the backend callback', () => {
    const stripe = client({
      STRIPE_PUBLIC_BASE_URL: 'https://api.example/',
      BILLING_CHECKOUT_SUCCESS_URL: 'https://app.example/plans',
    });
    expect(stripe.completionUrl('success')).toBe(
      'https://api.example/billing/stripe/return?outcome=success',
    );
  });

  it('preserves app URL parameters and sets the actual return outcome', () => {
    const stripe = client({
      BILLING_CHECKOUT_SUCCESS_URL:
        'https://app.example/plans?source=stripe&outcome=old#billing',
      BILLING_CHECKOUT_CANCEL_URL: 'https://app.example/plans?source=stripe',
    });
    expect(stripe.appReturnUrl('success')).toBe(
      'https://app.example/plans?source=stripe&outcome=success#billing',
    );
    expect(stripe.appReturnUrl('cancel')).toBe(
      'https://app.example/plans?source=stripe&outcome=cancel',
    );
  });

  it('supports a configured mobile app destination', () => {
    expect(
      client({
        BILLING_CHECKOUT_SUCCESS_URL: 'zomaal://screens/apps/plans-pricing',
      }).appReturnUrl('success'),
    ).toBe('zomaal://screens/apps/plans-pricing?outcome=success');
  });

  it('keeps informational returns when app destinations are absent', () => {
    expect(client().appReturnUrl('success')).toBeNull();
    expect(client().appReturnUrl('cancel')).toBeNull();
    expect(
      client({ BILLING_CHECKOUT_SUCCESS_URL: '   ' }).appReturnUrl('success'),
    ).toBeNull();
  });
});
