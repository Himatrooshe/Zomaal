import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdsConnection,
  AdsConnectionStatus,
  AdsPlatform,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreAccessService } from '../../access/store-access.service';
import { calendarDay } from '../../common/calendar-date.util';
import { AdsConnectionService } from '../ads-connection.service';
import { SnapchatAdsAuthService } from './snapchat-ads-auth.service';
import { SnapchatAdsApiService } from './snapchat-ads-api.service';

const PLATFORM = AdsPlatform.SNAPCHAT;
function eligible(): Prisma.AdsConnectionWhereInput {
  return {
    platform: PLATFORM,
    status: AdsConnectionStatus.ACTIVE,
    store: {
      user: {
        subscription: {
          accessEndsAt: { gt: new Date() },
          OR: [{ planId: null }, { plan: { features: { has: 'ads' } } }],
        },
      },
    },
  };
}
@Injectable()
export class SnapchatAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
    private readonly api: SnapchatAdsApiService,
    private readonly auth: SnapchatAdsAuthService,
    private readonly connections: AdsConnectionService,
  ) {}

  async list(userId: string, id: string, refresh = false) {
    const connection = await this.owned(userId, id);
    if (refresh) {
      const campaigns = await this.provider(connection, (token) =>
        this.api.campaigns(token, connection.externalAdvertiserId),
      );
      await this.prisma.$transaction(async (tx) => {
        const stillActive = await tx.adsConnection.findFirst({
          where: { id, status: AdsConnectionStatus.ACTIVE },
        });
        if (!stillActive)
          throw new ConflictException(
            'Snapchat was disconnected during refresh',
          );
        for (const row of campaigns) {
          const data = {
            name: row.name,
            status: row.status,
            objective: row.objective,
            budget: row.budget === null ? null : new Prisma.Decimal(row.budget),
            startDate: row.startDate,
            endDate: row.endDate,
            currency: connection.currency,
          };
          await tx.adsCampaign.upsert({
            where: {
              connectionId_externalCampaignId: {
                connectionId: id,
                externalCampaignId: row.id,
              },
            },
            create: { connectionId: id, externalCampaignId: row.id, ...data },
            update: data,
          });
        }
        // The provider's complete list no longer includes these entities. Keep
        // their financial history; do not claim they are still live campaigns.
        await tx.adsCampaign.updateMany({
          where: {
            connectionId: id,
            externalCampaignId: { notIn: campaigns.map((c) => c.id) },
          },
          data: { status: 'UNAVAILABLE' },
        });
        await tx.adsConnection.update({
          where: { id },
          data: { lastVerifiedAt: new Date() },
        });
      });
    }
    const campaigns = await this.prisma.adsCampaign.findMany({
      where: { connectionId: id },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      currency: connection.currency,
      timezone: connection.timezone,
      resultMetric: 'conversion_purchases',
      data: campaigns.map((c) => ({
        ...c,
        budget: c.budget?.toFixed(4) ?? null,
        rawPayload: undefined,
      })),
    };
  }

  async select(userId: string, id: string, ids: string[]) {
    await this.owned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AdsConnection" WHERE "id" = ${id} FOR UPDATE`;
      if (
        !(await tx.adsConnection.findFirst({
          where: { id, status: AdsConnectionStatus.ACTIVE },
        }))
      )
        throw new ConflictException('Reconnect Snapchat Ads');
      const previous = await tx.adsCampaign.findMany({
        where: { connectionId: id, tracked: true },
        select: { externalCampaignId: true },
      });
      const valid = await tx.adsCampaign.count({
        where: {
          connectionId: id,
          externalCampaignId: { in: ids },
          status: { not: 'UNAVAILABLE' },
        },
      });
      if (valid !== ids.length)
        throw new NotFoundException(
          'One or more campaigns are unavailable or belong to another account',
        );
      await tx.adsCampaign.updateMany({
        where: { connectionId: id },
        data: { tracked: false },
      });
      await tx.adsCampaign.updateMany({
        where: { connectionId: id, externalCampaignId: { in: ids } },
        data: { tracked: true },
      });
      if (
        previous.length !== ids.length ||
        previous.some((c) => !ids.includes(c.externalCampaignId))
      ) {
        // New selections need a full backfill; invalidate any old sync lease.
        await tx.adsConnection.update({
          where: { id },
          data: {
            lastSyncedAt: null,
            syncStartedAt: null,
            lastSyncError: null,
          },
        });
      }
    });
    return this.list(userId, id);
  }

  async metrics(userId: string, id: string, days: number) {
    const connection = await this.owned(userId, id);
    const { currency, timezone } = metadata(connection);
    const today = calendarDay(new Date(), timezone),
      from = addDays(today, -(days - 1));
    const campaigns = await this.prisma.adsCampaign.findMany({
      where: { connectionId: id, tracked: true },
      include: {
        metrics: {
          where: { date: { gte: from, lte: today } },
          orderBy: { date: 'asc' },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      connectionId: id,
      currency,
      timezone,
      resultMetric: 'conversion_purchases',
      attribution: {
        actionReportTime: 'conversion',
        swipeUp: '28_DAY',
        view: '1_DAY',
      },
      period: { from: label(from), to: label(today), days },
      dataUpdatedAt: connection.lastSyncedAt,
      syncState: connection.lastSyncError
        ? 'SYNC_FAILED'
        : connection.lastSyncedAt
          ? 'SYNCED'
          : 'NOT_SYNCED',
      campaigns: campaigns.map((c) => {
        const spend = c.metrics.reduce(
          (s, m) => s.plus(m.spend),
          new Prisma.Decimal(0),
        );
        const clicks = c.metrics.reduce((s, m) => s + m.clicks, 0),
          impressions = c.metrics.reduce((s, m) => s + m.impressions, 0),
          purchases = c.metrics.reduce((s, m) => s + m.results, 0);
        return {
          id: c.id,
          externalCampaignId: c.externalCampaignId,
          name: c.name,
          status: c.status,
          objective: c.objective,
          spent: spend.toFixed(4),
          clicks,
          impressions,
          purchases,
          ctr: impressions
            ? new Prisma.Decimal(clicks).div(impressions).times(100).toFixed(4)
            : null,
          costPerPurchase: purchases ? spend.div(purchases).toFixed(4) : null,
          daily: c.metrics.map((m) => ({
            date: label(m.date),
            spent: m.spend.toFixed(4),
            clicks: m.clicks,
            impressions: m.impressions,
            purchases: m.results,
            reach: m.reach,
            frequency: m.frequency?.toFixed(4) ?? null,
          })),
        };
      }),
    };
  }

  async syncForUser(userId: string, id: string) {
    await this.owned(userId, id);
    return this.sync(id);
  }
  async syncAll() {
    const result = {
      connectionsProcessed: 0,
      connectionsFailed: 0,
      snapshotsUpserted: 0,
    };
    if (!this.api.isEnabled()) return result;
    const rows = await this.prisma.adsConnection.findMany({
      where: { ...eligible(), campaigns: { some: { tracked: true } } },
      select: { id: true },
    });
    for (const row of rows) {
      try {
        result.snapshotsUpserted += (await this.sync(row.id)).snapshotsUpserted;
        result.connectionsProcessed++;
      } catch {
        result.connectionsFailed++;
      }
    }
    return result;
  }

  async sync(id: string, now = new Date()) {
    const lease = new Date();
    const claimed = await this.prisma.adsConnection.updateMany({
      where: {
        id,
        ...eligible(),
        OR: [
          { syncStartedAt: null },
          { syncStartedAt: { lt: new Date(Date.now() - 15 * 60000) } },
        ],
      },
      data: { syncStartedAt: lease },
    });
    if (claimed.count !== 1)
      throw new ConflictException(
        'Snapchat sync is already running or the subscription is inactive',
      );
    let snapshotsUpserted = 0;
    try {
      const connection = await this.prisma.adsConnection.findUniqueOrThrow({
        where: { id },
        include: { campaigns: { where: { tracked: true } } },
      });
      const { currency, timezone } = metadata(connection);
      const campaigns = new Map(
        connection.campaigns.map((c) => [c.externalCampaignId, c.id]),
      );
      if (!campaigns.size) return { snapshotsUpserted: 0 };
      const today = calendarDay(now, timezone),
        end = addDays(today, 1);
      const days = connection.lastSyncedAt ? 30 : 90;
      let from = addDays(today, -(days - 1));
      while (from < end) {
        const until = new Date(
          Math.min(addDays(from, 30).getTime(), end.getTime()),
        );
        const metrics = await this.provider(connection, (token) =>
          this.api.dailyMetrics(
            token,
            connection.externalAdvertiserId,
            timezone,
            label(from),
            label(until),
          ),
        );
        const seen = new Set<string>();
        const selected = metrics.filter((m) => campaigns.has(m.campaignId));
        for (const m of selected) {
          const key = `${m.campaignId}:${m.date}`;
          if (seen.has(key))
            throw new ServiceUnavailableException(
              'Snapchat returned duplicate campaign-day metrics',
            );
          seen.add(key);
        }
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "AdsConnection" WHERE "id" = ${id} FOR UPDATE`;
          if (
            !(await tx.adsConnection.findFirst({
              where: { id, ...eligible(), syncStartedAt: lease },
            }))
          )
            throw new ConflictException('Snapchat access changed during sync');
          const currentlyTracked = await tx.adsCampaign.findMany({
            where: { connectionId: id, tracked: true },
            select: { id: true },
          });
          const selectedIds = new Set(campaigns.values());
          if (
            currentlyTracked.length !== selectedIds.size ||
            currentlyTracked.some((c) => !selectedIds.has(c.id))
          )
            throw new ConflictException(
              'Campaign selection changed during sync; retry',
            );
          // Replace only a successfully fetched window, atomically. This removes
          // stale values when the provider revises a previously nonzero day to zero.
          await tx.adsMetricSnapshot.deleteMany({
            where: {
              campaignId: { in: [...campaigns.values()] },
              date: { gte: from, lt: until },
            },
          });
          for (const m of selected) {
            const spend = new Prisma.Decimal(m.spend);
            await tx.adsMetricSnapshot.create({
              data: {
                campaignId: campaigns.get(m.campaignId)!,
                date: new Date(`${m.date}T00:00:00Z`),
                currency,
                spend,
                clicks: m.clicks,
                impressions: m.impressions,
                results: m.purchases,
                reach: m.reach,
                frequency:
                  m.frequency === null ? null : new Prisma.Decimal(m.frequency),
                cpm: m.impressions
                  ? spend.div(m.impressions).times(1000)
                  : null,
                ctr: m.impressions
                  ? new Prisma.Decimal(m.clicks).div(m.impressions).times(100)
                  : null,
                costPerResult: m.purchases ? spend.div(m.purchases) : null,
                conversionRate: m.clicks
                  ? new Prisma.Decimal(m.purchases).div(m.clicks).times(100)
                  : null,
                rawPayload: m.raw,
              },
            });
          }
        });
        snapshotsUpserted += selected.length;
        from = until;
      }
      await this.prisma.adsConnection.updateMany({
        where: { id, syncStartedAt: lease, status: AdsConnectionStatus.ACTIVE },
        data: { lastSyncedAt: new Date(), lastSyncError: null },
      });
      return { snapshotsUpserted };
    } catch (error) {
      await this.prisma.adsConnection.updateMany({
        where: { id, syncStartedAt: lease },
        data: {
          lastSyncError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Snapchat sync failed',
        },
      });
      throw error;
    } finally {
      await this.prisma.adsConnection.updateMany({
        where: { id, syncStartedAt: lease },
        data: { syncStartedAt: null },
      });
    }
  }
  private async provider<T>(
    connection: AdsConnection,
    call: (token: string) => Promise<T>,
  ) {
    const token = await this.auth.getValidAccessToken(connection);
    try {
      return await call(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.connections.markReauthorizationRequired(connection.id);
        throw new ConflictException('Reconnect Snapchat Ads');
      }
      throw error;
    }
  }
  private async owned(userId: string, id: string) {
    const access = await this.access.requireStore(userId);
    const row = await this.prisma.adsConnection.findFirst({
      where: { id, storeId: access.id, platform: PLATFORM },
    });
    if (!row) throw new NotFoundException('Snapchat connection not found');
    if (row.status !== AdsConnectionStatus.ACTIVE)
      throw new ConflictException('Reconnect Snapchat Ads');
    return row;
  }
}
function metadata(connection: AdsConnection) {
  if (
    !connection.currency ||
    !/^[A-Z]{3}$/.test(connection.currency) ||
    !connection.timezone
  )
    throw new ServiceUnavailableException(
      'Snapchat account currency/timezone is unavailable; reconnect',
    );
  return { currency: connection.currency, timezone: connection.timezone };
}
function label(date: Date) {
  return date.toISOString().slice(0, 10);
}
function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400000);
}
