import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import Stripe from 'stripe';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { AccessModule } from '../src/access/access.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { BillingModule } from '../src/billing/billing.module';
import { StripeClientService } from '../src/billing/stripe-client.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';

const url = process.env.STRIPE_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
postgres('Stripe billing HTTP with PostgreSQL', () => {
  let db: PrismaClient, pool: Pool, app: INestApplication, server: Server;
  let owner: string,
    staff: string,
    outsider: string,
    currentUser: string | null;
  let planId: string,
    remote: Stripe.Subscription,
    latestInvoice: Stripe.Invoice;
  const ids: string[] = [];
  const secret = 'whsec_local_billing_test';
  const sdk = new Stripe('sk_test_local');
  const price = {
    id: 'price_starter',
    livemode: false,
    active: true,
    currency: 'mad',
    unit_amount: 9900,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  };
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const sessionCreate = jest.fn();
  const api = {
    prices: { retrieve: jest.fn().mockResolvedValue(price) },
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test' }) },
    checkout: {
      sessions: {
        create: sessionCreate,
        retrieve: jest.fn((id: string) => Promise.resolve(sessions.get(id))),
      },
    },
    subscriptions: {
      retrieve: jest.fn(() => Promise.resolve(remote)),
      update: jest.fn((_: string, data: object) =>
        Promise.resolve(Object.assign(remote, data)),
      ),
    },
    invoices: { retrieve: jest.fn(() => Promise.resolve(latestInvoice)) },
    webhooks: sdk.webhooks,
  };
  const billingConfig = {
    get: () => api,
    webhookSecret: () => secret,
    priceId: (_: string, interval: string) => {
      if (interval !== 'MONTHLY') throw new Error('Unavailable interval');
      return price.id;
    },
    completionUrl: () => 'https://staging.example/billing/stripe/return',
  };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      !/(test|staging|_ci)/.test(parsed.pathname)
    )
      throw new Error('Dedicated local test database required');
    pool = new Pool({ connectionString: url });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          await db.user.create({
            data: { phone: `stripe-test-${randomUUID()}` },
          })
        ).id,
      );
    [owner, staff, outsider] = ids;
    const store = await db.store.create({
      data: {
        userId: owner,
        ownerName: 'Test',
        businessName: 'Stripe test',
        address: 'Test',
        city: 'Test',
        country: 'MA',
      },
    });
    await db.user.update({
      where: { id: owner },
      data: { activeStoreId: store.id },
    });
    await db.staffMember.create({
      data: {
        userId: staff,
        storeId: store.id,
        name: 'Staff',
        permissionOverrides: ['ads.manage', 'ads.view'],
      },
    });
    const outsideStore = await db.store.create({
      data: {
        userId: outsider,
        ownerName: 'Other',
        businessName: 'Other',
        address: 'Test',
        city: 'Test',
        country: 'MA',
      },
    });
    await db.user.update({
      where: { id: outsider },
      data: { activeStoreId: outsideStore.id },
    });
    planId = (
      await db.plan.create({
        data: {
          code: `TEST_${randomUUID()}`,
          name: 'Test Starter',
          monthlyPrice: 99,
          currency: 'MAD',
          maxStores: 1,
          features: [],
          featureList: [],
        },
      })
    ).id;
    await db.subscription.create({
      data: { userId: owner, accessEndsAt: new Date(Date.now() - 86400000) },
    });
    sessionCreate.mockImplementation(
      (params: Stripe.Checkout.SessionCreateParams) => {
        const session = {
          id: 'cs_test',
          url: 'https://checkout.stripe.com/test',
          status: 'open',
          expires_at: Math.floor(Date.now() / 1000) + 86400,
          metadata: params.metadata,
        } as Stripe.Checkout.Session;
        sessions.set(session.id, session);
        return Promise.resolve(session);
      },
    );
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        AccessModule,
        BillingModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(StripeClientService)
      .useValue(billingConfig)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!currentUser) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest<{ user: object }>().user = {
            userId: currentUser,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
    server = app.getHttpServer<Server>() as Server;
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.billingInvoice.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      if (planId) await db.plan.delete({ where: { id: planId } });
      await db.stripeWebhookReceipt.deleteMany({
        where: { eventId: { startsWith: 'evt_local_stripe_' } },
      });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });
  const checkout = () =>
    request(server)
      .post('/billing/stripe/checkout')
      .send({ planId, interval: 'MONTHLY' });
  function event(
    type: string,
    object: unknown,
    id = `evt_local_stripe_${randomUUID()}`,
  ) {
    const payload = JSON.stringify({
      id,
      type,
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    });
    return {
      payload,
      signature: sdk.webhooks.generateTestHeaderString({ payload, secret }),
    };
  }
  function send(value: { payload: string; signature: string }) {
    return request(server)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', value.signature)
      .send(value.payload);
  }

  it('requires authentication for checkout', async () => {
    currentUser = null;
    await checkout().expect(401);
  });
  it('denies staff billing even with ads permissions', async () => {
    currentUser = staff;
    await checkout().expect(403);
    expect(sessionCreate).not.toHaveBeenCalled();
  });
  it('rejects malformed or client supplied price/owner overrides', async () => {
    currentUser = owner;
    await request(server)
      .post('/billing/stripe/checkout')
      .send({ planId, interval: 'MONTHLY', amount: 1, userId: outsider })
      .expect(400);
  });
  it('allows an expired owner to checkout and reuses the pending session', async () => {
    currentUser = owner;
    const first = await checkout().expect(200),
      second = await checkout().expect(200);
    expect((first.body as { sessionId: string }).sessionId).toBe(
      (second.body as { sessionId: string }).sessionId,
    );
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.subscription.findUniqueOrThrow({ where: { userId: owner } })
      ).accessEndsAt.getTime(),
    ).toBeLessThan(Date.now());
  });
  it('persists the idempotency key before a provider timeout', async () => {
    const ownerSub = await db.subscription.findUniqueOrThrow({
      where: { userId: owner },
    });
    const originalSession = sessions.get('cs_test')!;
    originalSession.status = 'expired';
    sessionCreate.mockRejectedValueOnce(
      new Error('Simulated provider timeout'),
    );
    await checkout().expect(500);
    const pending = await db.subscription.findUniqueOrThrow({
      where: { userId: owner },
    });
    expect(pending.stripeCheckoutRequestId).not.toBe(
      ownerSub.stripeCheckoutRequestId,
    );
    expect(pending.stripeCheckoutSessionId).toBeNull();
    await checkout().expect(200);
    const retry = await db.subscription.findUniqueOrThrow({
      where: { userId: owner },
    });
    expect(retry.stripeCheckoutRequestId).toBe(pending.stripeCheckoutRequestId);
    const calls = sessionCreate.mock.calls as [
      Stripe.Checkout.SessionCreateParams,
      Stripe.RequestOptions,
    ][];
    expect(calls.at(-1)![1].idempotencyKey).toBe(
      calls.at(-2)![1].idempotencyKey,
    );
  });
  it('browser return does not activate a subscription', async () => {
    await request(server)
      .get('/billing/stripe/return?outcome=success')
      .expect(200);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { userId: owner } }))
        .planId,
    ).toBeNull();
  });
  it('rejects unsigned webhooks', async () => {
    await request(server)
      .post('/webhooks/stripe')
      .send({ type: 'invoice.paid' })
      .expect(400);
  });
  it('rejects expired signatures and tampered payloads', async () => {
    const payload = JSON.stringify({ id: 'evt_fake', type: 'invoice.paid' });
    await send({
      payload,
      signature: sdk.webhooks.generateTestHeaderString({
        payload,
        secret,
        timestamp: Math.floor(Date.now() / 1000) - 600,
      }),
    }).expect(400);
    const signed = event('invoice.paid', {});
    await send({
      payload: signed.payload + ' ',
      signature: signed.signature,
    }).expect(400);
  });
  it('activates only a verified paid invoice and records it once across replay', async () => {
    const local = await db.subscription.findUniqueOrThrow({
      where: { userId: owner },
    });
    const now = Math.floor(Date.now() / 1000);
    latestInvoice = {
      id: 'in_local_test',
      object: 'invoice',
      status: 'paid',
      currency: 'mad',
      amount_due: 9900,
      amount_paid: 9900,
      parent: { subscription_details: { subscription: 'sub_test' } },
      status_transitions: { paid_at: now },
      lines: {
        has_more: false,
        data: [
          {
            quantity: 1,
            pricing: { price_details: { price: price.id } },
            period: { start: now, end: now + 2592000 },
          },
        ],
      },
    } as unknown as Stripe.Invoice;
    remote = {
      id: 'sub_test',
      object: 'subscription',
      customer: 'cus_test',
      livemode: false,
      status: 'active',
      cancel_at_period_end: false,
      metadata: {
        app: 'zomaal',
        billing_environment: 'staging',
        owner_user_id: owner,
        local_subscription_id: local.id,
        plan_id: planId,
        checkout_request_id: local.stripeCheckoutRequestId!,
      },
      items: { data: [{ quantity: 1, price }] },
      latest_invoice: latestInvoice,
    } as unknown as Stripe.Subscription;
    const paid = event('invoice.paid', latestInvoice);
    await Promise.all([send(paid).expect(200), send(paid).expect(200)]);
    // Same invoice under a different event ID still must not duplicate history.
    await send(event('invoice.paid', latestInvoice)).expect(200);
    const active = await db.subscription.findUniqueOrThrow({
      where: { userId: owner },
    });
    expect(active.provider).toBe('STRIPE');
    expect(active.planId).toBe(planId);
    expect(active.accessEndsAt.getTime()).toBeGreaterThan(Date.now());
    expect(await db.billingInvoice.count({ where: { userId: owner } })).toBe(1);
  });
  it('refuses another checkout while a subscription is active', async () => {
    currentUser = owner;
    await checkout().expect(409);
  });
  it('keeps billing and invoices owner-only for staff', async () => {
    currentUser = staff;
    await request(server).get('/billing/invoices').expect(403);
    const r = await request(server).get('/billing/subscription').expect(200);
    expect((r.body as { canManage: boolean }).canManage).toBe(false);
    await request(server).post('/billing/subscription/cancel').expect(403);
  });
  it('does not expose the owner invoices to another store', async () => {
    currentUser = outsider;
    const r = await request(server).get('/billing/invoices').expect(200);
    expect((r.body as { items: unknown[] }).items).toEqual([]);
  });
  it('cancels and resumes at Stripe, preserving the already paid period', async () => {
    currentUser = owner;
    const end = (
      await db.subscription.findUniqueOrThrow({ where: { userId: owner } })
    ).accessEndsAt;
    await request(server).post('/billing/subscription/cancel').expect(200);
    expect(remote.cancel_at_period_end).toBe(true);
    await request(server).post('/billing/subscription/resume').expect(200);
    expect(remote.cancel_at_period_end).toBe(false);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { userId: owner } }))
        .accessEndsAt,
    ).toEqual(end);
  });
  it('failed payment does not extend paid access', async () => {
    const before = (
      await db.subscription.findUniqueOrThrow({ where: { userId: owner } })
    ).accessEndsAt;
    remote.status = 'past_due';
    latestInvoice.status = 'open';
    latestInvoice.amount_paid = 0;
    await send(event('invoice.payment_failed', latestInvoice)).expect(200);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { userId: owner } }))
        .accessEndsAt,
    ).toEqual(before);
  });
  it('rejects live-mode and wrong-owner events', async () => {
    const old = remote.metadata.owner_user_id;
    remote.metadata.owner_user_id = outsider;
    await send(event('customer.subscription.updated', remote)).expect(400);
    remote.metadata.owner_user_id = old;
    const payload = JSON.stringify({
      id: 'evt_live',
      type: 'customer.subscription.updated',
      livemode: true,
      data: { object: remote },
    });
    await send({
      payload,
      signature: sdk.webhooks.generateTestHeaderString({ payload, secret }),
    }).expect(400);
  });
  it('an immediate provider cancellation revokes access and stale paid events cannot restore it', async () => {
    remote.status = 'canceled';
    remote.ended_at = Math.floor(Date.now() / 1000) - 1;
    await send(event('customer.subscription.deleted', remote)).expect(200);
    latestInvoice.status = 'paid';
    latestInvoice.amount_paid = 9900;
    await send(event('invoice.paid', latestInvoice)).expect(200);
    expect(
      (
        await db.subscription.findUniqueOrThrow({ where: { userId: owner } })
      ).accessEndsAt.getTime(),
    ).toBeLessThan(Date.now());
  });
  it('allows a fresh checkout after an ended subscription and completed old session', async () => {
    sessions.get('cs_test')!.status = 'complete';
    currentUser = owner;
    await checkout().expect(200);
    const local = await db.subscription.findUniqueOrThrow({
      where: { userId: owner },
    });
    expect(local.stripeCheckoutSessionId).toBe('cs_test');
    expect(local.stripeSubscriptionId).toBeNull();
  });
});
