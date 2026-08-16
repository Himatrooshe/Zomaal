import { BadGatewayException } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  Prisma,
} from '@prisma/client';
import type { NormalizedEcommerceOrder } from '../ecommerce/interfaces/ecommerce-revenue-adapter.interface';

export const SHOPIFY_REVENUE_ORDER_FIELDS = `
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
  subtotalPriceSet { shopMoney { amount currencyCode } }
  currentSubtotalPriceSet { shopMoney { amount currencyCode } }
  totalDiscountsSet { shopMoney { amount currencyCode } }
  currentShippingPriceSet { shopMoney { amount currencyCode } }
  currentTotalTaxSet { shopMoney { amount currencyCode } }
  netPaymentSet { shopMoney { amount currencyCode } }
  shippingAddress { city }
  lineItems(first: 250) {
    nodes {
      id
      title
      sku
      quantity
      product { id }
      variant { id }
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
    }
  }
`;

interface RawMoney {
  amount: string;
  currencyCode: string;
}

interface RawMoneyBag {
  shopMoney: RawMoney;
}

export interface RawShopifyRevenueOrder {
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
  shippingAddress?: { city: string | null } | null;
  lineItems?: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      quantity: number;
      product: { id: string } | null;
      variant: { id: string } | null;
      originalUnitPriceSet: RawMoneyBag;
      priceAfterAllDiscountsBeforeTaxesSet: RawMoneyBag;
    }>;
  };
}

export function normalizeShopifyOrder(
  order: RawShopifyRevenueOrder,
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
    shippingCity: order.shippingAddress?.city?.trim() || null,
    providerCreatedAt: parseShopifyDate(order.createdAt),
    processedAt: parseShopifyDate(order.processedAt ?? order.createdAt),
    cancelledAt: order.cancelledAt ? parseShopifyDate(order.cancelledAt) : null,
    providerUpdatedAt: parseShopifyDate(order.updatedAt),
    lines: (order.lineItems?.nodes ?? []).map((line) => ({
      externalLineId: line.id,
      externalProductId: line.product?.id ?? null,
      externalVariantId: line.variant?.id ?? null,
      sku: line.sku?.trim() || null,
      name: line.title,
      quantity: line.quantity,
      unitPrice: decimal(line.originalUnitPriceSet.shopMoney.amount).toFixed(4),
      totalPrice: decimal(
        line.priceAfterAllDiscountsBeforeTaxesSet.shopMoney.amount,
      ).toFixed(4),
      currency: line.originalUnitPriceSet.shopMoney.currencyCode,
    })),
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
