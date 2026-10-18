import { AdsPlatform, Prisma } from '@prisma/client';
import { AdsDashboardService } from './ads-dashboard.service';

function snapshot(spend: string, clicks: number, impressions: number) {
  return {
    spend: new Prisma.Decimal(spend),
    clicks,
    impressions,
    results: 0,
    reach: null,
    frequency: null,
  };
}

function connection(
  platform: AdsPlatform,
  metrics: ReturnType<typeof snapshot>[],
  lastSyncedAt: Date | null = null,
) {
  return { platform, lastSyncedAt, campaigns: [{ metrics }] };
}

function build(connections: ReturnType<typeof connection>[]) {
  const prisma = {
    adsConnection: { findMany: jest.fn().mockResolvedValue(connections) },
  };
  const storeAccess = {
    requireStore: jest
      .fn()
      .mockResolvedValue({ id: 'store-1', baseCurrency: 'MAD' }),
  };
  return new AdsDashboardService(prisma as never, storeAccess as never);
}

describe('AdsDashboardService.getCampaigns', () => {
  function account(
    id: string,
    currency: string,
    campaigns: { name: string; status: string }[],
    lastSyncedAt: Date | null = null,
  ) {
    return {
      id,
      displayName: `Account ${id}`,
      currency,
      lastSyncedAt,
      campaigns: campaigns.map((c, i) => ({
        id: `${id}-camp-${i}`,
        name: c.name,
        status: c.status,
        currency,
        budget: null,
        metrics: [snapshot('10', 2, 100)],
      })),
    };
  }

  it('shows campaigns from every ad account of the platform', async () => {
    const prisma = {
      adsConnection: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            account('a', 'MAD', [{ name: 'Sales', status: 'ACTIVE' }]),
            account(
              'b',
              'EUR',
              [{ name: 'Leads', status: 'PAUSED' }],
              new Date('2026-10-17T10:00:00Z'),
            ),
          ]),
      },
    };
    const storeAccess = {
      requireStore: jest
        .fn()
        .mockResolvedValue({ id: 'store-1', baseCurrency: 'MAD' }),
    };
    const service = new AdsDashboardService(
      prisma as never,
      storeAccess as never,
    );

    const res = await service.getCampaigns('user-1', AdsPlatform.META, 7);

    expect(res.available).toBe(true);
    expect(
      res.campaigns.map((c) => [c.name, c.active, c.connectionId, c.currency]),
    ).toEqual([
      ['Sales', true, 'a', 'MAD'],
      ['Leads', false, 'b', 'EUR'],
    ]);
    expect(res.campaigns[1].accountName).toBe('Account b');
    expect(res.dataUpdatedAt).toBe('2026-10-17T10:00:00.000Z');
  });

  it.each([
    ['ENABLE', true],
    ['CAMPAIGN_STATUS_ENABLE', true],
    ['ENABLED', true],
    ['ACTIVE', true],
    ['DISABLE', false],
    ['PAUSED', false],
  ])('treats %s as active=%s', async (status, active) => {
    const prisma = {
      adsConnection: {
        findMany: jest
          .fn()
          .mockResolvedValue([account('a', 'MAD', [{ name: 'X', status }])]),
      },
    };
    const service = new AdsDashboardService(
      prisma as never,
      {
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-1', baseCurrency: 'MAD' }),
      } as never,
    );
    const res = await service.getCampaigns('user-1', AdsPlatform.TIKTOK, 1);
    expect(res.campaigns[0].active).toBe(active);
  });
});

describe('AdsDashboardService.getStatistics', () => {
  it('adds up several accounts on the same platform', async () => {
    const service = build([
      connection(AdsPlatform.GOOGLE, [snapshot('10', 1, 100)]),
      connection(AdsPlatform.GOOGLE, [snapshot('30', 3, 300)]),
      connection(AdsPlatform.TIKTOK, [snapshot('60', 6, 600)]),
    ]);

    const result = await service.getStatistics('user-1', 'week', 'spent');

    expect(result.total).toBe(100);
    const google = result.byPlatform.find(
      (p) => p.platform === AdsPlatform.GOOGLE,
    );
    expect(google).toEqual({
      platform: AdsPlatform.GOOGLE,
      value: 40,
      sharePercentage: 40,
      available: true,
    });
  });

  it('computes ratio metrics from the combined totals', async () => {
    const service = build([
      connection(AdsPlatform.GOOGLE, [snapshot('0', 1, 100)]),
      connection(AdsPlatform.GOOGLE, [snapshot('0', 9, 900)]),
    ]);

    const result = await service.getStatistics('user-1', 'week', 'ctr');

    const google = result.byPlatform.find(
      (p) => p.platform === AdsPlatform.GOOGLE,
    );
    expect(google?.value).toBe(1);
  });
});
