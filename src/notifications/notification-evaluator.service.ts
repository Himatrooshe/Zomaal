import { Injectable, Logger } from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  Prisma,
  SalaryPaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';
import { salaryDay } from '../staff/salary-payment-status.util';
import {
  NotificationsService,
  type RaiseNotificationInput,
} from './notifications.service';
import { NotificationType } from './notification-type';
import {
  daysLeft,
  deriveSubscriptionStatus,
} from '../billing/subscription-status.util';
import { ENDING_SOON_DAYS } from '../billing/plan-features';

const STORE_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Q16.3: this week vs last week, alert at a 30% drop, checked daily. */
export const SALES_DROP_THRESHOLD = 0.3;
// Below this many orders last week a 30% swing is noise, not a signal.
export const SALES_DROP_MIN_PREVIOUS_ORDERS = 5;

// Same payment statuses the revenue summary counts as sales.
const INCLUDED_PAYMENT_STATUSES = Prisma.sql`
  (
    'PARTIALLY_PAID'::"EcommercePaymentStatus",
    'PAID'::"EcommercePaymentStatus",
    'PARTIALLY_REFUNDED'::"EcommercePaymentStatus",
    'REFUNDED'::"EcommercePaymentStatus"
  )
`;

const PLATFORM_LABEL: Record<string, string> = {
  SHOPIFY: 'Shopify',
  YOUCAN: 'YouCan',
  LIGHTFUNNELS: 'Lightfunnels',
};

interface StoreRef {
  id: string;
  userId: string;
  baseCurrency: string;
}

export interface EvaluationSummary {
  stores: number;
  failedStores: number;
  raised: number;
  resolved: number;
}

/**
 * Turns current state in other modules into notifications. Run on a schedule
 * (POST /internal/notifications/run). Every check reconciles: it raises what
 * newly holds and resolves what stopped holding, so re-running is safe.
 */
@Injectable()
export class NotificationEvaluatorService {
  private readonly logger = new Logger(NotificationEvaluatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly currency: CurrencyService,
  ) {}

