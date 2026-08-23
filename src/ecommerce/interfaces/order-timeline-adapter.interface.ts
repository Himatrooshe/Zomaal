import type { OrderEventType } from '../constants/order-event-type';

export interface NormalizedOrderEvent {
  /** Platform's own stable ID. When absent, the adapter generates a deterministic key. */
  providerEventId: string;
  source:          'SHOPIFY' | 'YOUCAN' | 'LIGHTFUNNELS' | 'SYSTEM';
  type:            OrderEventType;
  title:           string;
  message?:        string;
  actor?:          string;
  location?:       string;
  metadata?:       Record<string, unknown>;
  occurredAt:      Date;
  /** True when reconstructed from stored timestamps — not a real platform event. */
  synthetic:       boolean;
  rawPayload?:     unknown;
}

export interface OrderTimelineAdapter {
  /**
   * Fetch the complete event history for one order from the platform.
   * Implementations must return events sorted oldest-first; the service
   * handles presentation ordering.
   */
  fetchEvents(userId: string, externalOrderId: string): Promise<NormalizedOrderEvent[]>;
}
