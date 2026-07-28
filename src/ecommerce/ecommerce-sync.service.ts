import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EcommerceConnectionStatus, EcommercePlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { EcommerceSyncResponseDto } from './dto/ecommerce-response.dto';
import type {
  EcommerceRevenueAdapter,
  NormalizedEcommerceOrder,
} from './interfaces/ecommerce-revenue-adapter.interface';
import { LightfunnelsRevenueAdapter } from './lightfunnels-revenue.adapter';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';
import { YouCanRevenueAdapter } from './youcan-revenue.adapter';

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
        await this.persistOrders(connection.id, page.orders);
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
    orders: NormalizedEcommerceOrder[],
  ): Promise<void> {
    if (orders.length === 0) {
      return;
    }

    await this.prisma.$transaction(
      orders.map((order) =>
        this.prisma.ecommerceOrder.upsert({
          where: {
            connectionId_externalOrderId: {
              connectionId,
              externalOrderId: order.externalOrderId,
            },
          },
          create: { connectionId, ...order },
          update: order,
        }),
      ),
    );
  }
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Order synchronization failed';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}
