import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EcommerceConnectionStatus, EcommercePlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { EcommerceSyncResponseDto } from './dto/ecommerce-response.dto';
import {
  ShopifyRevenueAdapter,
  type NormalizedEcommerceOrder,
} from './shopify-revenue.adapter';

const MAX_PAGES_PER_REQUEST = 5;

@Injectable()
export class EcommerceSyncService {
  private readonly runningSyncs = new Map<
    string,
    Promise<EcommerceSyncResponseDto>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyAdapter: ShopifyRevenueAdapter,
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
      include: { shopifyConnection: true },
    });

    if (!connection) {
      throw new NotFoundException('E-commerce connection not found');
    }
    if (
      connection.status !== EcommerceConnectionStatus.ACTIVE ||
      (connection.platform === EcommercePlatform.SHOPIFY &&
        !connection.shopifyConnection)
    ) {
      throw new ConflictException(
        'Reconnect this e-commerce account before synchronizing it',
      );
    }

    const running = this.runningSyncs.get(connection.id);
    if (running) {
      return running;
    }

    const sync = this.runShopifySync(userId, connection).finally(() => {
      this.runningSyncs.delete(connection.id);
    });
    this.runningSyncs.set(connection.id, sync);
    return sync;
  }

  private async runShopifySync(
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
    if (connection.platform !== EcommercePlatform.SHOPIFY) {
      throw new ConflictException(
        'Synchronization is not supported for this e-commerce platform',
      );
    }

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
        const page = await this.shopifyAdapter.fetchOrdersPage(
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
            'Shopify returned an invalid pagination cursor',
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
