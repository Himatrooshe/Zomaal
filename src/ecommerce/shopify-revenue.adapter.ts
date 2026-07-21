import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  Prisma,
} from '@prisma/client';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';

const SHOPIFY_SYNC_PAGE_SIZE = 50;

const SHOPIFY_REVENUE_ORDERS_QUERY = `#graphql
  query ZomaalRevenueOrders(
    $first: Int!
    $after: String
    $query: String
  ) {
    orders(
      first: $first
      after: $after
      query: $query
      sortKey: UPDATED_AT
    ) {
      nodes {
        id
        name
        closed
        createdAt
        updatedAt
        processedAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentSubtotalLineItemsQuantity
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentSubtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentShippingPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentTotalTaxSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        netPaymentSet {
          shopMoney {
            amount
            currencyCode
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

export interface NormalizedEcommerceOrder {
  externalOrderId: string;
  orderName: string;
  status: EcommerceOrderStatus;
  financialStatus: EcommercePaymentStatus;
  fulfillmentStatus: string;
  currency: string;
  itemCount: number;
  grossSales: string;
  discounts: string;
  refunds: string;
  netSales: string;
  shipping: string;
  tax: string;
  totalCollected: string;
  providerCreatedAt: Date;
  processedAt: Date;
  cancelledAt: Date | null;
  providerUpdatedAt: Date;
}

export interface EcommerceOrderPage {
  orders: NormalizedEcommerceOrder[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RawMoney {
  amount: string;
  currencyCode: string;
}

interface RawMoneyBag {
  shopMoney: RawMoney;
}

interface RawShopifyOrder {
  id: string;
  name: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentSubtotalLineItemsQuantity: number;
  subtotalPriceSet: RawMoneyBag | null;
  currentSubtotalPriceSet: RawMoneyBag;
  totalDiscountsSet: RawMoneyBag | null;
  currentShippingPriceSet: RawMoneyBag;
  currentTotalTaxSet: RawMoneyBag;
  netPaymentSet: RawMoneyBag;
}

interface RawShopifyOrdersResponse {
  orders: {
    nodes: RawShopifyOrder[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

@Injectable()
export class ShopifyRevenueAdapter {
  constructor(
    private readonly shopifyConnectionService: ShopifyConnectionService,
  ) {}

  async fetchOrdersPage(
    userId: string,
    after: string | null,
    updatedSince: Date | null,
    updatedThrough: Date,
  ): Promise<EcommerceOrderPage> {
    const response =
      await this.shopifyConnectionService.graphqlForUser<RawShopifyOrdersResponse>(
        userId,
        SHOPIFY_REVENUE_ORDERS_QUERY,
        {
          first: SHOPIFY_SYNC_PAGE_SIZE,
          after,
          query: [
            updatedSince
              ? `updated_at:>='${updatedSince.toISOString()}'`
              : null,
            `updated_at:<='${updatedThrough.toISOString()}'`,
          ]
            .filter(Boolean)
            .join(' '),
        },
      );

    if (!response.orders?.nodes || !response.orders.pageInfo) {
      throw new BadGatewayException(
        'Shopify returned an invalid order synchronization response',
      );
    }

    return {
      orders: response.orders.nodes.map(normalizeShopifyOrder),
      hasNextPage: response.orders.pageInfo.hasNextPage,
      endCursor: response.orders.pageInfo.endCursor,
    };
  }
}

function normalizeShopifyOrder(
  order: RawShopifyOrder,
): NormalizedEcommerceOrder {
  const currentSubtotal = decimal(
    order.currentSubtotalPriceSet.shopMoney.amount,
  );
  const originalSubtotal = decimal(
    order.subtotalPriceSet?.shopMoney.amount ??
      order.currentSubtotalPriceSet.shopMoney.amount,
  );
  const discounts = decimal(order.totalDiscountsSet?.shopMoney.amount ?? '0');
  const grossSales = originalSubtotal.plus(discounts);
  const calculatedRefunds = originalSubtotal.minus(currentSubtotal);
  const refunds = calculatedRefunds.lessThan(0)
    ? new Prisma.Decimal(0)
    : calculatedRefunds;

  return {
    externalOrderId: order.id,
    orderName: order.name,
    status: order.cancelledAt
      ? EcommerceOrderStatus.CANCELLED
      : order.closed
        ? EcommerceOrderStatus.CLOSED
        : EcommerceOrderStatus.OPEN,
    financialStatus: mapPaymentStatus(order.displayFinancialStatus),
    fulfillmentStatus: order.displayFulfillmentStatus,
    currency: order.currentSubtotalPriceSet.shopMoney.currencyCode,
    itemCount: order.currentSubtotalLineItemsQuantity,
    grossSales: grossSales.toFixed(4),
    discounts: discounts.toFixed(4),
    refunds: refunds.toFixed(4),
    netSales: currentSubtotal.toFixed(4),
    shipping: decimal(order.currentShippingPriceSet.shopMoney.amount).toFixed(
      4,
    ),
    tax: decimal(order.currentTotalTaxSet.shopMoney.amount).toFixed(4),
    totalCollected: decimal(order.netPaymentSet.shopMoney.amount).toFixed(4),
    providerCreatedAt: parseShopifyDate(order.createdAt),
    processedAt: parseShopifyDate(order.processedAt ?? order.createdAt),
    cancelledAt: order.cancelledAt ? parseShopifyDate(order.cancelledAt) : null,
    providerUpdatedAt: parseShopifyDate(order.updatedAt),
  };
}

function mapPaymentStatus(value: string | null): EcommercePaymentStatus {
  switch (value) {
    case 'PENDING':
      return EcommercePaymentStatus.PENDING;
    case 'AUTHORIZED':
      return EcommercePaymentStatus.AUTHORIZED;
    case 'PARTIALLY_PAID':
      return EcommercePaymentStatus.PARTIALLY_PAID;
    case 'PAID':
      return EcommercePaymentStatus.PAID;
    case 'PARTIALLY_REFUNDED':
      return EcommercePaymentStatus.PARTIALLY_REFUNDED;
    case 'REFUNDED':
      return EcommercePaymentStatus.REFUNDED;
    case 'VOIDED':
      return EcommercePaymentStatus.VOIDED;
    case 'EXPIRED':
      return EcommercePaymentStatus.EXPIRED;
    default:
      return EcommercePaymentStatus.UNKNOWN;
  }
}

function decimal(value: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadGatewayException(
      'Shopify returned an invalid monetary amount',
    );
  }
}

function parseShopifyDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadGatewayException('Shopify returned an invalid order date');
  }
  return date;
}
