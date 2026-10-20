import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DuplicateOrderDecision,
  EcommerceOrderStatus,
  EcommercePlatform,
  Prisma,
} from '@prisma/client';
import { isUniqueConstraintError } from '../common/prisma-errors.util';
import { OrderEventType } from '../ecommerce/constants/order-event-type';
import { NotificationType } from '../notifications/notification-type';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CancelDuplicateOrdersResponseDto,
  DuplicateOrderDto,
  DuplicateOrderGroupDto,
  DuplicateOrdersResponseDto,
} from './dto/duplicate-orders.dto';
import {
  DUPLICATE_WINDOW_HOURS,
  DUPLICATE_WINDOW_MS,
  clusterDuplicateOrders,
  lineProductKeys,
  duplicateLinesMatch,
  type DuplicateCluster,
} from './duplicate-orders.util';

import { lockDuplicateReviewStore } from './duplicate-review-lock.util';

const DAY_MS = 86_400_000;
// Orders this far before the visible range still decide which order is
// "main", so the list and the cancel/keep checks always agree.
const LOOKBACK_MARGIN_MS = 7 * DAY_MS;
// First syncs import months of history; only alert on fresh orders.
const NOTIFY_MAX_AGE_MS = 2 * DAY_MS;

const ORDER_SELECT = {
  id: true,
  orderName: true,
  status: true,
  providerCreatedAt: true,
  totalCollected: true,
  currency: true,
  itemCount: true,
  connectionId: true,
  customerId: true,
  connection: { select: { platform: true } },
  dispatch: { select: { status: true } },
  customer: {
    select: { id: true, phone: true, name: true, isBlacklisted: true },
  },
  lines: {
    select: {
      name: true,
      quantity: true,
      sku: true,
      warehouseVariantId: true,
      externalProductId: true,
      externalVariantId: true,
    },
  },
} satisfies Prisma.EcommerceOrderSelect;

type OrderRow = Prisma.EcommerceOrderGetPayload<{
  select: typeof ORDER_SELECT;
}>;

interface Candidate {
  id: string;
  customerId: string;
  placedAt: Date;
  productKeys: Set<string>;
  row: OrderRow;
}

export function duplicateNotificationKey(mainOrderId: string): string {
  return `${NotificationType.DUPLICATE_ORDERS}:${mainOrderId}`;
}

/**
 * Risk Center → Duplicate Orders. Groups are computed from live orders on
 * every read (nothing to backfill or keep in sync); the merchant's
 * decisions are stored in DuplicateOrderReview and take those orders out
 * of detection.
 */
