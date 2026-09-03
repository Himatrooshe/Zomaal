import { Injectable, NotFoundException } from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdsCampaignListResponseDto,
  AdsMetricKey,
  AdsStatisticsResponseDto,
} from './dto/ads-dashboard.dto';

// Platform-agnostic on purpose — this file never changes when Meta/Google/
// Snapchat get their own auth+sync services later. It only ever reads
// AdsCampaign/AdsMetricSnapshot, filtered by platform, joined through
// AdsConnection for store ownership.

const ALL_PLATFORMS: AdsPlatform[] = [
  AdsPlatform.META,
  AdsPlatform.TIKTOK,
  AdsPlatform.GOOGLE,
  AdsPlatform.SNAPCHAT,
];

const PERIOD_DAYS: Record<'week' | 'month' | 'quarter', number> = {
  week: 7,
  month: 30,
  quarter: 90,
};

@Injectable()
export class AdsDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getCampaigns(
    userId: string,
    platform: AdsPlatform,
    days: 1 | 7 | 30 | 90 = 1,
  ): Promise<AdsCampaignListResponseDto> {
    const store = await this.requireStore(userId);
    const to = new Date();
    const from = startOfUtcDay(new Date(to.getTime() - (days - 1) * 86_400_000));

    const connection = await this.prisma.adsConnection.findFirst({
      where: { storeId: store.id, platform, status: AdsConnectionStatus.ACTIVE },
      include: {
        campaigns: {
          where: { tracked: true },
          include: {
            metrics: { where: { date: { gte: from, lte: to } } },
          },
        },
      },
    });

    if (!connection) {
      return {
        platform,
        available: false,
        currency: store.baseCurrency,
        period: { days, from: from.toISOString(), to: to.toISOString() },
        campaigns: [],
        dataUpdatedAt: null,
      };
    }

    const campaigns = connection.campaigns.map((campaign) => {
      const agg = aggregateSnapshots(campaign.metrics, days === 1);
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        active: /ENABLE/i.test(campaign.status),
        metrics: {
          spent: agg.spend.toFixed(4),
          clicks: agg.clicks,
          results: agg.results,
          costPerResult: agg.results ? agg.spend.dividedBy(agg.results).toFixed(4) : null,
          cpm: agg.impressions
            ? agg.spend.dividedBy(agg.impressions).times(1000).toFixed(4)
            : null,
          ctr: agg.impressions
            ? new Prisma.Decimal(agg.clicks).dividedBy(agg.impressions).times(100).toFixed(4)
            : null,
          frequency: agg.frequency?.toFixed(4) ?? null,
          budget: campaign.budget?.toFixed(4) ?? null,
          reach: agg.reach,
          impressions: agg.impressions,
          conversionRate: agg.clicks
            ? new Prisma.Decimal(agg.results).dividedBy(agg.clicks).times(100).toFixed(4)
            : null,
        },
      };
    });

    return {
      platform,
      available: true,
      currency: connection.currency ?? store.baseCurrency,
      period: { days, from: from.toISOString(), to: to.toISOString() },
      campaigns,
      dataUpdatedAt: connection.lastSyncedAt?.toISOString() ?? null,
    };
  }

  async getStatistics(
    userId: string,
    period: 'week' | 'month' | 'quarter' = 'month',
    metric: AdsMetricKey = 'spent',
  ): Promise<AdsStatisticsResponseDto> {
    const store = await this.requireStore(userId);
    const days = PERIOD_DAYS[period];
    const to = new Date();
    const from = startOfUtcDay(new Date(to.getTime() - (days - 1) * 86_400_000));

    const connections = await this.prisma.adsConnection.findMany({
      where: { storeId: store.id, status: AdsConnectionStatus.ACTIVE },
      include: {
        campaigns: {
          where: { tracked: true },
          include: { metrics: { where: { date: { gte: from, lte: to } } } },
        },
      },
    });

    const byPlatform = new Map<AdsPlatform, number>();
    let latestSync: Date | null = null;

    for (const connection of connections) {
      const allSnapshots = connection.campaigns.flatMap((c) => c.metrics);
      const agg = aggregateSnapshots(allSnapshots, false);
      byPlatform.set(connection.platform, metricValue(metric, agg));
      if (connection.lastSyncedAt && (!latestSync || connection.lastSyncedAt > latestSync)) {
        latestSync = connection.lastSyncedAt;
      }
    }

    const total = [...byPlatform.values()].reduce((sum, value) => sum + value, 0);
    const connectedPlatforms = new Set(connections.map((c) => c.platform));

    return {
      period,
      metric,
      total: round2(total),
      byPlatform: ALL_PLATFORMS.map((platform) => {
        const value = byPlatform.get(platform) ?? 0;
        return {
          platform,
          value: round2(value),
          sharePercentage: total > 0 ? round2((value / total) * 100) : 0,
          available: connectedPlatforms.has(platform),
        };
      }),
      dataUpdatedAt: latestSync?.toISOString() ?? null,
    };
  }

  private async requireStore(
    userId: string,
  ): Promise<{ id: string; baseCurrency: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true, baseCurrency: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }
}

interface SnapshotLike {
  spend: Prisma.Decimal;
  clicks: number;
  impressions: number;
  results: number;
  reach: number | null;
  frequency: Prisma.Decimal | null;
}

interface Aggregate {
  spend: Prisma.Decimal;
  clicks: number;
  impressions: number;
  results: number;
  reach: number | null;
  frequency: Prisma.Decimal | null;
}

// Sums the additive metrics (spend/clicks/impressions/results) across every
// day in range — always correct. reach/frequency are NOT reliably additive
// across days (the same user can be reached on multiple days), so for a
// multi-day range we report them as null rather than a misleading sum;
// singleDay=true (period is "Today") uses the one snapshot's own values,
// which are accurate as reported by the platform for that day.
function aggregateSnapshots(snapshots: SnapshotLike[], singleDay: boolean): Aggregate {
  let spend = new Prisma.Decimal(0);
  let clicks = 0;
  let impressions = 0;
  let results = 0;

  for (const s of snapshots) {
    spend = spend.plus(s.spend);
    clicks += s.clicks;
    impressions += s.impressions;
    results += s.results;
  }

  const reach = singleDay ? (snapshots[0]?.reach ?? null) : null;
  const frequency = singleDay ? (snapshots[0]?.frequency ?? null) : null;

  return { spend, clicks, impressions, results, reach, frequency };
}

function metricValue(metric: AdsMetricKey, agg: Aggregate): number {
  switch (metric) {
    case 'linkClicks':
      return agg.clicks;
    case 'spent':
      return agg.spend.toNumber();
    case 'results':
      return agg.results;
    case 'costPerResult':
      return agg.results ? agg.spend.dividedBy(agg.results).toNumber() : 0;
    case 'cpm':
      return agg.impressions ? agg.spend.dividedBy(agg.impressions).times(1000).toNumber() : 0;
    case 'ctr':
      return agg.impressions ? (agg.clicks / agg.impressions) * 100 : 0;
    case 'frequency':
      return agg.frequency?.toNumber() ?? 0;
    case 'reach':
      return agg.reach ?? 0;
    case 'impressions':
      return agg.impressions;
    case 'conversionRate':
      return agg.clicks ? (agg.results / agg.clicks) * 100 : 0;
    default:
      return 0;
  }
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
