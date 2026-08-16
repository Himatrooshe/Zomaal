import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  Prisma,
} from '@prisma/client';
import { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import type {
  EcommerceOrderPage,
  EcommerceRevenueAdapter,
  NormalizedEcommerceOrder,
} from './interfaces/ecommerce-revenue-adapter.interface';

const PAGE_SIZE = 25;
const ORDERS_QUERY = `
  query ZomaalLightfunnelsOrders(
    $first: Int!
    $after: String
    $query: String!
  ) {
    orders(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          name
          created_at
          updated_at
          cancelled_at
          financial_status
          fulfillment_status
          discount_value
          subtotal
          shipping
          total
          refunded_amount
          net_payment
          currency
          test
          shipping_address { city }
          items {
            __typename
            ... on VariantSnapshot {
              id
              variant_id
              title
              sku
              price
            }
            ... on OrderBumpSnapshot {
              id
              product_id
              title
              sku
              price
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface OrdersQueryData {
  orders?: unknown;
  pagination?: unknown;
}

@Injectable()
export class LightfunnelsRevenueAdapter implements EcommerceRevenueAdapter {
  constructor(
    private readonly connectionService: LightfunnelsConnectionService,
  ) {}

  async fetchOrdersPage(
    userId: string,
    cursor: string | null,
    updatedSince?: Date | null,
    updatedThrough?: Date,
  ): Promise<EcommerceOrderPage> {
    void updatedSince;
    void updatedThrough;
    const data = await this.connectionService.graphqlForUser<OrdersQueryData>(
      userId,
      ORDERS_QUERY,
      {
        first: PAGE_SIZE,
        after: cursor,
        query: 'order_by:id order_dir:asc',
      },
      'orders',
    );
    const connection = asRecord(data.orders ?? data.pagination, 'orders');
    const edges = asArray(connection.edges, 'orders.edges');
    const pageInfo = asRecord(connection.pageInfo, 'orders.pageInfo');
    const hasNextPage = asBoolean(
      pageInfo.hasNextPage,
      'orders.pageInfo.hasNextPage',
    );
    const endCursor = optionalString(pageInfo.endCursor);
    if (hasNextPage && !endCursor) {
      throw new BadGatewayException(
        'Lightfunnels pagination did not include an end cursor',
      );
    }

    const orders: NormalizedEcommerceOrder[] = [];
    for (const edgeValue of edges) {
      const edge = asRecord(edgeValue, 'orders.edge');
      const order = asRecord(edge.node, 'orders.edge.node');
      if (order.test === true) {
        continue;
      }
      orders.push(normalizeOrder(order));
    }
    return {
      orders,
      hasNextPage,
      endCursor: hasNextPage ? endCursor : null,
    };
  }
}

function normalizeOrder(
  order: Record<string, unknown>,
): NormalizedEcommerceOrder {
  const externalOrderId = requiredString(order.id, 'order.id');
  const currency = requiredString(
    order.currency,
    'order.currency',
  ).toUpperCase();
  const grossSales = decimal(order.subtotal, 'order.subtotal');
  const discounts = decimal(order.discount_value, 'order.discount_value');
  const refunds = decimal(order.refunded_amount, 'order.refunded_amount');
  const shipping = decimal(order.shipping, 'order.shipping');
  const total = decimal(order.total, 'order.total');
  const netSales = Prisma.Decimal.max(
    grossSales.minus(discounts).minus(refunds),
    0,
  );
  const tax = Prisma.Decimal.max(
    total.minus(grossSales.minus(discounts)).minus(shipping),
    0,
  );
  const financialStatus = mapFinancialStatus(
    requiredString(order.financial_status, 'order.financial_status'),
  );
  const totalCollected = isCollectedStatus(financialStatus)
    ? decimal(order.net_payment, 'order.net_payment')
    : new Prisma.Decimal(0);
  const providerCreatedAt = timestamp(order.created_at, 'order.created_at');
  const providerUpdatedAt = timestamp(order.updated_at, 'order.updated_at');
  const cancelledAt =
    order.cancelled_at === null || order.cancelled_at === undefined
      ? null
      : timestamp(order.cancelled_at, 'order.cancelled_at');
  const items = Array.isArray(order.items) ? order.items : [];

  return {
    externalOrderId,
    orderName: optionalString(order.name) ?? '',
    status: cancelledAt
      ? EcommerceOrderStatus.CANCELLED
      : EcommerceOrderStatus.OPEN,
    financialStatus,
    fulfillmentStatus: optionalString(order.fulfillment_status) ?? '',
    currency,
    itemCount: items.length,
    grossSales: grossSales.toFixed(4),
    discounts: discounts.toFixed(4),
    refunds: refunds.toFixed(4),
    netSales: netSales.toFixed(4),
    shipping: shipping.toFixed(4),
    tax: tax.toFixed(4),
    totalCollected: totalCollected.toFixed(4),
    shippingCity:
      optionalString(asOptionalRecord(order.shipping_address)?.city) ?? null,
    providerCreatedAt,
    processedAt: providerCreatedAt,
    cancelledAt,
    providerUpdatedAt,
    lines: items.map((item, index) =>
      normalizeLine(item, index, externalOrderId, currency),
    ),
  };
}

function normalizeLine(
  value: unknown,
  index: number,
  orderId: string,
  currency: string,
) {
  const item = asOptionalRecord(value) ?? {};
  const price = optionalDecimal(item.price);
  return {
    externalLineId: optionalString(item.id) ?? `${orderId}:${index + 1}`,
    externalProductId: optionalString(item.product_id),
    externalVariantId: optionalString(item.variant_id),
    sku: optionalString(item.sku),
    name: optionalString(item.title) ?? 'Unknown Product',
    quantity: 1,
    unitPrice: price.toFixed(4),
    totalPrice: price.toFixed(4),
    currency,
  };
}

function mapFinancialStatus(value: string): EcommercePaymentStatus {
  switch (value.trim().toLowerCase()) {
    case 'paid':
      return EcommercePaymentStatus.PAID;
    case 'partially_refunded':
      return EcommercePaymentStatus.PARTIALLY_REFUNDED;
    case 'refunded':
      return EcommercePaymentStatus.REFUNDED;
    case 'pending':
      return EcommercePaymentStatus.PENDING;
    default:
      return EcommercePaymentStatus.UNKNOWN;
  }
}

function isCollectedStatus(value: EcommercePaymentStatus): boolean {
  return (
    value === EcommercePaymentStatus.PAID ||
    value === EcommercePaymentStatus.PARTIALLY_REFUNDED ||
    value === EcommercePaymentStatus.REFUNDED
  );
}

function decimal(value: unknown, field: string): Prisma.Decimal {
  try {
    const parsed = new Prisma.Decimal(value as Prisma.Decimal.Value);
    if (!parsed.isFinite() || parsed.isNegative()) {
      throw new Error('invalid decimal');
    }
    return parsed;
  } catch {
    throw new BadGatewayException(
      `Lightfunnels returned an invalid ${field} value`,
    );
  }
}

function timestamp(value: unknown, field: string): Date {
  let parsed: Date;

  // Handle PHP/Carbon object serialization if Lightfunnels returns that
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const timestampObject = value as Record<string, unknown>;
    if (typeof timestampObject.date === 'string') {
      value = timestampObject.date;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = new Date(value < 10_000_000_000 ? value * 1000 : value);
  } else if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    // Some timestamps might have a space instead of T, replace for strict ISO compliance
    const normalized = trimmed.replace(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/,
      '$1T$2Z',
    );
    const numeric = Number(value);

    // Lightfunnels apparently returns relative human-readable times for their TimeStamp scalar!
    if (trimmed === 'just now') {
      parsed = new Date();
    } else if (trimmed.endsWith(' ago')) {
      const parts = trimmed.split(' ');
      const amount = parseInt(parts[0], 10);
      const unit = parts[1]?.toLowerCase();
      let multiplier = 0;
      if (unit.startsWith('sec')) multiplier = 1000;
      else if (unit.startsWith('min')) multiplier = 60 * 1000;
      else if (unit.startsWith('hour')) multiplier = 60 * 60 * 1000;
      else if (unit.startsWith('day')) multiplier = 24 * 60 * 60 * 1000;
      else if (unit.startsWith('week')) multiplier = 7 * 24 * 60 * 60 * 1000;
      else if (unit.startsWith('month'))
        multiplier = 30 * 24 * 60 * 60 * 1000; // Approximation
      else if (unit.startsWith('year')) multiplier = 365 * 24 * 60 * 60 * 1000;

      if (multiplier > 0 && !isNaN(amount)) {
        parsed = new Date(Date.now() - amount * multiplier);
      } else {
        parsed = new Date(NaN);
      }
    } else {
      parsed =
        Number.isFinite(numeric) && /^\d+$/.test(trimmed)
          ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
          : new Date(normalized);
    }
  } else {
    throw new BadGatewayException(
      `Lightfunnels returned an invalid ${field} timestamp. Received type ${typeof value}: ${JSON.stringify(value)}`,
    );
  }
  if (Number.isNaN(parsed.getTime())) {
    throw new BadGatewayException(
      `Lightfunnels returned an invalid ${field} timestamp. Could not parse: ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new BadGatewayException(
      `Lightfunnels response did not include ${field}`,
    );
  }
  return parsed;
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalDecimal(value: unknown): Prisma.Decimal {
  try {
    const parsed = new Prisma.Decimal(
      typeof value === 'number' || typeof value === 'string' ? value : 0,
    );
    return parsed.isFinite() && !parsed.isNegative()
      ? parsed
      : new Prisma.Decimal(0);
  } catch {
    return new Prisma.Decimal(0);
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadGatewayException(
      `Lightfunnels returned an invalid ${field} response`,
    );
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BadGatewayException(
      `Lightfunnels returned an invalid ${field} response`,
    );
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadGatewayException(
      `Lightfunnels returned an invalid ${field} response`,
    );
  }
  return value;
}
