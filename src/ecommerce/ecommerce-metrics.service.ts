import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EcommerceConnectionStatus, EcommercePlatform } from '@prisma/client';
import { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import { YouCanDataService } from '../youcan/youcan-data.service';
import type { EcommerceMetricsRefreshDto } from './dto/ecommerce-response.dto';

const LIGHTFUNNELS_COUNT_PAGE_SIZE = 100;
const LIGHTFUNNELS_MAX_COUNT_PAGES = 100;

type CountResult = { productCount: number; customerCount: number };

export interface ScheduledEcommerceMetricsResponse {
  selectedConnections: number;
  succeededConnections: number;
  failedConnections: number;
  failures: Array<{
    connectionId: string;
    platform: EcommercePlatform;
    message: string;
  }>;
}

@Injectable()
export class EcommerceMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyConnection: ShopifyConnectionService,
    private readonly youCanData: YouCanDataService,
    private readonly lightfunnelsConnection: LightfunnelsConnectionService,
  ) {}

  async refreshConnectionMetrics(
    userId: string,
    connectionId: string,
  ): Promise<EcommerceMetricsRefreshDto> {
    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: { id: connectionId, store: { userId } },
      select: { id: true, platform: true, status: true },
    });
    if (!connection) {
      throw new NotFoundException('E-commerce connection not found');
    }
    if (connection.status !== EcommerceConnectionStatus.ACTIVE) {
      throw new ConflictException(
        'Reconnect this e-commerce account before refreshing metrics',
      );
    }

    try {
      const counts = await this.countsFor(userId, connection.platform);
      const metricsSyncedAt = new Date();
      await this.prisma.ecommerceConnection.update({
        where: { id: connection.id },
        data: {
          ...counts,
          metricsSyncedAt,
          lastMetricsError: null,
        },
      });
      return {
        connectionId: connection.id,
        platform: connection.platform,
        ...counts,
        metricsSyncedAt: metricsSyncedAt.toISOString(),
      };
    } catch (error) {
      await this.prisma.ecommerceConnection.updateMany({
        where: { id: connection.id },
        data: { lastMetricsError: safeErrorMessage(error) },
      });
      throw error;
    }
  }

  async refreshAllActiveConnections(): Promise<ScheduledEcommerceMetricsResponse> {
    const staleBefore = new Date(Date.now() - 15 * 60_000);
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: {
        status: EcommerceConnectionStatus.ACTIVE,
        OR: [
          { metricsSyncedAt: null },
          { metricsSyncedAt: { lte: staleBefore } },
        ],
      },
      select: {
        id: true,
        platform: true,
        store: { select: { userId: true } },
      },
      orderBy: [{ metricsSyncedAt: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    const failures: ScheduledEcommerceMetricsResponse['failures'] = [];
    let succeededConnections = 0;
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const connection = connections[nextIndex++];
        if (!connection) {
          return;
        }
        try {
          await this.refreshConnectionMetrics(
            connection.store.userId,
            connection.id,
          );
          succeededConnections++;
        } catch (error) {
          failures.push({
            connectionId: connection.id,
            platform: connection.platform,
            message: safeErrorMessage(error),
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, connections.length) }, worker),
    );

    return {
      selectedConnections: connections.length,
      succeededConnections,
      failedConnections: failures.length,
      failures,
    };
  }

  private countsFor(
    userId: string,
    platform: EcommercePlatform,
  ): Promise<CountResult> {
    switch (platform) {
      case EcommercePlatform.SHOPIFY:
        return this.shopifyCounts(userId);
      case EcommercePlatform.YOUCAN:
        return this.youCanCounts(userId);
      case EcommercePlatform.LIGHTFUNNELS:
        return this.lightfunnelsCounts(userId);
    }
  }

  private async shopifyCounts(userId: string): Promise<CountResult> {
    const data = await this.shopifyConnection.graphqlForUser<{
      productsCount?: { count?: unknown };
      customersCount?: { count?: unknown };
    }>(
      userId,
      `#graphql
        query ZomaalHomeCounts {
          productsCount(limit: null) { count }
          customersCount(limit: null) { count }
        }
      `,
    );
    return {
      productCount: requiredCount(data.productsCount?.count, 'product'),
      customerCount: requiredCount(data.customersCount?.count, 'customer'),
    };
  }

  private async youCanCounts(userId: string): Promise<CountResult> {
    const [products, customers] = await Promise.all([
      this.youCanData.listProducts(userId, { page: 1, limit: 1 }),
      this.youCanData.listCustomers(userId, { page: 1, limit: 1 }),
    ]);
    return {
      productCount: paginationTotal(products, 'product'),
      customerCount: paginationTotal(customers, 'customer'),
    };
  }

  private async lightfunnelsCounts(userId: string): Promise<CountResult> {
    const [productCount, customerCount] = await Promise.all([
      this.countLightfunnelsResource(userId, 'products'),
      this.countLightfunnelsResource(userId, 'customers'),
    ]);
    return { productCount, customerCount };
  }

  private async countLightfunnelsResource(
    userId: string,
    resource: 'products' | 'customers',
  ): Promise<number> {
    let after: string | null = null;
    let count = 0;
    for (let page = 0; page < LIGHTFUNNELS_MAX_COUNT_PAGES; page++) {
      const response =
        await this.lightfunnelsConnection.graphqlForUser<unknown>(
          userId,
          `query ZomaalCount${resource === 'products' ? 'Products' : 'Customers'}(
          $first: Int!
          $after: String
        ) {
          ${resource}(first: $first, after: $after, query: "") {
            edges { node { id } }
            pageInfo { hasNextPage endCursor }
          }
          }`,
          { first: LIGHTFUNNELS_COUNT_PAGE_SIZE, after },
          resource,
        );
      const connection = asRecord(asRecord(response)[resource]);
      const edges = connection.edges;
      if (!Array.isArray(edges)) {
        throw new BadGatewayException(
          `Lightfunnels returned an invalid ${resource} count response`,
        );
      }
      count += edges.length;
      const pageInfo = asRecord(connection.pageInfo);
      if (pageInfo.hasNextPage !== true) {
        return count;
      }
      if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor) {
        throw new BadGatewayException(
          `Lightfunnels did not return a ${resource} count cursor`,
        );
      }
      after = pageInfo.endCursor;
    }
    throw new BadGatewayException(
      `Lightfunnels ${resource} count exceeded the safe 10000-record scan limit`,
    );
  }
}

function paginationTotal(value: unknown, resource: string): number {
  const record = asRecord(value);
  const meta = asRecord(record.meta);
  const pagination = asRecord(meta.pagination);
  const total = pagination.total ?? meta.total;
  return requiredCount(total, resource);
}

function requiredCount(value: unknown, resource: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new BadGatewayException(
      `Provider returned an invalid ${resource} count`,
    );
  }
  return count;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Metric refresh failed';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}
