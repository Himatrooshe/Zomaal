import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
} from '@prisma/client';
import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import type {
  EcommerceFulfillmentAdapter,
  EcommerceFulfillmentPreview,
} from './interfaces/ecommerce-fulfillment-adapter.interface';

interface RawYouCanFulfillmentOrder {
  id: string;
  ref: string | null;
  currency: string | null;
  total: string | number;
  status: string | null;
  status_new: string | null;
  status_object: { slug?: string } | null;
  payment_status_new: string | null;
  payment: { status_text?: string; status_object?: { slug?: string } } | null;
  shipping_status: string | null;
  shipping: { status_text?: string } | null;
  note: string | null;
  customer: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  shipping_address: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
  variants: Array<{
    id?: string;
    product_variant_id?: string;
    product_name?: string;
    name?: string;
    title?: string;
    quantity: number | string;
    price: number | string;
  }> | null;
}

@Injectable()
export class YouCanFulfillmentAdapter implements EcommerceFulfillmentAdapter {
  constructor(
    private readonly youCanConnectionService: YouCanConnectionService,
  ) {}

  async fetchFulfillmentPreview(
    userId: string,
    externalOrderId: string,
  ): Promise<EcommerceFulfillmentPreview> {
    const [order, storeCurrency] = await Promise.all([
      this.youCanConnectionService.getJsonForUser<{
        data?: RawYouCanFulfillmentOrder;
      }>(userId, `/orders/${externalOrderId}`, {
        include: 'customer,shipping,variants',
      }),
      this.youCanConnectionService.getStoreCurrency(userId),
    ]);

    if (!order.data || !order.data.id) {
      throw new BadGatewayException('YouCan order not found');
    }

    const data = order.data;
    const variants = Array.isArray(data.variants) ? data.variants : [];
    const shippingAddress = data.shipping_address;
    const customer = data.customer;

    const recipientName =
      [
        shippingAddress?.first_name || customer?.first_name,
        shippingAddress?.last_name || customer?.last_name,
      ]
        .filter(Boolean)
        .join(' ') || null;

    const recipientPhone = shippingAddress?.phone || customer?.phone || null;

    const fullAddress =
      [shippingAddress?.address1, shippingAddress?.address2]
        .filter(Boolean)
        .join(', ') || null;

    const lineItems = variants.map((v) => ({
      title: v.product_name || v.name || v.title || 'Unknown Product',
      sku: v.product_variant_id || v.id || '',
      quantity: Number(v.quantity) || 1,
    }));

    return {
      platform: EcommercePlatform.YOUCAN,
      externalOrderId: String(data.id),
      orderReference: data.ref || String(data.id),
      recipientName,
      recipientPhone,
      address: fullAddress,
      city: shippingAddress?.city || null,
      country: shippingAddress?.country || null,
      currency: (data.currency || storeCurrency).toUpperCase(),
      codAmount: String(data.total || '0'),
      lineItems,
      notes: data.note || null,
      status: this.mapOrderStatus(data),
      financialStatus: this.mapPaymentStatus(data),
      fulfillmentStatus:
        data.shipping_status || data.shipping?.status_text || 'unknown',
    };
  }

  private mapOrderStatus(
    order: RawYouCanFulfillmentOrder,
  ): EcommerceOrderStatus {
    const slug = (
      order.status_object?.slug ??
      order.status_new ??
      order.status ??
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

  private mapPaymentStatus(
    order: RawYouCanFulfillmentOrder,
  ): EcommercePaymentStatus {
    const slug = (
      order.payment?.status_object?.slug ??
      order.payment?.status_text ??
      order.payment_status_new ??
      ''
    )
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');

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
}
