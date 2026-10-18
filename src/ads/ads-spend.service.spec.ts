import { Prisma } from '@prisma/client';
import { AdsSpendService } from './ads-spend.service';

const STORE = { id: 'store-1', baseCurrency: 'MAD' };

function build(rows: unknown[]) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const currency = {
    convertOrNull: jest.fn(
      (amount: Prisma.Decimal | string, from: string, to: string) => {
        const value = new Prisma.Decimal(amount);
        if (from === to) return Promise.resolve(value);
        if (from === 'USD') return Promise.resolve(value.times(10));
        return Promise.resolve(null);
      },
    ),
  };
  return {
    service: new AdsSpendService(prisma as never, currency as never),
    prisma,
    currency,
  };
}

function sqlText(call: unknown[]): string {
  return (call[0] as Prisma.Sql).sql;
}

describe('AdsSpendService.getTotals', () => {
  it('converts each account to the store currency and totals by platform', async () => {
    const { service } = build([
      {
        connectionId: 'conn-meta',
        platform: 'META',
        accountName: 'Account A',
        currency: 'USD',
        spend: new Prisma.Decimal('12.5'),
        results: BigInt(5),
        lastSyncedAt: new Date('2026-10-18T06:20:00.000Z'),
      },
      {
        connectionId: 'conn-tiktok',
        platform: 'TIKTOK',
        accountName: 'Account B',
        currency: 'MAD',
        spend: new Prisma.Decimal('75'),
        results: 0,
        lastSyncedAt: new Date('2026-10-18T06:00:00.000Z'),
      },
    ]);

    const totals = await service.getTotals(STORE, {
      from: '2026-10-01',
      to: '2026-10-18',
    });

    expect(totals.spend.toFixed(2)).toBe('200.00');
    expect(totals.results).toBe(5);
    expect(totals.costPerResult?.toFixed(2)).toBe('40.00');
    expect(
      totals.byPlatform.map((p) => [p.platform, p.spend.toFixed(2), p.results]),
    ).toEqual([
      ['META', '125.00', 5],
      ['TIKTOK', '75.00', 0],
    ]);
    expect(totals.accounts[0]).toEqual(
      expect.objectContaining({
        connectionId: 'conn-meta',
        accountCurrency: 'USD',
        results: 5,
      }),
    );
    expect(totals.accounts[0].spend?.toFixed(2)).toBe('125.00');
    expect(totals.unconverted).toEqual([]);
    expect(totals.dataUpdatedAt?.toISOString()).toBe(
      '2026-10-18T06:20:00.000Z',
    );
  });

  it('leaves out spend with no exchange rate instead of guessing', async () => {
    const { service } = build([
      {
        connectionId: 'conn-1',
        platform: 'GOOGLE',
        accountName: null,
        currency: 'XYZ',
        spend: new Prisma.Decimal('30'),
        results: 2,
        lastSyncedAt: null,
      },
      {
        connectionId: 'conn-2',
        platform: 'GOOGLE',
        accountName: null,
        currency: 'MAD',
        spend: new Prisma.Decimal('50'),
        results: 5,
        lastSyncedAt: null,
      },
    ]);

    const totals = await service.getTotals(STORE, { from: null, to: null });

    expect(totals.spend.toFixed(2)).toBe('50.00');
    expect(totals.results).toBe(7);
    expect(totals.costPerResult?.toFixed(2)).toBe('10.00');
    expect(totals.accounts[0].spend).toBeNull();
    expect(
      totals.unconverted.map((u) => [u.currency, u.amount.toFixed(2)]),
    ).toEqual([['XYZ', '30.00']]);
  });

  it('returns zeros and a null cost per result with no data', async () => {
    const { service } = build([]);
    const totals = await service.getTotals(STORE, { from: null, to: null });
    expect(totals.spend.toFixed(2)).toBe('0.00');
    expect(totals.costPerResult).toBeNull();
    expect(totals.dataUpdatedAt).toBeNull();
  });

  it('only counts tracked campaigns of the store, within the dates', async () => {
    const { service, prisma } = build([]);
    await service.getTotals(STORE, { from: '2026-10-01', to: '2026-10-18' });
    const call = prisma.$queryRaw.mock.calls[0] as unknown[];
    const sql = sqlText(call);
    expect(sql).toContain('cp."tracked" = true');
    expect(sql).toContain('c."storeId" =');
    expect(sql).toContain('s."date" >=');
    expect(sql).toContain('s."date" <=');
    expect((call[0] as Prisma.Sql).values).toEqual(
      expect.arrayContaining(['store-1', '2026-10-01', '2026-10-18']),
    );
  });

  it('omits date bounds when the range is open', async () => {
    const { service, prisma } = build([]);
    await service.getTotals(STORE, { from: null, to: null });
    expect(sqlText(prisma.$queryRaw.mock.calls[0] as unknown[])).not.toContain(
      's."date" >=',
    );
  });
});

describe('AdsSpendService.getMonthly', () => {
  it('sums converted spend per month and reports unconverted currencies', async () => {
    const { service, prisma } = build([
      { month: '2026-09', currency: 'USD', spend: new Prisma.Decimal('2') },
      { month: '2026-09', currency: 'MAD', spend: new Prisma.Decimal('5') },
      { month: '2026-10', currency: 'XYZ', spend: new Prisma.Decimal('9') },
    ]);

    const result = await service.getMonthly(
      STORE,
      new Date('2026-09-01T00:00:00.000Z'),
    );

    expect(result.byMonth.get('2026-09')?.toFixed(2)).toBe('25.00');
    expect(result.byMonth.has('2026-10')).toBe(false);
    expect(
      result.unconverted.map((u) => [u.currency, u.amount.toFixed(2)]),
    ).toEqual([['XYZ', '9.00']]);
    const call = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect((call[0] as Prisma.Sql).values).toContain('2026-09-01');
  });
});
