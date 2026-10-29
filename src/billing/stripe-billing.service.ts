import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BillingInterval, Plan, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import { StripeClientService } from './stripe-client.service';
import type { StripeCheckoutDto } from './stripe-billing.dto';

@Injectable()
export class StripeBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
    private readonly stripe: StripeClientService,
  ) {}

  async checkout(userId: string, dto: StripeCheckoutDto) {
    await this.access.requireOwner(userId);
    const api = this.stripe.get();
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan?.isActive) throw new NotFoundException('Active plan not found');
    const priceId = this.stripe.priceId(plan.code, dto.interval);
    this.assertPrice(await api.prices.retrieve(priceId), plan);
    const storesUsed = await this.prisma.store.count({ where: { userId } });
    if (plan.maxStores !== null && storesUsed > plan.maxStores) {
      throw new ConflictException(
        'This plan cannot cover your existing stores',
      );
    }
    const reservation = await this.prisma.$transaction(
      async (tx) => {
        await this.lockOwner(tx, userId);
        let sub = await tx.subscription.upsert({
          where: { userId },
          update: {},
          create: { userId, accessEndsAt: new Date() },
        });
        let previousSubscriptionEnded = false;
        if (sub.stripeSubscriptionId) {
          const remote = await api.subscriptions.retrieve(
            sub.stripeSubscriptionId,
          );
          if (!['canceled', 'incomplete_expired'].includes(remote.status)) {
            throw new ConflictException(
              'A Stripe subscription already exists; manage it before starting another',
            );
          }
          sub = await tx.subscription.update({
            where: { id: sub.id },
            data: { stripeSubscriptionId: null },
          });
          previousSubscriptionEnded = true;
        } else if (sub.planId && sub.accessEndsAt > new Date()) {
          throw new ConflictException(
            'An active paid subscription already exists',
          );
        }
        if (sub.stripeCheckoutSessionId) {
          const pending = await api.checkout.sessions.retrieve(
            sub.stripeCheckoutSessionId,
          );
          if (pending.status === 'open') {
            if (pending.metadata?.plan_id !== plan.id)
              throw new ConflictException(
                'A checkout for another plan is already open',
              );
            return { existing: sessionResponse(pending) };
          }
          if (
            pending.status === 'complete' &&
            !sub.stripeSubscriptionId &&
            !previousSubscriptionEnded
          ) {
            throw new ConflictException(
              'Payment confirmation is still processing',
            );
          }
          // An expired/completed old session needs a fresh persisted request key.
          sub = await tx.subscription.update({
            where: { id: sub.id },
            data: {
              stripeCheckoutRequestId: null,
              stripeCheckoutSessionId: null,
              stripeCheckoutPlanId: null,
            },
          });
        }
        if (
          sub.stripeCheckoutRequestId &&
          sub.stripeCheckoutPlanId !== plan.id
        ) {
          throw new ConflictException(
            'A checkout for another plan is already processing',
          );
        }
        const currentStoreCount = await tx.store.count({ where: { userId } });
        if (plan.maxStores !== null && currentStoreCount > plan.maxStores) {
          throw new ConflictException(
            'This plan cannot cover your existing stores',
          );
        }
        const customerId =
          sub.stripeCustomerId ??
          (
            await api.customers.create(
              {
                metadata: {
                  app: 'zomaal',
                  owner_user_id: userId,
                  billing_environment: 'staging',
                },
              },
              { idempotencyKey: `zomaal-staging-customer-${userId}` },
            )
          ).id;
        // Persist the request key before the provider call; retries after a timeout
        // use the same key, even when Stripe created a session before the timeout.
        const requestId = sub.stripeCheckoutRequestId ?? randomUUID();
        sub = await tx.subscription.update({
          where: { id: sub.id },
          data: {
            stripeCustomerId: customerId,
            stripeCheckoutRequestId: requestId,
            stripeCheckoutPlanId: plan.id,
          },
        });
        return { customerId, requestId, subscriptionId: sub.id };
      },
      { timeout: 60000 },
    );
    if (reservation.existing) return reservation.existing;
    const { customerId, requestId, subscriptionId } = reservation;
    const metadata = {
      app: 'zomaal',
      billing_environment: 'staging',
      owner_user_id: userId,
      local_subscription_id: subscriptionId,
      plan_id: plan.id,
      checkout_request_id: requestId,
    };
    const session = await api.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        allowed_payment_method_types: ['card'],
        metadata,
        subscription_data: { metadata },
        success_url: this.stripe.completionUrl('success'),
        cancel_url: this.stripe.completionUrl('cancel'),
        billing_address_collection: 'required',
      },
      { idempotencyKey: `zomaal-staging-checkout-${requestId}` },
    );
    await this.prisma.subscription.updateMany({
      where: { id: subscriptionId, stripeCheckoutRequestId: requestId },
      data: { stripeCheckoutSessionId: session.id },
    });
    return sessionResponse(session);
  }

  async webhook(rawBody: Buffer, signature: string) {
    const api = this.stripe.get();
    let event: Stripe.Event;
    try {
      event = api.webhooks.constructEvent(
        rawBody,
        signature,
        this.stripe.webhookSecret(),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
    if (event.livemode)
      throw new BadRequestException('Live events are not accepted in staging');
    const supported = [
      'checkout.session.completed',
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ];
    if (!supported.includes(event.type))
      return { received: true, ignored: true };
    if (
      await this.prisma.stripeWebhookReceipt.findUnique({
        where: { eventId: event.id },
      })
    ) {
      return { received: true, duplicate: true };
    }
    const object = event.data.object;
    let subscriptionId: string | null = null;
    if (object.object === 'subscription') subscriptionId = object.id;
    if (object.object === 'checkout.session')
      subscriptionId = objectId(object.subscription);
    if (object.object === 'invoice')
      subscriptionId = objectId(
        object.parent?.subscription_details?.subscription,
      );
    if (!subscriptionId) return { received: true, ignored: true };
    const remote = await api.subscriptions.retrieve(subscriptionId);
    const metadata = remote.metadata;
    if (metadata.app !== 'zomaal' || metadata.billing_environment !== 'staging')
      return { received: true, ignored: true };
    const userId = metadata.owner_user_id;
    if (!userId || remote.livemode)
      throw new BadRequestException('Invalid Stripe subscription ownership');

    return this.prisma.$transaction(
      async (tx) => {
        await this.lockOwner(tx, userId);
        if (
          await tx.stripeWebhookReceipt.findUnique({
            where: { eventId: event.id },
          })
        )
          return { received: true, duplicate: true };
        const local = await tx.subscription.findUnique({ where: { userId } });
        if (
          !local ||
          local.id !== metadata.local_subscription_id ||
          local.stripeCustomerId !== objectId(remote.customer) ||
          (local.stripeSubscriptionId
            ? local.stripeSubscriptionId !== remote.id
            : local.stripeCheckoutRequestId !== metadata.checkout_request_id)
        ) {
          throw new BadRequestException(
            'Stripe subscription does not belong to this billing account',
          );
        }
        const plan = await tx.plan.findUnique({
          where: { id: metadata.plan_id },
        });
        if (!plan)
          throw new BadRequestException('Stripe plan mapping not found');
        // Fetch again under the lock so delayed/concurrent events cannot regress
        // cancellation state from a snapshot captured before another transaction.
        const current = await api.subscriptions.retrieve(remote.id, {
          expand: ['latest_invoice'],
        });
        const item = current.items.data[0];
        if (
          current.items.data.length !== 1 ||
          item.quantity !== 1 ||
          item.price.id !==
            this.stripe.priceId(plan.code, BillingInterval.MONTHLY)
        ) {
          throw new BadRequestException('Unexpected Stripe subscription items');
        }
        this.assertPrice(item.price, plan);
        let invoice: Stripe.Invoice | null = null;
        if (object.object === 'invoice' && event.type === 'invoice.paid')
          invoice = await api.invoices.retrieve(object.id);
        else if (
          current.latest_invoice &&
          typeof current.latest_invoice !== 'string'
        )
          invoice = current.latest_invoice;
        const data: Prisma.SubscriptionUpdateInput = {
          stripeSubscriptionId: current.id,
          cancelAtPeriodEnd: current.cancel_at_period_end,
          canceledAt: current.canceled_at
            ? new Date(current.canceled_at * 1000)
            : null,
        };
        if (
          invoice?.status === 'paid' &&
          invoice.amount_paid >= invoice.amount_due &&
          invoice.amount_paid >= this.priceMinor(plan) &&
          invoice.currency.toUpperCase() === plan.currency.toUpperCase() &&
          objectId(invoice.parent?.subscription_details?.subscription) ===
            current.id
        ) {
          const line = invoice.lines.data.find(
            (entry) => entry.pricing?.price_details?.price === item.price.id,
          );
          if (
            !line ||
            invoice.lines.has_more ||
            invoice.lines.data.length !== 1 ||
            line.quantity !== 1
          ) {
            throw new BadRequestException('Unexpected Stripe invoice lines');
          }
          const periodStart = new Date(line.period.start * 1000);
          const periodEnd = new Date(line.period.end * 1000);
          if (
            periodEnd > local.accessEndsAt &&
            ['active', 'past_due'].includes(current.status)
          ) {
            Object.assign(data, {
              planId: plan.id,
              interval: BillingInterval.MONTHLY,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              accessEndsAt: periodEnd,
              provider: 'STRIPE',
              providerReference: current.id,
            });
          }
          await tx.billingInvoice.upsert({
            where: { stripeInvoiceId: invoice.id },
            update: {},
            create: {
              stripeInvoiceId: invoice.id,
              userId,
              subscriptionId: local.id,
              planId: plan.id,
              planName: plan.name,
              interval: BillingInterval.MONTHLY,
              amount: new Prisma.Decimal(invoice.amount_paid).div(100),
              currency: invoice.currency.toUpperCase(),
              periodStart,
              periodEnd,
              paidAt: new Date(
                (invoice.status_transitions.paid_at ?? event.created) * 1000,
              ),
              provider: 'STRIPE',
              providerReference: invoice.id,
            },
          });
        }
        // A failed payment never buys a new period. Cancellation/unpaid pauses
        // revoke access immediately; past_due retains only previously paid time.
        if (
          ['canceled', 'unpaid', 'paused', 'incomplete_expired'].includes(
            current.status,
          )
        ) {
          const end = new Date(
            (current.ended_at ?? Math.floor(Date.now() / 1000)) * 1000,
          );
          data.accessEndsAt =
            end < local.accessEndsAt ? end : local.accessEndsAt;
        }
        await tx.subscription.update({ where: { id: local.id }, data });
        await tx.stripeWebhookReceipt.create({
          data: { eventId: event.id, eventType: event.type },
        });
        return { received: true };
      },
      { timeout: 60000 },
    );
  }

  async setCancellation(userId: string, cancel: boolean) {
    await this.access.requireOwner(userId);
    const api = this.stripe.get();
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockOwner(tx, userId);
        const sub = await tx.subscription.findUnique({ where: { userId } });
        if (
          !sub?.stripeSubscriptionId ||
          sub.provider !== 'STRIPE' ||
          sub.accessEndsAt <= new Date()
        ) {
          throw new ConflictException('No active Stripe subscription');
        }
        const remote = await api.subscriptions.update(
          sub.stripeSubscriptionId,
          { cancel_at_period_end: cancel },
        );
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            cancelAtPeriodEnd: remote.cancel_at_period_end,
            canceledAt: remote.canceled_at
              ? new Date(remote.canceled_at * 1000)
              : null,
          },
        });
        return { cancelAtPeriodEnd: remote.cancel_at_period_end };
      },
      { timeout: 60000 },
    );
  }

  private priceMinor(plan: Plan): number {
    return new Prisma.Decimal(plan.monthlyPrice ?? 0).times(100).toNumber();
  }
  private assertPrice(price: Stripe.Price, plan: Plan) {
    if (
      price.livemode ||
      !price.active ||
      price.currency.toUpperCase() !== plan.currency.toUpperCase() ||
      price.unit_amount !== this.priceMinor(plan) ||
      price.unit_amount <= 0 ||
      price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== 'licensed'
    ) {
      throw new ConflictException(
        'Stripe price does not match the configured plan',
      );
    }
  }
  private async lockOwner(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }
}

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}
function sessionResponse(session: Stripe.Checkout.Session) {
  if (!session.url)
    throw new ConflictException('Checkout session is no longer open');
  return {
    sessionId: session.id,
    checkoutUrl: session.url,
    expiresAt: new Date(session.expires_at * 1000).toISOString(),
  };
}
