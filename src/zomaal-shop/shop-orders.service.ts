import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MerchantPurchaseSource,
  Prisma,
  ShopOrderCancelledBy,
  ShopOrderStatus,
  ShopPaymentMethod,
  ShopPaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { money, orderNumberLabel } from './shop-pricing.util';

export const ORDER_INCLUDE = {
  items: { orderBy: { productName: 'asc' } },
  store: {
    select: {
      id: true,
      businessName: true,
      ownerName: true,
      user: { select: { id: true, phone: true } },
    },
  },
} satisfies Prisma.ShopOrderInclude;

export type OrderWithItems = Prisma.ShopOrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

/** Forward-only fulfilment path; an admin may skip steps (e.g. PENDING → DELIVERED). */
const FORWARD: ShopOrderStatus[] = [
  ShopOrderStatus.PENDING,
  ShopOrderStatus.CONFIRMED,
  ShopOrderStatus.SHIPPED,
  ShopOrderStatus.DELIVERED,
];

/** Merchants may only cancel before the order is confirmed; admins until delivery. */
export const MERCHANT_CANCELLABLE: ShopOrderStatus[] = [
  ShopOrderStatus.PENDING,
];
export const ADMIN_CANCELLABLE: ShopOrderStatus[] = [
  ShopOrderStatus.PENDING,
  ShopOrderStatus.CONFIRMED,
  ShopOrderStatus.SHIPPED,
];

type Tx = Prisma.TransactionClient;