  async runAll(now: Date = new Date()): Promise<EvaluationSummary> {
    const summary: EvaluationSummary = {
      stores: 0,
      failedStores: 0,
      raised: 0,
      resolved: 0,
    };
    let cursor: string | undefined;

    for (;;) {
      const stores = await this.prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, userId: true, baseCurrency: true },
        orderBy: { id: 'asc' },
        take: STORE_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (stores.length === 0) break;

      for (const store of stores) {
        summary.stores++;
        try {
          const result = await this.evaluateStore(store, now);
          summary.raised += result.raised;
          summary.resolved += result.resolved;
        } catch (err) {
          summary.failedStores++;
          this.logger.error(
            `Notification evaluation failed for store ${store.id}: ${(err as Error).message}`,
          );
        }
      }
      cursor = stores[stores.length - 1].id;
    }
    return summary;
  }

  async evaluateStore(
    store: StoreRef,
    now: Date,
  ): Promise<{ raised: number; resolved: number }> {
    const stock = await this.stockAlerts(store.id);
    const batches: [NotificationType, RaiseNotificationInput[]][] = [
      [NotificationType.LOW_STOCK, stock.low],
      [NotificationType.OUT_OF_STOCK, stock.out],
      [NotificationType.SALARY_OVERDUE, await this.salaryAlerts(store.id, now)],
      [NotificationType.SALES_DROP, await this.salesDropAlerts(store, now)],
      ...(await this.platformAlerts(store.id)),
      [NotificationType.COURIER_SYNC_FAILED, await this.courierAlerts(store)],
      ...(await this.billingAlerts(store, now)),
    ];

    let raised = 0;
    let resolved = 0;
    for (const [type, desired] of batches) {
      const r = await this.notifications.reconcile(store.id, type, desired);
      raised += r.raised;
      resolved += r.resolved;
    }
    return { raised, resolved };
  }

  /**
   * Q17: warn the owner before the trial / paid period ends and once it has.
   * Subscriptions are activated manually (no auto-renew), so an active plan
   * always gets the "ending soon" warning. The key carries the end date, so
   * a renewal resolves the old alert and the next period alerts afresh.
   */
  async billingAlerts(
    store: StoreRef,
    now: Date,
  ): Promise<[NotificationType, RaiseNotificationInput[]][]> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId: store.userId },
      select: {
        planId: true,
        accessEndsAt: true,
        cancelAtPeriodEnd: true,
        plan: { select: { name: true } },
      },
    });
    const trialEnding: RaiseNotificationInput[] = [];
    const subEnding: RaiseNotificationInput[] = [];
    const expired: RaiseNotificationInput[] = [];

    if (sub) {
      const status = deriveSubscriptionStatus(sub, now);
      const left = daysLeft(sub.accessEndsAt, now);
      const endsOn = sub.accessEndsAt.toISOString();
      const day = endsOn.slice(0, 10);
      const base = {
        storeId: store.id,
        entityType: 'SUBSCRIPTION',
        metadata: { accessEndsAt: endsOn, status },
      };
      const inDays = `${left} day${left === 1 ? '' : 's'}`;

      if (status === 'TRIALING' && left <= ENDING_SOON_DAYS) {
        trialEnding.push({
          ...base,
          type: NotificationType.TRIAL_ENDING,
          title: `Your free trial ends in ${inDays}`,
          message:
            'Choose a plan to keep making changes and syncing your stores.',
          dedupeKey: `${NotificationType.TRIAL_ENDING}:${day}`,
        });
      } else if (status === 'ACTIVE' && left <= ENDING_SOON_DAYS) {
        subEnding.push({
          ...base,
          type: NotificationType.SUBSCRIPTION_ENDING,
          title: sub.plan
            ? `Your ${sub.plan.name} plan ends in ${inDays}`
            : `Your plan ends in ${inDays}`,
          message: sub.cancelAtPeriodEnd
            ? 'Your subscription was cancelled and will not renew.'
            : 'Renew to keep making changes and syncing your stores.',
          dedupeKey: `${NotificationType.SUBSCRIPTION_ENDING}:${day}`,
        });
      } else if (status === 'TRIAL_ENDED' || status === 'EXPIRED') {
        expired.push({
          ...base,
          type: NotificationType.SUBSCRIPTION_EXPIRED,
          title:
            status === 'TRIAL_ENDED'
              ? 'Your free trial has ended'
              : 'Your subscription has expired',
          message:
            'Your account is read-only and syncing is paused. Choose a plan to continue.',
          dedupeKey: `${NotificationType.SUBSCRIPTION_EXPIRED}:${day}`,
        });
      }
    }

    return [
      [NotificationType.TRIAL_ENDING, trialEnding],
      [NotificationType.SUBSCRIPTION_ENDING, subEnding],
      [NotificationType.SUBSCRIPTION_EXPIRED, expired],
    ];
  }

  async stockAlerts(
    storeId: string,
  ): Promise<{ low: RaiseNotificationInput[]; out: RaiseNotificationInput[] }> {
    // Available = onHand - reserved - damaged, same as the products list's
    // LOW_STOCK / OUT_OF_STOCK filter. Only tracked, active standard variants;
    // bundle stock is derived from their components, which alert themselves.
    const rows = await this.prisma.$queryRaw<
      {
        variantId: string;
        variantTitle: string;
        isDefault: boolean;
        productId: string;
        productName: string;
        threshold: number;
        available: number;
      }[]
    >(Prisma.sql`
      SELECT
        v."id" AS "variantId",
        v."title" AS "variantTitle",
        v."isDefault",
        p."id" AS "productId",
        p."name" AS "productName",
        v."lowStockThreshold" AS "threshold",
        COALESCE(SUM(b."onHand" - b."reserved" - b."damaged"), 0)::int AS "available"
      FROM "WarehouseVariant" v
      INNER JOIN "WarehouseProduct" p ON p."id" = v."productId"
      INNER JOIN "InventoryItem" ii ON ii."variantId" = v."id"
      LEFT JOIN "InventoryBalance" b ON b."inventoryItemId" = ii."id"
      WHERE v."storeId" = ${storeId}
        AND p."status" = 'ACTIVE'
        AND p."kind" = 'STANDARD'
        AND p."archivedAt" IS NULL
      GROUP BY v."id", p."id"
      HAVING COALESCE(SUM(b."onHand" - b."reserved" - b."damaged"), 0) <= v."lowStockThreshold"
    `);

    const low: RaiseNotificationInput[] = [];
    const out: RaiseNotificationInput[] = [];
    for (const row of rows) {
      const name = row.isDefault
        ? row.productName
        : `${row.productName} — ${row.variantTitle}`;
      const base = {
        storeId,
        entityType: 'WAREHOUSE_VARIANT',
        entityId: row.variantId,
        metadata: {
          productId: row.productId,
          available: row.available,
          threshold: row.threshold,
        },
      };
      if (row.available <= 0) {
        out.push({
          ...base,
          type: NotificationType.OUT_OF_STOCK,
          title: `${name} is out of stock`,
          message: 'No units available. Restock to keep fulfilling orders.',
          dedupeKey: `${NotificationType.OUT_OF_STOCK}:${row.variantId}`,
        });
      } else {
        low.push({
          ...base,
          type: NotificationType.LOW_STOCK,
          title: `${name} is running low`,
          message: `${row.available} ${row.available === 1 ? 'item' : 'items'} left`,
          dedupeKey: `${NotificationType.LOW_STOCK}:${row.variantId}`,
        });
      }
    }
    return { low, out };
  }

  async salaryAlerts(
    storeId: string,
    now: Date,
  ): Promise<RaiseNotificationInput[]> {
    const overdue = await this.prisma.staffSalaryPayment.findMany({
      where: {
        status: SalaryPaymentStatus.PENDING,
        paymentDate: { lt: salaryDay(now) },
        staffMember: { storeId },
      },
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        staffMember: { select: { id: true, name: true } },
      },
      orderBy: { paymentDate: 'asc' },
    });

    return overdue.map((p) => ({
      storeId,
      type: NotificationType.SALARY_OVERDUE,
      title: `Salary overdue for ${p.staffMember.name}`,
      message: `Payment was due on ${p.paymentDate.toISOString().slice(0, 10)}.`,
      entityType: 'STAFF_SALARY_PAYMENT',
      entityId: p.id,
      metadata: {
        staffMemberId: p.staffMember.id,
        amount: p.amount.toFixed(2),
        paymentDate: p.paymentDate.toISOString(),
      },
      dedupeKey: `${NotificationType.SALARY_OVERDUE}:${p.id}`,
    }));
  }

  async salesDropAlerts(
    store: StoreRef,
    now: Date,
  ): Promise<RaiseNotificationInput[]> {
    const currentStart = new Date(now.getTime() - 7 * DAY_MS);
    const previousStart = new Date(now.getTime() - 14 * DAY_MS);

    const rows = await this.prisma.$queryRaw<
      {
        window: 'current' | 'previous';
        currency: string;
        orderCount: number;
        netSales: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT
        CASE WHEN orders."processedAt" >= ${currentStart} THEN 'current' ELSE 'previous' END AS "window",
        orders."currency",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(orders."netSales"), 0) AS "netSales"
      FROM "EcommerceOrder" orders
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      WHERE connection."storeId" = ${store.id}
        AND connection."includeInRevenue" = true
        AND orders."financialStatus" IN ${INCLUDED_PAYMENT_STATUSES}
        AND orders."processedAt" >= ${previousStart}
        AND orders."processedAt" < ${now}
      GROUP BY 1, orders."currency"
    `);

    let current = new Prisma.Decimal(0);
    let previous = new Prisma.Decimal(0);
    let previousOrders = 0;
    for (const row of rows) {
      const amount =
        row.currency === store.baseCurrency
          ? new Prisma.Decimal(row.netSales)
          : await this.currency.convertAmount(
              row.netSales,
              row.currency,
              store.baseCurrency,
            );
      if (row.window === 'current') {
        current = current.plus(amount);
      } else {
        previous = previous.plus(amount);
        previousOrders += row.orderCount;
      }
    }

    if (previousOrders < SALES_DROP_MIN_PREVIOUS_ORDERS || previous.lte(0)) {
      return [];
    }
    const change = current.minus(previous).div(previous);
    if (change.gt(-SALES_DROP_THRESHOLD)) return [];

    const dropPercent = change.abs().times(100).toDecimalPlaces(0).toNumber();
    return [
      {
        storeId: store.id,
        type: NotificationType.SALES_DROP,
        title: 'Unusual sales drop',
        message: `Sales are down ${dropPercent}% vs last week.`,
        metadata: {
          currency: store.baseCurrency,
          currentNetSales: current.toFixed(2),
          previousNetSales: previous.toFixed(2),
          changePercent: change.times(100).toFixed(1),
        },
        dedupeKey: NotificationType.SALES_DROP,
      },
    ];
  }

  async platformAlerts(
    storeId: string,
  ): Promise<[NotificationType, RaiseNotificationInput[]][]> {
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: { storeId },
      select: {
        id: true,
        platform: true,
        displayName: true,
        status: true,
        lastSyncError: true,
      },
    });

    const disconnected: RaiseNotificationInput[] = [];
    const syncFailed: RaiseNotificationInput[] = [];
    for (const c of connections) {
      const label = c.displayName || PLATFORM_LABEL[c.platform] || c.platform;
      const base = {
        storeId,
        entityType: 'ECOMMERCE_CONNECTION',
        entityId: c.id,
        metadata: { platform: c.platform, status: c.status },
      };
      if (c.status !== EcommerceConnectionStatus.ACTIVE) {
        disconnected.push({
          ...base,
          type: NotificationType.PLATFORM_DISCONNECTED,
          title: `${label} is disconnected`,
          message:
            c.status === EcommerceConnectionStatus.REAUTHORIZATION_REQUIRED
              ? 'Reconnect it to resume syncing orders.'
              : 'Orders from this store are no longer syncing.',
          dedupeKey: `${NotificationType.PLATFORM_DISCONNECTED}:${c.id}`,
        });
      } else if (c.lastSyncError) {
        syncFailed.push({
          ...base,
          type: NotificationType.PLATFORM_SYNC_FAILED,
          title: `${label} sync failed`,
          message:
            'Recent orders may be missing until the next successful sync.',
          dedupeKey: `${NotificationType.PLATFORM_SYNC_FAILED}:${c.id}`,
        });
      }
    }
    return [
      [NotificationType.PLATFORM_DISCONNECTED, disconnected],
      [NotificationType.PLATFORM_SYNC_FAILED, syncFailed],
    ];
  }

  async courierAlerts(store: StoreRef): Promise<RaiseNotificationInput[]> {
    // Courier connections belong to the owner's user, not a store, so every
    // store they own shows the alert.
    const user = await this.prisma.user.findUnique({
      where: { id: store.userId },
      select: {
        quickLivraisonConnection: { select: { lastSyncError: true } },
        forceLogConnection: { select: { lastSyncError: true } },
        ozoneExpressConnection: { select: { lastSyncError: true } },
        ameexConnection: { select: { lastSyncError: true } },
      },
    });
    if (!user) return [];

    const couriers: [
      string,
      string,
      { lastSyncError: string | null } | null,
    ][] = [
      ['QUICKLIVRAISON', 'QuickLivraison', user.quickLivraisonConnection],
      ['FORCELOG', 'ForceLog', user.forceLogConnection],
      ['OZONEEXPRESS', 'OzoneExpress', user.ozoneExpressConnection],
      ['AMEEX', 'Ameex', user.ameexConnection],
    ];

    return couriers
      .filter(([, , conn]) => Boolean(conn?.lastSyncError))
      .map(([code, label]) => ({
        storeId: store.id,
        type: NotificationType.COURIER_SYNC_FAILED,
        title: `${label} sync failed`,
        message: 'Shipment statuses may be out of date.',
        entityType: 'SHIPPING_PROVIDER',
        entityId: code,
        metadata: { provider: code },
        dedupeKey: `${NotificationType.COURIER_SYNC_FAILED}:${code}`,
      }));
  }
}
