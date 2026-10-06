import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { GoogleAdsCampaignService } from './google-ads-campaign.service';
import { GoogleAdsSyncService } from './google-ads-sync.service';

const CONNECTION = {
  id: 'conn-1',
  storeId: 'store-1',
  platform: AdsPlatform.GOOGLE,
  status: AdsConnectionStatus.ACTIVE,
  externalAdvertiserId: '1234567890',
  currency: 'MAD',
};

const CAMPAIGN_ROW = {
  id: 'camp-1',
  externalCampaignId: '111',
  name: 'Search A',
  status: 'ENABLED',
  objective: 'SEARCH',
  budget: new Prisma.Decimal('15.5'),
  currency: 'MAD',
  startDate: null,
  endDate: null,
  tracked: true,
};

function build() {
  const prisma = {
    adsConnection: {
      findFirst: jest.fn().mockResolvedValue(CONNECTION),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    adsCampaign: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([CAMPAIGN_ROW]),
      findUnique: jest.fn(),
      update: jest.fn(({ data }: { data: object }) => ({
        ...CAMPAIGN_ROW,
        ...data,
      })),
      updateMany: jest.fn(),
    },
    adsMetricSnapshot: { upsert: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const googleApi = {
    isEnabled: jest.fn().mockReturnValue(true),
    listCampaigns: jest.fn(),
    setCampaignStatus: jest.fn(),
    getDailyMetrics: jest.fn(),
    isUnauthorizedError: (e: unknown) => e instanceof UnauthorizedException,
  };
  const googleAuth = { getValidAccessToken: jest.fn().mockResolvedValue('at') };
  const connections = { markReauthorizationRequired: jest.fn() };
  const storeAccess = {
    requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
  };
  const campaigns = new GoogleAdsCampaignService(
    prisma as never,
    googleApi as never,
    googleAuth as never,
    connections as never,
    storeAccess as never,
  );
  const sync = new GoogleAdsSyncService(
    prisma as never,
    googleApi as never,
    googleAuth as never,
    connections as never,
  );
  return { campaigns, sync, prisma, googleApi, connections };
}

describe('GoogleAdsCampaignService', () => {
  it('only reaches connections of the caller’s store and platform', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findFirst.mockResolvedValue(null);
    await expect(ctx.campaigns.list('user-1', 'conn-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.prisma.adsConnection.findFirst).toHaveBeenCalledWith({
      where: { id: 'conn-x', storeId: 'store-1', platform: AdsPlatform.GOOGLE },
    });
  });

  it('refresh mirrors live campaigns and returns budgets with 2 decimals', async () => {
    const ctx = build();
    ctx.googleApi.listCampaigns.mockResolvedValue([
      {
        externalCampaignId: '111',
        name: 'Search A',
        status: 'ENABLED',
        channelType: 'SEARCH',
        budget: 15.5,
        raw: {},
      },
    ]);
    const res = await ctx.campaigns.refreshAndList('user-1', 'conn-1');
    expect(ctx.prisma.adsCampaign.upsert).toHaveBeenCalledTimes(1);
    expect(res.data[0]).toMatchObject({
      externalCampaignId: '111',
      budget: '15.50',
      objective: 'SEARCH',
    });
  });

  it('a revoked token during refresh asks the merchant to reconnect', async () => {
    const ctx = build();
    ctx.googleApi.listCampaigns.mockRejectedValue(new UnauthorizedException());
    await expect(
      ctx.campaigns.refreshAndList('user-1', 'conn-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.connections.markReauthorizationRequired).toHaveBeenCalledWith(
      'conn-1',
    );
  });

  it('pauses on Google first, then records the new status', async () => {
    const ctx = build();
    ctx.prisma.adsCampaign.findUnique.mockResolvedValue(CAMPAIGN_ROW);
    const res = await ctx.campaigns.setStatus(
      'user-1',
      'conn-1',
      '111',
      'PAUSED',
    );
    expect(ctx.googleApi.setCampaignStatus).toHaveBeenCalledWith(
      'at',
      '1234567890',
      '111',
      'PAUSED',
    );
    expect(res.status).toBe('PAUSED');
  });

  it('does not record a status Google rejected', async () => {
    const ctx = build();
    ctx.prisma.adsCampaign.findUnique.mockResolvedValue(CAMPAIGN_ROW);
    ctx.googleApi.setCampaignStatus.mockRejectedValue(
      new Error('google said no'),
    );
    await expect(
      ctx.campaigns.setStatus('user-1', 'conn-1', '111', 'PAUSED'),
    ).rejects.toThrow('google said no');
    expect(ctx.prisma.adsCampaign.update).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric campaign id and unknown campaigns', async () => {
    const ctx = build();
    await expect(
      ctx.campaigns.setStatus('user-1', 'conn-1', 'abc', 'PAUSED'),
    ).rejects.toBeInstanceOf(BadRequestException);
    ctx.prisma.adsCampaign.findUnique.mockResolvedValue(null);
    await expect(
      ctx.campaigns.setStatus('user-1', 'conn-1', '999', 'PAUSED'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GoogleAdsSyncService', () => {
  const NOW = new Date('2026-10-06T10:00:00.000Z');

  it('upserts one snapshot per campaign-day over the last 30 days', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findUniqueOrThrow.mockResolvedValue({
      ...CONNECTION,
      campaigns: [CAMPAIGN_ROW],
    });
    ctx.googleApi.getDailyMetrics.mockResolvedValue([
      {
        date: '2026-10-05',
        externalCampaignId: '111',
        spend: 12.34,
        clicks: 10,
        impressions: 500,
        conversions: 2.6,
        cpm: 24.68,
        ctr: 2,
        costPerConversion: 4.75,
        conversionRate: 26,
        raw: {},
      },
      {
        date: '2026-10-05',
        externalCampaignId: '999',
        spend: 1,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        cpm: null,
        ctr: null,
        costPerConversion: null,
        conversionRate: null,
        raw: {},
      },
    ]);

    const upserted = await ctx.sync.syncConnection('conn-1', NOW);

    expect(upserted).toBe(1);
    expect(ctx.googleApi.getDailyMetrics).toHaveBeenCalledWith(
      'at',
      '1234567890',
      ['111'],
      '2026-09-06',
      '2026-10-06',
    );
    const call = ctx.prisma.adsMetricSnapshot.upsert.mock.calls[0] as [
      {
        create: {
          results: number;
          spend: Prisma.Decimal;
          currency: string;
          reach: null;
        };
      },
    ];
    expect(call[0].create.results).toBe(3);
    expect(call[0].create.spend.toFixed(2)).toBe('12.34');
    expect(call[0].create.currency).toBe('MAD');
    expect(call[0].create.reach).toBeNull();
  });

  it('records the error and keeps going when one account fails', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findMany.mockResolvedValue([
      { id: 'conn-1', _count: { campaigns: 1 } },
      { id: 'conn-2', _count: { campaigns: 2 } },
    ]);
    ctx.prisma.adsConnection.findUniqueOrThrow
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        ...CONNECTION,
        id: 'conn-2',
        campaigns: [CAMPAIGN_ROW],
      });
    ctx.googleApi.getDailyMetrics.mockResolvedValue([]);

    const res = await ctx.sync.syncAllActiveConnections();

    expect(res).toEqual({
      connectionsProcessed: 1,
      connectionsFailed: 1,
      campaignsSynced: 2,
      snapshotsUpserted: 0,
    });
    expect(ctx.prisma.adsConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { lastSyncError: 'boom' },
    });
  });

  it('does nothing while Google Ads is disabled', async () => {
    const ctx = build();
    ctx.googleApi.isEnabled.mockReturnValue(false);
    await expect(ctx.sync.syncAllActiveConnections()).resolves.toMatchObject({
      connectionsProcessed: 0,
    });
    expect(ctx.prisma.adsConnection.findMany).not.toHaveBeenCalled();
  });

  it('only selects active, tracked connections of paying/trial accounts', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findMany.mockResolvedValue([]);
    await ctx.sync.syncAllActiveConnections();
    const arg = ctx.prisma.adsConnection.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(arg[0].where).toMatchObject({
      platform: AdsPlatform.GOOGLE,
      status: AdsConnectionStatus.ACTIVE,
      campaigns: { some: { tracked: true } },
    });
    expect(arg[0].where.store).toBeDefined();
  });
});
