import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SubscriptionService } from './subscription.service';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const STARTER = {
  id: 'plan-starter',
  code: 'STARTER',
  name: 'Starter',
  description: null,
  monthlyPrice: new Prisma.Decimal('10'),
  yearlyPrice: null,
  currency: 'MAD',
  taxIncluded: true,
  maxStores: 1,
  features: [],
  featureList: [],
  isActive: true,
  sortOrder: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

function sub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    userId: 'owner-1',
    planId: null,
    plan: null,
    interval: null,
    trialEndsAt: new Date(NOW.getTime() + 7 * DAY),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    accessEndsAt: new Date(NOW.getTime() + 7 * DAY),
    provider: 'MANUAL',
    providerReference: null,
    ...overrides,
  };
}

function build() {
  const prisma = {
    store: { findFirst: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    staffMember: { findUnique: jest.fn().mockResolvedValue(null) },
    subscription: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    plan: { findUnique: jest.fn(), findMany: jest.fn() },
    billingInvoice: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const storeAccess = {
    require: jest.fn().mockResolvedValue({ storeId: 's', isOwner: true }),
    requireOwner: jest.fn().mockResolvedValue({ storeId: 's', isOwner: true }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new SubscriptionService(
    prisma as never,
    storeAccess as never,
    config as never,
  );
  return { service, prisma, storeAccess, config };
}

describe('SubscriptionService', () => {
  describe('ownerUserIdFor', () => {
    it('resolves staff to their store owner', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue(null);
      prisma.staffMember.findUnique.mockResolvedValue({
        store: { userId: 'owner-1' },
      });
      await expect(service.ownerUserIdFor('staff-1')).resolves.toBe('owner-1');
    });

    it('is null for a user still onboarding', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue(null);
      await expect(service.ownerUserIdFor('new')).resolves.toBeNull();
    });
  });

  describe('stateForOwner', () => {
    it('gives the trial every feature and unlimited stores', async () => {
      const { service, prisma } = build();
      prisma.subscription.findUnique.mockResolvedValue(sub());
      const state = await service.stateForOwner('owner-1', NOW);
      expect(state).toMatchObject({
        status: 'TRIALING',
        isReadOnly: false,
        maxStores: null,
      });
      expect(state.features).toEqual(
        expect.arrayContaining(['ads', 'shop', 'whatsapp']),
      );
    });

    it('locks an expired paid plan and uses the plan entitlements', async () => {
      const { service, prisma } = build();
      prisma.subscription.findUnique.mockResolvedValue(
        sub({
          planId: STARTER.id,
          plan: STARTER,
          accessEndsAt: new Date(NOW.getTime() - DAY),
        }),
      );
      const state = await service.stateForOwner('owner-1', NOW);
      expect(state).toMatchObject({
        status: 'EXPIRED',
        isReadOnly: true,
        maxStores: 1,
        features: [],
      });
    });

    it('self-heals a missing subscription row with a trial', async () => {
      const { service, prisma } = build();
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.subscription.findUniqueOrThrow.mockResolvedValue(sub());
      await service.stateForOwner('owner-1', NOW);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'owner-1' },
          create: expect.objectContaining({
            accessEndsAt: new Date(NOW.getTime() + 7 * DAY),
          }) as object,
          update: {},
        }),
      );
    });
  });

  describe('assertCanCreateStore', () => {
    it('always allows the first store', async () => {
      const { service, prisma } = build();
      prisma.store.count.mockResolvedValue(0);
      await expect(
        service.assertCanCreateStore('owner-1'),
      ).resolves.toBeUndefined();
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('blocks a second store on Starter', async () => {
      const { service, prisma } = build();
      prisma.store.count.mockResolvedValue(1);
      prisma.subscription.findUnique.mockResolvedValue(
        sub({
          planId: STARTER.id,
          plan: STARTER,
          accessEndsAt: new Date(Date.now() + DAY),
        }),
      );
      const err = await service
        .assertCanCreateStore('owner-1')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        reason: 'PLAN_UPGRADE_REQUIRED',
        feature: 'multi_store',
      });
    });

    it('allows more stores on an unlimited plan', async () => {
      const { service, prisma } = build();
      prisma.store.count.mockResolvedValue(3);
      prisma.subscription.findUnique.mockResolvedValue(
        sub({
          planId: 'pro',
          plan: { ...STARTER, id: 'pro', maxStores: null },
          accessEndsAt: new Date(Date.now() + DAY),
        }),
      );
      await expect(
        service.assertCanCreateStore('owner-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('cancel / resume', () => {
    it('refuses to cancel a trial', async () => {
      const { service, prisma } = build();
      prisma.subscription.findUnique.mockResolvedValue(sub());
      await expect(service.cancel('owner-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('cancels at period end without touching access', async () => {
      const { service, prisma } = build();
      const active = sub({
        planId: STARTER.id,
        plan: STARTER,
        accessEndsAt: new Date(Date.now() + DAY),
      });
      prisma.subscription.findUnique.mockResolvedValue(active);
      prisma.store.findFirst.mockResolvedValue({ id: 's' });
      await service.cancel('owner-1');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { cancelAtPeriodEnd: true, canceledAt: expect.any(Date) as Date },
      });
    });

    it('refuses to resume when nothing is pending', async () => {
      const { service, prisma } = build();
      prisma.subscription.findUnique.mockResolvedValue(
        sub({
          planId: STARTER.id,
          plan: STARTER,
          accessEndsAt: new Date(Date.now() + DAY),
        }),
      );
      await expect(service.resume('owner-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('activateManually', () => {
    const input = {
      planId: STARTER.id,
      interval: 'MONTHLY' as const,
      amount: '10.00',
    };

    function setup(current: ReturnType<typeof sub>) {
      const ctx = build();
      ctx.prisma.store.findFirst.mockResolvedValue({ id: 's' });
      ctx.prisma.plan.findUnique.mockResolvedValue(STARTER);
      ctx.prisma.subscription.upsert.mockResolvedValue(current);
      ctx.prisma.subscription.update.mockImplementation(
        ({ data }: { data: object }) => ({
          ...current,
          ...data,
        }),
      );
      ctx.prisma.billingInvoice.create.mockImplementation(
        ({ data }: { data: object }) => ({
          id: 'inv-1',
          ...data,
        }),
      );
      return ctx;
    }

    it('starts a new period now when coming from a trial', async () => {
      const { service, prisma } = setup(sub());
      const { invoice } = await service.activateManually(
        'owner-1',
        input,
        'admin-1',
        NOW,
      );
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planId: STARTER.id,
            accessEndsAt: new Date('2026-11-05T12:00:00.000Z'),
            cancelAtPeriodEnd: false,
          }) as object,
        }),
      );
      expect(invoice).toMatchObject({
        amount: '10.00',
        currency: 'MAD',
        periodStart: NOW.toISOString(),
        periodEnd: '2026-11-05T12:00:00.000Z',
      });
    });

    it('extends from the current end when renewing the same plan early', async () => {
      const end = new Date('2026-10-20T00:00:00.000Z');
      const { service } = setup(
        sub({
          planId: STARTER.id,
          interval: 'MONTHLY',
          accessEndsAt: end,
          currentPeriodStart: NOW,
        }),
      );
      const { invoice } = await service.activateManually(
        'owner-1',
        input,
        'admin-1',
        NOW,
      );
      expect(invoice.periodStart).toBe(end.toISOString());
      expect(invoice.periodEnd).toBe('2026-11-20T00:00:00.000Z');
    });

    it('rejects an interval the plan is not sold at', async () => {
      const { service } = setup(sub());
      await expect(
        service.activateManually(
          'owner-1',
          { ...input, interval: 'YEARLY' },
          'admin-1',
          NOW,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 for a user who owns no store', async () => {
      const { service, prisma } = setup(sub());
      prisma.store.findFirst.mockResolvedValue(null);
      await expect(
        service.activateManually('nobody', input, 'admin-1', NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('extendTrial', () => {
    it('adds days to an active trial', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue({ id: 's' });
      prisma.subscription.upsert.mockResolvedValue(sub());
      await service.extendTrial('owner-1', 5, NOW);
      const expected = new Date(NOW.getTime() + 12 * DAY);
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { trialEndsAt: expected, accessEndsAt: expected },
      });
    });

    it('restarts from today when the trial already ended', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue({ id: 's' });
      prisma.subscription.upsert.mockResolvedValue(
        sub({ accessEndsAt: new Date(NOW.getTime() - 3 * DAY) }),
      );
      await service.extendTrial('owner-1', 2, NOW);
      const expected = new Date(NOW.getTime() + 2 * DAY);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { trialEndsAt: expected, accessEndsAt: expected },
        }),
      );
    });

    it('refuses once on a paid plan', async () => {
      const { service, prisma } = build();
      prisma.store.findFirst.mockResolvedValue({ id: 's' });
      prisma.subscription.upsert.mockResolvedValue(sub({ planId: STARTER.id }));
      await expect(
        service.extendTrial('owner-1', 5, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
