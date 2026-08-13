import { BadRequestException } from '@nestjs/common';
import { CreateWarehouseProductDto, ProductStockStatus } from './dto/product.dto';
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
  function makeService(ids: string[] = ['11111111-1111-4111-8111-111111111111']) {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(ids.map((id) => ({ id }))),
      warehouseProduct: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    } as unknown as WarehouseStoreService;
    const service = new ProductService(
      prisma,
      stores,
      {} as BarcodeService,
    );
    return { service, prisma };
  }

  it('constrains the paginated query with stock-matching product ids', async () => {
    const { service, prisma } = makeService(['p-1', 'p-2']);

    await service.list('user-1', {
      stockStatus: ProductStockStatus.LOW_STOCK,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const call = (prisma.warehouseProduct.findMany as jest.Mock).mock
      .calls[0][0];
    expect(call.where).toEqual(
      expect.objectContaining({ id: { in: ['p-1', 'p-2'] } }),
    );
  });

  it('skips the stock lookup when stockStatus is omitted', async () => {
    const { service, prisma } = makeService();

    await service.list('user-1', {});

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const call = (prisma.warehouseProduct.findMany as jest.Mock).mock
      .calls[0][0];
    expect(call.where.id).toBeUndefined();
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