@Injectable()
export class DuplicateOrdersService {
  private readonly logger = new Logger(DuplicateOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    storeId: string,
    query: { days: number; page: number; limit: number },
  ): Promise<DuplicateOrdersResponseDto> {
    const now = new Date();
    const from = new Date(now.getTime() - query.days * DAY_MS);
    const clusters = (
      await this.detect(storeId, {
        from: new Date(from.getTime() - LOOKBACK_MARGIN_MS),
        to: now,
      })
    )
      .filter((c) => lastPlaced(c) >= from)
      .sort((a, b) => lastPlaced(b).getTime() - lastPlaced(a).getTime());

    const total = clusters.length;
    return {
      windowHours: DUPLICATE_WINDOW_HOURS,
      from: from.toISOString(),
      totalGroups: total,
      totalDuplicates: clusters.reduce((n, c) => n + c.duplicates.length, 0),
      data: clusters
        .slice((query.page - 1) * query.limit, query.page * query.limit)
        .map(toGroupDto),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * "Cancel selected". Manual orders are cancelled for real; platform orders
   * (Zomaal only has read access) are cancelled in Zomaal — dispatch is
   * blocked and the merchant is told to cancel on the platform too.
   */
  async cancel(
    storeId: string,
    userId: string,
    orderIds: string[],
  ): Promise<CancelDuplicateOrdersResponseDto> {
    let clusters: DuplicateCluster<Candidate>[] = [];
    const now = new Date();
    const cancelled: CancelDuplicateOrdersResponseDto['cancelled'] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockDuplicateReviewStore(tx, storeId);
        clusters = await this.clustersContaining(storeId, orderIds, tx);
        const selected = new Set(orderIds);
        const groupOf = new Map<string, DuplicateCluster<Candidate>>();
        for (const cluster of clusters) {
          for (const member of [cluster.main, ...cluster.duplicates]) {
            if (selected.has(member.id)) groupOf.set(member.id, cluster);
          }
          const remaining = [cluster.main, ...cluster.duplicates].filter(
            (m) => !selected.has(m.id),
          );
          if (remaining.length === 0) {
            throw new BadRequestException(
              `Keep at least one order from the group of ${label(cluster.main.row)}`,
            );
          }
        }
        const missing = orderIds.filter((id) => !groupOf.has(id));
        if (missing.length > 0) {
          throw new BadRequestException(
            `Not in a duplicate group: ${missing.join(', ')}`,
          );
        }

        for (const orderId of orderIds) {
          const cluster = groupOf.get(orderId)!;
          const order = [cluster.main, ...cluster.duplicates].find(
            (m) => m.id === orderId,
          )!.row;
          // Re-read inside the transaction: a dispatch may have started
          // since the groups were computed.
          const dispatch = await tx.ecommerceOrderDispatch.findUnique({
            where: { orderId },
            select: { status: true },
          });
          if (dispatch && dispatch.status !== 'FAILED') {
            throw new ConflictException(
              `${label(order)} was already sent to a courier and can't be cancelled here`,
            );
          }
          const mainOrderId =
            cluster.main.id === orderId
              ? (cluster.duplicates.find((d) => !selected.has(d.id))?.id ??
                null)
              : cluster.main.id;
          await tx.duplicateOrderReview.create({
            data: {
              storeId,
              orderId,
              mainOrderId,
              decision: DuplicateOrderDecision.CANCELLED,
              decidedByUserId: userId,
            },
          });

          const platform = order.connection.platform;
          const isManual = platform === EcommercePlatform.MANUAL;
          if (isManual) {
            await tx.ecommerceOrder.updateMany({
              where: {
                id: orderId,
                status: { not: EcommerceOrderStatus.CANCELLED },
              },
              data: {
                status: EcommerceOrderStatus.CANCELLED,
                cancelledAt: now,
              },
            });
          }
          const mainLabel = mainOrderId
            ? label(
                [cluster.main, ...cluster.duplicates].find(
                  (m) => m.id === mainOrderId,
                )!.row,
              )
            : 'another order';
          await tx.ecommerceOrderEvent.upsert({
            where: {
              orderId_providerEventId: {
                orderId,
                providerEventId: `system-duplicate-cancelled-${orderId}`,
              },
            },
            create: {
              orderId,
              providerEventId: `system-duplicate-cancelled-${orderId}`,
              source: 'SYSTEM',
              type: OrderEventType.DUPLICATE_ORDER_CANCELLED,
              title: 'Cancelled as a duplicate order',
              message: isManual
                ? `Duplicate of ${mainLabel}.`
                : `Duplicate of ${mainLabel}. Cancelled in Zomaal only — cancel it on ${platformName(platform)} too.`,
              metadata: { mainOrderId },
              occurredAt: now,
              synthetic: false,
            },
            update: {},
          });
          cancelled.push({
            orderId,
            orderName: order.orderName,
            platform,
            platformCancelRequired: !isManual,
          });
        }
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          'One of these orders was already reviewed — refresh the list',
        );
      }
      throw err;
    }

