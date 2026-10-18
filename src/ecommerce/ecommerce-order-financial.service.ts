import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStockService } from './order-stock.service';
import {
  ORDER_LINE_STOCK_INCLUDE,
  orderLineCosts,
  packagingMaterialIds,
  type OrderLineWithStock,
} from './order-stock.util';
import { resolvePackagingUnitCosts } from '../warehouse/packaging-cost.util';
import { OrderEventType } from './constants/order-event-type';
import { refreshCodStatus } from './cod-status.util';
import { WhatsAppTriggerService } from '../whatsapp/whatsapp-trigger.service';
import {
  deriveTerminalOutcome,
  TERMINAL_FAILURE_EVENT_TYPES,
} from './order-status.util';

const TERMINAL_FAILURE_STATUSES = new Set<ShippingShipmentStatus>([
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
]);

// The parcel travelled and came back, so the courier still charges for it.
// A plain cancellation may happen before pickup and costs nothing.
const SHIPPED_FAILURE_STATUSES = new Set<ShippingShipmentStatus>([
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
]);
const SHIPPED_FAILURE_EVENT_TYPES = new Set<string>([
  OrderEventType.DELIVERY_FAILED,
  OrderEventType.RETURNED,
]);

const SHIPMENT_SYNC_SELECT = {
  normalizedStatus: true,
  fee: true,
  recipientPhone: true,
  recipientName: true,
  lastActionAt: true,
  providerUpdatedAt: true,
} as const;

const REVENUE_RECOGNIZED_KEY = 'revenue-recognized';
const REVENUE_REVERSED_KEY = 'revenue-reversed';
const SHIPPING_LOSS_KEY = 'shipping-loss';

type SyncReason =
  | 'NOT_DISPATCHED'
  | 'NO_CARRIER_STATUS_YET'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'CANCELLED';

/**
 * The "carrier status -> revenue/profit" engine. Financial events are an
 * append-only ledger (mirrors the EcommerceOrderEvent/InventoryMovement
 * pattern already used elsewhere in this codebase) — corrections add a new
 * event, nothing is ever overwritten.
 *
 * Triggers: the manual POST .../financials/sync, the four courier services
 * (syncFromDispatchId after they persist a normalizedStatus), and damage
 * recorded during EcommerceService.recordProductCondition. The same
 * DELIVERED / cancelled outcome also drives order stock (OrderStockService).
 */
@Injectable()
export class EcommerceOrderFinancialService {
  private readonly logger = new Logger(EcommerceOrderFinancialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStock: OrderStockService,
    private readonly whatsAppTrigger: WhatsAppTriggerService,
  ) {}

  /** Customer message for the new courier status; never blocks the ledger. */
  private async queueWhatsApp(
    orderId: string,
    shipment: {
      normalizedStatus: ShippingShipmentStatus;
      recipientPhone: string | null;
      recipientName: string | null;
      lastActionAt: Date | null;
      providerUpdatedAt: Date | null;
    },
  ): Promise<void> {
    try {
      await this.whatsAppTrigger.onShipmentStatus({
        orderId,
        status: shipment.normalizedStatus,
        statusChangedAt: shipment.lastActionAt ?? shipment.providerUpdatedAt,
        recipientPhone: shipment.recipientPhone,
        recipientName: shipment.recipientName,
      });
    } catch (err) {
      this.logger.warn(
        `WhatsApp queue failed for order ${orderId}: ${(err as Error).message}`,
      );
    }
  }

