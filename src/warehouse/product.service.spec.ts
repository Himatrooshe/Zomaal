import { BadRequestException } from '@nestjs/common';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  MediaAssetPurpose,
  Prisma,
  WarehouseProductKind,
  WarehouseProductStatus,
} from '@prisma/client';
import {
  CreateWarehouseProductDto,
  ProductPerformancePeriod,
  ProductStockStatus,
} from './dto/product.dto';
import {
  createFingerprint,
  prepareProduct,
  ProductService,
} from './product.service';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseStoreService } from './warehouse-store.service';
import { BarcodeService } from './barcode.service';

describe('warehouse product preparation', () => {
  it('creates one default inventory variant for a product without options', () => {
    const result = prepareProduct(baseProduct());

    expect(result.options).toEqual([]);
    expect(result.variants).toEqual([
      expect.objectContaining({
        optionValues: [],
        price: 50,
        costPrice: 25,
        stockQuantity: 10,
        lowStockAlertThreshold: 5,
      }),
    ]);
  });

  it('requires every generated option combination exactly once', () => {
    const input = baseProduct({
      options: [
        { name: 'Size', values: ['M', 'L'] },
        { name: 'Color', values: ['Black', 'White'] },
      ],
      variants: [
        variant(['M', 'Black']),
        variant(['M', 'White']),
        variant(['L', 'Black']),
        variant(['L', 'White']),
      ],
    });

    const result = prepareProduct(input);
    expect(result.variants.map((item) => item.optionValues)).toEqual([
      ['M', 'Black'],
      ['M', 'White'],
      ['L', 'Black'],
      ['L', 'White'],
    ]);
  });

  it('rejects missing and duplicate combinations', () => {
    expect(() =>
      prepareProduct(
        baseProduct({
          options: [{ name: 'Size', values: ['M', 'L'] }],
          variants: [variant(['M'])],
        }),
      ),
    ).toThrow('Exactly 2 variant configurations are required');

    expect(() =>
      prepareProduct(
        baseProduct({
          options: [{ name: 'Size', values: ['M', 'L'] }],
          variants: [variant(['M']), variant(['M'])],
        }),
      ),
    ).toThrow('Duplicate variant combination');
  });

  it('rejects more than 100 generated variants', () => {
    expect(() =>
      prepareProduct(
        baseProduct({
          options: [
            {
              name: 'A',
              values: Array.from({ length: 11 }, (_, index) => `A${index}`),
            },
            {
              name: 'B',
              values: Array.from({ length: 10 }, (_, index) => `B${index}`),
            },
          ],
          variants: [],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('creates stable fingerprints and detects changed idempotent requests', () => {
    expect(createFingerprint({ name: 'Box', stock: 10 })).toBe(
      createFingerprint({ stock: 10, name: 'Box' }),
    );
    expect(createFingerprint({ name: 'Box', stock: 10 })).not.toBe(
      createFingerprint({ name: 'Box', stock: 11 }),
    );
  });
});

describe('warehouse product list stock filter', () => {
  function makeService(
    ids: string[] = ['11111111-1111-4111-8111-111111111111'],
  ) {
    const queryRaw = jest.fn().mockResolvedValue(ids.map((id) => ({ id })));
    let capturedFindManyArgs: { where: Record<string, unknown> } | undefined;
    const findMany = jest.fn((args: { where: Record<string, unknown> }) => {
      capturedFindManyArgs = args;
      return Promise.resolve([]);
    });
    const prisma = {
      $queryRaw: queryRaw,
      warehouseProduct: {
        count: jest.fn().mockResolvedValue(1),
        findMany,
      },
    } as unknown as PrismaService;
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    } as unknown as WarehouseStoreService;
    const service = new ProductService(prisma, stores, {} as BarcodeService);
    return {
      service,
      queryRaw,
      getFindManyArgs: () => capturedFindManyArgs,
    };
  }

  it('constrains the paginated query with stock-matching product ids', async () => {
    const { service, queryRaw, getFindManyArgs } = makeService(['p-1', 'p-2']);

    await service.list('user-1', {
      stockStatus: ProductStockStatus.LOW_STOCK,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const call = getFindManyArgs();
    expect(call).toBeDefined();
    expect(call!.where).toEqual(
      expect.objectContaining({ id: { in: ['p-1', 'p-2'] } }),
    );
  });

  it('skips the stock lookup when stockStatus is omitted', async () => {
    const { service, queryRaw, getFindManyArgs } = makeService();

    await service.list('user-1', {});

    expect(queryRaw).not.toHaveBeenCalled();
    const call = getFindManyArgs();
    expect(call).toBeDefined();
    expect(call!.where.id).toBeUndefined();
  });
});

describe('warehouse product performance', () => {
  it('returns product-level financial and delivery metrics from matched order lines', async () => {
    const prisma = {
      warehouseProduct: {
        findFirst: jest.fn().mockResolvedValue({ id: 'product-1' }),
      },
      ecommerceOrderLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            quantity: 2,
            totalPrice: new Prisma.Decimal(200),
            warehouseVariant: { costPrice: new Prisma.Decimal(60) },
            order: {
              id: 'order-1',
              status: EcommerceOrderStatus.CLOSED,
              financialStatus: EcommercePaymentStatus.PAID,
              fulfillmentStatus: 'FULFILLED',
              shippingCity: 'Casablanca',
              processedAt: new Date('2026-08-10T12:00:00.000Z'),
              providerUpdatedAt: new Date('2026-08-11T12:00:00.000Z'),
              dispatch: null,
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const stores = {
      requireStore: jest.fn().mockResolvedValue({
        id: 'store-1',
        baseCurrency: 'MAD',
      }),
    } as unknown as WarehouseStoreService;
    const service = new ProductService(prisma, stores, {} as BarcodeService);

    const result = await service.performance('user-1', 'product-1', {
      period: ProductPerformancePeriod.CUSTOM,
      from: '2026-08-10',
      to: '2026-08-10',
    });

    expect(result.metrics).toMatchObject({
      totalOrders: 1,
      deliveredOrders: 1,
      totalUnits: 2,
      totalRevenue: '200.0000',
      totalCost: '120.0000',
      grossProfit: '80.0000',
      roi: 66.67,
      deliveryRate: 100,
    });
    expect(result.performance).toEqual([
      expect.objectContaining({
        date: '2026-08-10',
        orders: 1,
        revenue: '200.0000',
      }),
    ]);
    expect(result.topCities).toEqual([
      { city: 'Casablanca', orders: 1, revenue: '200.0000' },
    ]);
  });
});

describe('warehouse product bundles', () => {
  it('derives bundle cost and available stock from component variants', async () => {
    let capturedVariantData:
      | { costPrice: Prisma.Decimal; productId: string; price: number }
      | undefined;
    const variantCreate = jest.fn(
      (args: {
        data: { costPrice: Prisma.Decimal; productId: string; price: number };
      }) => {
        capturedVariantData = args.data;
        return Promise.resolve({ id: 'bundle-variant' });
      },
    );
    const now = new Date('2026-08-16T00:00:00.000Z');
    const component = (
      id: string,
      productName: string,
      cost: number,
      available: number,
      quantity: number,
    ) => ({
      id: `component-${id}`,
      bundleProductId: 'bundle-1',
      componentVariantId: id,
      quantity,
      position: 0,
      createdAt: now,
      updatedAt: now,
      componentVariant: {
        id,
        title: 'Default',
        sku: id.toUpperCase(),
        costPrice: new Prisma.Decimal(cost),
        product: {
          id: `product-${id}`,
          name: productName,
          status: WarehouseProductStatus.ACTIVE,
        },
        inventoryItem: {
          balances: [
            { onHand: available, reserved: 0, damaged: 0, incoming: 0 },
          ],
        },
      },
    });
    const savedProduct = {
      id: 'bundle-1',
      name: 'Desk Bundle',
      description: null,
      status: WarehouseProductStatus.ACTIVE,
      kind: WarehouseProductKind.BUNDLE,
      version: 1,
      category: null,
      options: [],
      media: [
        {
          id: 'image-1',
          purpose: MediaAssetPurpose.PRODUCT_MAIN,
          position: 0,
          contentType: 'image/png',
        },
      ],
      variants: [
        {
          id: 'bundle-variant',
          title: 'Bundle',
          sku: 'DESK-BUNDLE',
          price: new Prisma.Decimal(199),
          costPrice: new Prisma.Decimal(120),
          lowStockThreshold: 2,
          isDefault: true,
          optionValues: [],
          inventoryItem: null,
          media: [],
        },
      ],
      gift: null,
      packagingRequirements: [],
      bundleComponents: [
        component('variant-a', 'Keyboard', 50, 10, 2),
        component('variant-b', 'Mouse', 20, 3, 1),
      ],
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const componentFindMany = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 'variant-a', costPrice: new Prisma.Decimal(50) },
        { id: 'variant-b', costPrice: new Prisma.Decimal(20) },
      ])
      .mockResolvedValueOnce([{ id: 'bundle-variant', sku: 'DESK-BUNDLE' }]);
    const tx = {
      warehouseProduct: {
        create: jest.fn().mockResolvedValue({ id: 'bundle-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(savedProduct),
      },
      warehouseVariant: { create: variantCreate },
      productBundleComponent: { createMany: jest.fn() },
      mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      warehouseProduct: { findUnique: jest.fn().mockResolvedValue(null) },
      productCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
      warehouseVariant: { findMany: componentFindMany },
      mediaAsset: { findFirst: jest.fn().mockResolvedValue({ id: 'image-1' }) },
      ecommerceOrderLine: { updateMany: jest.fn() },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    } as unknown as WarehouseStoreService;
    const service = new ProductService(prisma, stores, {} as BarcodeService);

    const result = await service.createBundle('user-1', {
      idempotencyKey: 'bundle-create-001',
      name: 'Desk Bundle',
      categoryId: '00000000-0000-4000-8000-000000000001',
      mainImageUploadId: '00000000-0000-4000-8000-000000000002',
      price: 199,
      sku: 'DESK-BUNDLE',
      lowStockAlertThreshold: 2,
      components: [
        { variantId: 'variant-a', quantity: 2 },
        { variantId: 'variant-b', quantity: 1 },
      ],
    });

    expect(capturedVariantData?.productId).toBe('bundle-1');
    expect(capturedVariantData?.price).toBe(199);
    expect(capturedVariantData?.costPrice.toFixed(4)).toBe('120.0000');
    expect(result).toMatchObject({
      kind: WarehouseProductKind.BUNDLE,
      inventory: { onHand: 3, available: 3 },
    });
    expect(result.bundleComponents).toHaveLength(2);
  });
});

function baseProduct(
  overrides: Partial<CreateWarehouseProductDto> = {},
): CreateWarehouseProductDto {
  return {
    idempotencyKey: 'create-product-123',
    name: 'Headphones',
    categoryId: '00000000-0000-4000-8000-000000000001',
    mainImageUploadId: '00000000-0000-4000-8000-000000000002',
    basePrice: 50,
    costPrice: 25,
    stockQuantity: 10,
    ...overrides,
  };
}

function variant(optionValues: string[]) {
  return { optionValues, price: 50, stockQuantity: 10 };
}
