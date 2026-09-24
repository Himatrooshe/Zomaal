import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import { PackagingService } from '../warehouse/packaging.service';
import type { ListShopOrdersDto, ShopOrderListTab } from './dto/shop.dto';
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

type StatusStep = {
  key: string;
  title: string;
  at: string | null;
  completed: boolean;
  current: boolean;
  trackingNumber?: string | null;
};

@Injectable()
export class ShopOrdersService {
  private readonly logger = new Logger(ShopOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly packaging: PackagingService,
  ) {}

  // ---- Merchant reads ----

  async listForStore(storeId: string, query: ListShopOrdersDto = {}) {
    const statusFilter = this.resolveStatusFilter(query.tab, query.status);
    const search = query.search?.trim();

    const orders = await this.prisma.shopOrder.findMany({
      where: {
        storeId,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search
          ? {
              items: {
                some: {
                  productName: { contains: search, mode: 'insensitive' },
                },
              },
            }
          : {}),
      },
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
      /** Figma list tab bucket (Processing covers PENDING + CONFIRMED). */
      listTab: this.listTabForStatus(o.status),
      /** Short label for the list card, e.g. "Out for delivery". */
      lastUpdate: this.lastUpdateLabel(o.status),
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      currency: o.currency,
      total: money(o.total),
      itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      preview: o.items
        .slice(0, 3)
        .map((i) => ({ productName: i.productName, imageUrl: i.imageUrl })),
      trackingNumber: o.trackingNumber,
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
    cancelledBy: ShopOrderCancelledBy,
    reason: string | undefined,
    allowedFrom: ShopOrderStatus[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.shopOrder.updateMany({
        where: { id: orderId, status: { in: allowedFrom } },
        data: {
          status: ShopOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy,
          cancelReason: reason?.trim() || null,
        },
      });
      if (!flipped.count) {
        const current = await tx.shopOrder.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        if (!current) throw new NotFoundException('Order not found');
        if (cancelledBy === ShopOrderCancelledBy.MERCHANT) {
          throw new ConflictException(
            'This order can no longer be cancelled from the app. Contact Zomaal support.',
          );
        }
        throw new ConflictException(
          `This order is ${current.status.toLowerCase()} — it can't be cancelled.`,
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

    // Packaging ownership is credited after the order txn commits so each
    // line uses PackagingService's own idempotent transaction. Failures are
    // logged and retried on a later deliver attempt / ops fix — purchases
    // already persisted above.
    if (to === ShopOrderStatus.DELIVERED) {
      await this.creditPackagingFromDelivery(orderId);
    }
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

  /**
   * Credits owned packaging materials so Add Product → Select packaging can
   * list them. Catalog key is the shop variant id when present, otherwise the
   * shop product id (simple products without size/color options).
   */
  private async creditPackagingFromDelivery(orderId: string) {
    const order = await this.prisma.shopOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { orderBy: { sortOrder: 'asc' }, take: 1 },
              },
            },
            variant: true,
          },
        },
      },
    });
    if (!order) return;

    for (const item of order.items) {
      const catalogId = item.variantId ?? item.productId;
      if (!catalogId) continue;
      try {
        await this.packaging.creditDeliveredPurchase(order.storeId, {
          zomaalShopVariantId: catalogId,
          name: item.productName,
          sku: item.variant?.sku ?? item.product?.sku ?? undefined,
          imageObjectName: item.product?.images[0]?.objectName,
          quantity: item.quantity,
          deliveryReference: item.id,
        });
      } catch (error) {
        this.logger.error(
          `Failed to credit packaging for shop order item ${item.id}: ${String(error)}`,
        );
      }
    }
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

  private resolveStatusFilter(
    tab?: ShopOrderListTab,
    status?: ShopOrderStatus,
  ): Prisma.EnumShopOrderStatusFilter | ShopOrderStatus | undefined {
    if (tab && tab !== 'ALL') {
      if (tab === 'PROCESSING') {
        return { in: [ShopOrderStatus.PENDING, ShopOrderStatus.CONFIRMED] };
      }
      return tab as ShopOrderStatus;
    }
    return status;
  }

  private listTabForStatus(status: ShopOrderStatus): ShopOrderListTab {
    if (
      status === ShopOrderStatus.PENDING ||
      status === ShopOrderStatus.CONFIRMED
    ) {
      return 'PROCESSING';
    }
    if (status === ShopOrderStatus.SHIPPED) return 'SHIPPED';
    if (status === ShopOrderStatus.DELIVERED) return 'DELIVERED';
    if (status === ShopOrderStatus.CANCELLED) return 'CANCELLED';
    return 'ALL';
  }

  /** Human label for Figma list "Last update: …". */
  private lastUpdateLabel(status: ShopOrderStatus): string {
    switch (status) {
      case ShopOrderStatus.PENDING:
        return 'Order placed';
      case ShopOrderStatus.CONFIRMED:
        return 'Order confirmed';
      case ShopOrderStatus.SHIPPED:
        return 'Out for delivery';
      case ShopOrderStatus.DELIVERED:
        return 'Delivered';
      case ShopOrderStatus.CANCELLED:
        return 'Cancelled';
      default:
        return status;
    }
  }

  /**
   * Figma Order track timeline. We do not store a separate OUT_FOR_DELIVERY
   * status — when the order is SHIPPED, that step is shown as current.
   */
  buildStatusSteps(order: {
    status: ShopOrderStatus;
    createdAt: Date;
    confirmedAt: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    trackingNumber: string | null;
  }): StatusStep[] {
    if (order.status === ShopOrderStatus.CANCELLED) {
      return [
        {
          key: 'PLACED',
          title: 'Order Placed',
          at: order.createdAt.toISOString(),
          completed: true,
          current: false,
        },
        {
          key: 'CANCELLED',
          title: 'Cancelled',
          at: order.cancelledAt?.toISOString() ?? null,
          completed: true,
          current: true,
        },
      ];
    }

    const rank: Record<ShopOrderStatus, number> = {
      [ShopOrderStatus.PENDING]: 0,
      [ShopOrderStatus.CONFIRMED]: 1,
      [ShopOrderStatus.SHIPPED]: 2,
      [ShopOrderStatus.DELIVERED]: 4,
      [ShopOrderStatus.CANCELLED]: -1,
    };
    const currentRank = rank[order.status] ?? 0;
    const outForDeliveryCurrent = order.status === ShopOrderStatus.SHIPPED;
    const outForDeliveryDone = order.status === ShopOrderStatus.DELIVERED;

    const steps: StatusStep[] = [
      {
        key: 'PLACED',
        title: 'Order Placed',
        at: order.createdAt.toISOString(),
        completed: true,
        current: order.status === ShopOrderStatus.PENDING,
      },
      {
        key: 'CONFIRMED',
        title: 'Order Confirm',
        at: order.confirmedAt?.toISOString() ?? null,
        completed: currentRank >= 1,
        current: order.status === ShopOrderStatus.CONFIRMED,
      },
      {
        key: 'SHIPPED',
        title: 'Shipped',
        at: order.shippedAt?.toISOString() ?? null,
        completed: currentRank >= 2,
        current: false,
        trackingNumber: order.trackingNumber,
      },
      {
        key: 'OUT_FOR_DELIVERY',
        title: 'Out for delivery',
        at: outForDeliveryDone
          ? (order.deliveredAt?.toISOString() ?? null)
          : null,
        completed: outForDeliveryDone,
        current: outForDeliveryCurrent,
      },
      {
        key: 'DELIVERED',
        title: 'Delivered',
        at: order.deliveredAt?.toISOString() ?? null,
        completed: order.status === ShopOrderStatus.DELIVERED,
        current: order.status === ShopOrderStatus.DELIVERED,
      },
    ];
    return steps;
  }

  private baseResponse(order: OrderWithItems) {
    const base = {
      id: order.id,
      number: orderNumberLabel(order.number),
      status: order.status,
      listTab: this.listTabForStatus(order.status),
      lastUpdate: this.lastUpdateLabel(order.status),
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
      /** Figma Order track vertical timeline. */
      statusSteps: this.buildStatusSteps(order),
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
