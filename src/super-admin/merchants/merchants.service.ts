import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
  ShopOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { ListMerchantsQueryDto } from './dto/list-merchants-query.dto';

const STORE_INCLUDE = {
  _count: {
    select: {
      warehouseProducts: true,
      customers: true,
      staffMembers: true,
      ecommerceConnections: true,
    },
  },
  user: { select: { id: true, phone: true, onboardingComplete: true } },
} satisfies Prisma.StoreInclude;

type StoreWithCounts = Prisma.StoreGetPayload<{
  include: typeof STORE_INCLUDE;
}>;

const EDITABLE_FIELDS = [
  'businessName',
  'ownerName',
  'address',
  'city',
  'country',
  'isActive',
] as const;

// "Merchant" = a Zomaal user who owns a store — the account type this
// admin panel manages here. Staff members (StaffMember, tied to someone
// else's store) are a different identity, shown inside a merchant's detail.
@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  async list(query: ListMerchantsQueryDto) {
    const isActive =
      query.isActive === undefined ? undefined : query.isActive === 'true';

    const stores = await this.prisma.store.findMany({
      where: {
        ...(isActive !== undefined ? { isActive } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  businessName: { contains: query.search, mode: 'insensitive' },
                },
                { ownerName: { contains: query.search, mode: 'insensitive' } },
                { user: { phone: { contains: query.search } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: STORE_INCLUDE,
    });

    return stores.map((store) => this.toResponse(store));
  }

  async getOne(userId: string) {
    const store = await this.requireStoreByUserId(userId);
    return this.toResponse(store);
  }

  // Everything the Merchant detail page shows, in one round trip. Read-only.
  async overview(userId: string) {
    const store = await this.requireStoreByUserId(userId);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orderWhere: Prisma.EcommerceOrderWhereInput = {
      connection: { storeId: store.id },
    };

    const [
      connections,
      staff,
      totalOrders,
      orders30d,
      revenueByCurrency,
      recentOrders,
      blacklistedCustomers,
    ] = await Promise.all([
      this.prisma.ecommerceConnection.findMany({
        where: { storeId: store.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          platform: true,
          displayName: true,
          status: true,
          lastSyncedAt: true,
          lastSyncError: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
      this.prisma.staffMember.findMany({
        where: { storeId: store.id },
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          name: true,
          jobTitle: true,
          status: true,
          lastLoginAt: true,
          lastActiveAt: true,
          role: { select: { name: true } },
          user: { select: { phone: true } },
        },
      }),
      this.prisma.ecommerceOrder.count({ where: orderWhere }),
      this.prisma.ecommerceOrder.count({
        where: { ...orderWhere, processedAt: { gte: since30d } },
      }),
      this.prisma.ecommerceOrder.groupBy({
        by: ['currency'],
        where: { ...orderWhere, cancelledAt: null },
        _sum: { totalCollected: true },
        _count: { _all: true },
      }),
      this.prisma.ecommerceOrder.findMany({
        where: orderWhere,
        orderBy: { processedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderName: true,
          externalOrderId: true,
          status: true,
          financialStatus: true,
          fulfillmentStatus: true,
          currency: true,
          totalCollected: true,
          processedAt: true,
          connection: { select: { platform: true } },
        },
      }),
      this.prisma.customer.count({
        where: { storeId: store.id, isBlacklisted: true },
      }),
    ]);

    const [shopOrders, shopSpent, recentShopOrders] = await Promise.all([
      this.prisma.shopOrder.groupBy({
        by: ['status'],
        where: { storeId: store.id },
        _count: { _all: true },
      }),
      this.prisma.shopOrder.aggregate({
        where: { storeId: store.id, status: ShopOrderStatus.DELIVERED },
        _sum: { total: true },
      }),
      this.prisma.shopOrder.findMany({
        where: { storeId: store.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          currency: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      merchant: this.toResponse(store),
      connections: connections.map((c) => ({
        id: c.id,
        platform: c.platform,
        displayName: c.displayName,
        status: c.status,
        isManual: c.platform === EcommercePlatform.MANUAL,
        healthy:
          c.status === EcommerceConnectionStatus.ACTIVE && !c.lastSyncError,
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        lastSyncError: c.lastSyncError,
        orderCount: c._count.orders,
        connectedAt: c.createdAt.toISOString(),
      })),
      staff: staff.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.user.phone,
        jobTitle: s.jobTitle,
        role: s.role?.name ?? null,
        status: s.status,
        lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
        lastActiveAt: s.lastActiveAt?.toISOString() ?? null,
      })),
      orders: {
        total: totalOrders,
        last30Days: orders30d,
        // Orders keep their platform's currency, so revenue is never summed
        // across currencies — one line per currency instead.
        revenueByCurrency: revenueByCurrency.map((r) => ({
          currency: r.currency,
          orderCount: r._count._all,
          totalCollected: (
            r._sum.totalCollected ?? new Prisma.Decimal(0)
          ).toFixed(2),
        })),
        recent: recentOrders.map((o) => ({
          id: o.id,
          orderName: o.orderName ?? o.externalOrderId,
          platform: o.connection.platform,
          status: o.status,
          financialStatus: o.financialStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          currency: o.currency,
          totalCollected: o.totalCollected.toFixed(2),
          processedAt: o.processedAt.toISOString(),
        })),
      },
      customers: {
        total: store._count.customers,
        blacklisted: blacklistedCustomers,
      },
      zomaalShop: {
        orders: shopOrders.reduce((sum, g) => sum + g._count._all, 0),
        byStatus: Object.fromEntries(
          shopOrders.map((g) => [g.status, g._count._all]),
        ),
        deliveredSpend: (shopSpent._sum.total ?? new Prisma.Decimal(0)).toFixed(
          2,
        ),
        recent: recentShopOrders.map((o) => ({
          id: o.id,
          number: `ZS-${o.number}`,
          status: o.status,
          total: o.total.toFixed(2),
          currency: o.currency,
          createdAt: o.createdAt.toISOString(),
        })),
      },
    };
  }

  async update(
    actor: SuperAdminJwtPayload,
    userId: string,
    dto: UpdateMerchantDto,
  ) {
    const existing = await this.requireStoreByUserId(userId);
    const store = await this.prisma.store.update({
      where: { id: existing.id },
      data: {
        ...(dto.businessName !== undefined
          ? { businessName: dto.businessName.trim() }
          : {}),
        ...(dto.ownerName !== undefined
          ? { ownerName: dto.ownerName.trim() }
          : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
        ...(dto.country !== undefined ? { country: dto.country.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: STORE_INCLUDE,
    });

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of EDITABLE_FIELDS) {
      if (existing[field] !== store[field]) {
        changes[field] = { from: existing[field], to: store[field] };
      }
    }

    const statusChanged = 'isActive' in changes;
    const otherChanges = Object.keys(changes).filter((f) => f !== 'isActive');
    if (statusChanged) {
      await this.activity.record(actor, {
        action: store.isActive ? 'MERCHANT_REACTIVATED' : 'MERCHANT_SUSPENDED',
        entityType: ActivityEntity.MERCHANT,
        entityId: userId,
        summary: `${store.isActive ? 'Reactivated' : 'Suspended'} merchant "${store.businessName}"`,
      });
    }
    if (otherChanges.length > 0) {
      await this.activity.record(actor, {
        action: 'MERCHANT_UPDATED',
        entityType: ActivityEntity.MERCHANT,
        entityId: userId,
        summary: `Edited merchant "${store.businessName}" (${otherChanges.join(', ')})`,
        metadata: Object.fromEntries(
          otherChanges.map((f) => [f, changes[f]]),
        ) as Prisma.InputJsonValue,
      });
    }

    return this.toResponse(store);
  }

  async remove(actor: SuperAdminJwtPayload, userId: string) {
    const store = await this.requireStoreByUserId(userId);
    // Cascades: deleting the User removes the Store (onDelete: Cascade)
    // and everything hanging off it — warehouse products, customers,
    // orders, staff, connections, the lot. This is the "Full edit access"
    // option, deliberately: there is no soft-delete here. The activity log
    // row below is the only surviving record that this merchant existed.
    await this.prisma.user.delete({ where: { id: userId } });
    await this.activity.record(actor, {
      action: 'MERCHANT_DELETED',
      entityType: ActivityEntity.MERCHANT,
      entityId: userId,
      summary: `Permanently deleted merchant "${store.businessName}" (${store.user.phone})`,
      metadata: {
        phone: store.user.phone,
        businessName: store.businessName,
        ownerName: store.ownerName,
        productCount: store._count.warehouseProducts,
        customerCount: store._count.customers,
        staffCount: store._count.staffMembers,
      },
    });
    return { message: `Merchant "${store.businessName}" deleted` };
  }

  private async requireStoreByUserId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeStoreId: true },
    });
    const store =
      (user?.activeStoreId
        ? await this.prisma.store.findFirst({
            where: { id: user.activeStoreId, userId },
            include: STORE_INCLUDE,
          })
        : null) ??
      (await this.prisma.store.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        include: STORE_INCLUDE,
      }));
    if (!store) {
      throw new NotFoundException('Merchant not found');
    }
    return store;
  }

  private toResponse(store: StoreWithCounts) {
    return {
      id: store.user.id,
      phone: store.user.phone,
      storeId: store.id,
      businessName: store.businessName,
      ownerName: store.ownerName,
      address: store.address,
      city: store.city,
      country: store.country,
      baseCurrency: store.baseCurrency,
      logoUrl: store.logoUrl,
      isActive: store.isActive,
      onboardingComplete: store.user.onboardingComplete,
      productCount: store._count.warehouseProducts,
      customerCount: store._count.customers,
      staffCount: store._count.staffMembers,
      connectionCount: store._count.ecommerceConnections,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    };
  }
}
