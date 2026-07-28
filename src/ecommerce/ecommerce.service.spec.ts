import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';

describe('EcommerceService', () => {
  it('converts all platform revenue to the store base currency', async () => {
    const rows = [
      aggregateRow('SHOPIFY', 'MAD', '100.0000'),
      aggregateRow('YOUCAN', 'AED', '50.0000'),
      aggregateRow('LIGHTFUNNELS', 'USD', '25.0000'),
    ];
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceConnection: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { lastSyncedAt: new Date('2026-07-19T10:00:00.000Z') },
          ]),
      },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      { 
        convertAmount: jest.fn().mockImplementation(async (amount, from, to) => {
          if (from === 'MAD') return amount;
          if (from === 'AED') return amount.times(new Prisma.Decimal(2)); // mock AED -> MAD = x2
          if (from === 'USD') return amount.times(new Prisma.Decimal(10)); // mock USD -> MAD = x10
          return amount;
        }) 
      } as any,
    );

    const result = await service.getRevenueSummary('user-id', {
      timezone: 'Africa/Casablanca',
    });

    expect(result.totalsByCurrency).toHaveLength(1);
    expect(result.totalsByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'MAD',
          totalCollected: '450.0000', // 100 + (50 * 2) + (25 * 10) = 450
        }),
      ]),
    );
    expect(result.byPlatform).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'SHOPIFY',
          currency: 'MAD',
          totalCollected: '100.0000',
        }),
        expect.objectContaining({
          platform: 'YOUCAN',
          currency: 'MAD',
          totalCollected: '100.0000',
        }),
        expect.objectContaining({
          platform: 'LIGHTFUNNELS',
          currency: 'MAD',
          totalCollected: '250.0000',
        }),
      ]),
    );
    expect(result.dataFreshAsOf).toBe('2026-07-19T10:00:00.000Z');
  });

  it('rejects invalid calendar dates before querying revenue', async () => {
    const queryRaw = jest.fn();
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'store-id' }),
      },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      { convertAmount: jest.fn().mockImplementation(async (amount, from, to) => amount) } as any,
    );

    await expect(
      service.getRevenueSummary('user-id', {
        from: '2026-02-31',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

function aggregateRow(
  platform: string,
  currency: string,
  totalCollected: string,
) {
  return {
    platform,
    currency,
    orderCount: 1,
    grossSales: new Prisma.Decimal(totalCollected),
    discounts: new Prisma.Decimal(0),
    refunds: new Prisma.Decimal(0),
    netSales: new Prisma.Decimal(totalCollected),
    shipping: new Prisma.Decimal(0),
    tax: new Prisma.Decimal(0),
    totalCollected: new Prisma.Decimal(totalCollected),
  };
}
