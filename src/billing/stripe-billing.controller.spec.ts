import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StripeBillingController } from './stripe-billing.controller';
import { StripeBillingService } from './stripe-billing.service';
import { StripeClientService } from './stripe-client.service';

describe('Stripe browser return HTTP', () => {
  let app: INestApplication;
  let server: Server;
  const config: Record<string, string> = {};
  const billing = { checkout: jest.fn(), webhook: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StripeBillingController],
      providers: [
        StripeClientService,
        { provide: ConfigService, useValue: new ConfigService(config) },
        { provide: StripeBillingService, useValue: billing },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer<Server>() as Server;
  });

  beforeEach(() => {
    for (const key of Object.keys(config)) delete config[key];
    jest.clearAllMocks();
  });

  afterEach(() => {
    expect(billing.checkout).not.toHaveBeenCalled();
    expect(billing.webhook).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['success', 'cancel'])(
    'redirects a public %s return to the configured app',
    async (outcome) => {
      config.BILLING_CHECKOUT_SUCCESS_URL = 'https://app.example/plans';
      config.BILLING_CHECKOUT_CANCEL_URL = 'https://app.example/billing';
      const response = await request(server)
        .get(`/billing/stripe/return?outcome=${outcome}`)
        .expect(303);
      expect(response.headers.location).toBe(
        `https://app.example/${outcome === 'success' ? 'plans' : 'billing'}?outcome=${outcome}`,
      );
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it('ignores a request-supplied redirect destination', async () => {
    config.BILLING_CHECKOUT_SUCCESS_URL = 'https://app.example/plans';
    const response = await request(server)
      .get('/billing/stripe/return')
      .query({ outcome: 'success', redirectUrl: 'https://other.example' })
      .expect(303);
    expect(response.headers.location).toBe(
      'https://app.example/plans?outcome=success',
    );
  });

  it.each(['success', 'cancel'])(
    'keeps a %s informational response when no app URL is configured',
    async (outcome) => {
      const response = await request(server)
        .get(`/billing/stripe/return?outcome=${outcome}`)
        .expect(200);
      expect(response.body).toMatchObject({ sandbox: true });
      expect(response.headers.location).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it.each(['', '?outcome=unknown', '?outcome=success&outcome=cancel'])(
    'does not redirect ambiguous or missing outcomes (%s)',
    async (query) => {
      config.BILLING_CHECKOUT_SUCCESS_URL = 'https://app.example/plans';
      config.BILLING_CHECKOUT_CANCEL_URL = 'https://app.example/plans';
      const response = await request(server)
        .get(`/billing/stripe/return${query}`)
        .expect(200);
      expect(response.headers.location).toBeUndefined();
    },
  );
});
