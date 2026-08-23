import { Injectable } from '@nestjs/common';
import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import { OrderEventType } from './constants/order-event-type';
import type {
  NormalizedOrderEvent,
  OrderTimelineAdapter,
} from './interfaces/order-timeline-adapter.interface';

// YouCan has no event-history API. This adapter reads the current order state
// and returns it as a single normalized event. The timeline service handles
// change detection during sync — each status transition becomes a persisted event.
//
// The adapter is used only when refreshTimeline() is called with ?refresh=true,
// to pick up any status that changed since the last sync.

interface RawYouCanOrder {
  id: number | string;
  status_object?: { slug?: string } | null;
  status_new?: string | null;
  status?: string | null;
  payment_status_new?: string | null;
  payment?: { status_object?: { slug?: string } } | null;
  shipping_status?: string | null;
  shipping?: { status_text?: string } | null;
  updated_at?: string | null;
}

const PAYMENT_STATUS_MAP: Record<string, OrderEventType> = {
  pending:    OrderEventType.PAYMENT_PENDING,
  authorized: OrderEventType.PAYMENT_AUTHORIZED,
  paid:       OrderEventType.PAYMENT_PAID,
  complete:   OrderEventType.PAYMENT_PAID,
  refunded:   OrderEventType.PAYMENT_REFUNDED,
  voided:     OrderEventType.PAYMENT_VOIDED,
};

const SHIPPING_STATUS_MAP: Record<string, OrderEventType> = {
  pending:     OrderEventType.FULFILLMENT_PENDING,
  processing:  OrderEventType.FULFILLMENT_CREATED,
  shipped:     OrderEventType.IN_TRANSIT,
  in_delivery: OrderEventType.OUT_FOR_DELIVERY,
  delivered:   OrderEventType.DELIVERED,
  returned:    OrderEventType.RETURNED,
  cancelled:   OrderEventType.ORDER_CANCELLED,
  canceled:    OrderEventType.ORDER_CANCELLED,
};

@Injectable()
export class YouCanOrderTimelineAdapter implements OrderTimelineAdapter {
  constructor(
    private readonly youCanConnectionService: YouCanConnectionService,
  ) {}

  async fetchEvents(
    userId: string,
    externalOrderId: string,
  ): Promise<NormalizedOrderEvent[]> {
    const response = await this.youCanConnectionService.getJsonForUser<{
      data?: RawYouCanOrder;
    }>(userId, `/orders/${externalOrderId}`, {});

    if (!response.data?.id) {
      return [];
    }

    const data   = response.data;
    const now    = data.updated_at ? new Date(data.updated_at) : new Date();
    const events: NormalizedOrderEvent[] = [];

    const paymentSlug = (
      data.payment?.status_object?.slug ?? data.payment_status_new ?? ''
    ).toLowerCase();

    if (paymentSlug) {
      const type = PAYMENT_STATUS_MAP[paymentSlug] ?? OrderEventType.OTHER;
      events.push({
        providerEventId: `youcan-payment-${String(data.id)}-${paymentSlug}`,
        source:          'YOUCAN',
        type,
        title:           paymentTitle(type),
        occurredAt:      now,
        synthetic:       false,
        rawPayload:      { paymentStatus: paymentSlug },
      });
    }

    const shippingSlug = (
      data.shipping_status ?? data.shipping?.status_text ?? ''
    ).toLowerCase().replace(/\s+/g, '_');

    if (shippingSlug && shippingSlug !== 'unknown') {
      const type = SHIPPING_STATUS_MAP[shippingSlug] ?? OrderEventType.OTHER;
      events.push({
        providerEventId: `youcan-shipping-${String(data.id)}-${shippingSlug}`,
        source:          'YOUCAN',
        type,
        title:           shippingTitle(type, shippingSlug),
        occurredAt:      now,
        synthetic:       false,
        rawPayload:      { shippingStatus: shippingSlug },
      });
    }

    return events;
  }
}

function paymentTitle(type: OrderEventType): string {
  const map: Partial<Record<OrderEventType, string>> = {
    [OrderEventType.PAYMENT_PENDING]:    'Payment pending',
    [OrderEventType.PAYMENT_AUTHORIZED]: 'Payment authorized',
    [OrderEventType.PAYMENT_PAID]:       'Payment received',
    [OrderEventType.PAYMENT_REFUNDED]:   'Payment refunded',
    [OrderEventType.PAYMENT_VOIDED]:     'Payment voided',
  };
  return map[type] ?? 'Payment updated';
}

function shippingTitle(type: OrderEventType, rawSlug: string): string {
  const map: Partial<Record<OrderEventType, string>> = {
    [OrderEventType.FULFILLMENT_PENDING]:  'Awaiting fulfillment',
    [OrderEventType.FULFILLMENT_CREATED]:  'Order fulfillment started',
    [OrderEventType.IN_TRANSIT]:           'In transit',
    [OrderEventType.OUT_FOR_DELIVERY]:     'Out for delivery',
    [OrderEventType.DELIVERED]:            'Delivered',
    [OrderEventType.RETURNED]:             'Returned',
    [OrderEventType.ORDER_CANCELLED]:      'Order cancelled',
  };
  return map[type] ?? rawSlug.replace(/_/g, ' ');
}