@Injectable()
export class ShopOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Merchant reads ----

  async listForStore(storeId: string, status?: ShopOrderStatus) {
    const orders = await this.prisma.shopOrder.findMany({
      where: { storeId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        items: {
          select: { quantity: true, imageUrl: true, productName: true },
        },
      },
    });
    return orders.map((o) => ({
      id: o.id,
      number: orderNumberLabel(o.number),
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      currency: o.currency,
      total: money(o.total),
      itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      preview: o.items
        .slice(0, 3)
        .map((i) => ({ productName: i.productName, imageUrl: i.imageUrl })),
      canCancel: MERCHANT_CANCELLABLE.includes(o.status),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async detailForStore(storeId: string, orderId: string) {
    const order = await this.prisma.shopOrder.findFirst({
      where: { id: orderId, storeId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.toMerchantResponse(order);
  }

  async cancelByMerchant(storeId: string, orderId: string, reason?: string) {
    const order = await this.prisma.shopOrder.findFirst({
      where: { id: orderId, storeId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    await this.cancel(
      orderId,
      ShopOrderCancelledBy.MERCHANT,
      reason,
      MERCHANT_CANCELLABLE,
    );
    return this.detailForStore(storeId, orderId);
  }

  // ---- Lifecycle (shared by merchant + admin) ----

  /**
   * Cancels atomically: the status flip is conditional on the order still
   * being in a cancellable state (so two cancels, or cancel-vs-ship, can't
   * both win), and stock plus the promo use are returned in the same
   * transaction.
   */
  async cancel(
    orderId: string,
    by: ShopOrderCancelledBy,
    reason: string | undefined,
    allowed: ShopOrderStatus[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.shopOrder.updateMany({
        where: { id: orderId, status: { in: allowed } },
        data: {
          status: ShopOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: by,
          cancelReason: reason?.trim() || null,
        },
      });
      if (!flipped.count) {
        const current = await tx.shopOrder.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        if (!current) throw new NotFoundException('Order not found');
        throw new ConflictException(
          by === ShopOrderCancelledBy.MERCHANT &&
            current.status !== ShopOrderStatus.CANCELLED
            ? `This order is already ${current.status.toLowerCase()} and can no longer be cancelled from the app. Contact Zomaal support.`
            : `This order is ${current.status.toLowerCase()} and can't be cancelled.`,
        );
      }

      const order = await tx.shopOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });
      await this.restock(tx, order.items);
      if (order.promoCodeId) {
        await tx.shopPromoCode.updateMany({
          where: { id: order.promoCodeId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }
    });
  }

  async advance(
    orderId: string,
    to: ShopOrderStatus,
    extra: { trackingNumber?: string } = {},
  ) {
    if (!FORWARD.includes(to) || to === ShopOrderStatus.PENDING) {
      throw new BadRequestException(
        `Can't move an order to ${to}. Use cancel to cancel it.`,
      );
    }
    const allowedFrom = FORWARD.slice(0, FORWARD.indexOf(to));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.shopOrder.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          paymentMethod: true,
          confirmedAt: true,
          shippedAt: true,
        },
      });
      if (!current) throw new NotFoundException('Order not found');

      const flipped = await tx.shopOrder.updateMany({
        where: { id: orderId, status: { in: allowedFrom } },
        data: {
          status: to,
          ...(to === ShopOrderStatus.CONFIRMED || !current.confirmedAt
            ? { confirmedAt: now }
            : {}),
          ...(to === ShopOrderStatus.SHIPPED ||
          (to === ShopOrderStatus.DELIVERED && !current.shippedAt)
            ? { shippedAt: now }
            : {}),
          ...(extra.trackingNumber !== undefined
            ? { trackingNumber: extra.trackingNumber.trim() || null }
            : {}),
          ...(to === ShopOrderStatus.DELIVERED
            ? {
                deliveredAt: now,
                // Cash on delivery is collected when the order is delivered.
                ...(current.paymentMethod === ShopPaymentMethod.COD
                  ? { paymentStatus: ShopPaymentStatus.PAID }
                  : {}),
              }
            : {}),
        },
      });
      if (!flipped.count) {
        throw new ConflictException(
          `This order is ${current.status.toLowerCase()} — it can't be moved to ${to.toLowerCase()}.`,
        );
      }

      if (to === ShopOrderStatus.DELIVERED)
        await this.recordPurchases(tx, orderId, now);
    });
  }

  // Delivered goods become "From Shop" entries in the merchant's Purchases
  // list. Idempotent: one purchase per order item (unique shopOrderItemId).
  private async recordPurchases(tx: Tx, orderId: string, deliveredAt: Date) {
    const order = await tx.shopOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    await tx.merchantPurchase.createMany({
      skipDuplicates: true,
      data: order.items.map((item) => ({
        storeId: order.storeId,
        source: MerchantPurchaseSource.SHOP,
        shopProductId: item.productId,
        shopOrderItemId: item.id,
        // Purchases group by product, so the name stays the product's; the
        // chosen option is kept on the history row's note.
        productName: item.productName,
        unitLabel: item.unitLabel,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalCost: item.lineTotal,
        currency: order.currency,
        purchaseDate: deliveredAt,
        notes: item.variantLabel
          ? `Zomaal Shop order ${orderNumberLabel(order.number)} · ${item.variantLabel}`
          : `Zomaal Shop order ${orderNumberLabel(order.number)}`,
        createdByUserId: order.placedByUserId,
      })),
    });
  }

  // Returns stock for items whose product/variant still exists. A product's
  // stock mirrors the sum of its variants, so both are incremented.
  async restock(
    tx: Tx,
    items: {
      productId: string | null;
      variantId: string | null;
      quantity: number;
    }[],
  ) {
    for (const item of items) {
      if (item.variantId) {
        await tx.shopProductVariant.updateMany({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }
      if (item.productId) {
        await tx.shopProduct.updateMany({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
  }

  private baseResponse(order: OrderWithItems) {
    const base = {
      id: order.id,
      number: orderNumberLabel(order.number),
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      subtotal: money(order.subtotal),
      discount: money(order.discount),
      deliveryFee: money(order.deliveryFee),
      total: money(order.total),
      promoCode: order.promoCode,
      itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        variantLabel: i.variantLabel,
        unitLabel: i.unitLabel,
        imageUrl: i.imageUrl,
        unitPrice: money(i.unitPrice),
        quantity: i.quantity,
        lineTotal: money(i.lineTotal),
      })),
      shippingAddress: {
        label: order.shipLabel,
        fullName: order.shipName,
        phone: order.shipPhone,
        country: order.shipCountry,
        city: order.shipCity,
        district: order.shipDistrict,
        address: order.shipAddress,
        formatted: [
          order.shipAddress,
          order.shipDistrict,
          order.shipCity,
          order.shipCountry,
        ]
          .filter(Boolean)
          .join(', '),
      },
      note: order.note,
      trackingNumber: order.trackingNumber,
      timeline: {
        placedAt: order.createdAt.toISOString(),
        confirmedAt: order.confirmedAt?.toISOString() ?? null,
        shippedAt: order.shippedAt?.toISOString() ?? null,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
      },
      cancelledBy: order.cancelledBy,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
    return base;
  }

  toMerchantResponse(order: OrderWithItems) {
    return {
      ...this.baseResponse(order),
      canCancel: MERCHANT_CANCELLABLE.includes(order.status),
    };
  }

  toAdminResponse(order: OrderWithItems) {
    return {
      ...this.baseResponse(order),
      adminNote: order.adminNote,
      canCancel: ADMIN_CANCELLABLE.includes(order.status),
      nextStatuses:
        order.status === ShopOrderStatus.CANCELLED
          ? []
          : FORWARD.slice(FORWARD.indexOf(order.status) + 1),
      merchant: {
        userId: order.store.user.id,
        storeId: order.store.id,
        businessName: order.store.businessName,
        ownerName: order.store.ownerName,
        phone: order.store.user.phone,
      },
    };
  }
}
