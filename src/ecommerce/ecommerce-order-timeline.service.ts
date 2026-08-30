import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EcommercePlatform,
  EcommercePaymentStatus,
  EcommerceOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderEventType } from './constants/order-event-type';
import { ShopifyOrderTimelineAdapter } from './shopify-order-timeline.adapter';
import { YouCanOrderTimelineAdapter } from './youcan-order-timeline.adapter';
import { LightfunnelsOrderTimelineAdapter } from './lightfunnels-order-timeline.adapter';
import type { NormalizedOrderEvent } from './interfaces/order-timeline-adapter.interface';
import type { OrderTimelineDto } from './dto/order-timeline.dto';

@Injectable()
export class EcommerceOrderTimelineService {
  private readonly logger = new Logger(EcommerceOrderTimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyAdapter: ShopifyOrderTimelineAdapter,
    private readonly youCanAdapter: YouCanOrderTimelineAdapter,
    private readonly lightfunnelsAdapter: LightfunnelsOrderTimelineAdapter,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getTimeline(
    userId: string,
    orderId: string,
    refresh: boolean,
  ): Promise<OrderTimelineDto> {
    const order = await this.prisma.ecommerceOrder.findFirst({
      where: { id: orderId, connection: { store: { userId } } },
      include: {
        connection: { select: { platform: true } },
        events: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }] },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    const platform = order.connection.platform;
    let stale = false;

    // Only Shopify has a real event-history API — fetch live on first load or explicit refresh.
    // YouCan/Lightfunnels events come exclusively from detectAndStoreChanges() during sync.
    // Calling their adapters here would duplicate what sync already stored.
    const isShopify = platform === EcommercePlatform.SHOPIFY;
    const shouldFetch = isShopify && (refresh || order.events.length === 0);

    if (shouldFetch) {
      try {
        await this.refreshFromPlatform(
          userId,
          order.id,
          order.externalOrderId,
          platform,
        );
      } catch (err) {
        if (order.events.length > 0) {
          // Serve cached — platform is temporarily unavailable
          stale = true;
          this.logger.warn(
            `Timeline refresh failed for order ${orderId}, serving cached events: ${String(err)}`,
          );
        } else {
          throw err;
        }
      }
    }

    // Re-read events after potential refresh
    const events = stale
      ? order.events
      : await this.prisma.ecommerceOrderEvent.findMany({
          where: { orderId: order.id },
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        });

    // Backfill synthetic events for YouCan/Lightfunnels orders that have none yet
    if (events.length === 0 && platform !== EcommercePlatform.SHOPIFY) {
      await this.backfillSyntheticEvents(order);
      const backfilled = await this.prisma.ecommerceOrderEvent.findMany({
        where: { orderId: order.id },
        orderBy: { occurredAt: 'desc' },
      });
      return this.buildResponse(order.id, platform, backfilled, stale);
    }

    return this.buildResponse(order.id, platform, events, stale);
  }

  /**
   * One-time backfill: generates synthetic events for ALL existing YouCan/Lightfunnels/
   * MANUAL orders that have no events yet. Safe to call multiple times — idempotent.
   * (MANUAL orders also self-heal lazily on first GET .../timeline via getTimeline()
   * above, since it backfills any platform !== SHOPIFY — this bulk pass just covers
   * them proactively too, so the two paths agree on what's in scope.)
   */
  async backfillAllOrders(): Promise<{ processed: number; skipped: number }> {
    const orders = await this.prisma.ecommerceOrder.findMany({
      where: {
        connection: { platform: { in: ['YOUCAN', 'LIGHTFUNNELS', 'MANUAL'] } },
        events: { none: {} },
      },
      select: {
        id: true,
        financialStatus: true,
        fulfillmentStatus: true,
        status: true,
        providerCreatedAt: true,
        processedAt: true,
        cancelledAt: true,
      },
    });

    let processed = 0;
    let skipped = 0;
    for (const order of orders) {
      try {
        await this.backfillSyntheticEvents(order);
        processed++;
      } catch (err) {
        this.logger.warn(
          `Backfill failed for order ${order.id}: ${String(err)}`,
        );
        skipped++;
      }
    }
    this.logger.log(
      `Timeline backfill complete: ${processed} processed, ${skipped} skipped`,
    );
    return { processed, skipped };
  }

  /**
   * Called during sync (YouCan / Lightfunnels) when an order's status changes.
   * Creates one event per status field that transitioned.
   */
  async detectAndStoreChanges(
    orderId: string,
    previous: {
      financialStatus: EcommercePaymentStatus;
      fulfillmentStatus: string | null;
    },
    current: {
      financialStatus: EcommercePaymentStatus;
      fulfillmentStatus: string | null;
    },
    source: 'YOUCAN' | 'LIGHTFUNNELS',
    occurredAt: Date,
  ): Promise<void> {
    const events: NormalizedOrderEvent[] = [];

    const safeOccurredAt = isValidDate(occurredAt) ? occurredAt : new Date();
    const src = source.toLowerCase();

    if (previous.financialStatus !== current.financialStatus) {
      const type =
        FINANCIAL_STATUS_MAP[current.financialStatus] ?? OrderEventType.OTHER;
      events.push({
        // Stable key: one event per order per financial status (no timestamp — avoids Date.now() non-determinism)
        providerEventId: `${src}-financial-${orderId}-${current.financialStatus}`,
        source,
        type,
        title: financialTitle(type),
        occurredAt: safeOccurredAt,
        synthetic: false,
        rawPayload: {
          previousFinancialStatus: previous.financialStatus,
          currentFinancialStatus: current.financialStatus,
        },
      });
    }

    if (
      previous.fulfillmentStatus !== current.fulfillmentStatus &&
      current.fulfillmentStatus
    ) {
      const prevSlug = (previous.fulfillmentStatus ?? 'none')
        .toLowerCase()
        .replace(/\s+/g, '_');
      const currSlug = current.fulfillmentStatus
        .toLowerCase()
        .replace(/\s+/g, '_');
      const type =
        (source === 'YOUCAN'
          ? YOUCAN_SHIPPING_MAP[currSlug]
          : LIGHTFUNNELS_FULFILLMENT_MAP[currSlug]) ?? OrderEventType.OTHER;

      events.push({
        // Stable key encodes the transition so re-entering the same status creates a new event
        providerEventId: `${src}-fulfillment-${orderId}-${prevSlug}-to-${currSlug}`,
        source,
        type,
        title: fulfillmentTitle(type, currSlug),
        occurredAt: safeOccurredAt,
        synthetic: false,
        rawPayload: {
          previousFulfillmentStatus: previous.fulfillmentStatus,
          currentFulfillmentStatus: current.fulfillmentStatus,
        },
      });
    }

    if (events.length > 0) {
      await this.upsertEvents(orderId, events);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async refreshFromPlatform(
    userId: string,
    orderId: string,
    externalOrderId: string,
    platform: EcommercePlatform,
  ): Promise<void> {
    const adapter = this.adapterFor(platform);
    const events = await adapter.fetchEvents(userId, externalOrderId);
    await this.upsertEvents(orderId, events);
  }

  /**
   * Idempotent writer. Events are immutable once stored.
   * providerEventId is always set by the adapter so the unique constraint always applies.
   */
  async upsertEvents(
    orderId: string,
    events: NormalizedOrderEvent[],
  ): Promise<void> {
    if (events.length === 0) return;

    await this.prisma.$transaction(
      events.map((event) => {
        // Guard against invalid dates coming from platform adapters
        const occurredAt = isValidDate(event.occurredAt)
          ? event.occurredAt
          : new Date();

        return this.prisma.ecommerceOrderEvent.upsert({
          where: {
            orderId_providerEventId: {
              orderId,
              providerEventId: event.providerEventId,
            },
          },
          create: {
            orderId,
            providerEventId: event.providerEventId,
            source: event.source,
            type: event.type,
            title: event.title,
            message: event.message ?? null,
            actor: event.actor ?? null,
            location: event.location ?? null,
            metadata: event.metadata
              ? JSON.parse(JSON.stringify(event.metadata))
              : undefined,
            occurredAt,
            synthetic: event.synthetic,
            rawPayload:
              event.rawPayload !== undefined
                ? JSON.parse(JSON.stringify(event.rawPayload))
                : undefined,
          },
          update: {}, // immutable — never overwrite
        });
      }),
    );
  }

  /**
   * Creates synthetic events from timestamps already stored on the order.
   * Used for YouCan/Lightfunnels orders that have no events yet.
   */
  private async backfillSyntheticEvents(order: {
    id: string;
    financialStatus: EcommercePaymentStatus;
    fulfillmentStatus: string | null;
    status: EcommerceOrderStatus;
    providerCreatedAt: Date;
    processedAt: Date;
    cancelledAt: Date | null;
  }): Promise<void> {
    const events: NormalizedOrderEvent[] = [];

    events.push({
      providerEventId: `system-created-${order.id}`,
      source: 'SYSTEM',
      type: OrderEventType.ORDER_CREATED,
      title: 'Order created',
      occurredAt: order.providerCreatedAt,
      synthetic: true,
    });

    // Only add confirmed if it's a different timestamp
    if (order.processedAt.getTime() !== order.providerCreatedAt.getTime()) {
      events.push({
        providerEventId: `system-confirmed-${order.id}`,
        source: 'SYSTEM',
        type: OrderEventType.ORDER_CONFIRMED,
        title: 'Order confirmed',
        occurredAt: order.processedAt,
        synthetic: true,
      });
    }

    const finType = FINANCIAL_STATUS_MAP[order.financialStatus];
    if (finType && finType !== OrderEventType.ORDER_CREATED) {
      events.push({
        providerEventId: `system-financial-${order.id}-${order.financialStatus}`,
        source: 'SYSTEM',
        type: finType,
        title: financialTitle(finType),
        occurredAt: order.processedAt,
        synthetic: true,
      });
    }

    if (
      order.fulfillmentStatus &&
      order.fulfillmentStatus !== 'unfulfilled' &&
      order.fulfillmentStatus !== 'unknown'
    ) {
      events.push({
        providerEventId: `system-fulfillment-${order.id}-${order.fulfillmentStatus}`,
        source: 'SYSTEM',
        type: OrderEventType.FULFILLMENT_CREATED,
        title: 'Order fulfilled',
        occurredAt: order.processedAt,
        synthetic: true,
      });
    }

    if (order.cancelledAt) {
      events.push({
        providerEventId: `system-cancelled-${order.id}`,
        source: 'SYSTEM',
        type: OrderEventType.ORDER_CANCELLED,
        title: 'Order cancelled',
        occurredAt: order.cancelledAt,
        synthetic: true,
      });
    }

    await this.upsertEvents(order.id, events);
  }

  private adapterFor(platform: EcommercePlatform) {
    switch (platform) {
      case EcommercePlatform.SHOPIFY:
        return this.shopifyAdapter;
      case EcommercePlatform.YOUCAN:
        return this.youCanAdapter;
      case EcommercePlatform.LIGHTFUNNELS:
        return this.lightfunnelsAdapter;
      case EcommercePlatform.MANUAL:
        // getTimeline() only ever calls refreshFromPlatform() when
        // platform === SHOPIFY — manual orders have no external platform to
        // fetch a timeline from in the first place.
        throw new Error(
          'Manual orders have no external platform to fetch a timeline from',
        );
    }
  }

  private buildResponse(
    orderId: string,
    platform: EcommercePlatform,
    events: Array<{
      id: string;
      type: string;
      title: string;
      message: string | null;
      actor: string | null;
      location: string | null;
      occurredAt: Date;
      synthetic: boolean;
      createdAt: Date;
      metadata: unknown;
    }>,
    stale: boolean,
  ): OrderTimelineDto {
    const dataUpdatedAt =
      events.length > 0
        ? events
            .reduce(
              (latest, e) => (e.createdAt > latest ? e.createdAt : latest),
              events[0].createdAt,
            )
            .toISOString()
        : null;

    // Extract tracking info from the most recent fulfillment event that carries it
    const tracking = this.extractTracking(events);

    if (events.length === 0) {
      return {
        orderId,
        platform,
        available: false,
        reason: 'NO_EVENTS',
        currentStatus: null,
        stale,
        dataUpdatedAt: null,
        tracking: null,
        events: [],
      };
    }

    return {
      orderId,
      platform,
      available: true,
      currentStatus: deriveCurrentStatus(events),
      stale,
      dataUpdatedAt,
      tracking,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        message: e.message,
        actor: e.actor,
        location: e.location,
        occurredAt: e.occurredAt.toISOString(),
        synthetic: e.synthetic,
      })),
    };
  }