    await this.resolveAlerts(storeId, clusters);
    return { cancelled };
  }

  /** "These are real orders": marks every duplicate in the group as kept. */
  async keepGroup(
    storeId: string,
    userId: string,
    mainOrderId: string,
  ): Promise<{ kept: number }> {
    let resolved: DuplicateCluster<Candidate>[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await lockDuplicateReviewStore(tx, storeId);
      const cluster = (
        await this.clustersContaining(storeId, [mainOrderId], tx)
      ).find((c) => c.main.id === mainOrderId);
      if (!cluster) throw new NotFoundException('Duplicate group not found');
      const { count } = await tx.duplicateOrderReview.createMany({
        data: cluster.duplicates.map((d) => ({
          storeId,
          orderId: d.id,
          mainOrderId,
          decision: DuplicateOrderDecision.KEPT,
          decidedByUserId: userId,
        })),
        skipDuplicates: true,
      });
      resolved = [cluster];
      return { kept: count };
    });
    await this.resolveAlerts(storeId, resolved);
    return result;
  }

  /**
   * Called for every genuinely new order (CustomerRiskService.recordNewOrder,
   * after its lines are stored). Raises one alert per group.
   */
  async checkNewOrder(params: {
    storeId: string;
    customerId: string;
    orderId: string;
  }): Promise<void> {
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: params.orderId },
      select: { providerCreatedAt: true },
    });
    if (
      !order ||
      Date.now() - order.providerCreatedAt.getTime() > NOTIFY_MAX_AGE_MS
    ) {
      return;
    }
    const placed = order.providerCreatedAt.getTime();
    const cluster = (
      await this.detect(params.storeId, {
        customerIds: [params.customerId],
        from: new Date(placed - LOOKBACK_MARGIN_MS),
        to: new Date(placed + DUPLICATE_WINDOW_MS + 1),
      })
    ).find((c) => c.duplicates.some((d) => d.id === params.orderId));
    if (!cluster) return;

    const duplicate = cluster.duplicates.find((d) => d.id === params.orderId)!;
    await this.notifications.raise({
      storeId: params.storeId,
      type: NotificationType.DUPLICATE_ORDERS,
      title: 'Possible duplicate order',
      message: `${label(duplicate.row)} looks like a duplicate of ${label(cluster.main.row)} — same customer and product within ${DUPLICATE_WINDOW_HOURS} hours. Review it before shipping.`,
      entityType: 'ECOMMERCE_ORDER',
      entityId: params.orderId,
      metadata: { mainOrderId: cluster.main.id, customerId: params.customerId },
      dedupeKey: duplicateNotificationKey(cluster.main.id),
    });
  }

  /** True when the order was cancelled from the Duplicate Orders screen. */
  async isCancelledDuplicate(orderId: string): Promise<boolean> {
    const review = await this.prisma.duplicateOrderReview.findUnique({
      where: { orderId },
      select: { decision: true },
    });
    return review?.decision === DuplicateOrderDecision.CANCELLED;
  }

  private async clustersContaining(
    storeId: string,
    orderIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const orders = await db.ecommerceOrder.findMany({
      where: { id: { in: orderIds }, connection: { storeId } },
      select: { customerId: true, providerCreatedAt: true },
    });
    if (orders.length !== orderIds.length) {
      throw new NotFoundException('Order not found');
    }
    const customerIds = [
      ...new Set(
        orders.map((o) => o.customerId).filter((id): id is string => !!id),
      ),
    ];
    if (customerIds.length === 0) return [];
    const times = orders.map((o) => o.providerCreatedAt.getTime());
    return this.detect(
      storeId,
      {
        customerIds,
        from: new Date(Math.min(...times) - LOOKBACK_MARGIN_MS),
        to: new Date(Math.max(...times) + LOOKBACK_MARGIN_MS),
      },
      db,
    );
  }

  private async detect(
    storeId: string,
    range: { from: Date; to: Date; customerIds?: string[] },
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<DuplicateCluster<Candidate>[]> {
    const where: Prisma.EcommerceOrderWhereInput = {
      connection: { storeId },
      status: { not: EcommerceOrderStatus.CANCELLED },
      duplicateReview: { is: null },
      providerCreatedAt: { gte: range.from, lt: range.to },
      customerId: range.customerIds ? { in: range.customerIds } : { not: null },
    };
    let customerIds = range.customerIds;
    if (!customerIds) {
      const repeat = await db.ecommerceOrder.groupBy({
        by: ['customerId'],
        where,
        having: { customerId: { _count: { gt: 1 } } },
      });
      customerIds = repeat
        .map((r) => r.customerId)
        .filter((id): id is string => !!id);
    }
    if (customerIds.length === 0) return [];

    const rows = await db.ecommerceOrder.findMany({
      where: { ...where, customerId: { in: customerIds } },
      select: ORDER_SELECT,
    });
    return clusterDuplicateOrders(
      rows
        .filter((row) => row.customerId && row.customer)
        .map((row) => ({
          id: row.id,
          customerId: row.customerId!,
          placedAt: row.providerCreatedAt,
          productKeys: new Set(
            row.lines.flatMap((line) =>
              lineProductKeys(line, row.connectionId),
            ),
          ),
          row,
        })),
      DUPLICATE_WINDOW_MS,
      (a, b) =>
        a.row.lines.some((left) =>
          b.row.lines.some((right) =>
            duplicateLinesMatch(
              left,
              a.row.connectionId,
              right,
              b.row.connectionId,
            ),
          ),
        ),
    );
  }

  private async resolveAlerts(
    storeId: string,
    clusters: DuplicateCluster<Candidate>[],
  ): Promise<void> {
    await this.notifications
      .resolve(
        storeId,
        clusters.map((c) => duplicateNotificationKey(c.main.id)),
      )
      .catch((err: Error) =>
        this.logger.warn(`Duplicate alert resolve failed: ${err.message}`),
      );
  }
}

function lastPlaced(cluster: DuplicateCluster<Candidate>): Date {
  return cluster.duplicates[cluster.duplicates.length - 1].placedAt;
}

function label(row: { orderName: string | null; id: string }): string {
  return row.orderName
    ? `Order ${row.orderName}`
    : `Order ${row.id.slice(0, 8)}`;
}

function platformName(platform: EcommercePlatform): string {
  return platform.charAt(0) + platform.slice(1).toLowerCase();
}

function toOrderDto(row: OrderRow): DuplicateOrderDto {
  return {
    id: row.id,
    orderName: row.orderName,
    platform: row.connection.platform,
    status: row.status,
    placedAt: row.providerCreatedAt.toISOString(),
    totalCollected: row.totalCollected.toFixed(2),
    currency: row.currency,
    itemCount: row.itemCount,
    products: row.lines.map((l) => ({ name: l.name, quantity: l.quantity })),
    dispatchStatus: row.dispatch?.status ?? null,
    canCancel: !row.dispatch || row.dispatch.status === 'FAILED',
  };
}

function toGroupDto(
  cluster: DuplicateCluster<Candidate>,
): DuplicateOrderGroupDto {
  const customer = cluster.main.row.customer!;
  return {
    id: cluster.main.id,
    reason: 'SAME_PHONE_SAME_PRODUCT',
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      isBlacklisted: customer.isBlacklisted,
    },
    mainOrder: toOrderDto(cluster.main.row),
    duplicates: cluster.duplicates.map((d) => toOrderDto(d.row)),
    lastPlacedAt: lastPlaced(cluster).toISOString(),
  };
}
