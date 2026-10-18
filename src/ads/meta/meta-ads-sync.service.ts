import { Injectable, Logger } from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsConnectionService } from '../ads-connection.service';
import { activeAccountWhere } from '../../billing/subscription-status.util';
import {
  MetaAdsApiService,
  metaResultCount,
  type MetaDailyInsight,
} from './meta-ads-api.service';
import { MetaAdsAuthService } from './meta-ads-auth.service';

// Meta keeps attributing conversions for up to 28 days after a click, so
// every run re-pulls that window. One insights query per ad account covers
// every tracked campaign.
const SYNC_LOOKBACK_DAYS = 28;

export interface ScheduledMetaAdsSyncResponse {
  connectionsProcessed: number;
  connectionsFailed: number;
  campaignsSynced: number;
  snapshotsUpserted: number;
}

@Injectable()
export class MetaAdsSyncService {
  private readonly logger = new Logger(MetaAdsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaApi: MetaAdsApiService,
    private readonly metaAuth: MetaAdsAuthService,
    private readonly connections: AdsConnectionService,
  ) {}

  /** POST /internal/ads/meta/sync (Cloud Scheduler). */
  async syncAllActiveConnections(): Promise<ScheduledMetaAdsSyncResponse> {
    const result: ScheduledMetaAdsSyncResponse = {
      connectionsProcessed: 0,
      connectionsFailed: 0,
      campaignsSynced: 0,
      snapshotsUpserted: 0,
    };
    if (!this.metaApi.isEnabled()) return result;

    const active = await this.prisma.adsConnection.findMany({
      where: {
        platform: AdsPlatform.META,
        status: AdsConnectionStatus.ACTIVE,
        store: { user: activeAccountWhere() },
        campaigns: { some: { tracked: true } },
      },
      select: {
        id: true,
        _count: { select: { campaigns: { where: { tracked: true } } } },
      },
    });

    for (const connection of active) {
      try {
        result.snapshotsUpserted += await this.syncConnection(connection.id);
        result.connectionsProcessed += 1;
        result.campaignsSynced += connection._count.campaigns;
      } catch (error) {
        result.connectionsFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Meta Ads sync failed for connection ${connection.id}: ${message}`,
        );
        await this.prisma.adsConnection.update({
          where: { id: connection.id },
          data: { lastSyncError: message.slice(0, 500) },
        });
      }
    }
    return result;
  }

  async syncConnection(
    connectionId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const connection = await this.prisma.adsConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: {
        campaigns: { where: { tracked: true } },
        store: { select: { baseCurrency: true } },
      },
    });
    if (connection.campaigns.length === 0) return 0;

    const byExternalId = new Map(
      connection.campaigns.map((c) => [c.externalCampaignId, c]),
    );
    const endDate = dateOnly(now);
    const startDate = dateOnly(
      new Date(now.getTime() - SYNC_LOOKBACK_DAYS * 86_400_000),
    );

    const accessToken = await this.metaAuth.getValidAccessToken(connection);
    let insights: MetaDailyInsight[];
    try {
      insights = await this.metaApi.getDailyInsights(
        accessToken,
        connection.externalAdvertiserId,
        [...byExternalId.keys()],
        startDate,
        endDate,
      );
    } catch (error) {
      if (this.metaApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
      }
      throw error;
    }

    let upserted = 0;
    for (const day of insights) {
      const campaign = byExternalId.get(day.externalCampaignId);
      if (!campaign) continue;
      const date = new Date(`${day.date}T00:00:00Z`);
      const results = metaResultCount(campaign.objective, day.actions);
      const values = {
        spend: new Prisma.Decimal(day.spend),
        clicks: day.linkClicks,
        impressions: day.impressions,
        results,
        reach: day.reach,
        frequency: decimalOrNull(day.frequency),
        cpm: decimalOrNull(day.cpm),
        ctr: decimalOrNull(day.ctr),
        costPerResult: results ? decimalOrNull(day.spend / results) : null,
        conversionRate: day.linkClicks
          ? decimalOrNull((results / day.linkClicks) * 100)
          : null,
        rawPayload: day.raw as Prisma.InputJsonValue,
      };
      await this.prisma.adsMetricSnapshot.upsert({
        where: { campaignId_date: { campaignId: campaign.id, date } },
        create: {
          campaignId: campaign.id,
          date,
          currency: connection.currency ?? connection.store.baseCurrency,
          ...values,
        },
        update: values,
      });
      upserted += 1;
    }

    await this.prisma.adsConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });
    return upserted;
  }
}

function decimalOrNull(value: number | null): Prisma.Decimal | null {
  return value !== null && Number.isFinite(value)
    ? new Prisma.Decimal(value.toFixed(4))
    : null;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
