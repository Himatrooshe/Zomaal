import { BadRequestException } from '@nestjs/common';
import { ShopBannerLinkType } from '@prisma/client';
import { ShopBannersService } from './shop-banners.service';

const ACTOR = { username: 'superadmin' } as never;

function build() {
  const prisma = {
    shopBanner: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    shopProduct: { findUnique: jest.fn() },
    shopCategory: { findUnique: jest.fn() },
  };
  const images = { uploadBanner: jest.fn(), streamImage: jest.fn() };
  const activity = { record: jest.fn() };
  const service = new ShopBannersService(
    prisma as never,
    images as never,
    activity as never,
  );
  return { service, prisma, images, activity };
}

describe('ShopBannersService link validation', () => {
  it('requires a linkId when linkType is not NONE', async () => {
    const { service } = build();
    await expect(
      service.create(ACTOR, { linkType: ShopBannerLinkType.PRODUCT }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a product id that does not exist', async () => {
    const { service, prisma } = build();
    prisma.shopProduct.findUnique.mockResolvedValue(null);
    await expect(
      service.create(ACTOR, {
        linkType: ShopBannerLinkType.PRODUCT,
        linkId: 'missing',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a category id that exists', async () => {
    const { service, prisma } = build();
    prisma.shopCategory.findUnique.mockResolvedValue({ id: 'cat-1' });
    prisma.shopBanner.create.mockResolvedValue({
      id: 'b1',
      title: 'Sale',
      subtitle: null,
      linkType: ShopBannerLinkType.CATEGORY,
      linkId: 'cat-1',
      imageObjectName: null,
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    await expect(
      service.create(ACTOR, {
        linkType: ShopBannerLinkType.CATEGORY,
        linkId: 'cat-1',
      }),
    ).resolves.toBeDefined();
  });

  it('never checks a link when linkType is NONE', async () => {
    const { service, prisma } = build();
    prisma.shopBanner.create.mockResolvedValue({
      id: 'b1',
      title: null,
      subtitle: null,
      linkType: ShopBannerLinkType.NONE,
      linkId: null,
      imageObjectName: null,
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    await service.create(ACTOR, {});
    expect(prisma.shopProduct.findUnique).not.toHaveBeenCalled();
    expect(prisma.shopCategory.findUnique).not.toHaveBeenCalled();
  });
});

describe('ShopBannersService scheduling window', () => {
  it('rejects an end date on or before the start date', async () => {
    const { service } = build();
    await expect(
      service.create(ACTOR, {
        startsAt: '2026-02-01T00:00:00.000Z',
        endsAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ShopBannersService.toResponse "live" flag', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');
  beforeAll(() => jest.useFakeTimers().setSystemTime(now));
  afterAll(() => jest.useRealTimers());

  function banner(overrides: Record<string, unknown> = {}) {
    return {
      id: 'b1',
      title: 'Sale',
      subtitle: null,
      linkType: ShopBannerLinkType.NONE,
      linkId: null,
      imageObjectName: 'shop/banners/b1/photo.png',
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    } as never;
  }

  it('is not live without an uploaded image, even if active', async () => {
    const { service } = build();
    const r = await service.toResponse(banner({ imageObjectName: null }));
    expect(r.live).toBe(false);
    expect(r.imageUrl).toBeNull();
  });

  it('is not live when turned off', async () => {
    const { service } = build();
    const r = await service.toResponse(banner({ isActive: false }));
    expect(r.live).toBe(false);
  });

  it('is not live before its start date', async () => {
    const { service } = build();
    const r = await service.toResponse(
      banner({ startsAt: new Date('2026-07-01') }),
    );
    expect(r.live).toBe(false);
  });

  it('is not live after its end date', async () => {
    const { service } = build();
    const r = await service.toResponse(
      banner({ endsAt: new Date('2026-01-01') }),
    );
    expect(r.live).toBe(false);
  });

  it('is live when active, imaged, and within its window', async () => {
    const { service } = build();
    const r = await service.toResponse(
      banner({
        startsAt: new Date('2026-06-01'),
        endsAt: new Date('2026-07-01'),
      }),
    );
    expect(r.live).toBe(true);
  });
});
