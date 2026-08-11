import { BadGatewayException, Injectable } from '@nestjs/common';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import {
  normalizeShopifyOrder,
  type RawShopifyRevenueOrder,
  SHOPIFY_REVENUE_ORDER_FIELDS,
} from '../shopify/shopify-order-projection';
import type {
  EcommerceOrderPage,
  EcommerceRevenueAdapter,
} from './interfaces/ecommerce-revenue-adapter.interface';

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
        ${SHOPIFY_REVENUE_ORDER_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface RawShopifyOrdersResponse {
  orders: {
    nodes: RawShopifyRevenueOrder[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

@Injectable()
export class ShopifyRevenueAdapter implements EcommerceRevenueAdapter {
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
