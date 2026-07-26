import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  Prisma,
} from '@prisma/client';
import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import type {
  EcommerceOrderPage,
  EcommerceRevenueAdapter,
  NormalizedEcommerceOrder,
} from './interfaces/ecommerce-revenue-adapter.interface';

const YOUCAN_SYNC_PAGE_SIZE = 50;

interface RawYouCanOrder {
  id?: unknown;
  ref?: unknown;
  vat?: unknown;
  total?: unknown;
  currency?: unknown;
  status?: unknown;
  status_new?: unknown;
  status_object?: unknown;
  payment_status_new?: unknown;
  shipping_status?: unknown;
  is_refunded_by_platform?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  payment?: unknown;
  shipping?: unknown;
  refunds?: unknown;
  variants?: unknown;
}

interface RawYouCanOrdersResponse {
  data?: unknown;
  meta?: unknown;
}

@Injectable()
export class YouCanRevenueAdapter implements EcommerceRevenueAdapter {
  constructor(
    private readonly youCanConnectionService: YouCanConnectionService,
  ) {}

  async fetchOrdersPage(
    userId: string,
    cursor: string | null,
    updatedSince?: Date | null,
    updatedThrough?: Date,
  ): Promise<EcommerceOrderPage> {
    const page = parsePage(cursor);
    const [response, storeCurrency] = await Promise.all([
      this.youCanConnectionService.getJsonForUser<RawYouCanOrdersResponse>(
        userId,
        '/orders',
        {
          page,
          limit: YOUCAN_SYNC_PAGE_SIZE,
          sort_field: 'created_at',
          sort_order: 'asc',
          include: 'payment,shipping,discount,refunds,variants',
        },
      ),
      this.youCanConnectionService.getStoreCurrency(userId),
    ]);

    if (!Array.isArray(response.data)) {
      throw new BadGatewayException(
        'YouCan returned an invalid order synchronization response',
      );
    }
    const pagination = readPagination(response.meta);
    const currentPage = pagination.currentPage ?? page;
    const hasNextPage =
      pagination.totalPages !== null
        ? currentPage < pagination.totalPages
        : pagination.hasNextLink;

    return {
      orders: response.data.map((order) =>
        normalizeYouCanOrder(asOrder(order), storeCurrency),
      ),
      hasNextPage,
      endCursor: hasNextPage ? String(currentPage + 1) : null,
    };
  }
}

function normalizeYouCanOrder(
  order: RawYouCanOrder,
  storeCurrency: string,
): NormalizedEcommerceOrder {
  const id = requiredString(order.id, 'order identifier');
  const createdAt = parseDate(order.created_at, 'created_at');
  const updatedAt = parseDate(order.updated_at, 'updated_at');
  const variants: unknown[] = Array.isArray(order.variants)
    ? (order.variants as unknown[])
    : [];
  const grossSales = variants.reduce<Prisma.Decimal>(
    (total, variant) => total.plus(lineTotal(variant)),
    new Prisma.Decimal(0),
  );
  const itemCount = variants.reduce<number>(
    (total, variant) => total + lineQuantity(variant),
    0,
  );
  const shipping = moneyFromRecord(order.shipping, 'price');
  const tax = decimal(order.vat ?? 0, 'vat');
  const orderTotal = decimal(order.total, 'total');
  const calculatedDiscount = grossSales
    .plus(shipping)
    .plus(tax)
    .minus(orderTotal);
  const discounts = calculatedDiscount.greaterThan(0)
    ? calculatedDiscount
    : new Prisma.Decimal(0);
  const rawRefunds = refundTotal(order.refunds);
  const paymentSlug = paymentStatusSlug(order);
  const refunds =
    rawRefunds.equals(0) &&
    (paymentSlug === 'refunded' || order.is_refunded_by_platform === true)
      ? orderTotal
      : rawRefunds;
  const financialStatus = mapPaymentStatus(paymentSlug, refunds, orderTotal);
  const totalCollected = isCollectedStatus(financialStatus)
    ? nonNegative(orderTotal.minus(refunds))
    : new Prisma.Decimal(0);
  const netSales = nonNegative(grossSales.minus(discounts).minus(refunds));
  const status = mapOrderStatus(order);
  const currency =
    optionalString(order.currency)?.toUpperCase() ||
    storeCurrency.toUpperCase();

  return {
    externalOrderId: id,
    orderName: optionalString(order.ref) ?? id,
    status,
    financialStatus,
    fulfillmentStatus:
      optionalString(order.shipping_status) ??
      recordString(order.shipping, 'status_text') ??
      'unknown',
    currency,
    itemCount,
    grossSales: grossSales.toFixed(4),
    discounts: discounts.toFixed(4),
    refunds: refunds.toFixed(4),
    netSales: netSales.toFixed(4),
    shipping: shipping.toFixed(4),
    tax: tax.toFixed(4),
    totalCollected: totalCollected.toFixed(4),
    providerCreatedAt: createdAt,
    processedAt: createdAt,
    cancelledAt: status === EcommerceOrderStatus.CANCELLED ? updatedAt : null,
    providerUpdatedAt: updatedAt,
  };
}

