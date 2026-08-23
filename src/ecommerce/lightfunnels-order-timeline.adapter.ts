import { Injectable } from '@nestjs/common';
import { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import { OrderEventType } from './constants/order-event-type';
import type {
  NormalizedOrderEvent,
  OrderTimelineAdapter,
} from './interfaces/order-timeline-adapter.interface';

// Lightfunnels has no event-history API. Same strategy as YouCan:
// read the current order state and return it as normalized events.
// Change detection during sync builds the real timeline over time.

const LIGHTFUNNELS_CURRENT_ORDER_QUERY = `
  query ZomaalLightfunnelsOrderTimeline($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          financial_status
          fulfillment_status
          updated_at
        }
      }
    }
  }
`;

interface RawLightfunnelsTimelineResponse {
  orders?: {
    edges?: Array<{
      node?: {
        id: string;
        financial_status: string | null;
        fulfillment_status: string | null;
        updated_at: string | null;
      };
    }>;
  };
}

const FINANCIAL_STATUS_MAP: Record<string, OrderEventType> = {
  pending:    OrderEventType.PAYMENT_PENDING,
  authorized: OrderEventType.PAYMENT_AUTHORIZED,
  paid:       OrderEventType.PAYMENT_PAID,
  complete:   OrderEventType.PAYMENT_PAID,
  refunded:   OrderEventType.PAYMENT_REFUNDED,
  voided:     OrderEventType.PAYMENT_VOIDED,
};

const FULFILLMENT_STATUS_MAP: Record<string, OrderEventType> = {
  unfulfilled: OrderEventType.FULFILLMENT_PENDING,
  partial:     OrderEventType.FULFILLMENT_CREATED,
  fulfilled:   OrderEventType.FULFILLMENT_CREATED,
  restocked:   OrderEventType.RETURNED,
};

@Injectable()
export class LightfunnelsOrderTimelineAdapter implements OrderTimelineAdapter {
  constructor(
    private readonly lightfunnelsConnectionService: LightfunnelsConnectionService,
  ) {}

  async fetchEvents(
    userId: string,
    externalOrderId: string,
  ): Promise<NormalizedOrderEvent[]> {
    const data =
      await this.lightfunnelsConnectionService.graphqlForUser<RawLightfunnelsTimelineResponse>(
        userId,
        LIGHTFUNNELS_CURRENT_ORDER_QUERY,
        { query: `id:${externalOrderId}` },
        'orders',
      );

    const order = data?.orders?.edges?.[0]?.node;
    if (!order) return [];

    const now      = order.updated_at ? new Date(order.updated_at) : new Date();
    const events: NormalizedOrderEvent[] = [];

    const financialRaw = (order.financial_status ?? '').toLowerCase();
    if (financialRaw) {
      const type = FINANCIAL_STATUS_MAP[financialRaw] ?? OrderEventType.OTHER;
      events.push({
        providerEventId: `lightfunnels-financial-${order.id}-${financialRaw}`,
        source:          'LIGHTFUNNELS',
        type,
        title:           financialTitle(type),
        occurredAt:      now,
        synthetic:       false,
        rawPayload:      { financialStatus: financialRaw },
      });
    }

    const fulfillmentRaw = (order.fulfillment_status ?? '').toLowerCase();
    if (fulfillmentRaw) {
      const type = FULFILLMENT_STATUS_MAP[fulfillmentRaw] ?? OrderEventType.OTHER;
      events.push({
        providerEventId: `lightfunnels-fulfillment-${order.id}-${fulfillmentRaw}`,
        source:          'LIGHTFUNNELS',
        type,
        title:           fulfillmentTitle(type, fulfillmentRaw),
        occurredAt:      now,
        synthetic:       false,
        rawPayload:      { fulfillmentStatus: fulfillmentRaw },
      });
    }

    return events;
  }
}

function financialTitle(type: OrderEventType): string {
  const map: Partial<Record<OrderEventType, string>> = {
    [OrderEventType.PAYMENT_PENDING]:    'Payment pending',
    [OrderEventType.PAYMENT_AUTHORIZED]: 'Payment authorized',
    [OrderEventType.PAYMENT_PAID]:       'Payment received',
    [OrderEventType.PAYMENT_REFUNDED]:   'Payment refunded',
    [OrderEventType.PAYMENT_VOIDED]:     'Payment voided',
  };
  return map[type] ?? 'Payment updated';
}

function fulfillmentTitle(type: OrderEventType, raw: string): string {
  const map: Partial<Record<OrderEventType, string>> = {
    [OrderEventType.FULFILLMENT_PENDING]:  'Awaiting fulfillment',
    [OrderEventType.FULFILLMENT_CREATED]:  'Order fulfilled',
    [OrderEventType.RETURNED]:             'Items returned to stock',
  };
  return map[type] ?? raw;
}
