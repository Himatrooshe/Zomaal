import {
  EcommercePlatform,
  EcommerceOrderStatus,
  EcommercePaymentStatus,
} from '@prisma/client';

export interface FulfillmentLineItem {
  title: string;
  sku: string;
  quantity: number;
}

export interface EcommerceFulfillmentPreview {
  platform: EcommercePlatform;
  externalOrderId: string;
  orderReference: string; // e.g. #1001

  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;

  currency: string;
  codAmount: string; // the outstanding amount or COD amount

  lineItems: FulfillmentLineItem[];
  notes: string | null;

  status: EcommerceOrderStatus;
  financialStatus: EcommercePaymentStatus;
  fulfillmentStatus: string | null;
}

export interface EcommerceOrderProduct {
  lineItemId: string;
  productId: string | null;
  variantId: string | null;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
  currency: string;
  imageUrl: string | null;
}

export interface EcommerceOrderProducts {
  platform: EcommercePlatform;
  externalOrderId: string;
  orderReference: string;
  currency: string;
  complete: boolean;
  products: EcommerceOrderProduct[];
}

export interface EcommerceFulfillmentAdapter {
  fetchFulfillmentPreview(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceFulfillmentPreview>;

  fetchOrderProducts(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceOrderProducts>;
}