  /** Stock follows the same carrier outcome; a failure must not undo the ledger write. */
  private async syncStock(
    orderId: string,
    outcome: 'DELIVERED' | 'CANCELLED',
    deliveredAt?: Date,
  ) {
    try {
      if (outcome === 'DELIVERED') {
        await this.orderStock.deliverOrder(orderId, deliveredAt);
      } else {
        await this.orderStock.releaseOrder(orderId);
      }
    } catch (error) {
      this.logger.error(
        `Order stock sync (${outcome}) failed for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async syncCodStatus(orderId: string) {
    try {
      await refreshCodStatus(this.prisma, orderId);
    } catch (error) {
      this.logger.error(
        `COD status sync failed for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getSummary(userId: string, orderId: string) {
    const order = await this.prisma.ecommerceOrder.findFirst({
      where: { id: orderId, connection: { store: { userId } } },
      select: { id: true, currency: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const events = await this.prisma.ecommerceOrderFinancialEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });

    let revenue = new Prisma.Decimal(0);
    let productCost = new Prisma.Decimal(0);
    let shippingCost = new Prisma.Decimal(0);
    let damageCost = new Prisma.Decimal(0);
    let giftCost = new Prisma.Decimal(0);
    let packagingCost = new Prisma.Decimal(0);
    let netProfit = new Prisma.Decimal(0);

    for (const event of events) {
      netProfit = netProfit.plus(event.netProfitImpact);
      if (event.type === 'REVENUE_RECOGNIZED') {
        revenue = revenue.plus(event.revenue);
        productCost = productCost.plus(event.productCost);
        shippingCost = shippingCost.plus(event.shippingCost);
        giftCost = giftCost.plus(event.giftCost);
        packagingCost = packagingCost.plus(event.packagingCost);
      } else if (event.type === 'REVENUE_REVERSED') {
        revenue = revenue.minus(event.revenue);
        productCost = productCost.minus(event.productCost);
        shippingCost = shippingCost.minus(event.shippingCost);
      } else if (event.type === 'DAMAGE_LOSS') {
        damageCost = damageCost.plus(event.damageCost);
      } else if (event.type === 'SHIPPING_LOSS') {
        shippingCost = shippingCost.plus(event.shippingCost);
      }
    }

    return {
      orderId: order.id,
      currency: order.currency,
      revenue: revenue.toFixed(2),
      productCost: productCost.toFixed(2),
      shippingCost: shippingCost.toFixed(2),
      damageCost: damageCost.toFixed(2),
      giftCost: giftCost.toFixed(2),
      packagingCost: packagingCost.toFixed(2),
      netProfit: netProfit.toFixed(2),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        revenue: event.revenue.toFixed(2),
        productCost: event.productCost.toFixed(2),
        shippingCost: event.shippingCost.toFixed(2),
        damageCost: event.damageCost.toFixed(2),
        giftCost: event.giftCost.toFixed(2),
        packagingCost: event.packagingCost.toFixed(2),
        netProfitImpact: event.netProfitImpact.toFixed(2),
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /**
   * User-facing entry point (the controller's manual "refresh" trigger):
   * resolves orderId -> dispatchId scoped to the caller's store, then
   * delegates to syncFromDispatchId — the same engine the courier
   * sync/webhook hooks call directly by dispatchId.
   */
  async syncFromDispatch(userId: string, orderId: string) {
    const order = await this.prisma.ecommerceOrder.findFirst({
      where: { id: orderId, connection: { store: { userId } } },
      select: { id: true, dispatch: { select: { id: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!order.dispatch) {
      // No Zomaal courier dispatch — most likely fulfilled via a 3rd-party
      // shipping plugin on Shopify/YouCan/Lightfunnels (any carrier: FedEx,
      // DHL, local couriers). Fall back to the order's Timeline data
      // instead of leaving revenue stuck at 0 forever.
      return this.syncFromTimelineEvents(order.id);
    }
    return this.syncFromDispatchId(order.dispatch.id);
  }

  /**
   * Called whenever an order's timeline gains events. Dispatched orders are
   * already driven by the courier services, so only undispatched orders
   * (platform plugin or manual shipping) are evaluated here.
   */
  async syncUndispatchedOrder(orderId: string): Promise<void> {
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId },
      select: { dispatch: { select: { id: true } } },
    });
    if (!order || order.dispatch) return;
    await this.syncFromTimelineEvents(orderId);
  }

  /**
   * Fallback revenue-recognition path for orders with no Zomaal dispatch.
   * Reads whichever OrderEventType events are already stored for this order
   * (populated by the Order Timeline feature — see
   * ecommerce-order-timeline.service.ts) and applies the exact same
   * revenue/reversal math as the dispatch-based path via
   * applyRevenueRecognition/applyRevenueReversal below, with one honest
   * substitution: we have no visibility into what a 3rd-party carrier
   * actually charged the merchant, so shippingCost falls back to
   * order.shipping (what the CUSTOMER was charged for shipping) exactly the
   * same way applyRevenueRecognition already falls back when shipmentFee is
   * null — this is a proxy, not necessarily the merchant's real cost, and
   * is documented as such on OrderFinancialSummaryDto.shippingCost.
   *
   * Runs from POST .../financials/sync and automatically whenever the
   * timeline stores events (syncUndispatchedOrder).
   */
  private async syncFromTimelineEvents(orderId: string) {
    const events = await this.prisma.ecommerceOrderEvent.findMany({
      where: { orderId },
      select: { type: true, occurredAt: true },
    });
    if (events.length === 0) {
      return { applied: false, reason: 'NOT_DISPATCHED' as SyncReason };
    }

    // deriveTerminalOutcome, not deriveCurrentStatus — the latter's
    // severity-ranked priority list puts DELIVERED ahead of RETURNED
    // unconditionally, which would leave a delivered-then-returned order's
    // revenue permanently recognized and never reversed. This picks
    // whichever of DELIVERED/terminal-failure actually happened last.
    const currentStatus = deriveTerminalOutcome(events);

    if (currentStatus === OrderEventType.DELIVERED) {
      const order = await this.prisma.ecommerceOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          id: true,
          currency: true,
          totalCollected: true,
          shipping: true,
          lines: { include: ORDER_LINE_STOCK_INCLUDE },
        },
      });
      const event = await this.applyRevenueRecognition(order, null);
      const deliveredAt = events
        .filter((e) => e.type === OrderEventType.DELIVERED)
        .reduce(
          (latest, e) => (e.occurredAt > latest ? e.occurredAt : latest),
          new Date(0),
        );
      await this.syncStock(order.id, 'DELIVERED', deliveredAt);
      return {
        applied: event !== null,
        reason: 'DELIVERED' as SyncReason,
        shipmentStatus: currentStatus ?? undefined,
      };
    }

    if (currentStatus && TERMINAL_FAILURE_EVENT_TYPES.has(currentStatus)) {
      const order = await this.prisma.ecommerceOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, currency: true, shipping: true },
      });
      const event = await this.applyRevenueReversal(order.id, order.currency);
      if (SHIPPED_FAILURE_EVENT_TYPES.has(currentStatus)) {
        await this.applyShippingLoss(order.id, order.currency, order.shipping);
      }
      await this.syncStock(order.id, 'CANCELLED');
      return {
        applied: event !== null,
        reason: 'CANCELLED' as SyncReason,
        shipmentStatus: currentStatus ?? undefined,
      };
    }

    return {
      applied: false,
      reason: 'IN_PROGRESS' as SyncReason,
      shipmentStatus: currentStatus ?? undefined,
    };
  }

  /**
   * Core engine, keyed by dispatchId (no userId needed — a dispatch already
   * implies its store). This is what courier sync/webhook handlers call
   * directly right after persisting a shipment's normalizedStatus: reads
   * whichever courier shipment is linked and applies the matching financial
   * event. Idempotent — safe to call repeatedly without double counting.
   * Never throws for "nothing to do yet" states — those are expected, not
   * errors — only NOT_DISPATCHED/NO_CARRIER_STATUS_YET/IN_PROGRESS can occur
   * here since dispatchId is presumed to already exist.
   */
  /**
   * The real courier fee if dispatched via one of Zomaal's own couriers,
   * else the amount charged to the customer for shipping (order.shipping)
   * as a proxy — same fallback rule syncFromDispatchId/
   * applyRevenueRecognition use internally. Public so other features
   * needing "what did shipping actually cost this order" (currently
   * ReturnRequestService's Loss Summary preview) read the exact same
   * number the financial ledger does, rather than re-implementing the
   * courier-fee fallback chain a second time.
   */
  async resolveEffectiveShippingCost(orderId: string): Promise<Prisma.Decimal> {
    const order = await this.prisma.ecommerceOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        shipping: true,
        dispatch: {
          select: {
            senditShipment: { select: { fee: true } },
            quickLivraisonShipment: { select: { fee: true } },
            forceLogShipment: { select: { fee: true } },
            ozoneExpressShipment: { select: { fee: true } },
          },
        },
      },
    });
    const fee = pickShipmentFee(order.dispatch);
    return fee ?? order.shipping;
  }

  async syncFromDispatchId(dispatchId: string) {
    const dispatch = await this.prisma.ecommerceOrderDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        order: {
          include: { lines: { include: ORDER_LINE_STOCK_INCLUDE } },
        },
        senditShipment: { select: SHIPMENT_SYNC_SELECT },
        quickLivraisonShipment: { select: SHIPMENT_SYNC_SELECT },
        forceLogShipment: { select: SHIPMENT_SYNC_SELECT },
        ozoneExpressShipment: { select: SHIPMENT_SYNC_SELECT },
      },
    });
    if (!dispatch) {
      return { applied: false, reason: 'NOT_DISPATCHED' as SyncReason };
    }

    const shipment = pickCourierShipment(dispatch);
    if (!shipment) {
      return { applied: false, reason: 'NO_CARRIER_STATUS_YET' as SyncReason };
    }
    await this.syncCodStatus(dispatch.order.id);
    await this.queueWhatsApp(dispatch.order.id, shipment);

    if (shipment.normalizedStatus === ShippingShipmentStatus.DELIVERED) {
      const event = await this.applyRevenueRecognition(
        dispatch.order,
        shipment.fee,
      );
      await this.syncStock(dispatch.order.id, 'DELIVERED');
      return {
        applied: event !== null,
        reason: 'DELIVERED' as SyncReason,
        shipmentStatus: shipment.normalizedStatus,
      };
    }
    if (TERMINAL_FAILURE_STATUSES.has(shipment.normalizedStatus)) {
      const event = await this.applyRevenueReversal(
        dispatch.order.id,
        dispatch.order.currency,
      );
      if (SHIPPED_FAILURE_STATUSES.has(shipment.normalizedStatus)) {
        await this.applyShippingLoss(
          dispatch.order.id,
          dispatch.order.currency,
          shipment.fee ?? dispatch.order.shipping,
        );
      }
      await this.syncStock(dispatch.order.id, 'CANCELLED');
      return {
        applied: event !== null,
        reason: 'CANCELLED' as SyncReason,
        shipmentStatus: shipment.normalizedStatus,
      };
    }
    return {
      applied: false,
      reason: 'IN_PROGRESS' as SyncReason,
      shipmentStatus: shipment.normalizedStatus,
    };
  }

  /**
   * Called by EcommerceService.recordProductCondition() when a line is
   * marked DAMAGED with a cost. Immutable once stored: re-recording the same
   * line with the same condition is a no-op (upsert keyed on lineId).
   */
  /**
   * Brings the booked loss for one order line to `targetLoss`. Events stay
   * immutable: only the difference from what is already booked is appended,
   * so a correction (e.g. Lost → Good) undoes the earlier loss instead of
   * stacking a second one, and an exact repeat writes nothing.
   */
  async setLineLoss(
    orderId: string,
    lineId: string,
    currency: string,
    targetLoss: Prisma.Decimal,
    reason: string,
    recordedAt: Date,
  ) {
    const lineKey = `damage-loss:${lineId}`;
    const booked = await this.prisma.ecommerceOrderFinancialEvent.aggregate({
      where: {
        orderId,
        type: 'DAMAGE_LOSS',
        OR: [
          { idempotencyKey: lineKey },
          { idempotencyKey: { startsWith: `${lineKey}:` } },
        ],
      },
      _sum: { damageCost: true },
    });
    const delta = targetLoss.minus(
      booked._sum.damageCost ?? new Prisma.Decimal(0),
    );
    if (delta.isZero()) return null;

    const idempotencyKey = booked._sum.damageCost
      ? `${lineKey}:${recordedAt.getTime()}`
      : lineKey;
    return this.prisma.ecommerceOrderFinancialEvent.upsert({
      where: {
        orderId_idempotencyKey: { orderId, idempotencyKey },
      },
      create: {
        orderId,
        type: 'DAMAGE_LOSS',
        revenue: new Prisma.Decimal(0),
        productCost: new Prisma.Decimal(0),
        shippingCost: new Prisma.Decimal(0),
        damageCost: delta,
        netProfitImpact: delta.negated(),
        currency,
        reason,
        idempotencyKey,
      },
      update: {}, // events are immutable once stored — never overwrite
    });
  }

  private async applyRevenueRecognition(
    order: {
      id: string;
      currency: string;
      totalCollected: Prisma.Decimal;
      shipping: Prisma.Decimal;
      lines: OrderLineWithStock[];
    },
    shipmentFee: Prisma.Decimal | null,
  ) {
    const existing = await this.prisma.ecommerceOrderFinancialEvent.findUnique({
      where: {
        orderId_idempotencyKey: {
          orderId: order.id,
          idempotencyKey: REVENUE_RECOGNIZED_KEY,
        },
      },
    });
    if (existing) {
      return existing;
    }

    // COGS from lines matched to a warehouse product: product, gift and
    // packaging. Unmatched lines contribute 0 — profit is understated, not
    // overstated, when the catalog link is missing.
    const packagingUnitCosts = await resolvePackagingUnitCosts(
      this.prisma,
      packagingMaterialIds(order.lines),
    );
    const zero = new Prisma.Decimal(0);
    const costs = order.lines
      .map((line) => orderLineCosts(line, packagingUnitCosts))
      .reduce(
        (total, line) => ({
          productCost: total.productCost.plus(line.productCost),
          giftCost: total.giftCost.plus(line.giftCost),
          packagingCost: total.packagingCost.plus(line.packagingCost),
        }),
        { productCost: zero, giftCost: zero, packagingCost: zero },
      );
    // Prefer the actual courier fee (merchant's real cost) over the shipping
    // amount charged to the customer, when known. Already booked as a
    // shipping loss (courier reported a failure first) → not charged twice.
    const shippingLoss =
      await this.prisma.ecommerceOrderFinancialEvent.findUnique({
        where: {
          orderId_idempotencyKey: {
            orderId: order.id,
            idempotencyKey: SHIPPING_LOSS_KEY,
          },
        },
        select: { id: true },
      });
    const shippingCost = shippingLoss
      ? new Prisma.Decimal(0)
      : (shipmentFee ?? order.shipping);
    const revenue = order.totalCollected;
    const netProfitImpact = revenue
      .minus(costs.productCost)
      .minus(shippingCost)
      .minus(costs.giftCost)
      .minus(costs.packagingCost);

    return this.prisma.ecommerceOrderFinancialEvent.create({
      data: {
        orderId: order.id,
        type: 'REVENUE_RECOGNIZED',
        revenue,
        productCost: costs.productCost,
        shippingCost,
        damageCost: zero,
        giftCost: costs.giftCost,
        packagingCost: costs.packagingCost,
        netProfitImpact,
        currency: order.currency,
        reason: 'Carrier marked shipment as delivered',
        idempotencyKey: REVENUE_RECOGNIZED_KEY,
      },
    });
  }

  private async applyRevenueReversal(orderId: string, currency: string) {
    const existing = await this.prisma.ecommerceOrderFinancialEvent.findUnique({
      where: {
        orderId_idempotencyKey: {
          orderId,
          idempotencyKey: REVENUE_REVERSED_KEY,
        },
      },
    });
    if (existing) {
      return existing;
    }

    const recognized =
      await this.prisma.ecommerceOrderFinancialEvent.findUnique({
        where: {
          orderId_idempotencyKey: {
            orderId,
            idempotencyKey: REVENUE_RECOGNIZED_KEY,
          },
        },
      });
    // Never recognized -> nothing to reverse. A cancellation before delivery
    // never had a financial impact, so no event is needed.
    if (!recognized) {
      return null;
    }

    // Shipping was paid to the courier and gift / packaging were consumed,
    // so those costs stay; revenue and product cost are undone.
    return this.prisma.ecommerceOrderFinancialEvent.create({
      data: {
        orderId,
        type: 'REVENUE_REVERSED',
        revenue: recognized.revenue,
        productCost: recognized.productCost,
        shippingCost: new Prisma.Decimal(0),
        damageCost: new Prisma.Decimal(0),
        netProfitImpact: recognized.netProfitImpact
          .plus(recognized.shippingCost)
          .plus(recognized.giftCost)
          .plus(recognized.packagingCost)
          .negated(),
        currency,
        reason:
          'Carrier marked shipment as cancelled/refused/returned after being delivered',
        idempotencyKey: REVENUE_REVERSED_KEY,
      },
    });
  }

  /**
   * A refused or returned parcel that was never delivered still cost its
   * shipping. Delivered-then-returned orders already carry the shipping
   * cost in their recognition event, which the reversal keeps.
   */
  private async applyShippingLoss(
    orderId: string,
    currency: string,
    shippingCost: Prisma.Decimal,
  ) {
    if (shippingCost.lte(0)) return null;
    const recognized =
      await this.prisma.ecommerceOrderFinancialEvent.findUnique({
        where: {
          orderId_idempotencyKey: {
            orderId,
            idempotencyKey: REVENUE_RECOGNIZED_KEY,
          },
        },
        select: { id: true },
      });
    if (recognized) return null;
    const zero = new Prisma.Decimal(0);
    return this.prisma.ecommerceOrderFinancialEvent.upsert({
      where: {
        orderId_idempotencyKey: { orderId, idempotencyKey: SHIPPING_LOSS_KEY },
      },
      create: {
        orderId,
        type: 'SHIPPING_LOSS',
        revenue: zero,
        productCost: zero,
        shippingCost,
        damageCost: zero,
        netProfitImpact: shippingCost.negated(),
        currency,
        reason:
          'Parcel refused or returned before delivery; shipping still paid',
        idempotencyKey: SHIPPING_LOSS_KEY,
      },
      update: {}, // events are immutable once stored — never overwrite
    });
  }
}

// The single "which courier actually shipped this" rule, shared by
// syncFromDispatchId (needs the shipment's normalizedStatus too) and
// resolveEffectiveShippingCost (only needs the fee) — never duplicated.
type CourierShipmentFields<T> = {
  senditShipment: T | null;
  quickLivraisonShipment: T | null;
  forceLogShipment: T | null;
  ozoneExpressShipment: T | null;
};

function pickCourierShipment<T>(dispatch: CourierShipmentFields<T>): T | null {
  return (
    dispatch.senditShipment ??
    dispatch.quickLivraisonShipment ??
    dispatch.forceLogShipment ??
    dispatch.ozoneExpressShipment ??
    null
  );
}

function pickShipmentFee(
  dispatch: CourierShipmentFields<{ fee: Prisma.Decimal | null }> | null,
): Prisma.Decimal | null {
  if (!dispatch) return null;
  return pickCourierShipment(dispatch)?.fee ?? null;
}
