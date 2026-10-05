import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingInterval, Plan, Prisma, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import {
  TRIAL_DAYS,
  TRIAL_ENTITLEMENTS,
  isPlanFeature,
  type PlanFeature,
} from './plan-features';
import {
  addInterval,
  daysLeft,
  deriveSubscriptionStatus,
  isReadOnlyStatus,
  type SubscriptionStatus,
} from './subscription-status.util';
import type {
  BillingInvoiceListResponseDto,
  BillingInvoiceResponseDto,
  PlanResponseDto,
  SubscriptionResponseDto,
} from './dto/billing.dto';

export interface AccountState {
  ownerUserId: string;
  subscription: Subscription & { plan: Plan | null };
  status: SubscriptionStatus;
  isReadOnly: boolean;
  maxStores: number | null;
  features: PlanFeature[];
}

export interface ManualActivationInput {
  planId: string;
  interval: BillingInterval;
  periods?: number;
  amount: string;
  currency?: string;
  paidAt?: Date;
  providerReference?: string | null;
  note?: string | null;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
    private readonly config: ConfigService,
  ) {}

  /** Called when an owner creates their first store. Idempotent. */
  async startTrialIfMissing(
    ownerUserId: string,
    now: Date = new Date(),
    tx: Tx = this.prisma,
  ): Promise<Subscription> {
    const trialEndsAt = new Date(
      now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    );
    return tx.subscription.upsert({
      where: { userId: ownerUserId },
      create: { userId: ownerUserId, trialEndsAt, accessEndsAt: trialEndsAt },
      update: {},
    });
  }

  /**
   * The billing account behind whoever is calling: the owner of their active
   * store. Null for a user who has no store yet (still onboarding).
   */
  async ownerUserIdFor(userId: string): Promise<string | null> {
    const owned = await this.prisma.store.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (owned) return userId;
    const staff = await this.prisma.staffMember.findUnique({
      where: { userId },
      select: { store: { select: { userId: true } } },
    });
    return staff?.store.userId ?? null;
  }

  async stateForUser(
    userId: string,
    now = new Date(),
  ): Promise<AccountState | null> {
    const ownerUserId = await this.ownerUserIdFor(userId);
    if (!ownerUserId) return null;
    return this.stateForOwner(ownerUserId, now);
  }

  async stateForOwner(
    ownerUserId: string,
    now = new Date(),
  ): Promise<AccountState> {
    let subscription = await this.prisma.subscription.findUnique({
      where: { userId: ownerUserId },
      include: { plan: true },
    });
    if (!subscription) {
      // Self-heal: every store owner must have a subscription row.
      await this.startTrialIfMissing(ownerUserId, now);
      subscription = await this.prisma.subscription.findUniqueOrThrow({
        where: { userId: ownerUserId },
        include: { plan: true },
      });
    }

    const status = deriveSubscriptionStatus(subscription, now);
    const entitlements = subscription.plan
      ? {
          maxStores: subscription.plan.maxStores,
          features: subscription.plan.features.filter(isPlanFeature),
        }
      : TRIAL_ENTITLEMENTS;

    return {
      ownerUserId,
      subscription,
      status,
      isReadOnly: isReadOnlyStatus(status),
      maxStores: entitlements.maxStores,
      features: [...entitlements.features],
    };
  }

  /** Throws 403 PLAN_UPGRADE_REQUIRED when the plan's store limit is reached. */
  async assertCanCreateStore(ownerUserId: string): Promise<void> {
    const storeCount = await this.prisma.store.count({
      where: { userId: ownerUserId },
    });
    if (storeCount === 0) return; // first store always allowed; it starts the trial

    const state = await this.stateForOwner(ownerUserId);
    if (state.maxStores !== null && storeCount >= state.maxStores) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Your plan allows ${state.maxStores} store${state.maxStores === 1 ? '' : 's'}. Upgrade to add more businesses.`,
        reason: 'PLAN_UPGRADE_REQUIRED',
        feature: 'multi_store',
      });
    }
  }

  async listPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map(toPlanResponse);
  }

  async getForUser(userId: string): Promise<SubscriptionResponseDto> {
    const access = await this.storeAccess.require(userId);
    const state = await this.stateForUser(userId);
    if (!state) throw new NotFoundException('Store not found');
    const storesUsed = await this.prisma.store.count({
      where: { userId: state.ownerUserId },
    });
    return this.toSubscriptionResponse(state, storesUsed, access.isOwner);
  }

  /** Q17.5: cancellation takes effect at the end of the paid period, no refund. */
  async cancel(userId: string): Promise<SubscriptionResponseDto> {
    await this.storeAccess.requireOwner(userId);
    const state = await this.stateForOwner(userId);
    if (state.status !== 'ACTIVE') {
      throw new ConflictException(
        'Only an active paid subscription can be cancelled',
      );
    }
    if (!state.subscription.cancelAtPeriodEnd) {
      await this.prisma.subscription.update({
        where: { id: state.subscription.id },
        data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
      });
    }
    return this.getForUser(userId);
  }

  async resume(userId: string): Promise<SubscriptionResponseDto> {
    await this.storeAccess.requireOwner(userId);
    const state = await this.stateForOwner(userId);
    if (state.status !== 'ACTIVE' || !state.subscription.cancelAtPeriodEnd) {
      throw new ConflictException('There is no pending cancellation to undo');
    }
    await this.prisma.subscription.update({
      where: { id: state.subscription.id },
      data: { cancelAtPeriodEnd: false, canceledAt: null },
    });
    return this.getForUser(userId);
  }

  async listInvoices(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<BillingInvoiceListResponseDto> {
    await this.storeAccess.requireOwner(userId);
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.billingInvoice.count({ where }),
    ]);
    return {
      items: rows.map(toInvoiceResponse),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Admin records a payment received outside the app (until a gateway is
   * chosen). Renewing the same plan before it ends extends from the current
   * period end so paid time is never lost; anything else starts now.
   */
  async activateManually(
    ownerUserId: string,
    input: ManualActivationInput,
    adminId: string,
    now: Date = new Date(),
  ): Promise<{
    subscription: Subscription;
    invoice: BillingInvoiceResponseDto;
  }> {
    await this.assertIsOwner(ownerUserId);
    const plan = await this.prisma.plan.findUnique({
      where: { id: input.planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const price =
      input.interval === BillingInterval.MONTHLY
        ? plan.monthlyPrice
        : plan.yearlyPrice;
    if (price === null) {
      throw new ConflictException(
        `Plan ${plan.code} is not sold ${input.interval.toLowerCase()}`,
      );
    }

    const periods = input.periods ?? 1;
    return this.prisma.$transaction(async (tx) => {
      const current = await this.startTrialIfMissing(ownerUserId, now, tx);
      const renewing =
        current.planId === plan.id &&
        current.interval === input.interval &&
        current.accessEndsAt > now;
      const periodStart = renewing ? current.accessEndsAt : now;
      const periodEnd = addInterval(periodStart, input.interval, periods);

      const subscription = await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: plan.id,
          interval: input.interval,
          currentPeriodStart: renewing
            ? current.currentPeriodStart
            : periodStart,
          currentPeriodEnd: periodEnd,
          accessEndsAt: periodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          provider: 'MANUAL',
        },
      });
      const invoice = await tx.billingInvoice.create({
        data: {
          userId: ownerUserId,
          subscriptionId: subscription.id,
          planId: plan.id,
          planName: plan.name,
          interval: input.interval,
          amount: new Prisma.Decimal(input.amount),
          currency: (input.currency ?? plan.currency).toUpperCase(),
          periodStart,
          periodEnd,
          paidAt: input.paidAt ?? now,
          provider: 'MANUAL',
          providerReference: input.providerReference ?? null,
          note: input.note ?? null,
          recordedByAdminId: adminId,
        },
      });
      return { subscription, invoice: toInvoiceResponse(invoice) };
    });
  }

  /** Admin grants extra trial days (only while still on the trial). */
  async extendTrial(
    ownerUserId: string,
    days: number,
    now = new Date(),
  ): Promise<Subscription> {
    await this.assertIsOwner(ownerUserId);
    const sub = await this.startTrialIfMissing(ownerUserId, now);
    if (sub.planId !== null) {
      throw new ConflictException('Account is already on a paid plan');
    }
    const base = sub.accessEndsAt > now ? sub.accessEndsAt : now;
    const trialEndsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { trialEndsAt, accessEndsAt: trialEndsAt },
    });
  }

  async adminView(ownerUserId: string) {
    await this.assertIsOwner(ownerUserId);
    const state = await this.stateForOwner(ownerUserId);
    const [storesUsed, invoices] = await Promise.all([
      this.prisma.store.count({ where: { userId: ownerUserId } }),
      this.prisma.billingInvoice.findMany({
        where: { userId: ownerUserId },
        orderBy: { paidAt: 'desc' },
      }),
    ]);
    return {
      subscription: this.toSubscriptionResponse(state, storesUsed, true),
      invoices: invoices.map(toInvoiceResponse),
    };
  }

  private async assertIsOwner(userId: string): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Merchant not found');
  }

  private toSubscriptionResponse(
    state: AccountState,
    storesUsed: number,
    canManage: boolean,
  ): SubscriptionResponseDto {
    const sub = state.subscription;
    const now = new Date();
    return {
      status: state.status,
      isReadOnly: state.isReadOnly,
      plan: sub.plan ? toPlanResponse(sub.plan) : null,
      interval: sub.interval,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      trialDaysLeft:
        state.status === 'TRIALING' ? daysLeft(sub.accessEndsAt, now) : null,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      renewsAt:
        state.status === 'ACTIVE' && !sub.cancelAtPeriodEnd
          ? (sub.currentPeriodEnd?.toISOString() ?? null)
          : null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt?.toISOString() ?? null,
      accessEndsAt: sub.accessEndsAt.toISOString(),
      provider: sub.provider,
      paymentMethod: null,
      entitlements: {
        maxStores: state.maxStores,
        storesUsed,
        features: state.features,
      },
      checkoutUrl: this.config.get<string>('BILLING_CHECKOUT_URL') || null,
      canManage,
    };
  }
}

export function toPlanResponse(plan: Plan): PlanResponseDto {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPrice: plan.monthlyPrice?.toFixed(2) ?? null,
    yearlyPrice: plan.yearlyPrice?.toFixed(2) ?? null,
    currency: plan.currency,
    taxIncluded: plan.taxIncluded,
    maxStores: plan.maxStores,
    features: plan.features.filter(isPlanFeature),
    featureList: plan.featureList,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
  };
}

function toInvoiceResponse(
  invoice: Prisma.BillingInvoiceGetPayload<object>,
): BillingInvoiceResponseDto {
  return {
    id: invoice.id,
    planName: invoice.planName,
    interval: invoice.interval,
    amount: invoice.amount.toFixed(2),
    currency: invoice.currency,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    paidAt: invoice.paidAt.toISOString(),
    provider: invoice.provider,
    providerReference: invoice.providerReference,
  };
}
