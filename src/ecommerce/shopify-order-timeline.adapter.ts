import { BadGatewayException, Injectable } from '@nestjs/common';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import { OrderEventType } from './constants/order-event-type';
import type {
  NormalizedOrderEvent,
  OrderTimelineAdapter,
} from './interfaces/order-timeline-adapter.interface';

// ---------------------------------------------------------------------------
// GraphQL query — extends what ZomaalFulfillmentOrder already covers.
// We request both order-level events (lifecycle) and fulfillment-level events
// (shipping milestones, written by whatever carrier plugin the merchant uses).
// ---------------------------------------------------------------------------
const SHOPIFY_ORDER_TIMELINE_QUERY = `#graphql
  query ZomaalOrderTimeline($id: ID!) {
    order(id: $id) {
      id
      events(first: 100, sortKey: CREATED_AT) {
        nodes {
          id
          createdAt
          message
          ... on BasicEvent {
            action
            subjectType
          }
        }
      }
      fulfillments {
        id
        trackingInfo {
          company
          number
          url
        }
        events(first: 100) {
          nodes {
            id
            status
            happenedAt
            message
            city
            country
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Raw response types
// ---------------------------------------------------------------------------
interface RawShopifyBasicEvent {
  id: string;
  createdAt: string;
  message: string | null;
  action?: string;
  subjectType?: string;
}

interface RawShopifyFulfillmentEvent {
  id: string;
  status: string;
  happenedAt: string;
  message: string | null;
  city: string | null;
  country: string | null;
}

interface RawShopifyOrderTimelineResponse {
  order: {
    id: string;
    events: { nodes: RawShopifyBasicEvent[] };
    fulfillments: Array<{
      id: string;
      trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
      events: { nodes: RawShopifyFulfillmentEvent[] };
    }>;
  } | null;
}

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------
const ORDER_ACTION_MAP: Record<string, OrderEventType> = {
  PLACE:     OrderEventType.ORDER_CREATED,
  CONFIRM:   OrderEventType.ORDER_CONFIRMED,
  CLOSE:     OrderEventType.ORDER_CLOSED,
  CANCEL:    OrderEventType.ORDER_CANCELLED,
  REFUND:    OrderEventType.PAYMENT_REFUNDED,
  VOID:      OrderEventType.PAYMENT_VOIDED,
  AUTHORIZE: OrderEventType.PAYMENT_AUTHORIZED,
  CAPTURE:   OrderEventType.PAYMENT_PAID,
  FULFILL:   OrderEventType.FULFILLMENT_CREATED,
};

const FULFILLMENT_STATUS_MAP: Record<string, OrderEventType> = {
  LABEL_PRINTED:        OrderEventType.LABEL_CREATED,
  LABEL_PURCHASED:      OrderEventType.LABEL_CREATED,
  CONFIRMED:            OrderEventType.FULFILLMENT_CREATED,
  READY_FOR_PICKUP:     OrderEventType.PICKED_UP,
  PICKED_UP:            OrderEventType.PICKED_UP,
  IN_TRANSIT:           OrderEventType.IN_TRANSIT,
  OUT_FOR_DELIVERY:     OrderEventType.OUT_FOR_DELIVERY,
  ATTEMPTED_DELIVERY:   OrderEventType.DELIVERY_FAILED,
  DELIVERED:            OrderEventType.DELIVERED,
  FAILURE:              OrderEventType.DELIVERY_FAILED,
};

const FULFILLMENT_STATUS_TITLE: Record<string, string> = {
  LABEL_PRINTED:        'Shipping label printed',
  LABEL_PURCHASED:      'Shipping label created',
  CONFIRMED:            'Fulfillment confirmed',
  READY_FOR_PICKUP:     'Ready for pickup',
  PICKED_UP:            'Picked up',
  IN_TRANSIT:           'In transit',
  OUT_FOR_DELIVERY:     'Out for delivery',
  ATTEMPTED_DELIVERY:   'Delivery attempted',
  DELIVERED:            'Delivered',
  FAILURE:              'Delivery failed',
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
@Injectable()
export class ShopifyOrderTimelineAdapter implements OrderTimelineAdapter {
  constructor(
    private readonly shopifyConnectionService: ShopifyConnectionService,
  ) {}

  async fetchEvents(
    userId: string,
    externalOrderId: string,
  ): Promise<NormalizedOrderEvent[]> {
    const response =
      await this.shopifyConnectionService.graphqlForUser<RawShopifyOrderTimelineResponse>(
        userId,
        SHOPIFY_ORDER_TIMELINE_QUERY,
        { id: externalOrderId },
      );

    if (!response.order) {
      throw new BadGatewayException('Shopify order not found');
    }

    const events: NormalizedOrderEvent[] = [];

    // Order-level lifecycle events
    for (const raw of response.order.events.nodes) {
      const action = raw.action?.toUpperCase() ?? '';
      const cleanTitle = raw.message ? stripHtml(raw.message) : null;

      // Resolve type: action map first, then message heuristics
      let type: OrderEventType = ORDER_ACTION_MAP[action] ?? OrderEventType.OTHER;
      if (type === OrderEventType.OTHER && cleanTitle) {
        type = inferTypeFromMessage(cleanTitle);
      }

      // Skip events with no useful content at all
      if (!cleanTitle) continue;

      events.push({
        providerEventId: `shopify-event-${raw.id}`,
        source:          'SHOPIFY',
        type,
        title:           cleanTitle,
        occurredAt:      new Date(raw.createdAt),
        synthetic:       false,
        rawPayload:      raw,
      });
    }

    // Fulfillment-level shipping events (from any carrier plugin)
    for (const fulfillment of response.order.fulfillments) {
      const carrier = fulfillment.trackingInfo[0]?.company ?? undefined;

      // Capture tracking info on the first event of this fulfillment
      const tracking = fulfillment.trackingInfo[0] ?? null;

      for (const raw of fulfillment.events.nodes) {
        const status = raw.status?.toUpperCase();
        const type = FULFILLMENT_STATUS_MAP[status] ?? OrderEventType.OTHER;

        events.push({
          providerEventId: `shopify-fulfillment-event-${raw.id}`,
          source:          'SHOPIFY',
          type,
          title:           FULFILLMENT_STATUS_TITLE[status] ?? raw.message ?? status,
          message:         raw.message ?? undefined,
          actor:           carrier,
          location:        formatLocation(raw.city, raw.country),
          metadata:        tracking
            ? { carrier: tracking.company, number: tracking.number, url: tracking.url }
            : undefined,
          occurredAt:      new Date(raw.happenedAt),
          synthetic:       false,
          rawPayload:      raw,
        });
      }
    }

    return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }
}

function titleFor(type: OrderEventType): string {
  const titles: Record<string, string> = {
    ORDER_CREATED:       'Order created',
    ORDER_CONFIRMED:     'Order confirmed',
    ORDER_CLOSED:        'Order closed',
    ORDER_CANCELLED:     'Order cancelled',
    PAYMENT_REFUNDED:    'Payment refunded',
    PAYMENT_VOIDED:      'Payment voided',
    PAYMENT_AUTHORIZED:  'Payment authorized',
    PAYMENT_PAID:        'Payment received',
    FULFILLMENT_CREATED: 'Order fulfilled',
  };
  return titles[type] ?? type;
}

/** Strip HTML tags from Shopify event messages (they embed <a> links). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Infer a normalized event type from Shopify CommentEvent message text.
 * CommentEvents carry human-readable descriptions but no machine-readable action code.
 */
function inferTypeFromMessage(msg: string): OrderEventType {
  const m = msg.toLowerCase();
  if (m.includes('new order') || m.includes('created this order') || m.includes('from draft order')) return OrderEventType.ORDER_CREATED;
  if (m.includes('marked') && (m.includes('paid') || m.includes('payment'))) return OrderEventType.PAYMENT_PAID;
  if (m.includes('captured') && m.includes('payment')) return OrderEventType.PAYMENT_PAID;
  if (m.includes('partially paid')) return OrderEventType.PAYMENT_PARTIALLY_PAID;
  if (m.includes('refund')) return OrderEventType.PAYMENT_REFUNDED;
  if (m.includes('void')) return OrderEventType.PAYMENT_VOIDED;
  if (m.includes('authorized')) return OrderEventType.PAYMENT_AUTHORIZED;
  if (m.includes('confirmation') || m.includes('confirmed')) return OrderEventType.ORDER_CONFIRMED;
  if (m.includes('cancelled') || m.includes('canceled')) return OrderEventType.ORDER_CANCELLED;
  if (m.includes('closed')) return OrderEventType.ORDER_CLOSED;
  if (m.includes('fulfill') || m.includes('fulfilled')) return OrderEventType.FULFILLMENT_CREATED;
  if (m.includes('shipped') || m.includes('in transit') || m.includes('in-transit')) return OrderEventType.IN_TRANSIT;
  if (m.includes('out for delivery')) return OrderEventType.OUT_FOR_DELIVERY;
  if (m.includes('delivered')) return OrderEventType.DELIVERED;
  if (m.includes('return')) return OrderEventType.RETURNED;
  return OrderEventType.OTHER;
}

function formatLocation(city: string | null, country: string | null): string | undefined {
  return [city, country].filter(Boolean).join(', ') || undefined;
}
