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
