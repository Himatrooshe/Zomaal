import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Storage } from '@google-cloud/storage';
import { PrismaClient, MediaAssetPurpose } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { StoreAccessService } from '../src/access/store-access.service';
import { PermissionGuard } from '../src/access/permission.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ProductController } from '../src/warehouse/product.controller';
import { ProductService } from '../src/warehouse/product.service';
import { ProductComparisonPdfService } from '../src/warehouse/product-comparison-pdf.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';
import { BarcodeService } from '../src/warehouse/barcode.service';
import { MediaService } from '../src/warehouse/media.service';
import { InventoryService } from '../src/warehouse/inventory.service';

// Explicit opt-in to a disposable local database. Never use DATABASE_URL.
const url = process.env.PRODUCTS_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Product edits with PostgreSQL', () => {
  let db: PrismaClient;
  let pool: Pool;
  let app: INestApplication;
  let server: Server;
  let service: ProductService;
  let inventory: InventoryService;
  let owner: string;
  let storeId: string;
  let categoryId: string;
  const cloudDelete = jest.fn().mockResolvedValue(undefined);
  let bucketSpy: jest.SpyInstance;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    ) {
      throw new Error(
        'PRODUCTS_TEST_DATABASE_URL must identify a dedicated local test database',
      );
    }
    pool = new Pool({ connectionString: url, max: 5 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    owner = (
      await db.user.create({ data: { phone: `products-test-${randomUUID()}` } })
    ).id;
    storeId = (
      await db.store.create({
        data: {
          userId: owner,
          ownerName: 'QA',
          businessName: 'Products regression',
          address: 'Test',
          city: 'Test',
          country: 'MA',
          baseCurrency: 'MAD',
        },
      })
    ).id;
    await db.user.update({
      where: { id: owner },
      data: { activeStoreId: storeId },
    });
    categoryId = (
      await db.productCategory.create({
        data: { storeId, name: 'Test products', slug: 'test-products' },
      })
    ).id;
    const prisma = db as PrismaService;
    const access = new StoreAccessService(prisma);
    const stores = new WarehouseStoreService(access);
    // Only object storage is mocked. Database constraints and cleanup use real services.
    bucketSpy = jest.spyOn(Storage.prototype, 'bucket').mockReturnValue({
      file: () => ({ delete: cloudDelete }),
    } as never);
    const media = new MediaService(
      prisma,
      new ConfigService({ PRODUCT_IMAGE_BUCKET: 'test-only' }),
      stores,
    );
    service = new ProductService(
      prisma,
      stores,
      new BarcodeService(prisma, stores),
      {} as never,
      {} as never,
      {} as never,
      media,
    );
    inventory = new InventoryService(prisma, stores);
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [
        { provide: ProductService, useValue: service },
        { provide: ProductComparisonPdfService, useValue: {} },
        { provide: StoreAccessService, useValue: access },
        PermissionGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context
            .switchToHttp()
            .getRequest<{ user: { userId: string } }>().user = {
            userId: owner,
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    bucketSpy?.mockRestore();
    if (db) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItem: { storeId } },
      });
      await db.user.deleteMany({ where: { id: owner } });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });

  async function upload(purpose: MediaAssetPurpose) {
    return db.mediaAsset.create({
      data: {
        storeId,
        purpose,
        objectName: `test-${randomUUID()}`,
        originalName: 'fixture.png',
        checksum: 'test-fixture-checksum',
        contentType: 'image/png',
        sizeBytes: 1,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  }

  async function fixture() {
    const image = await upload('PRODUCT_MAIN');
    return service.create(owner, {
      idempotencyKey: randomUUID(),
      name: 'Test product',
      categoryId,
      mainImageUploadId: image.id,
      basePrice: 100,
      costPrice: 30,
      stockQuantity: 0,
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { optionValues: ['S'], price: 100, stockQuantity: 0 },
        { optionValues: ['M'], price: 120, stockQuantity: 0 },
      ],
    });
  }

  async function patch(
    id: string,
    data: Record<string, unknown>,
    status = 200,
  ) {
    const current = await service.get(owner, id);
    const response = await request(server)
      .patch(`/warehouse/products/${id}`)
      .send({ version: current.version, ...data })
      .expect(status);
    return {
      body: response.body as Awaited<ReturnType<ProductService['get']>>,
    };
  }

  it('replaces the main image and removes the detached row after commit', async () => {
    const p = await fixture();
    const oldId = p.images[0].id;
    const image = await upload('PRODUCT_MAIN');
    const response = await patch(p.id, { mainImageUploadId: image.id });
    expect(response.body.images).toHaveLength(1);
    expect(response.body.images[0].id).toBe(image.id);
    expect(await db.mediaAsset.findUnique({ where: { id: oldId } })).toBeNull();
    expect(
      await db.mediaAsset.findUnique({ where: { id: image.id } }),
    ).toMatchObject({
      status: 'ATTACHED',
      productId: p.id,
      expiresAt: null,
    });
  });

  it('removes a gallery image without violating the media attachment check', async () => {
    const p = await fixture();
    const image = await upload('PRODUCT_GALLERY');
    await patch(p.id, { galleryImageUploadIds: [image.id] });
    const response = await patch(p.id, { removeMediaIds: [image.id] });
    expect(response.body.images.map((i: { id: string }) => i.id)).not.toContain(
      image.id,
    );
    expect(
      await db.mediaAsset.findUnique({ where: { id: image.id } }),
    ).toBeNull();
  });

  it('replaces a variant image using the same constraint-safe detachment', async () => {
    const p = await fixture();
    const first = await upload('VARIANT');
    const second = await upload('VARIANT');
    await patch(p.id, {
      variants: [{ id: p.variants[0].id, imageUploadId: first.id }],
    });
    const response = await patch(p.id, {
      variants: [{ id: p.variants[0].id, imageUploadId: second.id }],
    });
    expect(response.body.variants[0].images[0].id).toBe(second.id);
    expect(
      await db.mediaAsset.findUnique({ where: { id: first.id } }),
    ).toBeNull();
  });

  it('rolls back image detachment, name and version when the new upload cannot attach', async () => {
    const p = await fixture();
    const image = await upload('PRODUCT_GALLERY');
    const deletesBefore = cloudDelete.mock.calls.length;
    await patch(
      p.id,
      { mainImageUploadId: image.id, name: 'Must roll back' },
      400,
    );
    const current = await service.get(owner, p.id);
    expect(current.name).toBe(p.name);
    expect(current.version).toBe(p.version);
    expect(current.images[0].id).toBe(p.images[0].id);
    expect(
      await db.mediaAsset.findUnique({ where: { id: p.images[0].id } }),
    ).toMatchObject({
      status: 'ATTACHED',
      productId: p.id,
      expiresAt: null,
    });
    expect(cloudDelete.mock.calls.length).toBe(deletesBefore);
  });

  it('accepts null to clear a description and normalizes nonempty text', async () => {
    const p = await fixture();
    expect(
      (await patch(p.id, { description: '  Description  ' })).body.description,
    ).toBe('Description');
    expect(
      (await patch(p.id, { description: null })).body.description,
    ).toBeNull();
  });

  it.each(['', '   ', '\t\n', null])(
    'rejects invalid edited name %j without changing the product',
    async (name) => {
      const p = await fixture();
      await patch(p.id, { name }, 400);
      const current = await service.get(owner, p.id);
      expect(current.name).toBe(p.name);
      expect(current.version).toBe(p.version);
    },
  );

  it('rejects blank create and bundle names through HTTP validation', async () => {
    await request(server)
      .post('/warehouse/products')
      .send({ name: '   ' })
      .expect(400);
    await request(server)
      .post('/warehouse/products/bundles')
      .send({ name: '   ' })
      .expect(400);
    await expect(
      service.create(owner, { name: '   ' } as never),
    ).rejects.toThrow('Product name must not be blank');
    await expect(
      service.createBundle(owner, { name: '   ' } as never),
    ).rejects.toThrow('Product name must not be blank');
  });

  it('removes a new unused variant and only its empty initialization record', async () => {
    const p = await fixture();
    const added = await patch(p.id, {
      addVariants: [{ optionValues: ['L'], price: 130, stockQuantity: 0 }],
    });
    const v = added.body.variants.find(
      (entry: { title: string }) => entry.title === 'L',
    ) as { id: string; inventoryItemId: string };
    expect(
      await db.inventoryMovement.findMany({
        where: { inventoryItemId: v.inventoryItemId },
      }),
    ).toHaveLength(1);
    const otherBefore = await db.inventoryMovement.findMany({
      where: { inventoryItemId: p.variants[0].inventoryItemId! },
    });
    const response = await patch(p.id, { removeVariantIds: [v.id] });
    expect(response.body.variants).toHaveLength(2);
    expect(
      await db.warehouseVariant.findUnique({ where: { id: v.id } }),
    ).toBeNull();
    expect(
      await db.inventoryItem.findUnique({ where: { id: v.inventoryItemId } }),
    ).toBeNull();
    expect(
      await db.inventoryMovement.findMany({
        where: { inventoryItemId: p.variants[0].inventoryItemId! },
      }),
    ).toEqual(otherBefore);
  });

  it('preserves a used variant and all its movements even after its stock returns to zero', async () => {
    const p = await fixture();
    const v = p.variants[0];
    for (const quantityDelta of [5, -5]) {
      await inventory.adjust(owner, v.inventoryItemId!, {
        bucket: 'ON_HAND',
        quantityDelta,
        reason: 'Regression fixture',
        idempotencyKey: randomUUID(),
      });
    }
    const before = await db.inventoryMovement.findMany({
      where: { inventoryItemId: v.inventoryItemId! },
      orderBy: { id: 'asc' },
    });
    await patch(p.id, { removeVariantIds: [v.id] }, 400);
    expect(
      await db.warehouseVariant.findUnique({ where: { id: v.id } }),
    ).not.toBeNull();
    expect(
      await db.inventoryMovement.findMany({
        where: { inventoryItemId: v.inventoryItemId! },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('preserves a purchase-linked variant even when no stock was added', async () => {
    const p = await fixture();
    const v = p.variants[0];
    await db.merchantPurchase.create({
      data: {
        storeId,
        source: 'MANUAL',
        warehouseProductId: p.id,
        warehouseVariantId: v.id,
        productName: p.name,
        unitLabel: 'unit',
        quantity: 1,
        unitPrice: 30,
        totalCost: 30,
        currency: 'MAD',
        purchaseDate: new Date(),
        stockAdded: false,
      },
    });
    await patch(p.id, { removeVariantIds: [v.id] }, 400);
    expect(
      await db.merchantPurchase.count({ where: { warehouseVariantId: v.id } }),
    ).toBe(1);
  });
});
