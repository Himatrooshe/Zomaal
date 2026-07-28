import { BadGatewayException, ConflictException } from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ProductStatus, PublishProductDto } from './dto/product.dto';
import type { LightfunnelsProductAdapter } from './lightfunnels-product.adapter';
import { ProductService } from './product.service';
import type { ShopifyProductAdapter } from './shopify-product.adapter';
import type { YouCanProductAdapter } from './youcan-product.adapter';

describe('ProductService', () => {
  const request: PublishProductDto = {
    platform: EcommercePlatform.SHOPIFY,
    idempotencyKey: 'product-publish-request-1',
    product: {
      title: 'Winter Hat',
      description: '<p>Warm hat</p>',
      vendor: 'Zomaal',
      status: ProductStatus.ACTIVE,
      variants: [
        {
          title: 'Black',
          sku: 'HAT-BLK',
          price: 99,
          compareAtPrice: 129,
          inventoryQty: 12,
        },
      ],
      images: [{ url: 'https://example.com/hat.jpg', position: 0 }],
    },
  };

  it.each([
    EcommercePlatform.SHOPIFY,
    EcommercePlatform.YOUCAN,
    EcommercePlatform.LIGHTFUNNELS,
  ])(
    'creates and publishes through the selected %s adapter',
    async (platform) => {
      const pending = productFixture(platform, 'PENDING');
      const published = productFixture(platform, 'PUBLISHED');
      let capturedCreateArguments: unknown;
      const create = jest.fn((argumentsValue: unknown) => {
        capturedCreateArguments = argumentsValue;
        return Promise.resolve(pending);
      });
      const prisma = prismaMock({
        product: {
          findUnique: jest.fn().mockResolvedValue(null),
          create,
          findFirst: jest.fn().mockResolvedValue(published),
        },
        ecommerceConnection: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'connection-id',
            platform,
            status: EcommerceConnectionStatus.ACTIVE,
          }),
        },
        productListing: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const shopify = adapterMock();
      const youcan = adapterMock();
      const lightfunnels = adapterMock();
      const service = new ProductService(
        prisma,
        shopify as unknown as ShopifyProductAdapter,
        youcan as unknown as YouCanProductAdapter,
        lightfunnels as unknown as LightfunnelsProductAdapter,
      );

      const result = await service.createAndPublishProduct('user-id', {
        ...request,
        platform,
      });

      const selected = {
        [EcommercePlatform.SHOPIFY]: shopify,
        [EcommercePlatform.YOUCAN]: youcan,
        [EcommercePlatform.LIGHTFUNNELS]: lightfunnels,
      }[platform];
      expect(selected.publishProduct).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          idempotencyKey: request.idempotencyKey,
          title: request.product.title,
        }),
      );
      const createArguments = capturedCreateArguments as {
        data: {
          idempotencyKey: string;
          listings: {
            create: {
              connectionId: string;
              status: string;
            };
          };
        };
      };
      expect(createArguments.data.idempotencyKey).toBe(request.idempotencyKey);
      expect(createArguments.data.listings).toEqual({
        create: {
          connectionId: 'connection-id',
          status: 'PENDING',
        },
      });
      expect(result.listings[0]).toEqual(
        expect.objectContaining({
          platform,
          status: 'PUBLISHED',
          externalProductId: 'external-product-id',
        }),
      );
    },
  );

  it('returns the existing published result for the same idempotency key', async () => {
    const existing = productFixture(EcommercePlatform.SHOPIFY, 'PUBLISHED');
    const create = jest.fn();
    const prisma = prismaMock({
      product: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create,
      },
    });
    const shopify = adapterMock();
    const service = new ProductService(
      prisma,
      shopify as unknown as ShopifyProductAdapter,
      adapterMock() as unknown as YouCanProductAdapter,
      adapterMock() as unknown as LightfunnelsProductAdapter,
    );

    const result = await service.createAndPublishProduct('user-id', request);

    expect(result.id).toBe(existing.id);
    expect(shopify.publishProduct).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for a different platform', async () => {
    const existing = productFixture(EcommercePlatform.YOUCAN, 'FAILED');
    const prisma = prismaMock({
      product: {
        findUnique: jest.fn().mockResolvedValue(existing),
      },
    });
    const service = new ProductService(
      prisma,
      adapterMock() as unknown as ShopifyProductAdapter,
      adapterMock() as unknown as YouCanProductAdapter,
      adapterMock() as unknown as LightfunnelsProductAdapter,
    );

    await expect(
      service.createAndPublishProduct('user-id', request),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a failed listing and returns a retryable product identifier', async () => {
    const pending = productFixture(EcommercePlatform.SHOPIFY, 'PENDING');
    const update = jest.fn().mockResolvedValue({});
    const prisma = prismaMock({
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(pending),
      },
      ecommerceConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'connection-id',
          platform: EcommercePlatform.SHOPIFY,
          status: EcommerceConnectionStatus.ACTIVE,
        }),
      },
      productListing: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
      },
    });
    const shopify = adapterMock();
    shopify.publishProduct.mockRejectedValueOnce(
      new Error('provider rejected input'),
    );
    const service = new ProductService(
      prisma,
      shopify as unknown as ShopifyProductAdapter,
      adapterMock() as unknown as YouCanProductAdapter,
      adapterMock() as unknown as LightfunnelsProductAdapter,
    );

    let thrown: unknown;
    try {
      await service.createAndPublishProduct('user-id', request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadGatewayException);
    expect((thrown as BadGatewayException).getResponse()).toMatchObject({
      productId: 'product-id',
      platform: EcommercePlatform.SHOPIFY,
      listingStatus: 'FAILED',
    });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'listing-id' },
      data: {
        status: 'FAILED',
        errorMessage: 'provider rejected input',
      },
    });
  });
});

function adapterMock() {
  return {
    publishProduct: jest.fn().mockResolvedValue({
      externalProductId: 'external-product-id',
    }),
  };
}

function prismaMock(overrides: Record<string, Record<string, unknown>>) {
  return {
    store: {
      findUnique: jest.fn().mockResolvedValue({ id: 'store-id' }),
    },
    product: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      ...overrides.product,
    },
    ecommerceConnection: {
      findFirst: jest.fn(),
      ...overrides.ecommerceConnection,
    },
    productListing: {
      updateMany: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
      ...overrides.productListing,
    },
  } as unknown as PrismaService;
}

function productFixture(platform: EcommercePlatform, listingStatus: string) {
  const now = new Date('2026-07-29T00:00:00.000Z');
  return {
    id: 'product-id',
    storeId: 'store-id',
    idempotencyKey: 'product-publish-request-1',
    title: 'Winter Hat',
    description: '<p>Warm hat</p>',
    vendor: 'Zomaal',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    variants: [
      {
        id: 'variant-id',
        productId: 'product-id',
        title: 'Black',
        sku: 'HAT-BLK',
        price: new Prisma.Decimal(99),
        compareAtPrice: new Prisma.Decimal(129),
        inventoryQty: 12,
      },
    ],
    images: [
      {
        id: 'image-id',
        productId: 'product-id',
        url: 'https://example.com/hat.jpg',
        position: 0,
      },
    ],
    listings: [
      {
        id: 'listing-id',
        productId: 'product-id',
        connectionId: 'connection-id',
        externalProductId:
          listingStatus === 'PUBLISHED' ? 'external-product-id' : null,
        status: listingStatus,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        connection: { platform },
      },
    ],
  };
}
