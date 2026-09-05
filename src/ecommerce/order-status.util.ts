import { OrderEventType } from './constants/order-event-type';

// Single source of truth for "what is this order's current status", derived
// from its stored OrderEventType events. Used by both
// ecommerce-order-timeline.service.ts (for the Timeline API's currentStatus
// field) and ecommerce-order-financial.service.ts (to decide whether to
// recognize/reverse revenue for orders with no Zomaal dispatch) — kept here,
// not duplicated, so the two can never silently drift apart on what
// "delivered" means for a given order.
export const STATUS_PRIORITY: string[] = [
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

export function deriveCurrentStatus(
  events: Array<{ type: string }>,
): string | null {
  if (events.length === 0) return null;
  const present = new Set(events.map((e) => e.type));
  return STATUS_PRIORITY.find((s) => present.has(s)) ?? events[0].type;
}

// Terminal, non-recoverable outcomes for revenue purposes — mirrors
// TERMINAL_FAILURE_STATUSES (CANCELLED/REFUSED/RETURNED_TO_SELLER) in
// ecommerce-order-financial.service.ts, but expressed in OrderEventType
// vocabulary for orders with no Zomaal courier shipment to read a
// ShippingShipmentStatus from.
export const TERMINAL_FAILURE_EVENT_TYPES = new Set<string>([
  OrderEventType.ORDER_CANCELLED,
  OrderEventType.FULFILLMENT_CANCELLED,
  OrderEventType.DELIVERY_FAILED,
  OrderEventType.RETURNED,
]);

/**
 * deriveCurrentStatus's STATUS_PRIORITY is a fixed severity ranking built
 * for a display badge — it deliberately ignores timestamps so an
 * out-of-order-arriving early event (e.g. a late ORDER_CREATED webhook)
 * never overwrites a later, more-advanced one. That makes DELIVERED
 * outrank RETURNED unconditionally, which is correct for "how far did this
 * order's happy path get" but WRONG for "what is the final financial
 * outcome" — an order that was delivered and later returned needs the
 * reversal, not a repeat of DELIVERED forever.
 *
 * Used instead of deriveCurrentStatus by anything that needs the true
 * chronological outcome — currently ecommerce-order-financial.service.ts's
 * 3rd-party-carrier revenue sync and EcommerceService.resolveScannedCode's
 * PLATFORM_TRACKING branch. Only considers DELIVERED and the terminal-
 * failure types above; among whichever of those are present, picks the one
 * with the latest occurredAt — a genuine RETURNED after DELIVERED wins.
 */
export function deriveTerminalOutcome(
  events: Array<{ type: string; occurredAt: Date }>,
): string | null {
  const relevant = events.filter(
    (e) => e.type === OrderEventType.DELIVERED || TERMINAL_FAILURE_EVENT_TYPES.has(e.type),
  );
  if (relevant.length === 0) return null;
  return relevant.reduce((latest, e) =>
    e.occurredAt > latest.occurredAt ? e : latest,
  ).type;
}
