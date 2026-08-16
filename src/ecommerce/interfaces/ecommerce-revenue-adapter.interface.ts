import { EcommerceOrderStatus, EcommercePaymentStatus } from '@prisma/client';

export interface NormalizedEcommerceOrderLine {
  externalLineId: string;
  externalProductId: string | null;
  externalVariantId: string | null;
  sku: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  currency: string;
}

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
  shippingCity: string | null;
  providerCreatedAt: Date;
  processedAt: Date;
  cancelledAt: Date | null;
  providerUpdatedAt: Date;
  lines: NormalizedEcommerceOrderLine[];
}

export interface EcommerceOrderPage {
  orders: NormalizedEcommerceOrder[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface EcommerceRevenueAdapter {
  fetchOrdersPage(
    userId: string,
    cursor: string | null,
    updatedSince: Date | null,
    updatedThrough: Date,
  ): Promise<EcommerceOrderPage>;
}
