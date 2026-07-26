import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';

describe('EcommerceService', () => {
  it('combines platforms by currency without mixing currencies', async () => {
    const rows = [
      aggregateRow('SHOPIFY', 'MAD', '100.0000'),
      aggregateRow('YOUCAN', 'MAD', '50.0000'),
      aggregateRow('LIGHTFUNNELS', 'MAD', '25.0000'),
      aggregateRow('SHOPIFY', 'USD', '20.0000'),
    ];
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'store-id' }),
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
      { convertCurrency: jest.fn() } as any,
    );

    const result = await service.getRevenueSummary('user-id', {
      timezone: 'Africa/Casablanca',
    });

    expect(result.totalsByCurrency).toHaveLength(2);
    expect(result.totalsByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'MAD',
          totalCollected: '175.0000',
        }),
        expect.objectContaining({
          currency: 'USD',
          totalCollected: '20.0000',
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
          totalCollected: '50.0000',
        }),
        expect.objectContaining({
          platform: 'LIGHTFUNNELS',
          currency: 'MAD',
          totalCollected: '25.0000',
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
      { convertCurrency: jest.fn() } as any,
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
