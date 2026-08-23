import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { EcommerceSyncResponseDto } from './dto/ecommerce-response.dto';
import type {
  EcommerceRevenueAdapter,
  NormalizedEcommerceOrder,
} from './interfaces/ecommerce-revenue-adapter.interface';
import { LightfunnelsRevenueAdapter } from './lightfunnels-revenue.adapter';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';
import { YouCanRevenueAdapter } from './youcan-revenue.adapter';
import { EcommerceOrderTimelineService } from './ecommerce-order-timeline.service';

const MAX_PAGES_PER_REQUEST = 5;

export interface ScheduledEcommerceSyncFailure {
  connectionId: string;
  platform: EcommercePlatform;
  message: string;
}

export interface ScheduledEcommerceSyncResponse {
  selectedConnections: number;
  succeededConnections: number;
  failedConnections: number;
  pendingConnections: number;
  processedOrders: number;
  startedAt: string;
  finishedAt: string;
  failures: ScheduledEcommerceSyncFailure[];
}

@Injectable()
export class EcommerceSyncService {
  private readonly logger = new Logger(EcommerceSyncService.name);
  private readonly runningSyncs = new Map<
    string,
    Promise<EcommerceSyncResponseDto>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly lightfunnelsAdapter: LightfunnelsRevenueAdapter,
    private readonly shopifyAdapter: ShopifyRevenueAdapter,
    private readonly youCanAdapter: YouCanRevenueAdapter,
    private readonly configService: ConfigService,
    private readonly timelineService: EcommerceOrderTimelineService,
  ) {}

  async syncConnection(
    userId: string,
    connectionId: string,
  ): Promise<EcommerceSyncResponseDto> {
    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: {
        id: connectionId,
        store: { userId },
      },
      include: {
        shopifyConnection: true,
        youCanConnection: true,
        lightfunnelsConnection: true,
      },
    });

    if (!connection) {
      throw new NotFoundException('E-commerce connection not found');
    }
    if (
      connection.status !== EcommerceConnectionStatus.ACTIVE ||
      (connection.platform === EcommercePlatform.SHOPIFY &&
        !connection.shopifyConnection) ||
      (connection.platform === EcommercePlatform.YOUCAN &&
        !connection.youCanConnection) ||
      (connection.platform === EcommercePlatform.LIGHTFUNNELS &&
        !connection.lightfunnelsConnection)
    ) {
      throw new ConflictException(
        'Reconnect this e-commerce account before synchronizing it',
      );
    }

    const running = this.runningSyncs.get(connection.id);
    if (running) {
      return running;
    }

    const sync = this.runSync(userId, connection).finally(() => {
      this.runningSyncs.delete(connection.id);
    });
    this.runningSyncs.set(connection.id, sync);
    return sync;
  }

  async syncAllActiveConnections(): Promise<ScheduledEcommerceSyncResponse> {
    const startedAt = new Date();
    const maxConnections = this.configService.get<number>(
      'ECOMMERCE_SYNC_MAX_CONNECTIONS',
      100,
    );
    const concurrency = this.configService.get<number>(
      'ECOMMERCE_SYNC_CONCURRENCY',
      2,
    );
    const minIntervalMinutes = this.configService.get<number>(
      'ECOMMERCE_SYNC_MIN_INTERVAL_MINUTES',
      15,
    );
    const staleBefore = new Date(
      startedAt.getTime() - minIntervalMinutes * 60_000,
    );

    const connections = await this.prisma.ecommerceConnection.findMany({
      where: {
        status: EcommerceConnectionStatus.ACTIVE,
        OR: [
          { syncStartedAt: { not: null } },
          { lastSyncedAt: null },
          { lastSyncedAt: { lte: staleBefore } },
        ],
      },
      select: {
        id: true,
        platform: true,
        store: { select: { userId: true } },
      },
      orderBy: [{ lastSyncedAt: 'asc' }, { createdAt: 'asc' }],
      take: maxConnections,
    });

    const failures: ScheduledEcommerceSyncFailure[] = [];
    let nextIndex = 0;
    let succeededConnections = 0;
    let pendingConnections = 0;
    let processedOrders = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        const connection = connections[index];
        if (!connection) {
          return;
        }

        try {
          const result = await this.syncConnection(
            connection.store.userId,
            connection.id,
          );
          succeededConnections++;
          processedOrders += result.processedOrders;
          if (result.hasMore) {
            pendingConnections++;
          }
        } catch (error) {
          const message = safeErrorMessage(error);
          failures.push({
            connectionId: connection.id,
            platform: connection.platform,
            message,
          });
          this.logger.warn(
            `Scheduled ${connection.platform} sync failed for connection ${connection.id}: ${message}`,
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, connections.length) }, worker),
    );

    const result: ScheduledEcommerceSyncResponse = {
      selectedConnections: connections.length,
      succeededConnections,
      failedConnections: failures.length,
      pendingConnections,
      processedOrders,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      failures,
    };

    this.logger.log(
      `Scheduled e-commerce sync finished: ${result.succeededConnections} succeeded, ${result.failedConnections} failed, ${result.processedOrders} orders processed`,
    );

    return result;
  }

  private async runSync(
    userId: string,
    connection: {
      id: string;
      storeId: string;
      platform: EcommercePlatform;
      syncCursor: string | null;
      syncFrom: Date | null;
      syncStartedAt: Date | null;
      lastSyncedAt: Date | null;
    },
  ): Promise<EcommerceSyncResponseDto> {
    const adapter = this.adapterFor(connection.platform);

    let cursor = connection.syncCursor;
    const syncFrom =
      connection.syncStartedAt !== null
        ? connection.syncFrom
        : connection.lastSyncedAt;
    const syncStartedAt = connection.syncStartedAt ?? new Date();
    let processedOrders = 0;

    await this.prisma.ecommerceConnection.update({
      where: { id: connection.id },
      data: {
        syncFrom,
        syncStartedAt,
        lastSyncError: null,
      },
    });

    try {
      for (
        let pageNumber = 0;
        pageNumber < MAX_PAGES_PER_REQUEST;
        pageNumber++
      ) {
        const page = await adapter.fetchOrdersPage(
          userId,
          cursor,
          syncFrom,
          syncStartedAt,
        );
        await this.persistOrders(connection.id, connection.storeId, page.orders, connection.platform);
        processedOrders += page.orders.length;

        if (!page.hasNextPage) {
          await this.prisma.ecommerceConnection.update({
            where: { id: connection.id },
            data: {
              syncCursor: null,
              syncFrom: null,
              syncStartedAt: null,
              lastSyncedAt: syncStartedAt,
              lastSyncError: null,
              includeInRevenue: true,
            },
          });
          return {
            connectionId: connection.id,
            platform: connection.platform,
            processedOrders,
            hasMore: false,
            lastSyncedAt: syncStartedAt.toISOString(),
          };
        }

        if (!page.endCursor) {
          throw new BadGatewayException(
            `${connection.platform} returned an invalid pagination cursor`,
          );
        }
        cursor = page.endCursor;
        await this.prisma.ecommerceConnection.update({
          where: { id: connection.id },
          data: { syncCursor: cursor },
        });
      }

      return {
        connectionId: connection.id,
        platform: connection.platform,
        processedOrders,
        hasMore: true,
        lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      };
    } catch (error) {
      await this.prisma.ecommerceConnection.updateMany({
        where: { id: connection.id },
        data: { lastSyncError: safeErrorMessage(error) },
      });
      throw error;
    }
  }

  private adapterFor(platform: EcommercePlatform): EcommerceRevenueAdapter {
    switch (platform) {
      case EcommercePlatform.SHOPIFY:
        return this.shopifyAdapter;
      case EcommercePlatform.YOUCAN:
        return this.youCanAdapter;
      case EcommercePlatform.LIGHTFUNNELS:
        return this.lightfunnelsAdapter;
      default:
        throw new ConflictException(
          'Synchronization is not supported for this e-commerce platform',
        );
    }
  }

  private async persistOrders(
    connectionId: string,
    storeId: string,
    orders: NormalizedEcommerceOrder[],
    platform: EcommercePlatform,
  ): Promise<void> {
    if (orders.length === 0) return;

    // For YouCan and Lightfunnels we detect status changes and persist timeline
    // events. We fetch the current state before the upsert in one batched query.
    const previousStateMap = new Map<
      string,
      { id: string; financialStatus: string; fulfillmentStatus: string | null }
    >();

    if (
      platform === EcommercePlatform.YOUCAN ||
      platform === EcommercePlatform.LIGHTFUNNELS
    ) {
      const existing = await this.prisma.ecommerceOrder.findMany({
        where: {
          connectionId,
          externalOrderId: { in: orders.map((o) => o.externalOrderId) },
        },
        select: { id: true, externalOrderId: true, financialStatus: true, fulfillmentStatus: true },
      });
      for (const row of existing) {
        previousStateMap.set(row.externalOrderId, row);
      }
    }

    // Upsert all orders — strip `lines` from the spread (lines are persisted separately below)
    const upserted = await this.prisma.$transaction(
      orders.map(({ lines: _lines, ...order }) =>
        this.prisma.ecommerceOrder.upsert({
          where: {
            connectionId_externalOrderId: {
              connectionId,
              externalOrderId: order.externalOrderId,
            },
          },
          create: { connectionId, ...order },
          update: order,
          select: { id: true, externalOrderId: true },
        }),
      ),
    );

    // Build a SKU → warehouseVariantId map for this store so lines can be linked immediately
    const allSkus = orders
      .flatMap((o) => o.lines.map((l) => l.sku))
      .filter((s): s is string => !!s);
    const variantBySku = new Map<string, string>();
    if (allSkus.length > 0) {
      const variants = await this.prisma.warehouseVariant.findMany({
        where: { storeId, sku: { in: allSkus } },
        select: { id: true, sku: true },
      });
      for (const v of variants) {
        if (v.sku) variantBySku.set(v.sku.toLowerCase(), v.id);
      }
    }

    // Persist order lines — replace all lines for each order (sync is authoritative)
    for (let i = 0; i < orders.length; i++) {
      const { id: orderId } = upserted[i];
      const lines = orders[i].lines;
      if (!lines || lines.length === 0) continue;

      await this.prisma.ecommerceOrderLine.deleteMany({ where: { orderId } });
      await this.prisma.ecommerceOrderLine.createMany({
        data: lines.map((line) => ({
          orderId,
          externalLineId:    line.externalLineId,
          externalProductId: line.externalProductId,
          externalVariantId: line.externalVariantId,
          sku:               line.sku,
          name:              line.name,
          quantity:          line.quantity,
          unitPrice:         line.unitPrice,
          totalPrice:        line.totalPrice,
          currency:          line.currency,
          warehouseVariantId: line.sku
            ? (variantBySku.get(line.sku.toLowerCase()) ?? null)
            : null,
        })),
        skipDuplicates: true,
      });
    }

    // Detect and store status transitions for non-Shopify platforms
    if (
      platform === EcommercePlatform.YOUCAN ||
      platform === EcommercePlatform.LIGHTFUNNELS
    ) {
      const source = platform === EcommercePlatform.YOUCAN ? 'YOUCAN' : 'LIGHTFUNNELS';

      for (let i = 0; i < orders.length; i++) {
        const incoming = orders[i];
        const previous = previousStateMap.get(incoming.externalOrderId);
        if (!previous) continue; // new order — no prior state to diff

        const { id: orderId } = upserted[i];
        await this.timelineService
          .detectAndStoreChanges(
            orderId,
            { financialStatus: previous.financialStatus as any, fulfillmentStatus: previous.fulfillmentStatus },
            { financialStatus: incoming.financialStatus, fulfillmentStatus: incoming.fulfillmentStatus },
            source,
            incoming.providerUpdatedAt,
          )
          .catch((err) =>
            this.logger.warn(`Timeline change detection failed for order ${orderId}: ${String(err)}`),
          );
      }
    }
  }
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Order synchronization failed';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}
