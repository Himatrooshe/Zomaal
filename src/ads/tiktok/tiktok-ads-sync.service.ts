import { Injectable, Logger } from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsConnectionService } from '../ads-connection.service';
import { TikTokAdsApiService, type TikTokDailyMetric } from './tiktok-ads-api.service';

const SYNC_LOOKBACK_DAYS = 7; // re-pull the last week every run — TikTok
// reporting numbers get revised for a few days after the fact (attribution
// windows), so a same-day-only pull would leave stale numbers behind.

export interface ScheduledTikTokAdsSyncResponse {
  connectionsProcessed: number;
  connectionsFailed: number;
  campaignsSynced: number;
  snapshotsUpserted: number;
}

@Injectable()
export class TikTokAdsSyncService {
  private readonly logger = new Logger(TikTokAdsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokApi: TikTokAdsApiService,
    private readonly connections: AdsConnectionService,
  ) {}

  // Called by POST /internal/ads/tiktok/sync (Cloud Scheduler), same shape
  // as EcommerceSchedulerController — pulls fresh metrics for every tracked
  // campaign on every ACTIVE TikTok connection across all stores.
  async syncAllActiveConnections(): Promise<ScheduledTikTokAdsSyncResponse> {
    const result: ScheduledTikTokAdsSyncResponse = {
      connectionsProcessed: 0,
      connectionsFailed: 0,
      campaignsSynced: 0,
      snapshotsUpserted: 0,
    };

    const activeConnections = await this.prisma.adsConnection.findMany({
      where: { platform: AdsPlatform.TIKTOK, status: AdsConnectionStatus.ACTIVE },
      include: { campaigns: { where: { tracked: true } } },
    });

    for (const connection of activeConnections) {
      if (connection.campaigns.length === 0) {
        continue; // nothing selected yet on "Select Campaigns" — nothing to sync
      }

      try {
        const upserted = await this.syncConnection(connection.id);
        result.connectionsProcessed += 1;
        result.campaignsSynced += connection.campaigns.length;
        result.snapshotsUpserted += upserted;
      } catch (error) {
        result.connectionsFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `TikTok Ads sync failed for connection ${connection.id}: ${message}`,
        );
        await this.prisma.adsConnection.update({
          where: { id: connection.id },
          data: { lastSyncError: message },
        });
      }
    }

    return result;
  }

  async syncConnection(connectionId: string): Promise<number> {
    const connection = await this.prisma.adsConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { campaigns: { where: { tracked: true } } },
    });
    if (connection.campaigns.length === 0) {
      return 0;
    }

    const accessToken = await this.connections.getAccessToken(connection);
    const campaignByExternalId = new Map(
      connection.campaigns.map((campaign) => [campaign.externalCampaignId, campaign]),
    );

    const endDate = dateOnly(new Date());
    const startDate = dateOnly(
      new Date(Date.now() - SYNC_LOOKBACK_DAYS * 86_400_000),
    );

    let metrics: TikTokDailyMetric[];
    try {
      metrics = await this.tiktokApi.getDailyMetrics(
        accessToken,
        connection.externalAdvertiserId,
        [...campaignByExternalId.keys()],
        startDate,
        endDate,
      );
    } catch (error) {
      if (this.tiktokApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
      }
      throw error;
    }

    let upserted = 0;
    for (const metric of metrics) {
      const campaign = campaignByExternalId.get(metric.externalCampaignId);
      if (!campaign) {
        continue; // metric for a campaign that isn't tracked (or is stale) — ignore
      }
      await this.prisma.adsMetricSnapshot.upsert({
        where: {
          campaignId_date: {
            campaignId: campaign.id,
            date: new Date(`${metric.date}T00:00:00Z`),
          },
        },
        create: {
          campaignId: campaign.id,
          date: new Date(`${metric.date}T00:00:00Z`),
          spend: new Prisma.Decimal(metric.spend),
          clicks: metric.clicks,
          impressions: metric.impressions,
          results: metric.results,
          reach: metric.reach !== null ? Math.trunc(metric.reach) : null,
          frequency: metric.frequency !== null ? new Prisma.Decimal(metric.frequency) : null,
          cpm: metric.cpm !== null ? new Prisma.Decimal(metric.cpm) : null,
          ctr: metric.ctr !== null ? new Prisma.Decimal(metric.ctr) : null,
          costPerResult:
            metric.costPerResult !== null ? new Prisma.Decimal(metric.costPerResult) : null,
          conversionRate:
            metric.conversionRate !== null ? new Prisma.Decimal(metric.conversionRate) : null,
          currency: connection.currency ?? 'USD',
          rawPayload: metric.raw as Prisma.InputJsonValue,
        },
        update: {
          spend: new Prisma.Decimal(metric.spend),
          clicks: metric.clicks,
          impressions: metric.impressions,
          results: metric.results,
          reach: metric.reach !== null ? Math.trunc(metric.reach) : null,
          frequency: metric.frequency !== null ? new Prisma.Decimal(metric.frequency) : null,
          cpm: metric.cpm !== null ? new Prisma.Decimal(metric.cpm) : null,
          ctr: metric.ctr !== null ? new Prisma.Decimal(metric.ctr) : null,
          costPerResult:
            metric.costPerResult !== null ? new Prisma.Decimal(metric.costPerResult) : null,
          conversionRate:
            metric.conversionRate !== null ? new Prisma.Decimal(metric.conversionRate) : null,
          rawPayload: metric.raw as Prisma.InputJsonValue,
        },
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

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
