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

export interface EcommerceFulfillmentAdapter {
  fetchFulfillmentPreview(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceFulfillmentPreview>;
}
