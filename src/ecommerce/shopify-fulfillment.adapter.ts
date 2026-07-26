import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
} from '@prisma/client';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import type {
  EcommerceFulfillmentAdapter,
  EcommerceFulfillmentPreview,
} from './interfaces/ecommerce-fulfillment-adapter.interface';

const SHOPIFY_FULFILLMENT_ORDER_QUERY = `#graphql
  query ZomaalFulfillmentOrder($id: ID!) {
    order(id: $id) {
      id
      name
      phone
      note
      closed
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      shippingAddress {
        name
        phone
        address1
        address2
        city
        country
      }
      currentSubtotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      lineItems(first: 50) {
        nodes {
          title
          sku
          unfulfilledQuantity
        }
      }
    }
  }
`;

interface RawShopifyFulfillmentOrder {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  closed: boolean;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  shippingAddress: {
    name: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    country: string | null;
  } | null;
  currentSubtotalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  lineItems: {
    nodes: Array<{
      title: string;
      sku: string | null;
      unfulfilledQuantity: number;
    }>;
  };
}

interface RawShopifyFulfillmentResponse {
  order: RawShopifyFulfillmentOrder | null;
}

@Injectable()
export class ShopifyFulfillmentAdapter implements EcommerceFulfillmentAdapter {
  constructor(
    private readonly shopifyConnectionService: ShopifyConnectionService,
  ) {}

  async fetchFulfillmentPreview(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceFulfillmentPreview> {
    const response =
      await this.shopifyConnectionService.graphqlForUser<RawShopifyFulfillmentResponse>(
        userId,
        SHOPIFY_FULFILLMENT_ORDER_QUERY,
        { id: externalOrderId },
      );

    if (!response.order) {
      throw new BadGatewayException('Shopify order not found');
    }

    const order = response.order;
    const address = order.shippingAddress;
    const lineItems = order.lineItems.nodes
      .filter((item) => item.unfulfilledQuantity > 0)
      .map((item) => ({
        title: item.title,
        sku: item.sku || '',
        quantity: item.unfulfilledQuantity,
      }));

    let fullAddress: string | null = null;
    if (address) {
      fullAddress = [address.address1, address.address2]
        .filter(Boolean)
        .join(', ');
    }

    return {
      platform: EcommercePlatform.SHOPIFY,
      externalOrderId: order.id,
      orderReference: order.name,
      recipientName: address?.name || null,
      recipientPhone: address?.phone || order.phone || null,
      address: fullAddress,
      city: address?.city || null,
      country: address?.country || null,
      currency: order.currentSubtotalPriceSet.shopMoney.currencyCode,
      codAmount: order.currentSubtotalPriceSet.shopMoney.amount,
      lineItems,
      notes: order.note || null,
      status: order.cancelledAt
        ? EcommerceOrderStatus.CANCELLED
        : order.closed
          ? EcommerceOrderStatus.CLOSED
          : EcommerceOrderStatus.OPEN,
      financialStatus: this.mapPaymentStatus(order.displayFinancialStatus),
      fulfillmentStatus: order.displayFulfillmentStatus,
    };
  }

  private mapPaymentStatus(value: string | null): EcommercePaymentStatus {
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
}