  private extractTracking(events: Array<{ metadata: unknown }>): {
    carrier: string | null;
    number: string | null;
    url: string | null;
  } | null {
    for (const e of events) {
      if (e.metadata && typeof e.metadata === 'object') {
        const m = e.metadata as Record<string, unknown>;
        if (
          m.carrier !== undefined ||
          m.number !== undefined ||
          m.url !== undefined
        ) {
          return {
            carrier: typeof m.carrier === 'string' ? m.carrier : null,
            number: typeof m.number === 'string' ? m.number : null,
            url: typeof m.url === 'string' ? m.url : null,
          };
        }
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Returns the most advanced lifecycle status present in the event list.
 * Uses a fixed priority list so that a late-arriving ORDER_CREATED notification
 * (e.g. Shopify's "Received new order" event timestamped after payment) never
 * overwrites a PAYMENT_PAID or DELIVERED status.
 */
const STATUS_PRIORITY: string[] = [
  OrderEventType.DELIVERED,
  OrderEventType.RETURN_IN_TRANSIT,
  OrderEventType.RETURNED,
  OrderEventType.RETURN_REQUESTED,
  OrderEventType.OUT_FOR_DELIVERY,
  OrderEventType.DELIVERY_FAILED,
  OrderEventType.IN_TRANSIT,
  OrderEventType.PICKED_UP,
  OrderEventType.LABEL_CREATED,
  OrderEventType.FULFILLMENT_CANCELLED,
  OrderEventType.FULFILLMENT_CREATED,
  OrderEventType.FULFILLMENT_PENDING,
  OrderEventType.ORDER_CANCELLED,
  OrderEventType.PAYMENT_REFUNDED,
  OrderEventType.PAYMENT_VOIDED,
  OrderEventType.PAYMENT_PAID,
  OrderEventType.PAYMENT_PARTIALLY_PAID,
  OrderEventType.PAYMENT_AUTHORIZED,
  OrderEventType.PAYMENT_PENDING,
  OrderEventType.ORDER_CLOSED,
  OrderEventType.ORDER_CONFIRMED,
  OrderEventType.ORDER_CREATED,
  OrderEventType.OTHER,
];

function deriveCurrentStatus(events: Array<{ type: string }>): string | null {
  if (events.length === 0) return null;
  const present = new Set(events.map((e) => e.type));
  return STATUS_PRIORITY.find((s) => present.has(s)) ?? events[0].type;
}

// ---------------------------------------------------------------------------
// Status maps (kept here to avoid a separate file for such small data)
// ---------------------------------------------------------------------------
const FINANCIAL_STATUS_MAP: Partial<
  Record<EcommercePaymentStatus, OrderEventType>
> = {
  [EcommercePaymentStatus.PENDING]: OrderEventType.PAYMENT_PENDING,
  [EcommercePaymentStatus.AUTHORIZED]: OrderEventType.PAYMENT_AUTHORIZED,
  [EcommercePaymentStatus.PARTIALLY_PAID]:
    OrderEventType.PAYMENT_PARTIALLY_PAID,
  [EcommercePaymentStatus.PAID]: OrderEventType.PAYMENT_PAID,
  [EcommercePaymentStatus.PARTIALLY_REFUNDED]: OrderEventType.PAYMENT_REFUNDED,
  [EcommercePaymentStatus.REFUNDED]: OrderEventType.PAYMENT_REFUNDED,
  [EcommercePaymentStatus.VOIDED]: OrderEventType.PAYMENT_VOIDED,
};

const YOUCAN_SHIPPING_MAP: Record<string, OrderEventType> = {
  pending: OrderEventType.FULFILLMENT_PENDING,
  processing: OrderEventType.FULFILLMENT_CREATED,
  shipped: OrderEventType.IN_TRANSIT,
  in_delivery: OrderEventType.OUT_FOR_DELIVERY,
  delivered: OrderEventType.DELIVERED,
  returned: OrderEventType.RETURNED,
  cancelled: OrderEventType.ORDER_CANCELLED,
  canceled: OrderEventType.ORDER_CANCELLED,
};

const LIGHTFUNNELS_FULFILLMENT_MAP: Record<string, OrderEventType> = {
  unfulfilled: OrderEventType.FULFILLMENT_PENDING,
  partial: OrderEventType.FULFILLMENT_CREATED,
  fulfilled: OrderEventType.FULFILLMENT_CREATED,
  restocked: OrderEventType.RETURNED,
};

function fulfillmentTitle(type: OrderEventType, slugFallback: string): string {
  const map: Partial<Record<OrderEventType, string>> = {
    [OrderEventType.FULFILLMENT_PENDING]: 'Awaiting fulfillment',
    [OrderEventType.FULFILLMENT_CREATED]: 'Order fulfilled',
    [OrderEventType.FULFILLMENT_CANCELLED]: 'Fulfillment cancelled',
    [OrderEventType.IN_TRANSIT]: 'In transit',
    [OrderEventType.OUT_FOR_DELIVERY]: 'Out for delivery',
    [OrderEventType.DELIVERED]: 'Delivered',
    [OrderEventType.DELIVERY_FAILED]: 'Delivery failed',
    [OrderEventType.PICKED_UP]: 'Picked up',
    [OrderEventType.RETURNED]: 'Returned',
    [OrderEventType.RETURN_REQUESTED]: 'Return requested',
    [OrderEventType.RETURN_IN_TRANSIT]: 'Return in transit',
  };
  return (
    map[type] ??
    slugFallback.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  );
}

function financialTitle(type: OrderEventType): string {
  const map: Partial<Record<OrderEventType, string>> = {
    [OrderEventType.PAYMENT_PENDING]: 'Payment pending',
    [OrderEventType.PAYMENT_AUTHORIZED]: 'Payment authorized',
    [OrderEventType.PAYMENT_PARTIALLY_PAID]: 'Partial payment received',
    [OrderEventType.PAYMENT_PAID]: 'Payment received',
    [OrderEventType.PAYMENT_REFUNDED]: 'Payment refunded',
    [OrderEventType.PAYMENT_VOIDED]: 'Payment voided',
  };
  return map[type] ?? 'Payment updated';
}
