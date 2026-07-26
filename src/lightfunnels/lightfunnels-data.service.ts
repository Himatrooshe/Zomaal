import { Injectable, BadGatewayException } from '@nestjs/common';
import { LightfunnelsConnectionService } from './lightfunnels-connection.service';
import { LightfunnelsDataPageQueryDto } from './dto/lightfunnels-data-query.dto';
import {
  LightfunnelsPaginatedResponseDto,
  LightfunnelsPaginatedConnectionDto,
  LightfunnelsDataResponseDto,
  LightfunnelsProductDto,
  LightfunnelsOrderDto,
  LightfunnelsCustomerDto,
} from './dto/lightfunnels-data-response.dto';

const PRODUCTS_QUERY = `
  query ZomaalLightfunnelsProducts(
    $first: Int!
    $after: String
    $query: String!
  ) {
    products(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          title
          description
          created_at
          updated_at
          status
          price
          compare_at_price
          images {
            url
            position
          }
          variants {
            id
            title
            price
            sku
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

const PRODUCT_QUERY = `
  query ZomaalLightfunnelsProduct($query: String!) {
    products(first: 1, query: $query) {
      edges {
        node {
          id
          title
          description
          created_at
          updated_at
          status
          price
          compare_at_price
          images {
            url
            position
          }
          variants {
            id
            title
            price
            sku
          }
        }
      }
    }
  }
`;

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
          currency
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ORDER_QUERY = `
  query ZomaalLightfunnelsOrder($query: String!) {
    orders(first: 1, query: $query) {
      edges {
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
          currency
          items {
            ... on VariantSnapshot {
              id
              title
              price
              sku
            }
            ... on OrderBumpSnapshot {
              id
              title
              price
              sku
            }
          }
        }
      }
    }
  }
`;

const CUSTOMERS_QUERY = `
  query ZomaalLightfunnelsCustomers(
    $first: Int!
    $after: String
    $query: String!
  ) {
    customers(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          first_name
          last_name
          email
          created_at
          updated_at
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

@Injectable()
export class LightfunnelsDataService {
  constructor(
    private readonly connectionService: LightfunnelsConnectionService,
  ) {}

  async listProducts(
    userId: string,
    query: LightfunnelsDataPageQueryDto,
  ): Promise<LightfunnelsPaginatedResponseDto<LightfunnelsProductDto>> {
    const data = await this.connectionService.graphqlForUser<{
      products: unknown;
    }>(userId, PRODUCTS_QUERY, {
      first: query.first,
      after: query.after,
      query: query.query ?? '',
    });
    return {
      data: data.products as LightfunnelsPaginatedConnectionDto<LightfunnelsProductDto>,
    };
  }

  async getProductDetails(
    userId: string,
    productId: string,
  ): Promise<LightfunnelsDataResponseDto<LightfunnelsProductDto>> {
    const data = await this.connectionService.graphqlForUser<{
      products: { edges: { node: unknown }[] };
    }>(userId, PRODUCT_QUERY, { query: `id:${productId}` });
    const product = data.products?.edges?.[0]?.node;
    if (!product) {
      throw new BadGatewayException('Lightfunnels product not found');
    }
    return { data: product as LightfunnelsProductDto };
  }

  async listOrders(
    userId: string,
    query: LightfunnelsDataPageQueryDto,
  ): Promise<LightfunnelsPaginatedResponseDto<LightfunnelsOrderDto>> {
    const data = await this.connectionService.graphqlForUser<{
      orders: unknown;
    }>(userId, ORDERS_QUERY, {
      first: query.first,
      after: query.after,
      query: query.query ?? '',
    });
    return {
      data: data.orders as LightfunnelsPaginatedConnectionDto<LightfunnelsOrderDto>,
    };
  }

  async getOrderDetails(
    userId: string,
    orderId: string,
  ): Promise<LightfunnelsDataResponseDto<LightfunnelsOrderDto>> {
    const data = await this.connectionService.graphqlForUser<{
      orders: { edges: { node: unknown }[] };
    }>(userId, ORDER_QUERY, { query: `id:${orderId}` });
    const order = data.orders?.edges?.[0]?.node;
    if (!order) {
      throw new BadGatewayException('Lightfunnels order not found');
    }
    return { data: order as LightfunnelsOrderDto };
  }

  async listCustomers(
    userId: string,
    query: LightfunnelsDataPageQueryDto,
  ): Promise<LightfunnelsPaginatedResponseDto<LightfunnelsCustomerDto>> {
    const data = await this.connectionService.graphqlForUser<{
      customers: unknown;
    }>(userId, CUSTOMERS_QUERY, {
      first: query.first,
      after: query.after,
      query: query.query ?? '',
    });
    return {
      data: data.customers as LightfunnelsPaginatedConnectionDto<LightfunnelsCustomerDto>,
    };
  }
}
