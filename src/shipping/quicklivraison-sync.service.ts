import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { QuickLivraisonClient } from './quicklivraison.client';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { QuickLivraisonShipmentService } from './quicklivraison-shipment.service';

@Injectable()
export class QuickLivraisonSyncService {
  private readonly logger = new Logger(QuickLivraisonSyncService.name);

  constructor(
    private readonly client: QuickLivraisonClient,
    private readonly connection: QuickLivraisonConnectionService,
    private readonly shipments: QuickLivraisonShipmentService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async sync(userId: string) {
    try {
      const apiKey = await this.connection.getApiKey(userId);
      const response = await this.client.listDeliveries(apiKey);
      const result = await this.shipments.reconcileProviderDeliveries(
        userId,
        response,
      );
      const syncedAt = new Date();
      await this.connection.updateSyncHealth(userId, syncedAt, null);

      return {
        success: true,
        message: 'QuickLivraison shipments synchronized',
        ...result,
        syncedAt: syncedAt.toISOString(),
      };
    } catch (error) {
      await this.connection.updateSyncHealth(
        userId,
        null,
        safeErrorMessage(error),
      );
      throw error;
    }
  }

  async syncAllActiveConnections() {
    const startedAt = new Date();
    const minIntervalMinutes = this.configService.get<number>(
      'QUICKLIVRAISON_SYNC_MIN_INTERVAL_MINUTES',
      15,
    );
    const maxConnections = this.configService.get<number>(
      'QUICKLIVRAISON_SYNC_MAX_CONNECTIONS',
      100,
    );
    const concurrency = this.configService.get<number>(
      'QUICKLIVRAISON_SYNC_CONCURRENCY',
      2,
    );
    const staleBefore = new Date(
      startedAt.getTime() - minIntervalMinutes * 60_000,
    );
    const connections = await this.prisma.quickLivraisonConnection.findMany({
      where: {
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lte: staleBefore } },
          { lastSyncError: { not: null } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: [{ lastSyncedAt: 'asc' }, { connectedAt: 'asc' }],
      take: maxConnections,
    });

    let nextIndex = 0;
    let succeededConnections = 0;
    let processedShipments = 0;
    const failures: Array<{
      connectionId: string;
      message: string;
    }> = [];
    const worker = async () => {
      while (true) {
        const connection = connections[nextIndex++];
        if (!connection) return;
        try {
          const result = await this.sync(connection.userId);
          succeededConnections += 1;
          processedShipments += result.processed;
        } catch (error) {
          const message = safeErrorMessage(error);
          failures.push({ connectionId: connection.id, message });
          this.logger.warn(
            `Scheduled QuickLivraison sync failed for connection ${connection.id}: ${message}`,
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, connections.length) }, worker),
    );

    return {
      selectedConnections: connections.length,
      succeededConnections,
      failedConnections: failures.length,
      processedShipments,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      failures,
    };
  }
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 1000);
  }
  return 'QuickLivraison synchronization failed';
}
