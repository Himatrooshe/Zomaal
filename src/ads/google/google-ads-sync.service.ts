import { Injectable, Logger } from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsConnectionService } from '../ads-connection.service';
import { activeAccountWhere } from '../../billing/subscription-status.util';
import {
  GoogleAdsApiService,
  type GoogleAdsDailyMetric,
} from './google-ads-api.service';
import { GoogleAdsAuthService } from './google-ads-auth.service';

// Google keeps revising conversions for weeks (default 30-day click
// attribution), so every run re-pulls the last 30 days. One GAQL query per
// account covers every tracked campaign.
const SYNC_LOOKBACK_DAYS = 30;

export interface ScheduledGoogleAdsSyncResponse {
  connectionsProcessed: number;
  connectionsFailed: number;
  campaignsSynced: number;
  snapshotsUpserted: number;
}

@Injectable()
export class GoogleAdsSyncService {
  private readonly logger = new Logger(GoogleAdsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleApi: GoogleAdsApiService,
    private readonly googleAuth: GoogleAdsAuthService,
    private readonly connections: AdsConnectionService,
  ) {}

  /** POST /internal/ads/google/sync (Cloud Scheduler). */
  async syncAllActiveConnections(): Promise<ScheduledGoogleAdsSyncResponse> {
    const result: ScheduledGoogleAdsSyncResponse = {
      connectionsProcessed: 0,
      connectionsFailed: 0,
      campaignsSynced: 0,
      snapshotsUpserted: 0,
    };
    if (!this.googleApi.isEnabled()) return result;

    const active = await this.prisma.adsConnection.findMany({
      where: {
        platform: AdsPlatform.GOOGLE,
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
          `Google Ads sync failed for connection ${connection.id}: ${message}`,
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
      include: { campaigns: { where: { tracked: true } } },
    });
    if (connection.campaigns.length === 0) return 0;

    const byExternalId = new Map(
      connection.campaigns.map((c) => [c.externalCampaignId, c]),
    );
    const endDate = dateOnly(now);
    const startDate = dateOnly(
      new Date(now.getTime() - SYNC_LOOKBACK_DAYS * 86_400_000),
    );

    const accessToken = await this.googleAuth.getValidAccessToken(connection);
    let metrics: GoogleAdsDailyMetric[];
    try {
      metrics = await this.googleApi.getDailyMetrics(
        accessToken,
        connection.externalAdvertiserId,
        [...byExternalId.keys()],
        startDate,
        endDate,
      );
    } catch (error) {
      if (this.googleApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
      }
      throw error;
    }

    let upserted = 0;
    for (const metric of metrics) {
      const campaign = byExternalId.get(metric.externalCampaignId);
      if (!campaign) continue;
      const date = new Date(`${metric.date}T00:00:00Z`);
      const values = {
        spend: new Prisma.Decimal(metric.spend),
        clicks: metric.clicks,
        impressions: metric.impressions,
        // Google conversions are fractional (data-driven attribution);
        // the shared snapshot stores whole results.
        results: Math.round(metric.conversions),
        reach: null,
        frequency: null,
        cpm: decimalOrNull(metric.cpm),
        ctr: decimalOrNull(metric.ctr),
        costPerResult: decimalOrNull(metric.costPerConversion),
        conversionRate: decimalOrNull(metric.conversionRate),
        rawPayload: metric.raw as Prisma.InputJsonValue,
      };
      await this.prisma.adsMetricSnapshot.upsert({
        where: { campaignId_date: { campaignId: campaign.id, date } },
        create: {
          campaignId: campaign.id,
          date,
          currency: connection.currency ?? 'USD',
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
  return value !== null ? new Prisma.Decimal(value.toFixed(4)) : null;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
