import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { MetaAdsCampaignService } from './meta-ads-campaign.service';
import { MetaAdsSyncService } from './meta-ads-sync.service';

const CONNECTION = {
  id: 'conn-1',
  storeId: 'store-1',
  platform: AdsPlatform.META,
  status: AdsConnectionStatus.ACTIVE,
  externalAdvertiserId: '111',
  currency: 'MAD',
  grantedScopes: 'ads_read,ads_management',
};

const CAMPAIGN_ROW = {
  id: 'camp-1',
  externalCampaignId: '9001',
  name: 'Sales A',
  status: 'ACTIVE',
  objective: 'OUTCOME_SALES',
  budget: new Prisma.Decimal('150.5'),
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
  const metaApi = {
    isEnabled: jest.fn().mockReturnValue(true),
    listCampaigns: jest.fn(),
    setCampaignStatus: jest.fn(),
    getDailyInsights: jest.fn(),
    isUnauthorizedError: (e: unknown) => e instanceof UnauthorizedException,
  };
  const metaAuth = { getValidAccessToken: jest.fn().mockResolvedValue('at') };
  const connections = { markReauthorizationRequired: jest.fn() };
  const storeAccess = {
    requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
  };
  const campaigns = new MetaAdsCampaignService(
    prisma as never,
    metaApi as never,
    metaAuth as never,
    connections as never,
    storeAccess as never,
  );
  const sync = new MetaAdsSyncService(
    prisma as never,
    metaApi as never,
    metaAuth as never,
    connections as never,
  );
  return { campaigns, sync, prisma, metaApi, connections };
}

function insight(extra: Record<string, unknown> = {}) {
  return {
    date: '2026-10-17',
    externalCampaignId: '9001',
    spend: 100,
    linkClicks: 40,
    impressions: 5000,
    reach: 3000,
    frequency: 1.6667,
    cpm: 20,
    ctr: 0.8,
    actions: { link_click: 40, omni_purchase: 4 },
    raw: {},
    ...extra,
  };
}