function mapOrderStatus(order: RawYouCanOrder): EcommerceOrderStatus {
  const slug = (
    recordString(order.status_object, 'slug') ??
    optionalString(order.status_new) ??
    optionalString(order.status) ??
    ''
  ).toLowerCase();
  if (/cancel/.test(slug)) {
    return EcommerceOrderStatus.CANCELLED;
  }
  if (/closed|processed/.test(slug)) {
    return EcommerceOrderStatus.CLOSED;
  }
  if (/open/.test(slug) || slug === '1') {
    return EcommerceOrderStatus.OPEN;
  }
  return EcommerceOrderStatus.UNKNOWN;
}

function paymentStatusSlug(order: RawYouCanOrder): string {
  return (
    recordString(recordValue(order.payment, 'status_object'), 'slug') ??
    recordString(order.payment, 'status_text') ??
    optionalString(order.payment_status_new) ??
    ''
  )
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function mapPaymentStatus(
  slug: string,
  refunds: Prisma.Decimal,
  total: Prisma.Decimal,
): EcommercePaymentStatus {
  if (refunds.greaterThan(0)) {
    return refunds.greaterThanOrEqualTo(total)
      ? EcommercePaymentStatus.REFUNDED
      : EcommercePaymentStatus.PARTIALLY_REFUNDED;
  }
  switch (slug) {
    case 'paid':
    case 'captured':
      return EcommercePaymentStatus.PAID;
    case 'partially-paid':
      return EcommercePaymentStatus.PARTIALLY_PAID;
    case 'authorized':
      return EcommercePaymentStatus.AUTHORIZED;
    case 'pending':
    case 'unpaid':
      return EcommercePaymentStatus.PENDING;
    case 'refunded':
      return EcommercePaymentStatus.REFUNDED;
    case 'voided':
    case 'canceled':
    case 'cancelled':
      return EcommercePaymentStatus.VOIDED;
    case 'expired':
      return EcommercePaymentStatus.EXPIRED;
    default:
      return EcommercePaymentStatus.UNKNOWN;
  }
}

function isCollectedStatus(status: EcommercePaymentStatus): boolean {
  switch (status) {
    case EcommercePaymentStatus.PARTIALLY_PAID:
    case EcommercePaymentStatus.PAID:
    case EcommercePaymentStatus.PARTIALLY_REFUNDED:
    case EcommercePaymentStatus.REFUNDED:
      return true;
    default:
      return false;
  }
}

function refundTotal(value: unknown): Prisma.Decimal {
  if (!Array.isArray(value)) {
    return new Prisma.Decimal(0);
  }
  return value.reduce<Prisma.Decimal>((total, refund) => {
    if (typeof refund === 'number' || typeof refund === 'string') {
      return total.plus(decimal(refund, 'refund'));
    }
    const amount = recordValue(refund, 'amount');
    if (isRecord(amount)) {
      return total.plus(decimal(amount.amount ?? 0, 'refund'));
    }
    return total.plus(decimal(amount ?? 0, 'refund'));
  }, new Prisma.Decimal(0));
}

function lineTotal(value: unknown): Prisma.Decimal {
  if (!isRecord(value)) {
    throw new BadGatewayException('YouCan returned an invalid order variant');
  }
  return decimal(value.price, 'variant price').times(
    decimal(value.quantity, 'variant quantity'),
  );
}

function lineQuantity(value: unknown): number {
  if (!isRecord(value)) {
    throw new BadGatewayException('YouCan returned an invalid order variant');
  }
  const quantity = Number(value.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new BadGatewayException(
      'YouCan returned an invalid variant quantity',
    );
  }
  return quantity;
}

function moneyFromRecord(value: unknown, key: string): Prisma.Decimal {
  return decimal(recordValue(value, key) ?? 0, key);
}

function decimal(value: unknown, field: string): Prisma.Decimal {
  try {
    const parsed = new Prisma.Decimal(
      typeof value === 'number' || typeof value === 'string' ? value : NaN,
    );
    if (!parsed.isFinite() || parsed.lessThan(0)) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new BadGatewayException(
      `YouCan returned an invalid monetary ${field}`,
    );
  }
}

function nonNegative(value: Prisma.Decimal): Prisma.Decimal {
  return value.lessThan(0) ? new Prisma.Decimal(0) : value;
}

function parseDate(value: unknown, field: string): Date {
  const date = new Date(requiredString(value, field));
  if (Number.isNaN(date.getTime())) {
    throw new BadGatewayException(`YouCan returned an invalid ${field} date`);
  }
  return date;
}

function parsePage(cursor: string | null): number {
  if (cursor === null) {
    return 1;
  }
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) {
    throw new BadGatewayException('Invalid YouCan pagination cursor');
  }
  return page;
}

function readPagination(meta: unknown): {
  currentPage: number | null;
  totalPages: number | null;
  hasNextLink: boolean;
} {
  const pagination = recordValue(meta, 'pagination');
  return {
    currentPage: positiveInteger(recordValue(pagination, 'current_page')),
    totalPages: positiveInteger(recordValue(pagination, 'total_pages')),
    hasNextLink: Boolean(
      recordString(recordValue(pagination, 'links'), 'next'),
    ),
  };
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOrder(value: unknown): RawYouCanOrder {
  if (!isRecord(value)) {
    throw new BadGatewayException('YouCan returned an invalid order');
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value);
  if (!result) {
    throw new BadGatewayException(`YouCan order is missing ${field}`);
  }
  return result;
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function recordString(value: unknown, key: string): string | null {
  return optionalString(recordValue(value, key));
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
