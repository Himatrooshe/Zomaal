import { Injectable } from '@nestjs/common';
import type { SenditSyncQueryDto } from './dto/sendit-sync-query.dto';
import { SenditClient } from './sendit.client';
import { SenditConnectionService } from './sendit-connection.service';
import { SenditShipmentService } from './sendit-shipment.service';

@Injectable()
export class SenditSyncService {
  constructor(
    private readonly client: SenditClient,
    private readonly connection: SenditConnectionService,
    private readonly shipments: SenditShipmentService,
  ) {}

  async sync(userId: string, query: SenditSyncQueryDto) {
    const credentials = await this.connection.getCredentials(userId);
    const maxPages = query.maxPages ?? 5;
    let page = query.startPage ?? 1;
    let pagesSynced = 0;
    let processed = 0;
    let imported = 0;
    let reconciled = 0;
    let nextPage: number | null = null;
    let providerTotal: number | null = null;

    while (pagesSynced < maxPages) {
      const response = await this.client.listDeliveries(userId, credentials, {
        page,
      });
      const result = await this.shipments.reconcileProviderPage(
        userId,
        response,
      );
      pagesSynced += 1;
      processed += result.processed;
      imported += result.imported;
      reconciled += result.reconciled;
      providerTotal = result.providerTotal ?? providerTotal;

      if (!result.hasMore) {
        nextPage = null;
        break;
      }

      page = Math.max(page + 1, result.currentPage + 1);
      nextPage = page;
    }

    return {
      success: true,
      message: 'Sendit shipments synchronized',
      pagesSynced,
      processed,
      imported,
      reconciled,
      nextPage,
      providerTotal,
      syncedAt: new Date().toISOString(),
    };
  }
}
