import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
} from '@prisma/client';
import { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import type {
  EcommerceFulfillmentAdapter,
  EcommerceFulfillmentPreview,
  EcommerceOrderProducts,
} from './interfaces/ecommerce-fulfillment-adapter.interface';

const LIGHTFUNNELS_FULFILLMENT_ORDER_QUERY = `
  query ZomaalLightfunnelsFulfillmentOrder($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          phone
          total
          currency
          notes
          cancelled_at
          financial_status
          fulfillment_status
          shipping_address {
            first_name
            last_name
            phone
            address1
            address2
            city
            country
          }
          items {
            ... on VariantSnapshot {
              title
              sku
            }
            ... on OrderBumpSnapshot {
              title
              sku
            }
          }
        }
      }
    }
  }
`;

const LIGHTFUNNELS_ORDER_PRODUCTS_QUERY = `
  query ZomaalLightfunnelsOrderProducts($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          currency
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
    }
  }
`;

interface RawLightfunnelsFulfillmentOrder {
  id: string;
  name: string | null;
  phone: string | null;
  total: string | number;
  currency: string;
  notes: string | null;
  cancelled_at: string | number | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  shipping_address: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    country: string | null;
  } | null;
  items: Array<{
    title: string | null;
    sku: string | null;
  }> | null;
}

interface RawLightfunnelsFulfillmentResponse {
  orders?: {
    edges?: Array<{
      node?: RawLightfunnelsFulfillmentOrder;
    }>;
  };
}

interface RawLightfunnelsOrderProductsResponse {
  orders?: {
    edges?: Array<{
      node?: {
        id: string;
        name: string | null;
        currency: string;
        items: Array<{
          __typename: 'VariantSnapshot' | 'OrderBumpSnapshot';
          id: string;
          variant_id?: string | null;
          product_id?: string | null;
          title: string | null;
          sku: string | null;
          price: number | string;
        }> | null;
      };
    }>;
  };
}

@Injectable()
export class LightfunnelsFulfillmentAdapter implements EcommerceFulfillmentAdapter {
  constructor(
    private readonly connectionService: LightfunnelsConnectionService,
  ) {}

  async fetchFulfillmentPreview(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceFulfillmentPreview> {
    const data =
      await this.connectionService.graphqlForUser<RawLightfunnelsFulfillmentResponse>(
        userId,
        LIGHTFUNNELS_FULFILLMENT_ORDER_QUERY,
        {
          query: `id:${externalOrderId}`,
        },
        'orders',
      );

    const edges = data?.orders?.edges || [];
    const order = edges[0]?.node;

    if (!order || String(order.id) !== externalOrderId) {
      throw new BadGatewayException('Lightfunnels order not found');
    }

    const shippingAddress = order.shipping_address;
    const recipientName =
      [shippingAddress?.first_name, shippingAddress?.last_name]
        .filter(Boolean)
        .join(' ') || null;

    const recipientPhone = shippingAddress?.phone || order.phone || null;
    const fullAddress =
      [shippingAddress?.address1, shippingAddress?.address2]
        .filter(Boolean)
        .join(', ') || null;

    const items = Array.isArray(order.items) ? order.items : [];
    const lineItems = items.map((item) => ({
      title: item.title || 'Unknown Product',
      sku: item.sku || '',
      quantity: 1,
    }));

    return {
      platform: EcommercePlatform.LIGHTFUNNELS,
      externalOrderId: String(order.id),
      orderReference: order.name || String(order.id),
      recipientName,
      recipientPhone,
      address: fullAddress,
      city: shippingAddress?.city || null,
      country: shippingAddress?.country || null,
      currency: (order.currency || '').toUpperCase(),
      codAmount: String(order.total || '0'),
      lineItems,
      notes: order.notes || null,
      status:
        order.cancelled_at === null || order.cancelled_at === undefined
          ? EcommerceOrderStatus.OPEN
          : EcommerceOrderStatus.CANCELLED,
      financialStatus: this.mapFinancialStatus(order.financial_status || ''),
      fulfillmentStatus: order.fulfillment_status || 'unknown',
    };
  }

  async fetchOrderProducts(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceOrderProducts> {
    const data =
      await this.connectionService.graphqlForUser<RawLightfunnelsOrderProductsResponse>(
        userId,
        LIGHTFUNNELS_ORDER_PRODUCTS_QUERY,
        { query: `id:${externalOrderId}` },
        'orders',
      );
    const order = data.orders?.edges?.[0]?.node;
    if (!order || String(order.id) !== externalOrderId) {
      throw new BadGatewayException('Lightfunnels order not found');
    }

    const currency = order.currency.toUpperCase();
    const items = Array.isArray(order.items) ? order.items : [];
    return {
      platform: EcommercePlatform.LIGHTFUNNELS,
      externalOrderId: String(order.id),
      orderReference: order.name || String(order.id),
      currency,
      complete: true,
      products: items.map((item) => ({
        lineItemId: String(item.id),
        productId: item.product_id ? String(item.product_id) : null,
        variantId: item.variant_id ? String(item.variant_id) : null,
        title: item.title || 'Unknown Product',
        variantTitle: null,
        sku: item.sku || null,
        quantity: 1,
        unitPrice: money(item.price),
        totalPrice: money(item.price),
        currency,
        imageUrl: null,
      })),
    };
  }

  private mapFinancialStatus(value: string): EcommercePaymentStatus {
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
}

function money(value: number | string): string | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : null;
}
