import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ShopPromoType } from '@prisma/client';
import { ShopPromoCodesService } from './shop-promo-codes.service';

const ACTOR = { username: 'superadmin' } as never;

function build() {
  const prisma = {
    shopPromoCode: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    shopOrder: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const activity = { record: jest.fn() };
  const service = new ShopPromoCodesService(prisma as never, activity as never);
  return { service, prisma, activity };
}

function promo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'promo-1',
    code: 'SUMMER20',
    description: null,
    type: ShopPromoType.PERCENT,
    value: new Prisma.Decimal(20),
    minSubtotal: null,
    maxDiscount: null,
    usageLimit: null,
    perStoreLimit: null,
    usedCount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  } as never;
}

describe('ShopPromoCodesService validation', () => {
  it('rejects a percentage discount outside 1-100', async () => {
    const { service } = build();
    await expect(
      service.create(ACTOR, {
        code: 'BAD',
        type: ShopPromoType.PERCENT,
        value: 150,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a fixed-amount discount above 100', async () => {
    const { service, prisma } = build();
    prisma.shopPromoCode.findUnique.mockResolvedValue(null);
    prisma.shopPromoCode.create.mockResolvedValue(
      promo({ type: ShopPromoType.FIXED, value: new Prisma.Decimal(500) }),
    );
    await expect(
      service.create(ACTOR, {
        code: 'BIG',
        type: ShopPromoType.FIXED,
        value: 500,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects an end date on or before the start date', async () => {
    const { service } = build();
    await expect(
      service.create(ACTOR, {
        code: 'X',
        type: ShopPromoType.FIXED,
        value: 10,
        startsAt: '2026-02-01T00:00:00.000Z',
        endsAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('uppercases the code and rejects a duplicate', async () => {
    const { service, prisma } = build();
    prisma.shopPromoCode.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create(ACTOR, {
        code: 'summer20',
        type: ShopPromoType.PERCENT,
        value: 10,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.shopPromoCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'SUMMER20' },
      select: { id: true },
    });
  });

  it('drops maxDiscount when switching a promo to FIXED', async () => {
    const { service, prisma } = build();
    prisma.shopPromoCode.findUnique.mockResolvedValue(
      promo({ maxDiscount: new Prisma.Decimal(50) }),
    );
    prisma.shopPromoCode.update.mockResolvedValue(
      promo({ type: ShopPromoType.FIXED }),
    );

    await service.update(ACTOR, 'promo-1', {
      type: ShopPromoType.FIXED,
    });

    const calls = prisma.shopPromoCode.update.mock.calls as unknown[][];
    const call = calls[0][0] as { data: { maxDiscount: unknown } };
    expect(call.data.maxDiscount).toBeNull();
  });
});

describe('ShopPromoCodesService.toResponse status', () => {
  const { service } = build();
  const now = new Date('2026-06-15T00:00:00.000Z');
  jest.useFakeTimers().setSystemTime(now);
  afterAll(() => jest.useRealTimers());

  it('is INACTIVE when turned off, regardless of dates', () => {
    expect(service.toResponse(promo({ isActive: false })).status).toBe(
      'INACTIVE',
    );
  });

  it('is SCHEDULED before its start date', () => {
    expect(
      service.toResponse(promo({ startsAt: new Date('2026-07-01') })).status,
    ).toBe('SCHEDULED');
  });

  it('is EXPIRED after its end date', () => {
    expect(
      service.toResponse(promo({ endsAt: new Date('2026-01-01') })).status,
    ).toBe('EXPIRED');
  });

  it('is USED_UP once usedCount reaches usageLimit', () => {
    expect(
      service.toResponse(promo({ usageLimit: 5, usedCount: 5 })).status,
    ).toBe('USED_UP');
  });

  it('is ACTIVE otherwise', () => {
    expect(service.toResponse(promo()).status).toBe('ACTIVE');
  });
});
