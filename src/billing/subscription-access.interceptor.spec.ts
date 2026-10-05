import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { ALLOW_WHEN_LOCKED, REQUIRED_PLAN_FEATURE } from './billing.decorators';

type Meta = { allowWhenLocked?: boolean; feature?: string };

function build(state: unknown, meta: Meta = {}) {
  const subscriptions = { stateForUser: jest.fn().mockResolvedValue(state) };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ALLOW_WHEN_LOCKED
        ? meta.allowWhenLocked
        : key === REQUIRED_PLAN_FEATURE
          ? meta.feature
          : undefined,
    ),
  } as unknown as Reflector;
  const interceptor = new SubscriptionAccessInterceptor(
    reflector,
    subscriptions as never,
  );
  return { interceptor, subscriptions };
}

function ctx(method: string, user?: { userId: string }): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  } as unknown as ExecutionContext;
}

const next = { handle: () => of('ok') };
const run = (i: SubscriptionAccessInterceptor, c: ExecutionContext) =>
  lastValueFrom(i.intercept(c, next));

const LOCKED = {
  status: 'TRIAL_ENDED',
  isReadOnly: true,
  features: ['ads', 'shop'],
};
const STARTER = { status: 'ACTIVE', isReadOnly: false, features: [] };

describe('SubscriptionAccessInterceptor', () => {
  it('lets reads through without loading the subscription', async () => {
    const { interceptor, subscriptions } = build(LOCKED);
    await expect(run(interceptor, ctx('GET', { userId: 'u' }))).resolves.toBe(
      'ok',
    );
    expect(subscriptions.stateForUser).not.toHaveBeenCalled();
  });

  it('ignores requests without a merchant user (webhooks, schedulers, admin)', async () => {
    const { interceptor, subscriptions } = build(LOCKED);
    await expect(run(interceptor, ctx('POST'))).resolves.toBe('ok');
    expect(subscriptions.stateForUser).not.toHaveBeenCalled();
  });

  it('blocks writes with 402 when the account is locked', async () => {
    const { interceptor } = build(LOCKED);
    const err = await run(interceptor, ctx('POST', { userId: 'u' })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
    expect((err as HttpException).getResponse()).toMatchObject({
      reason: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus: 'TRIAL_ENDED',
    });
  });

  it('allows writes on @AllowWhenLocked routes', async () => {
    const { interceptor } = build(LOCKED, { allowWhenLocked: true });
    await expect(run(interceptor, ctx('PATCH', { userId: 'u' }))).resolves.toBe(
      'ok',
    );
  });

  it('allows writes before onboarding (no store yet)', async () => {
    const { interceptor } = build(null);
    await expect(run(interceptor, ctx('POST', { userId: 'u' }))).resolves.toBe(
      'ok',
    );
  });

  it('blocks plan features the plan lacks, even on reads', async () => {
    const { interceptor } = build(STARTER, { feature: 'ads' });
    await expect(
      run(interceptor, ctx('GET', { userId: 'u' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows plan features the plan includes', async () => {
    const { interceptor } = build(
      { ...STARTER, features: ['ads'] },
      { feature: 'ads' },
    );
    await expect(run(interceptor, ctx('GET', { userId: 'u' }))).resolves.toBe(
      'ok',
    );
  });
});
