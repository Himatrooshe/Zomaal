import { BadRequestException } from '@nestjs/common';
import {
  EcommercePlatform,
  InventoryBarcodeType,
  OrderLineStockStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ShopifyDataService } from '../shopify/shopify-data.service';
import type { YouCanDataService } from '../youcan/youcan-data.service';
import type { LightfunnelsDataService } from '../lightfunnels/lightfunnels-data.service';
import type { BarcodeService } from './barcode.service';
import type { MediaService } from './media.service';
import type { WarehouseStoreService } from './warehouse-store.service';
import { ProductImportResultStatus } from './dto/product-import.dto';
import { ProductService } from './product.service';

const shopifyDetails = {
  legacyResourceId: '2002',
  title: 'Test Hoodie',
  description: '',
  hasOnlyDefaultVariant: false,
  featuredImage: null,
  options: [{ id: 'o1', name: 'Size', position: 1, values: ['M', 'L'] }],
  variants: {
    data: [
      {
        sku: 'HOOD-M',
        barcode: '4006381333931',
        price: '30.00',
        inventoryQuantity: 6,
        selectedOptions: [{ name: 'Size', value: 'M' }],
      },
      {
        sku: null,
        barcode: null,
        price: '32.00',
        inventoryQuantity: 2,
        selectedOptions: [{ name: 'Size', value: 'L' }],
      },
    ],
    pageInfo: { hasNextPage: false },
  },
};

function setup() {
  const db = {
    ecommerceConnection: {
      findFirst: jest.fn().mockResolvedValue({ id: 'connection-1' }),
    },
    warehouseProduct: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'product-new' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'product-new',
        options: [{ id: 'opt-size', name: 'Size', position: 0, values: [] }],
        variants: [],
      }),
    },
    warehouseVariant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([{ id: 'v-m', sku: 'HOOD-M' }]),
      create: jest.fn(({ data }: { data: { title: string } }) =>
        Promise.resolve({ id: `v-${data.title}` }),
      ),
    },
    inventoryBarcode: { findMany: jest.fn().mockResolvedValue([]) },
    warehouseLocation: { upsert: jest.fn().mockResolvedValue({ id: 'loc' }) },
    productOptionValue: {
      create: jest.fn(({ data }: { data: { value: string } }) =>
        Promise.resolve({ id: `val-${data.value}` }),
      ),
    },
    inventoryItem: { create: jest.fn() },
    ecommerceOrderLine: { updateMany: jest.fn() },
  };
  const prisma = Object.assign(db, {
    $transaction: jest.fn((fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
  });
  const shopify = {
    getProductDetails: jest.fn().mockResolvedValue(shopifyDetails),
  };
  let generated = 0;
  const barcodes = {
    normalizeAndValidate: jest.fn((value: string) => ({
      value,
      type: InventoryBarcodeType.EAN_13,
    })),
    generateForStore: jest.fn(() =>
      Promise.resolve({
        value: `ZM-GEN-${++generated}`,
        type: InventoryBarcodeType.INTERNAL_CODE_128,
      }),
    ),
    generateProductCodeForStore: jest.fn(() =>
      Promise.resolve(`CODE${++generated}`),
    ),
  };
  const service = new ProductService(
    prisma as unknown as PrismaService,
    {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    } as unknown as WarehouseStoreService,
    barcodes as unknown as BarcodeService,
    shopify as unknown as ShopifyDataService,
    {} as YouCanDataService,
    {} as LightfunnelsDataService,
    { uploadForStore: jest.fn() } as unknown as MediaService,
  );
  return { service, db, shopify };
}

const request = {
  platform: EcommercePlatform.SHOPIFY,
  productIds: ['gid://shopify/Product/2002'],
};

describe('warehouse product import', () => {
  it('creates a product with platform SKUs, prices and a generated product code', async () => {
    const { service, db, shopify } = setup();

    const result = await service.importFromPlatform('user-1', request);

    expect(shopify.getProductDetails).toHaveBeenCalledWith(
      'user-1',
      '2002',
      expect.objectContaining({ variantsFirst: 100 }),
    );
    expect(db.warehouseProduct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Test Hoodie',
        idempotencyKey: 'import:SHOPIFY:2002',
        options: { create: [{ name: 'Size', position: 0 }] },
      }) as unknown,
    });
    expect(db.warehouseVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'M',
        sku: 'HOOD-M',
        price: 30,
        costPrice: 0,
        productCode: expect.stringMatching(/^CODE/) as unknown,
      }) as unknown,
    });
    expect(db.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        barcodes: {
          create: expect.objectContaining({
            value: '4006381333931',
            source: 'MERCHANT',
          }) as unknown,
        },
        balances: { create: { locationId: 'loc', onHand: 0 } },
      }) as unknown,
    });
    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(result.results[0]).toMatchObject({
      status: ProductImportResultStatus.IMPORTED,
      productId: 'product-new',
      variantsImported: 2,
      variantsWithoutSku: 1,
      costMissing: true,
      imageImported: false,
    });
  });

  it('uses platform stock as opening stock only when asked', async () => {
    const { service, db } = setup();
    await service.importFromPlatform('user-1', {
      ...request,
      importStock: true,
    });
    expect(db.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        balances: { create: { locationId: 'loc', onHand: 6 } },
      }) as unknown,
    });
  });

  it('links past order lines without deducting stock for delivered orders', async () => {
    const { service, db } = setup();
    await service.importFromPlatform('user-1', request);

    expect(db.ecommerceOrderLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          warehouseVariantId: 'v-m',
          stockStatus: OrderLineStockStatus.DELIVERED,
        },
      }),
    );
    expect(db.ecommerceOrderLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { warehouseVariantId: 'v-m' } }),
    );
  });

  it('skips a product that was already imported', async () => {
    const { service, db } = setup();
    db.warehouseProduct.findUnique.mockResolvedValueOnce({
      id: 'product-old',
      name: 'Test Hoodie',
    });

    const result = await service.importFromPlatform('user-1', request);

    expect(result.results[0]).toMatchObject({
      status: ProductImportResultStatus.ALREADY_IMPORTED,
      productId: 'product-old',
    });
    expect(db.warehouseProduct.create).not.toHaveBeenCalled();
  });

  it('does not duplicate a product whose SKU already exists', async () => {
    const { service, db } = setup();
    db.warehouseVariant.findFirst.mockResolvedValueOnce({
      productId: 'product-existing',
      product: { name: 'Hoodie' },
    });

    const result = await service.importFromPlatform('user-1', request);

    expect(result.results[0]).toMatchObject({
      status: ProductImportResultStatus.SKU_MATCHED,
      productId: 'product-existing',
    });
    expect(result.skipped).toBe(1);
    expect(db.warehouseProduct.create).not.toHaveBeenCalled();
  });

  it('reports a platform failure per product instead of failing the batch', async () => {
    const { service, shopify } = setup();
    shopify.getProductDetails
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(shopifyDetails);

    const result = await service.importFromPlatform('user-1', {
      ...request,
      productIds: ['1111', '2002'],
    });

    expect(result.results.map((entry) => entry.status)).toEqual([
      ProductImportResultStatus.FAILED,
      ProductImportResultStatus.IMPORTED,
    ]);
  });

  it('requires the platform to be connected', async () => {
    const { service, db } = setup();
    db.ecommerceConnection.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.importFromPlatform('user-1', request),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