describe('MetaAdsCampaignService', () => {
  it('only reaches Meta connections of the caller’s store', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findFirst.mockResolvedValue(null);
    await expect(ctx.campaigns.list('user-1', 'conn-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.prisma.adsConnection.findFirst).toHaveBeenCalledWith({
      where: { id: 'conn-x', storeId: 'store-1', platform: AdsPlatform.META },
    });
  });

  it('asks to reconnect when the connection is no longer active', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findFirst.mockResolvedValue({
      ...CONNECTION,
      status: AdsConnectionStatus.REAUTHORIZATION_REQUIRED,
    });
    await expect(ctx.campaigns.list('user-1', 'conn-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refresh mirrors live campaigns with the account currency', async () => {
    const ctx = build();
    ctx.metaApi.listCampaigns.mockResolvedValue([
      {
        externalCampaignId: '9001',
        name: 'Sales A',
        status: 'ACTIVE',
        objective: 'OUTCOME_SALES',
        budget: 150.5,
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: null,
        raw: {},
      },
    ]);
    const res = await ctx.campaigns.refreshAndList('user-1', 'conn-1');
    expect(ctx.metaApi.listCampaigns).toHaveBeenCalledWith('at', '111', 'MAD');
    const upsert = (
      ctx.prisma.adsCampaign.upsert.mock.calls[0] as [
        { create: Record<string, unknown> },
      ]
    )[0];
    expect(upsert.create).toMatchObject({
      connectionId: 'conn-1',
      externalCampaignId: '9001',
      currency: 'MAD',
      objective: 'OUTCOME_SALES',
    });
    expect(res.data[0]).toMatchObject({ budget: '150.50', tracked: true });
  });

  it('a revoked token during refresh asks the merchant to reconnect', async () => {
    const ctx = build();
    ctx.metaApi.listCampaigns.mockRejectedValue(new UnauthorizedException());
    await expect(
      ctx.campaigns.refreshAndList('user-1', 'conn-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.connections.markReauthorizationRequired).toHaveBeenCalledWith(
      'conn-1',
    );
  });

  it('saves the selection: everything else is un-tracked', async () => {
    const ctx = build();
    await ctx.campaigns.saveSelection('user-1', 'conn-1', ['9001', '9001']);
    expect(ctx.prisma.adsCampaign.updateMany).toHaveBeenNthCalledWith(1, {
      where: { connectionId: 'conn-1' },
      data: { tracked: false },
    });
    expect(ctx.prisma.adsCampaign.updateMany).toHaveBeenNthCalledWith(2, {
      where: { connectionId: 'conn-1', externalCampaignId: { in: ['9001'] } },
      data: { tracked: true },
    });
  });

  describe('setStatus', () => {
    it('pauses on Meta first, then stores the new status', async () => {
      const ctx = build();
      ctx.prisma.adsCampaign.findUnique.mockResolvedValue(CAMPAIGN_ROW);
      const res = await ctx.campaigns.setStatus(
        'user-1',
        'conn-1',
        '9001',
        'PAUSED',
      );
      expect(ctx.metaApi.setCampaignStatus).toHaveBeenCalledWith(
        'at',
        '9001',
        'PAUSED',
      );
      expect(res.status).toBe('PAUSED');
    });

    it('does not touch the DB when Meta refuses', async () => {
      const ctx = build();
      ctx.prisma.adsCampaign.findUnique.mockResolvedValue(CAMPAIGN_ROW);
      ctx.metaApi.setCampaignStatus.mockRejectedValue(
        new ForbiddenException('Meta Ads: Permissions error'),
      );
      await expect(
        ctx.campaigns.setStatus('user-1', 'conn-1', '9001', 'PAUSED'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.prisma.adsCampaign.update).not.toHaveBeenCalled();
    });

    it('needs the ads_management permission', async () => {
      const ctx = build();
      ctx.prisma.adsConnection.findFirst.mockResolvedValue({
        ...CONNECTION,
        grantedScopes: 'ads_read',
      });
      await expect(
        ctx.campaigns.setStatus('user-1', 'conn-1', '9001', 'PAUSED'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.metaApi.setCampaignStatus).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric campaign id', async () => {
      const ctx = build();
      await expect(
        ctx.campaigns.setStatus('user-1', 'conn-1', 'act_1', 'PAUSED'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s for a campaign that was never listed', async () => {
      const ctx = build();
      ctx.prisma.adsCampaign.findUnique.mockResolvedValue(null);
      await expect(
        ctx.campaigns.setStatus('user-1', 'conn-1', '9001', 'PAUSED'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('MetaAdsSyncService', () => {
  function connectionWithCampaigns(campaigns = [CAMPAIGN_ROW]) {
    return { ...CONNECTION, campaigns, store: { baseCurrency: 'MAD' } };
  }

  it('stores one snapshot per day with results from the objective', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findUniqueOrThrow.mockResolvedValue(
      connectionWithCampaigns(),
    );
    ctx.metaApi.getDailyInsights.mockResolvedValue([insight()]);

    const count = await ctx.sync.syncConnection(
      'conn-1',
      new Date('2026-10-17T12:00:00Z'),
    );

    expect(count).toBe(1);
    expect(ctx.metaApi.getDailyInsights).toHaveBeenCalledWith(
      'at',
      '111',
      ['9001'],
      '2026-09-19',
      '2026-10-17',
    );
    const call = (
      ctx.prisma.adsMetricSnapshot.upsert.mock.calls[0] as [
        {
          where: unknown;
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        },
      ]
    )[0];
    expect(call.where).toEqual({
      campaignId_date: {
        campaignId: 'camp-1',
        date: new Date('2026-10-17T00:00:00Z'),
      },
    });
    expect(call.create.currency).toBe('MAD');
    expect(call.update).toMatchObject({
      clicks: 40,
      impressions: 5000,
      results: 4,
      reach: 3000,
    });
    expect(String(call.update.spend)).toBe('100');
    expect(String(call.update.costPerResult)).toBe('25');
    expect(String(call.update.conversionRate)).toBe('10');
    expect(ctx.prisma.adsConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: expect.objectContaining({ lastSyncError: null }) as object,
    });
  });

  it('leaves cost per result empty on days without results', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findUniqueOrThrow.mockResolvedValue(
      connectionWithCampaigns(),
    );
    ctx.metaApi.getDailyInsights.mockResolvedValue([
      insight({ actions: {}, linkClicks: 0 }),
    ]);
    await ctx.sync.syncConnection('conn-1');
    const call = (
      ctx.prisma.adsMetricSnapshot.upsert.mock.calls[0] as [
        { update: Record<string, unknown> },
      ]
    )[0];
    expect(call.update).toMatchObject({
      results: 0,
      costPerResult: null,
      conversionRate: null,
    });
  });

  it('falls back to the store currency when the account has none', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findUniqueOrThrow.mockResolvedValue({
      ...connectionWithCampaigns(),
      currency: null,
      store: { baseCurrency: 'EUR' },
    });
    ctx.metaApi.getDailyInsights.mockResolvedValue([insight()]);
    await ctx.sync.syncConnection('conn-1');
    const call = (
      ctx.prisma.adsMetricSnapshot.upsert.mock.calls[0] as [
        { create: Record<string, unknown> },
      ]
    )[0];
    expect(call.create.currency).toBe('EUR');
  });

  it('ignores insights for campaigns that are not tracked', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findUniqueOrThrow.mockResolvedValue(
      connectionWithCampaigns(),
    );
    ctx.metaApi.getDailyInsights.mockResolvedValue([
      insight({ externalCampaignId: '424242' }),
    ]);
    await expect(ctx.sync.syncConnection('conn-1')).resolves.toBe(0);
    expect(ctx.prisma.adsMetricSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('a revoked token flags the connection and records the error', async () => {
    const ctx = build();
    ctx.prisma.adsConnection.findMany.mockResolvedValue([
      { id: 'conn-1', _count: { campaigns: 1 } },
    ]);
    ctx.prisma.adsConnection.findUniqueOrThrow.mockResolvedValue(
      connectionWithCampaigns(),
    );
    ctx.metaApi.getDailyInsights.mockRejectedValue(
      new UnauthorizedException('Meta Ads access is no longer authorized'),
    );

    const res = await ctx.sync.syncAllActiveConnections();

    expect(res).toEqual({
      connectionsProcessed: 0,
      connectionsFailed: 1,
      campaignsSynced: 0,
      snapshotsUpserted: 0,
    });
    expect(ctx.connections.markReauthorizationRequired).toHaveBeenCalledWith(
      'conn-1',
    );
    expect(ctx.prisma.adsConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { lastSyncError: 'Meta Ads access is no longer authorized' },
    });
  });

  it('does nothing while Meta Ads is disabled', async () => {
    const ctx = build();
    ctx.metaApi.isEnabled.mockReturnValue(false);
    await ctx.sync.syncAllActiveConnections();
    expect(ctx.prisma.adsConnection.findMany).not.toHaveBeenCalled();
  });
});
