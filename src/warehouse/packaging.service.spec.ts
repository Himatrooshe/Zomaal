import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PackagingService, packagingStockStatus } from './packaging.service';

const STORE = { id: 'store-1' };
const MATERIAL_ID = '2d5e2688-0818-429a-bb03-8351130c60ea';
const UPLOAD_ID = '7c1f7f43-5a43-4c4e-9a52-0d3f0e5a1b11';

function materialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATERIAL_ID,
    storeId: STORE.id,
    zomaalShopVariantId: null,
    name: 'Medium box',
    sku: 'BOX-M',
    imageObjectName: null,
    unit: 'PIECES',
    minimumLevel: 10,
    lowStockAlert: true,
    isActive: true,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    inventoryItem: {
      id: 'item-1',
      balances: [{ onHand: 12, reserved: 0, damaged: 4 }],
    },
    _count: { requirements: 0 },
    requirements: [],
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    packagingMaterial: {
      create: jest.fn().mockResolvedValue({ id: MATERIAL_ID }),
      update: jest.fn().mockResolvedValue({}),
    },
    warehouseLocation: {
      upsert: jest.fn().mockResolvedValue({ id: 'location-1' }),
    },
    inventoryItem: { create: jest.fn().mockResolvedValue({ id: 'item-1' }) },
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({
        id: UPLOAD_ID,
        objectName: 'stores/store-1/media/new.webp',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    packagingMaterial: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(materialRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    productPackagingRequirement: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    mediaAsset: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    ...overrides,
  };
  return { prisma, tx };
}

function firstArg(mock: jest.Mock): unknown {
  return (mock.mock.calls as unknown[][])[0][0];
}

function buildService(prisma: unknown, media: unknown = {}) {
  const stores = { requireStore: jest.fn().mockResolvedValue(STORE) };
  return new PackagingService(prisma as never, stores as never, media as never);
}

describe('PackagingService', () => {
  it('resolves an image object only for an active material owned by the store', async () => {
    const prisma = {
      packagingMaterial: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ imageObjectName: 'shop/packaging/box.webp' }),
      },
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new PackagingService(
      prisma as never,
      stores as never,
      {} as never,
    );

    await expect(
      service.requireImageObject(
        'user-1',
        '2d5e2688-0818-429a-bb03-8351130c60ea',
      ),
    ).resolves.toBe('shop/packaging/box.webp');
    expect(prisma.packagingMaterial.findFirst).toHaveBeenCalledWith({
      where: {
        id: '2d5e2688-0818-429a-bb03-8351130c60ea',
        storeId: 'store-1',
        isActive: true,
        imageObjectName: { not: null },
      },
      select: { imageObjectName: true },
    });
  });

  it('hides missing or unowned packaging images', async () => {
    const prisma = {
      packagingMaterial: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new PackagingService(
      prisma as never,
      stores as never,
      {} as never,
    );

    await expect(
      service.requireImageObject(
        'user-1',
        '2d5e2688-0818-429a-bb03-8351130c60ea',
      ),
    ).rejects.toThrow('Packaging image not found');
  });

  it('does not credit the same delivered shop item twice', async () => {
    const existingMovement = { id: 'movement-1', resultingQuantity: 20 };
    const tx = {
      warehouseLocation: {
        upsert: jest.fn().mockResolvedValue({ id: 'location-1' }),
      },
      packagingMaterial: {
        upsert: jest.fn().mockResolvedValue({ id: 'material-1' }),
      },
      inventoryItem: {
        upsert: jest.fn().mockResolvedValue({ id: 'inventory-1' }),
      },
      inventoryMovement: {
        findUnique: jest.fn().mockResolvedValue(existingMovement),
        create: jest.fn(),
      },
      inventoryBalance: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const service = new PackagingService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.creditDeliveredPurchase('store-1', {
        zomaalShopVariantId: 'shop-variant-1',
        name: 'Large box',
        quantity: 20,
        deliveryReference: 'delivery-1',
      }),
    ).resolves.toBe(existingMovement);
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects non-positive delivery quantities before touching the database', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new PackagingService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.creditDeliveredPurchase('store-1', {
        zomaalShopVariantId: 'shop-variant-1',
        name: 'Large box',
        quantity: 0,
        deliveryReference: 'delivery-1',
      }),
    ).rejects.toThrow('positive integer');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('packagingStockStatus', () => {
    it.each([
      [0, 5, 'OUT_OF_STOCK'],
      [-1, 0, 'OUT_OF_STOCK'],
      [5, 5, 'LOW_STOCK'],
      [6, 5, 'IN_STOCK'],
      [1, 0, 'IN_STOCK'],
    ])('available %i, minimum %i → %s', (available, minimum, expected) => {
      expect(packagingStockStatus(available, minimum)).toBe(expected);
    });
  });

  describe('listOwned', () => {
    it('maps source, stock and status, and filters by stock status', async () => {
      const { prisma } = buildPrisma();
      prisma.packagingMaterial.findMany.mockResolvedValue([
        materialRow(),
        materialRow({
          id: 'shop-1',
          zomaalShopVariantId: 'shop-variant-1',
          name: 'Shop box',
          minimumLevel: 0,
          inventoryItem: {
            id: 'item-2',
            balances: [{ onHand: 30, reserved: 2, damaged: 0 }],
          },
          _count: { requirements: 2 },
        }),
      ]);
      const service = buildService(prisma);

      const all = await service.listOwned('user-1');
      expect(all[0]).toMatchObject({
        source: 'MANUAL',
        zomaalShopVariantId: null,
        onHand: 12,
        available: 8,
        stockStatus: 'LOW_STOCK',
        inventoryItemId: 'item-1',
        usedInProducts: 0,
      });
      expect(all[1]).toMatchObject({
        source: 'SHOP',
        available: 28,
        stockStatus: 'IN_STOCK',
        usedInProducts: 2,
      });

      const low = await service.listOwned('user-1', {
        stockStatus: 'LOW_STOCK',
      });
      expect(low.map((m) => m.id)).toEqual([MATERIAL_ID]);
    });

    it('filters merchant-added packaging and searches name or SKU', async () => {
      const { prisma } = buildPrisma();
      await buildService(prisma).listOwned('user-1', {
        source: 'MANUAL',
        search: 'box',
      });
      expect(prisma.packagingMaterial.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId: STORE.id,
            isActive: true,
            zomaalShopVariantId: null,
            OR: [
              { name: { contains: 'box', mode: 'insensitive' } },
              { sku: { contains: 'box', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });
  });

  describe('create', () => {
    it('creates the material with opening stock and attaches the photo', async () => {
      const { prisma, tx } = buildPrisma();
      const service = buildService(prisma);

      const result = await service.create('user-1', {
        name: 'Medium box',
        unit: 'PIECES',
        openingStock: 12,
        minimumLevel: 10,
        imageUploadId: UPLOAD_ID,
      });

      expect(tx.packagingMaterial.create).toHaveBeenCalledWith({
        data: {
          storeId: STORE.id,
          name: 'Medium box',
          sku: null,
          unit: 'PIECES',
          minimumLevel: 10,
          lowStockAlert: true,
        },
      });
      expect(firstArg(tx.inventoryItem.create)).toMatchObject({
        data: {
          kind: 'PACKAGING_MATERIAL',
          packagingMaterialId: MATERIAL_ID,
          balances: { create: { locationId: 'location-1', onHand: 12 } },
          movements: {
            create: {
              type: 'OPENING_BALANCE',
              quantityDelta: 12,
              idempotencyKey: `opening:${MATERIAL_ID}`,
            },
          },
        },
      });
      expect(firstArg(tx.mediaAsset.findFirst)).toMatchObject({
        where: {
          id: UPLOAD_ID,
          storeId: STORE.id,
          purpose: 'PACKAGING',
          status: 'TEMPORARY',
        },
      });
      expect(tx.mediaAsset.update).toHaveBeenCalledWith({
        where: { id: UPLOAD_ID },
        data: {
          status: 'ATTACHED',
          expiresAt: null,
          packagingMaterialId: MATERIAL_ID,
        },
      });
      expect(tx.packagingMaterial.update).toHaveBeenCalledWith({
        where: { id: MATERIAL_ID },
        data: { imageObjectName: 'stores/store-1/media/new.webp' },
      });
      expect(result.source).toBe('MANUAL');
    });

    it('writes no opening movement when stock starts at zero', async () => {
      const { prisma, tx } = buildPrisma();
      await buildService(prisma).create('user-1', { name: 'Tape' });
      const data = (
        tx.inventoryItem.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.movements).toBeUndefined();
      expect(data.balances).toEqual({
        create: { locationId: 'location-1', onHand: 0 },
      });
    });

    it('rejects an unusable photo upload', async () => {
      const { prisma, tx } = buildPrisma();
      tx.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(
        buildService(prisma).create('user-1', {
          name: 'Tape',
          imageUploadId: UPLOAD_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('refuses catalog fields on Zomaal Shop packaging', async () => {
      const { prisma } = buildPrisma();
      prisma.packagingMaterial.findFirst.mockResolvedValue(
        materialRow({ zomaalShopVariantId: 'shop-variant-1' }),
      );
      await expect(
        buildService(prisma).update('user-1', MATERIAL_ID, { name: 'New' }),
      ).rejects.toThrow('come from the shop catalog');
    });

    it('lets Shop packaging change its minimum level and alert', async () => {
      const { prisma, tx } = buildPrisma();
      prisma.packagingMaterial.findFirst.mockResolvedValue(
        materialRow({ zomaalShopVariantId: 'shop-variant-1' }),
      );
      await buildService(prisma).update('user-1', MATERIAL_ID, {
        minimumLevel: 20,
        lowStockAlert: false,
      });
      expect(firstArg(tx.packagingMaterial.update)).toMatchObject({
        where: { id: MATERIAL_ID },
        data: { minimumLevel: 20, lowStockAlert: false, name: undefined },
      });
    });

    it('replaces the photo and deletes the old one', async () => {
      const { prisma, tx } = buildPrisma();
      tx.mediaAsset.findUnique.mockResolvedValue({ id: 'old-asset' });
      const media = {
        deleteAttachedAsset: jest.fn().mockResolvedValue(undefined),
      };
      await buildService(prisma, media).update('user-1', MATERIAL_ID, {
        imageUploadId: UPLOAD_ID,
      });
      expect(tx.mediaAsset.update).toHaveBeenCalledWith({
        where: { id: 'old-asset' },
        data: { packagingMaterialId: null },
      });
      expect(tx.mediaAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: UPLOAD_ID } }),
      );
      expect(media.deleteAttachedAsset).toHaveBeenCalledWith('old-asset');
    });

    it('removes the photo with null', async () => {
      const { prisma, tx } = buildPrisma();
      tx.mediaAsset.findUnique.mockResolvedValue({ id: 'old-asset' });
      const media = {
        deleteAttachedAsset: jest.fn().mockResolvedValue(undefined),
      };
      await buildService(prisma, media).update('user-1', MATERIAL_ID, {
        imageUploadId: null,
      });
      expect(tx.packagingMaterial.update).toHaveBeenCalledWith({
        where: { id: MATERIAL_ID },
        data: { imageObjectName: null },
      });
      expect(tx.mediaAsset.findFirst).not.toHaveBeenCalled();
      expect(media.deleteAttachedAsset).toHaveBeenCalledWith('old-asset');
    });

    it('returns 404 for archived or other-store packaging', async () => {
      const { prisma } = buildPrisma();
      prisma.packagingMaterial.findFirst.mockResolvedValue(null);
      await expect(
        buildService(prisma).update('user-1', MATERIAL_ID, { unit: 'ROLLS' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive', () => {
    it('refuses while products still use it', async () => {
      const { prisma } = buildPrisma();
      prisma.productPackagingRequirement.findMany.mockResolvedValue([
        { productId: 'p-1' },
        { productId: 'p-2' },
      ]);
      await expect(
        buildService(prisma).archive('user-1', MATERIAL_ID),
      ).rejects.toThrow(
        new ConflictException(
          'This packaging is used by 2 products. Remove it from those products first.',
        ),
      );
      expect(prisma.packagingMaterial.update).not.toHaveBeenCalled();
    });

    it('archives unused packaging', async () => {
      const { prisma } = buildPrisma();
      await expect(
        buildService(prisma).archive('user-1', MATERIAL_ID),
      ).resolves.toEqual({ archived: true });
      expect(prisma.packagingMaterial.update).toHaveBeenCalledWith({
        where: { id: MATERIAL_ID },
        data: { isActive: false },
      });
    });
  });
});
