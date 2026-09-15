import { Injectable } from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
  ShopOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity/activity-log.service';
import { ShopService } from '../shop/shop.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// A connection that hasn't synced in this long is flagged "stale" even if it
// reports ACTIVE with no error — a silently stuck sync is still a problem.
const STALE_SYNC_MS = 2 * DAY_MS;

export type IntegrationHealth = 'HEALTHY' | 'STALE' | 'ERROR' | 'DISCONNECTED';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService,
    private readonly activity: ActivityLogService,
  ) {}

  async dashboard() {
    const now = Date.now();
    const since30d = new Date(now - 30 * DAY_MS);
    const since60d = new Date(now - 60 * DAY_MS);

    const [
      catalog,
      totalMerchants,
      activeMerchants,
      newMerchants30d,
      newMerchantsPrev30d,
      orders30d,
      ordersPrev30d,
      connections,
      blacklistedCustomers,
      signupsRaw,
      recentActivity,
    ] = await Promise.all([
      this.shop.catalogSummary(),
      this.prisma.store.count(),
      this.prisma.store.count({ where: { isActive: true } }),
      this.prisma.store.count({ where: { createdAt: { gte: since30d } } }),
      this.prisma.store.count({
        where: { createdAt: { gte: since60d, lt: since30d } },
      }),
      this.prisma.ecommerceOrder.count({
        where: { processedAt: { gte: since30d } },
      }),
      this.prisma.ecommerceOrder.count({
        where: { processedAt: { gte: since60d, lt: since30d } },
      }),
      this.prisma.ecommerceConnection.findMany({
        where: { platform: { not: EcommercePlatform.MANUAL } },
        select: { status: true, lastSyncedAt: true, lastSyncError: true },
      }),
      this.prisma.customer.count({ where: { isBlacklisted: true } }),
      this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM "Store"
        WHERE "createdAt" >= ${since30d}
        GROUP BY 1
        ORDER BY 1`,
      this.activity.list({ limit: 8 }),
    ]);

    const [pendingShopOrders, shopOrders30d, shopRevenue30d, shopSettings] =
      await Promise.all([
        this.prisma.shopOrder.count({
          where: { status: ShopOrderStatus.PENDING },
        }),
        this.prisma.shopOrder.count({
          where: {
            createdAt: { gte: since30d },
            status: { not: ShopOrderStatus.CANCELLED },
          },
        }),
        this.prisma.shopOrder.aggregate({
          where: {
            status: ShopOrderStatus.DELIVERED,
            deliveredAt: { gte: since30d },
          },
          _sum: { total: true },
        }),
        this.prisma.shopSettings.findUnique({ where: { id: 'default' } }),
      ]);

    const integrationCounts = {
      HEALTHY: 0,
      STALE: 0,
      ERROR: 0,
      DISCONNECTED: 0,
    };
    for (const c of connections) {
      integrationCounts[integrationHealth(c, now)] += 1;
    }

    // Dense 30-day series (zero-filled) so the chart has no gaps.
    const byDay = new Map(
      signupsRaw.map((r) => [
        r.day.toISOString().slice(0, 10),
        Number(r.count),
      ]),
    );
    const merchantSignups = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(now - (29 - i) * DAY_MS).toISOString().slice(0, 10);
      return { day, count: byDay.get(day) ?? 0 };
    });

    return {
      catalog,
      merchants: {
        total: totalMerchants,
        active: activeMerchants,
        suspended: totalMerchants - activeMerchants,
        new30d: newMerchants30d,
        newPrev30d: newMerchantsPrev30d,
      },
      orders: { last30d: orders30d, prev30d: ordersPrev30d },
      integrations: { total: connections.length, ...integrationCounts },
      blacklistedCustomers,
      shop: {
        pendingOrders: pendingShopOrders,
        orders30d: shopOrders30d,
        revenue30d: (
          shopRevenue30d._sum.total ?? new Prisma.Decimal(0)
        ).toFixed(2),
        currency: shopSettings?.currency ?? 'MAD',
      },
      merchantSignups,
      recentActivity: recentActivity.items,
    };
  }

  async integrations(query: {
    health?: IntegrationHealth;
    platform?: EcommercePlatform;
  }) {
    const now = Date.now();
    const connections = await this.prisma.ecommerceConnection.findMany({
      // MANUAL is hand-entered orders, not a synced integration — it has no
      // sync to be healthy or stale, so it's excluded from health entirely.
      where: query.platform
        ? { platform: query.platform }
        : { platform: { not: EcommercePlatform.MANUAL } },
      orderBy: [
        { lastSyncError: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        platform: true,
        displayName: true,
        status: true,
        lastSyncedAt: true,
        lastSyncError: true,
        createdAt: true,
        _count: { select: { orders: true } },
        store: {
          select: {
            businessName: true,
            isActive: true,
            user: { select: { id: true, phone: true } },
          },
        },
      },
    });

    return connections
      .map((c) => ({
        id: c.id,
        platform: c.platform,
        displayName: c.displayName,
        status: c.status,
        health: integrationHealth(c, now),
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        lastSyncError: c.lastSyncError,
        orderCount: c._count.orders,
        connectedAt: c.createdAt.toISOString(),
        merchant: {
          userId: c.store.user.id,
          businessName: c.store.businessName,
          phone: c.store.user.phone,
          isActive: c.store.isActive,
        },
      }))
      .filter((c) => !query.health || c.health === query.health);
  }

  // Blacklisted customers across every merchant. `flaggedByStores` counts
  // how many distinct merchants have blacklisted the same phone — the
  // cross-merchant fraud signal no single merchant can see on their own.
  async blacklist(query: { search?: string; multiStoreOnly?: boolean }) {
    const where: Prisma.CustomerWhereInput = {
      isBlacklisted: true,
      ...(query.search
        ? {
            OR: [
              { phone: { contains: query.search } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [customers, perPhone] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { blacklistedAt: { sort: 'desc', nulls: 'last' } },
        take: 500,
        select: {
          id: true,
          phone: true,
          name: true,
          city: true,
          totalOrders: true,
          returnsCount: true,
          cancellationsCount: true,
          refusalsCount: true,
          noAnswerCount: true,
          blacklistReason: true,
          blacklistedAt: true,
          store: {
            select: {
              businessName: true,
              user: { select: { id: true } },
            },
          },
        },
      }),
      this.prisma.customer.groupBy({
        by: ['phone'],
        where: { isBlacklisted: true },
        _count: { _all: true },
      }),
    ]);

    const storesPerPhone = new Map(
      perPhone.map((p) => [p.phone, p._count._all]),
    );

    const items = customers
      .map((c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        city: c.city,
        totalOrders: c.totalOrders,
        returns: c.returnsCount,
        cancellations: c.cancellationsCount,
        refusals: c.refusalsCount,
        noAnswer: c.noAnswerCount,
        reason: c.blacklistReason,
        blacklistedAt: c.blacklistedAt?.toISOString() ?? null,
        flaggedByStores: storesPerPhone.get(c.phone) ?? 1,
        merchant: {
          userId: c.store.user.id,
          businessName: c.store.businessName,
        },
      }))
      .filter((c) => !query.multiStoreOnly || c.flaggedByStores > 1);

    return {
      total: items.length,
      multiStorePhones: [...storesPerPhone.values()].filter((n) => n > 1)
        .length,
      items,
    };
  }
}

function integrationHealth(
  connection: {
    status: EcommerceConnectionStatus;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  },
  now: number,
): IntegrationHealth {
  if (connection.status !== EcommerceConnectionStatus.ACTIVE) {
    return 'DISCONNECTED';
  }
  if (connection.lastSyncError) return 'ERROR';
  if (
    !connection.lastSyncedAt ||
    now - connection.lastSyncedAt.getTime() > STALE_SYNC_MS
  ) {
    return 'STALE';
  }
  return 'HEALTHY';
}
