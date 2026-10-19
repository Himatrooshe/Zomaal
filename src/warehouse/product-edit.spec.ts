import { BadRequestException } from '@nestjs/common';
import {
  InventoryBarcodeType,
  MediaAssetPurpose,
  Prisma,
  WarehouseProductKind,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { BarcodeService } from './barcode.service';
import type { MediaService } from './media.service';
import type { WarehouseStoreService } from './warehouse-store.service';
import type { ShopifyDataService } from '../shopify/shopify-data.service';
import type { YouCanDataService } from '../youcan/youcan-data.service';
import type { LightfunnelsDataService } from '../lightfunnels/lightfunnels-data.service';
import { ProductService } from './product.service';

function media(id: string, purpose: MediaAssetPurpose, position = 0) {
  return {
    id,
    purpose,
    position,
    objectName: `obj-${id}`,
    contentType: 'image/png',
    originalName: `${id}.png`,
    sizeBytes: 1,
  };
}

function variant(
  id: string,
  values: string[],
  extras: { onHand?: number; media?: ReturnType<typeof media>[] } = {},
) {
  return {
    id,
    title: values.join(' / ') || 'Default',
    sku: null,
    productCode: `CODE-${id}`,
    price: new Prisma.Decimal(100),
    costPrice: new Prisma.Decimal(40),
    lowStockThreshold: 5,
    isDefault: values.length === 0,
    position: 0,
    optionValues: values.map((value) => ({
      value: {
        value,
        optionId: 'opt-size',
        option: { id: 'opt-size', name: 'Size', position: 0 },
      },
    })),
    inventoryItem: {
      id: `item-${id}`,
      barcodes: [],
      balances: [
        {
          onHand: extras.onHand ?? 0,
          reserved: 0,
          damaged: 0,
          incoming: 0,
          location: { id: 'loc', name: 'Main Warehouse' },
        },
      ],
    },
    media: extras.media ?? [],
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Shirt',
    description: null,
    status: 'ACTIVE',
    kind: WarehouseProductKind.STANDARD,
    version: 3,
    category: null,
    categoryId: null,
    options: [
      {
        id: 'opt-size',
        name: 'Size',
        position: 0,
        values: [
          { id: 'val-m', value: 'M', position: 0 },
          { id: 'val-l', value: 'L', position: 1 },
        ],
      },
    ],
    variants: [
      variant('var-m', ['M'], { onHand: 4 }),
      variant('var-l', ['L'], {
        media: [media('img-var-l', MediaAssetPurpose.VARIANT)],
      }),
    ],
    media: [
      media('img-main', MediaAssetPurpose.PRODUCT_MAIN),
      media('img-gallery', MediaAssetPurpose.PRODUCT_GALLERY, 1),
    ],
    gift: null,
    packagingRequirements: [],
    bundleComponents: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

function setup(current = product()) {
  const db = {
    warehouseProduct: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    warehouseVariant: {
      findFirst: jest.fn().mockResolvedValue({ id: 'gift-variant' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(({ data }: { data: { title: string } }) =>
        Promise.resolve({ id: `new-${data.title}` }),
      ),
    },
    mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    productGift: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    productPackagingRequirement: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    productBundleComponent: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    productOptionValue: {
      create: jest.fn().mockResolvedValue({ id: 'val-xl' }),
      deleteMany: jest.fn(),
    },
    packagingMaterial: { count: jest.fn().mockResolvedValue(1) },
    ecommerceOrderLine: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(),
    },
    warehouseLocation: { upsert: jest.fn().mockResolvedValue({ id: 'loc' }) },
    inventoryItem: { create: jest.fn() },
    inventoryMovement: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },
    merchantPurchase: { count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = Object.assign(db, {
    $transaction: jest.fn((fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
  });
  const mediaService = { deleteAttachedAsset: jest.fn() };
  const barcodes = {
    generateForStore: jest.fn().mockResolvedValue({
      value: 'ZM-NEW-1',
      type: InventoryBarcodeType.INTERNAL_CODE_128,
    }),
    generateProductCodeForStore: jest.fn().mockResolvedValue('NEWCODE1'),
  };
  const service = new ProductService(
    prisma as unknown as PrismaService,
    {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    } as unknown as WarehouseStoreService,
    barcodes as unknown as BarcodeService,
    {} as ShopifyDataService,
    {} as YouCanDataService,
    {} as LightfunnelsDataService,
    mediaService as unknown as MediaService,
  );
  return { service, db, mediaService };
}

describe('warehouse product full edit', () => {
  it('clears a nullable description without calling trim on null', async () => {
    const { service, db } = setup();
    await service.update('user-1', 'product-1', {
      version: 3,
      description: null,
    });
    expect(db.warehouseProduct.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }) as unknown,
      }),
    );
  });

  it('rejects a name that becomes blank after trimming', async () => {
    const { service, db } = setup();
    await expect(
      service.update('user-1', 'product-1', { version: 3, name: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.warehouseProduct.updateMany).not.toHaveBeenCalled();
  });

  it('preserves inventory history when a zero-stock variant has been used', async () => {
    const { service, db } = setup();
    db.inventoryMovement.count.mockResolvedValue(1);
    await expect(
      service.update('user-1', 'product-1', {
        version: 3,
        removeVariantIds: ['var-l'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.inventoryMovement.deleteMany).not.toHaveBeenCalled();
    expect(db.warehouseVariant.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces gift and packaging and deletes a removed gallery image', async () => {
    const { service, db, mediaService } = setup();

    await service.update('user-1', 'product-1', {
      version: 3,
      gift: { giftVariantId: 'gift-variant', quantity: 2 },
      packaging: [{ packagingMaterialId: 'box', quantityPerUnit: 1 }],
      removeMediaIds: ['img-gallery'],
    });

    expect(db.productGift.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { giftVariantId: 'gift-variant', quantity: 2 },
      }),
    );
    expect(db.productPackagingRequirement.deleteMany).toHaveBeenCalledWith({
      where: { productId: 'product-1', variantId: null },
    });
    expect(db.productPackagingRequirement.createMany).toHaveBeenCalled();
    expect(mediaService.deleteAttachedAsset).toHaveBeenCalledWith(
      'img-gallery',
    );
  });

  it('removes the gift when null is sent', async () => {
    const { service, db } = setup();
    await service.update('user-1', 'product-1', { version: 3, gift: null });
    expect(db.productGift.deleteMany).toHaveBeenCalledWith({
      where: { productId: 'product-1' },
    });
  });

  it('replaces the main image and deletes the old file', async () => {
    const { service, db, mediaService } = setup();

    await service.update('user-1', 'product-1', {
      version: 3,
      mainImageUploadId: 'upload-main',
    });

    expect(db.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'upload-main',
          purpose: MediaAssetPurpose.PRODUCT_MAIN,
        }) as unknown,
      }),
    );
    expect(mediaService.deleteAttachedAsset).toHaveBeenCalledWith('img-main');
  });

  it('refuses to remove the main image', async () => {
    const { service } = setup();
    await expect(
      service.update('user-1', 'product-1', {
        version: 3,
        removeMediaIds: ['img-main'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds a variant with a new option value and opening stock', async () => {
    const { service, db } = setup();

    await service.update('user-1', 'product-1', {
      version: 3,
      addVariants: [{ optionValues: ['XL'], price: 120, stockQuantity: 6 }],
    });

    expect(db.productOptionValue.create).toHaveBeenCalledWith({
      data: { optionId: 'opt-size', value: 'XL', position: 2 },
    });
    expect(db.warehouseVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'XL',
        productCode: 'NEWCODE1',
        costPrice: 40,
      }) as unknown,
    });
    expect(db.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        balances: { create: { locationId: 'loc', onHand: 6 } },
      }) as unknown,
    });
  });

  it('rejects adding a variant that already exists', async () => {
    const { service } = setup();
    await expect(
      service.update('user-1', 'product-1', {
        version: 3,
        addVariants: [{ optionValues: ['m'], price: 120, stockQuantity: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes an empty variant and deletes its image', async () => {
    const { service, db, mediaService } = setup();

    await service.update('user-1', 'product-1', {
      version: 3,
      removeVariantIds: ['var-l'],
    });

    expect(db.warehouseVariant.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['var-l'] }, productId: 'product-1' },
    });
    expect(db.productOptionValue.deleteMany).toHaveBeenCalled();
    expect(mediaService.deleteAttachedAsset).toHaveBeenCalledWith('img-var-l');
  });

  it('refuses to remove a variant that still has stock', async () => {
    const { service, db } = setup();
    await expect(
      service.update('user-1', 'product-1', {
        version: 3,
        removeVariantIds: ['var-m'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.warehouseVariant.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces bundle components and recalculates the bundle cost', async () => {
    const { service, db } = setup(
      product({
        kind: WarehouseProductKind.BUNDLE,
        options: [],
        variants: [variant('var-bundle', [])],
      }),
    );
    db.warehouseVariant.findMany.mockResolvedValueOnce([
      { id: 'comp-a', costPrice: new Prisma.Decimal(30) },
      { id: 'comp-b', costPrice: new Prisma.Decimal(12.5) },
    ]);

    await service.update('user-1', 'product-1', {
      version: 3,
      bundleComponents: [
        { variantId: 'comp-a', quantity: 1 },
        { variantId: 'comp-b', quantity: 2 },
      ],
    });

    expect(db.productBundleComponent.createMany).toHaveBeenCalled();
    const [[costUpdate]] = db.warehouseVariant.updateMany.mock.calls as [
      [{ data: { costPrice: Prisma.Decimal } }],
    ];
    expect(costUpdate.data.costPrice.toFixed(2)).toBe('55.00');
  });

  it('rejects bundle components on a standard product', async () => {
    const { service } = setup();
    await expect(
      service.update('user-1', 'product-1', {
        version: 3,
        bundleComponents: [{ variantId: 'comp-a', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
