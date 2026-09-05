import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderEventType } from './constants/order-event-type';
import {
  deriveTerminalOutcome,
  TERMINAL_FAILURE_EVENT_TYPES,
} from './order-status.util';

const TERMINAL_FAILURE_STATUSES = new Set<ShippingShipmentStatus>([
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
]);

const REVENUE_RECOGNIZED_KEY = 'revenue-recognized';
const REVENUE_REVERSED_KEY = 'revenue-reversed';

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
 * NOTE on scope: this exposes the calculation engine plus one manual trigger
 * (syncFromDispatch, callable via POST .../financials/sync) and one automatic
 * trigger already owned by this codebase (damage recorded during
 * EcommerceService.recordProductCondition). It does NOT auto-fire from the
 * 4 courier sync/webhook write paths (Sendit/QuickLivraison/ForceLog/
 * OzoneExpress each persist normalizedStatus independently, and Sendit/
 * QuickLivraison webhooks currently only store payloads in memory per
 * CLAUDE.md's documented bug) — wiring those in is a separate, larger,
 * per-courier change deliberately left out of this pass.
 */
@Injectable()
export class EcommerceOrderFinancialService {
  constructor(private readonly prisma: PrismaService) {}

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
    let netProfit = new Prisma.Decimal(0);

    for (const event of events) {
      netProfit = netProfit.plus(event.netProfitImpact);
      if (event.type === 'REVENUE_RECOGNIZED') {
        revenue = revenue.plus(event.revenue);
        productCost = productCost.plus(event.productCost);
        shippingCost = shippingCost.plus(event.shippingCost);
      } else if (event.type === 'REVENUE_REVERSED') {
        revenue = revenue.minus(event.revenue);
        productCost = productCost.minus(event.productCost);
        shippingCost = shippingCost.minus(event.shippingCost);
      } else if (event.type === 'DAMAGE_LOSS') {
        damageCost = damageCost.plus(event.damageCost);
      }
    }

    return {
      orderId: order.id,
      currency: order.currency,
      revenue: revenue.toFixed(2),
      productCost: productCost.toFixed(2),
      shippingCost: shippingCost.toFixed(2),
      damageCost: damageCost.toFixed(2),
      netProfit: netProfit.toFixed(2),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        revenue: event.revenue.toFixed(2),
        productCost: event.productCost.toFixed(2),
        shippingCost: event.shippingCost.toFixed(2),
        damageCost: event.damageCost.toFixed(2),
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
   * Does not fire automatically on its own — call it (or poll
   * POST .../financials/sync, which now reaches here for undispatched
   * orders) after the order's Timeline has been refreshed. Wiring this to
   * fire automatically whenever the Timeline discovers a new terminal
   * status is a natural next step, deliberately left out of this pass to
   * keep it scoped to "make the existing sync endpoint actually work for
   * these orders" rather than also changing when it runs.
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
          lines: {
            select: {
              quantity: true,
              warehouseVariant: { select: { costPrice: true } },
            },
          },
        },
      });
      const event = await this.applyRevenueRecognition(order, null);
      return {
        applied: event !== null,
        reason: 'DELIVERED' as SyncReason,
        shipmentStatus: currentStatus ?? undefined,
      };
    }

    if (currentStatus && TERMINAL_FAILURE_EVENT_TYPES.has(currentStatus)) {
      const order = await this.prisma.ecommerceOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, currency: true },
      });
      const event = await this.applyRevenueReversal(order.id, order.currency);
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
          include: {
            lines: {
              include: { warehouseVariant: { select: { costPrice: true } } },
            },
          },
        },
        senditShipment: { select: { normalizedStatus: true, fee: true } },
        quickLivraisonShipment: {
          select: { normalizedStatus: true, fee: true },
        },
        forceLogShipment: { select: { normalizedStatus: true, fee: true } },
        ozoneExpressShipment: {
          select: { normalizedStatus: true, fee: true },
        },
      },
    });
    if (!dispatch) {
      return { applied: false, reason: 'NOT_DISPATCHED' as SyncReason };
    }

    const shipment = pickCourierShipment(dispatch);
    if (!shipment) {
      return { applied: false, reason: 'NO_CARRIER_STATUS_YET' as SyncReason };
    }

    if (shipment.normalizedStatus === ShippingShipmentStatus.DELIVERED) {
      const event = await this.applyRevenueRecognition(
        dispatch.order,
        shipment.fee,
      );
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
  async applyDamageLoss(
    orderId: string,
    lineId: string,
    currency: string,
    damageCost: Prisma.Decimal,
    correctionSuffix?: number,
    reason: string = 'Product returned damaged',
  ) {
    // A plain re-record (same condition, same cost) reuses the stable key —
    // idempotent, no-op on repeat. A genuine correction (condition or cost
    // changed) gets a timestamp-suffixed key instead, so the corrected
    // amount lands as its own event rather than being silently dropped by
    // the immutable upsert below.
    const idempotencyKey = correctionSuffix
      ? `damage-loss:${lineId}:${correctionSuffix}`
      : `damage-loss:${lineId}`;
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
        damageCost,
        netProfitImpact: damageCost.negated(),
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
      lines: {
        quantity: number;
        warehouseVariant: { costPrice: Prisma.Decimal } | null;
      }[];
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

    // COGS from lines matched to a warehouse product; unmatched lines
    // contribute 0 — profit is understated, not overstated, when the catalog
    // link is missing.
    const productCost = order.lines.reduce(
      (sum, line) =>
        line.warehouseVariant
          ? sum.plus(line.warehouseVariant.costPrice.times(line.quantity))
          : sum,
      new Prisma.Decimal(0),
    );
    // Prefer the actual courier fee (merchant's real cost) over the shipping
    // amount charged to the customer, when known.
    const shippingCost = shipmentFee ?? order.shipping;
    const revenue = order.totalCollected;
    const netProfitImpact = revenue.minus(productCost).minus(shippingCost);

    return this.prisma.ecommerceOrderFinancialEvent.create({
      data: {
        orderId: order.id,
        type: 'REVENUE_RECOGNIZED',
        revenue,
        productCost,
        shippingCost,
        damageCost: new Prisma.Decimal(0),
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

    return this.prisma.ecommerceOrderFinancialEvent.create({
      data: {
        orderId,
        type: 'REVENUE_REVERSED',
        revenue: recognized.revenue,
        productCost: recognized.productCost,
        shippingCost: recognized.shippingCost,
        damageCost: new Prisma.Decimal(0),
        netProfitImpact: recognized.netProfitImpact.negated(),
        currency,
        reason:
          'Carrier marked shipment as cancelled/refused/returned after being delivered',
        idempotencyKey: REVENUE_REVERSED_KEY,
      },
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

function pickCourierShipment<T>(
  dispatch: CourierShipmentFields<T>,
): T | null {
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
