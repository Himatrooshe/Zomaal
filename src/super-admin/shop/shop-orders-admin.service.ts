import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShopOrderCancelledBy, ShopOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_CANCELLABLE,
  ORDER_INCLUDE,
  ShopOrdersService,
} from '../../zomaal-shop/shop-orders.service';
import { money, orderNumberLabel } from '../../zomaal-shop/shop-pricing.util';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import { toCsv } from './csv.util';

const PAGE_SIZE = 50;
// A CSV export is a one-shot download, not a paginated screen — cap it well
// above anything a merchant base will realistically produce so the file
// stays a manageable size and the query stays bounded.
const EXPORT_LIMIT = 20_000;

const CSV_HEADERS = [
  'Order #',
  'Status',
  'Merchant',
  'Phone',
  'City',
  'Payment method',
  'Payment status',
  'Currency',
  'Subtotal',
  'Discount',
  'Delivery fee',
  'Total',
  'Items',
  'Promo code',
  'Tracking number',
  'Placed at',
  'Delivered at',
  'Cancelled at',
  'Cancel reason',
] as const;

@Injectable()
export class ShopOrdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: ShopOrdersService,
    private readonly activity: ActivityLogService,
  ) {}

  private buildWhere(query: {
    status?: ShopOrderStatus;
    search?: string;
    storeId?: string;
  }): Prisma.ShopOrderWhereInput {
    const search = query.search?.trim();
    const numberMatch = search?.match(/^(?:zs-?)?(\d+)$/i);
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(search
        ? {
            OR: [
              ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
              {
                store: {
                  businessName: { contains: search, mode: 'insensitive' },
                },
              },
              { store: { user: { phone: { contains: search } } } },
              { shipPhone: { contains: search } },
            ],
          }
        : {}),
    };
  }

  async list(query: {
    status?: ShopOrderStatus;
    search?: string;
    storeId?: string;
    page?: number;
  }) {
    const page = query.page ?? 1;
    const where = this.buildWhere(query);
    const [total, orders, counts] = await Promise.all([
      this.prisma.shopOrder.count({ where }),
      this.prisma.shopOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          items: { select: { quantity: true } },
          store: {
            select: {
              businessName: true,
              user: { select: { id: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.shopOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: page * PAGE_SIZE < total,
      statusCounts: Object.fromEntries(
        Object.values(ShopOrderStatus).map((s) => [
          s,
          counts.find((c) => c.status === s)?._count._all ?? 0,
        ]),
      ),
      items: orders.map((o) => ({
        id: o.id,
        number: orderNumberLabel(o.number),
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        currency: o.currency,
        total: money(o.total),
        itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        city: o.shipCity,
        merchant: {
          userId: o.store.user.id,
          businessName: o.store.businessName,
          phone: o.store.user.phone,
        },
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  async exportCsv(query: {
    status?: ShopOrderStatus;
    search?: string;
    storeId?: string;
  }) {
    const orders = await this.prisma.shopOrder.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      include: {
        items: { select: { quantity: true } },
        store: {
          select: {
            businessName: true,
            user: { select: { phone: true } },
          },
        },
      },
    });
    return toCsv([
      [...CSV_HEADERS],
      ...orders.map((o) => [
        orderNumberLabel(o.number),
        o.status,
        o.store.businessName,
        o.store.user.phone,
        o.shipCity,
        o.paymentMethod,
        o.paymentStatus,
        o.currency,
        o.subtotal.toFixed(2),
        o.discount.toFixed(2),
        o.deliveryFee.toFixed(2),
        o.total.toFixed(2),
        o.items.reduce((sum, i) => sum + i.quantity, 0),
        o.promoCode,
        o.trackingNumber,
        o.createdAt.toISOString(),
        o.deliveredAt?.toISOString() ?? null,
        o.cancelledAt?.toISOString() ?? null,
        o.cancelReason,
      ]),
    ]);
  }

  async detail(id: string) {
    const order = await this.prisma.shopOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.orders.toAdminResponse(order);
  }

  async advance(
    actor: SuperAdminJwtPayload,
    id: string,
    status: ShopOrderStatus,
    trackingNumber?: string,
  ) {
    await this.orders.advance(id, status, { trackingNumber });
    const order = await this.detail(id);
    await this.activity.record(actor, {
      action: `ORDER_${status}`,
      entityType: ActivityEntity.SHOP_ORDER,
      entityId: id,
      summary: `Marked order ${order.number} (${order.merchant.businessName}) as ${status.toLowerCase()}${trackingNumber ? ` — tracking ${trackingNumber}` : ''}`,
    });
    return order;
  }

  async cancel(actor: SuperAdminJwtPayload, id: string, reason: string) {
    await this.orders.cancel(
      id,
      ShopOrderCancelledBy.ADMIN,
      reason,
      ADMIN_CANCELLABLE,
    );
    const order = await this.detail(id);
    await this.activity.record(actor, {
      action: 'ORDER_CANCELLED',
      entityType: ActivityEntity.SHOP_ORDER,
      entityId: id,
      summary: `Cancelled order ${order.number} (${order.merchant.businessName}): ${reason}`,
    });
    return order;
  }

  async updateNote(
    actor: SuperAdminJwtPayload,
    id: string,
    adminNote: string | null | undefined,
  ) {
    const exists = await this.prisma.shopOrder.findUnique({
      where: { id },
      select: { number: true },
    });
    if (!exists) throw new NotFoundException('Order not found');
    await this.prisma.shopOrder.update({
      where: { id },
      data: { adminNote: adminNote?.trim() || null },
    });
    await this.activity.record(actor, {
      action: 'ORDER_NOTE_UPDATED',
      entityType: ActivityEntity.SHOP_ORDER,
      entityId: id,
      summary: `Updated the internal note on order ${orderNumberLabel(exists.number)}`,
    });
    return this.detail(id);
  }
}
