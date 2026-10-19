import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
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
import { PurchasesController } from '../src/zomaal-shop/purchases.controller';
import { PurchasesService } from '../src/zomaal-shop/purchases.service';
import { ExpensesController } from '../src/expenses/expenses.controller';
import { ExpensesService } from '../src/expenses/expenses.service';
import { MediaService } from '../src/warehouse/media.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';
import { ProductController } from '../src/warehouse/product.controller';
import { ProductService } from '../src/warehouse/product.service';
import { ProductComparisonPdfService } from '../src/warehouse/product-comparison-pdf.service';
import { BarcodeService } from '../src/warehouse/barcode.service';
import { PackagingController } from '../src/warehouse/packaging.controller';
import { PackagingService } from '../src/warehouse/packaging.service';
import { attachReceipt } from '../src/common/media/attach-receipt.util';

// Explicit opt-in; never fall back to a shared DATABASE_URL.
const url = process.env.PURCHASES_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j39kAAAAASUVORK5CYII=',
  'base64',
);
interface PurchaseResponse {
  id: string;
  groupKey: string;
  expenseId: string;
  supplierName: string | null;
  invoiceNumber: string | null;
}

postgres('Purchases audit regressions with PostgreSQL', () => {
  let db: PrismaClient;
  let pool: Pool;
  let app: INestApplication;
  let server: Server;
  let service: PurchasesService;
  let media: MediaService;
  let storeId: string;
  let owner: string;
  let foreignOwner: string;
  let foreignStore: string;
  let storageSpy: jest.SpyInstance;
  const extraUsers: string[] = [];
  const cloudDelete = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    )
      throw new Error(
        'PURCHASES_TEST_DATABASE_URL must identify a dedicated local test database',
      );
    pool = new Pool({ connectionString: url, max: 10 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    async function ownerStore() {
      const user = await db.user.create({
        data: { phone: `purchases-test-${randomUUID()}` },
      });
      const store = await db.store.create({
        data: {
          userId: user.id,
          ownerName: 'QA',
          businessName: 'Purchases test',
          address: 'Test',
          city: 'Test',
          country: 'MA',
          baseCurrency: 'MAD',
        },
      });
      await db.user.update({
        where: { id: user.id },
        data: { activeStoreId: store.id },
      });
      return { user: user.id, store: store.id };
    }
    const a = await ownerStore(),
      b = await ownerStore();
    owner = a.user;
    storeId = a.store;
    foreignOwner = b.user;
    foreignStore = b.store;
    storageSpy = jest.spyOn(Storage.prototype, 'bucket').mockReturnValue({
      file: () => ({
        save: jest.fn().mockResolvedValue(undefined),
        delete: cloudDelete,
        createReadStream: () => Readable.from([png]),
      }),
    } as never);
    const prisma = db as PrismaService;
    const access = new StoreAccessService(prisma);
    media = new MediaService(
      prisma,
      new ConfigService({ PRODUCT_IMAGE_BUCKET: 'test-only' }),
      new WarehouseStoreService(access),
    );
    service = new PurchasesService(prisma, media);
    const module = await Test.createTestingModule({
      controllers: [
        PurchasesController,
        ExpensesController,
        ProductController,
        PackagingController,
      ],
      providers: [
        { provide: PurchasesService, useValue: service },
        { provide: MediaService, useValue: media },
        { provide: ProductComparisonPdfService, useValue: {} },
        {
          provide: ProductService,
          useValue: new ProductService(
            prisma,
            new WarehouseStoreService(access),
            new BarcodeService(prisma, new WarehouseStoreService(access)),
            {} as never,
            {} as never,
            {} as never,
            media,
          ),
        },
        {
          provide: PackagingService,
          useValue: new PackagingService(
            prisma,
            new WarehouseStoreService(access),
            media,
          ),
        },
        {
          provide: ExpensesService,
          useValue: new ExpensesService(prisma, media, {} as never),
        },
        { provide: StoreAccessService, useValue: access },
        PermissionGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest<{
            headers: Record<string, string | undefined>;
            user: { userId: string };
          }>();
          req.user = {
            userId: req.headers['x-foreign'] ? foreignOwner : owner,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    storageSpy?.mockRestore();
    if (db) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItem: { storeId: { in: [storeId, foreignStore] } } },
      });
      await db.user.deleteMany({
        where: { id: { in: [owner, foreignOwner, ...extraUsers] } },
      });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });

  function access(currency = 'MAD') {
    return { storeId, userId: owner, baseCurrency: currency } as never;
  }
  async function fixture() {
    const material = await db.packagingMaterial.create({
      data: {
        storeId,
        name: `QA ${randomUUID()}`,
        supplierNames: ['Atlas Supplies', 'Local Supplier'],
      },
    });
    return {
      packagingMaterialId: material.id,
      quantity: 10,
      unitPrice: 2,
      purchaseDate: '2026-01-01',
    };
  }
  async function physical(packagingMaterialId: string) {
    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { packagingMaterialId },
      include: { balances: true },
    });
    return item.balances.reduce((n, b) => n + b.onHand, 0);
  }
  // Force the first two reads to see the same committed purchase. Each retry
  // then uses a fresh PostgreSQL snapshot; this reproduced the old stale delta.
  function simultaneousReads() {
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = db.$extends({
      query: {
        merchantPurchase: {
          async findFirst({ args, query }) {
            const row = await query(args);
            if (++reads <= 2) {
              if (reads === 2) release();
              await gate;
            }
            return row;
          },
        },
      },
    });
    return new PurchasesService(client as unknown as PrismaService, media);
  }

  it('PUR-01 retries simultaneous edits without stock or expense drift', async () => {
    const f = await fixture();
    const p = await service.create(access(), f);
    const concurrent = simultaneousReads();
    await Promise.all([
      concurrent.update(storeId, p.id, { quantity: 15 }),
      concurrent.update(storeId, p.id, { quantity: 20 }),
    ]);
    const saved = await db.merchantPurchase.findUniqueOrThrow({
      where: { id: p.id },
      include: { expense: true },
    });
    expect(await physical(f.packagingMaterialId)).toBe(saved.quantity);
    expect(saved.expense?.amount.toString()).toBe(saved.totalCost.toString());
    expect(
      await db.expense.count({ where: { merchantPurchase: { id: p.id } } }),
    ).toBe(1);
    await service.remove(storeId, p.id);
    expect(await physical(f.packagingMaterialId)).toBe(0);
  });

  it('PUR-01 edit racing deletion cannot leave credited stock or an orphan expense', async () => {
    const f = await fixture();
    const p = await service.create(access(), f);
    const concurrent = simultaneousReads();
    const results = await Promise.allSettled([
      concurrent.update(storeId, p.id, { quantity: 20 }),
      concurrent.remove(storeId, p.id),
    ]);
    expect(results[1].status).toBe('fulfilled');
    expect(
      await db.merchantPurchase.findUnique({ where: { id: p.id } }),
    ).toBeNull();
    expect(
      await db.expense.findUnique({ where: { id: p.expenseId! } }),
    ).toBeNull();
    expect(await physical(f.packagingMaterialId)).toBe(0);
  });

  async function receipt(foreign = false) {
    let req = request(server).post('/expenses/receipts');
    if (foreign) req = req.set('x-foreign', '1');
    const response = await req
      .attach('receipt', png, { filename: 'qa.png', contentType: 'image/png' })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it('PUR-02 uploads, attaches, previews, replaces and clears receipts using real constraints', async () => {
    const f = await fixture(),
      first = await receipt();
    const created = await request(server)
      .post('/purchases')
      .send({ ...f, receiptAssetId: first })
      .expect(201);
    const p = created.body as PurchaseResponse;
    const attached = await db.mediaAsset.findUniqueOrThrow({
      where: { id: first },
    });
    expect(attached.status).toBe('ATTACHED');
    expect(attached.expenseId).toBe(p.expenseId);
    expect(attached.expiresAt).toBeNull();
    await request(server)
      .get(`/expenses/receipts/${first}`)
      .expect(200)
      .expect('Content-Type', /image\/png/);
    const second = await receipt();
    await request(server)
      .patch(`/purchases/${p.id}`)
      .send({ receiptAssetId: second })
      .expect(200);
    expect(await db.mediaAsset.findUnique({ where: { id: first } })).toBeNull();
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: second } }))
        .expenseId,
    ).toBe(p.expenseId);
    await request(server)
      .patch(`/purchases/${p.id}`)
      .send({ receiptAssetId: null })
      .expect(200);
    expect(
      await db.mediaAsset.findUnique({ where: { id: second } }),
    ).toBeNull();
    expect(
      (await db.expense.findUniqueOrThrow({ where: { id: p.expenseId } }))
        .receiptUrl,
    ).toBeNull();
    expect(cloudDelete).toHaveBeenCalled();
  });

  it('PUR-02 deleting a purchase with an attached receipt removes both expense and asset', async () => {
    const f = await fixture(),
      id = await receipt();
    const p = await service.create(access(), { ...f, receiptAssetId: id });
    await service.remove(storeId, p.id);
    expect(await db.mediaAsset.findUnique({ where: { id } })).toBeNull();
    expect(
      await db.expense.findUnique({ where: { id: p.expenseId! } }),
    ).toBeNull();
  });

  it('PUR-02 rejects foreign, reused and expired receipts without partial writes', async () => {
    const f = await fixture(),
      foreign = await receipt(true),
      expired = await receipt(),
      used = await receipt();
    await db.mediaAsset.update({
      where: { id: expired },
      data: { expiresAt: new Date(0) },
    });
    await service.create(access(), { ...f, receiptAssetId: used });
    const before = await db.merchantPurchase.count({ where: { storeId } });
    const expenses = await db.expense.count({ where: { storeId } });
    for (const receiptAssetId of [foreign, expired, used])
      await request(server)
        .post('/purchases')
        .send({ ...f, receiptAssetId })
        .expect(400);
    await request(server).get(`/expenses/receipts/${foreign}`).expect(404);
    expect(await db.merchantPurchase.count({ where: { storeId } })).toBe(
      before,
    );
    expect(await db.expense.count({ where: { storeId } })).toBe(expenses);
    expect(await physical(f.packagingMaterialId)).toBe(10);
  });

  it('PUR-02 allows receipt detachment and packaging photos while rejecting wrong owners', async () => {
    const id = await receipt();
    const purchase = await service.create(access(), await fixture());
    const expense = await db.expense.findUniqueOrThrow({
      where: { id: purchase.expenseId! },
    });
    await db.$transaction((tx) =>
      attachReceipt(tx, storeId, id, { expenseId: expense.id }),
    );
    await db.mediaAsset.update({ where: { id }, data: { expenseId: null } });
    const f = await fixture();
    const asset = await media.uploadForStore(
      storeId,
      MediaAssetPurpose.PACKAGING,
      {
        buffer: png,
        mimetype: 'image/png',
        originalname: 'qa.png',
        size: png.length,
      },
    );
    await db.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: 'ATTACHED',
        packagingMaterialId: f.packagingMaterialId,
        expiresAt: null,
      },
    });
    await expect(
      db.mediaAsset.update({
        where: { id: asset.id },
        data: { expenseId: expense.id },
      }),
    ).rejects.toThrow();
  });

  it('PUR-03 separates currencies in list keys and preserves safe legacy group links', async () => {
    const f = await fixture();
    const a = await service.create(access(), {
      ...f,
      quantity: 1,
      unitPrice: 10,
    });
    const b = await service.create(access('USD'), {
      ...f,
      quantity: 1,
      unitPrice: 20,
    });
    expect(a.groupKey).not.toBe(b.groupKey);
    const list = await service.list(storeId);
    const groups = list.items.filter((x) =>
      x.key.startsWith(`p_${f.packagingMaterialId}`),
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((x) => x.totalCost).sort()).toEqual(['10.00', '20.00']);
    expect(list.summary.totalSpent).toBeNull();
    expect((await service.group(storeId, a.groupKey)).totalCost).toBe('10.00');
    const legacy = await service.group(storeId, `p_${f.packagingMaterialId}`);
    expect(legacy.totalCost).toBeNull();
    expect(legacy.currency).toBeNull();
    expect(legacy.totalCostByCurrency).toHaveLength(2);
    await request(server)
      .get(`/purchases/groups/${a.groupKey}`)
      .set('x-foreign', '1')
      .expect(404);
  });

  it.each([
    { unitPrice: 10000000000000000, quantity: 1 },
    { unitPrice: 1000000000000, quantity: 1000000 },
  ])(
    'PUR-04 rejects monetary overflow without stock/expense writes: %j',
    async (change) => {
      const f = await fixture();
      const p = await service.create(access(), f);
      const expenses = await db.expense.count({ where: { storeId } });
      await request(server)
        .post('/purchases')
        .send({ ...f, ...change })
        .expect(400);
      await request(server)
        .patch(`/purchases/${p.id}`)
        .send(change)
        .expect(400);
      expect(await physical(f.packagingMaterialId)).toBe(10);
      expect(
        (
          await db.merchantPurchase.findUniqueOrThrow({ where: { id: p.id } })
        ).totalCost.toString(),
      ).toBe('20');
      expect(await db.expense.count({ where: { storeId } })).toBe(expenses);
    },
  );

  it.each(['unitPrice', 'quantity', 'purchaseDate', 'paymentMethod'])(
    'PUR-05 rejects null %s while preserving historical stock and dates',
    async (field) => {
      const f = await fixture();
      const p = await service.create(access(), f);
      await request(server)
        .patch(`/purchases/${p.id}`)
        .send({ [field]: null })
        .expect(400);
      expect(
        (
          await db.merchantPurchase.findUniqueOrThrow({ where: { id: p.id } })
        ).purchaseDate.toISOString(),
      ).toBe('2026-01-01T00:00:00.000Z');
      expect(
        (
          await db.expense.findUniqueOrThrow({ where: { id: p.expenseId! } })
        ).spentAt.toISOString(),
      ).toBe('2026-01-01T00:00:00.000Z');
      expect(await physical(f.packagingMaterialId)).toBe(10);
      await request(server)
        .patch(`/purchases/${p.id}`)
        .send({ notes: null, receiptAssetId: null })
        .expect(200);
    },
  );

  it('PUR-06 records selected suppliers and invoices as snapshots; omitted updates preserve them', async () => {
    const f = await fixture();
    const response = await request(server)
      .post('/purchases')
      .send({
        ...f,
        supplierName: 'Atlas Supplies',
        invoiceNumber: ' INV-001 ',
      })
      .expect(201);
    const p = response.body as PurchaseResponse;
    expect(p.supplierName).toBe('Atlas Supplies');
    expect(p.invoiceNumber).toBe('INV-001');
    const options = await service.productOptions(
      storeId,
      undefined,
      'PACKAGING',
    );
    expect(
      options.find((x) => x.id === f.packagingMaterialId)?.supplierNames,
    ).toEqual(['Atlas Supplies', 'Local Supplier']);
    await db.packagingMaterial.update({
      where: { id: f.packagingMaterialId },
      data: { supplierNames: ['Local Supplier'] },
    });
    const updated = await service.update(storeId, p.id, { quantity: 12 });
    expect(updated.supplierName).toBe('Atlas Supplies');
    expect(updated.invoiceNumber).toBe('INV-001');
    await request(server)
      .patch(`/purchases/${p.id}`)
      .send({ supplierName: 'Unknown' })
      .expect(400);
    const next = await service.update(storeId, p.id, {
      supplierName: 'Local Supplier',
      invoiceNumber: 'INV-002',
    });
    expect(next.supplierName).toBe('Local Supplier');
    expect(next.invoiceNumber).toBe('INV-002');
    await request(server)
      .post('/purchases')
      .send({ ...f, supplierName: 'Unknown' })
      .expect(400);
    await request(server)
      .post('/purchases')
      .send({ ...f, invoiceNumber: '   ' })
      .expect(400);
  });
  it('PUR-06 configures product suppliers through create/edit and selects them on a purchase', async () => {
    const category = await db.productCategory.create({
      data: { storeId, name: 'Suppliers', slug: randomUUID() },
    });
    const upload = await media.uploadForStore(
      storeId,
      MediaAssetPurpose.PRODUCT_MAIN,
      {
        buffer: png,
        mimetype: 'image/png',
        originalname: 'qa.png',
        size: png.length,
      },
    );
    const body = {
      idempotencyKey: randomUUID(),
      name: 'Supplier product',
      categoryId: category.id,
      mainImageUploadId: upload.id,
      basePrice: 100,
      costPrice: 20,
      stockQuantity: 0,
      supplierNames: [' Atlas Supplies ', 'Local Supplier'],
    };
    const created = await request(server)
      .post('/warehouse/products')
      .send(body)
      .expect(201);
    const product = created.body as {
      id: string;
      version: number;
      supplierNames: string[];
    };
    expect(product.supplierNames).toEqual(['Atlas Supplies', 'Local Supplier']);
    const purchased = await request(server)
      .post('/purchases')
      .send({
        warehouseProductId: product.id,
        quantity: 2,
        unitPrice: 20,
        purchaseDate: '2026-01-01',
        supplierName: 'Atlas Supplies',
        invoiceNumber: 'P-001',
      })
      .expect(201);
    const p = purchased.body as PurchaseResponse;
    await request(server)
      .patch(`/warehouse/products/${product.id}`)
      .send({
        version: product.version,
        supplierNames: ['Replacement Supplier'],
      })
      .expect(200);
    const saved = await service.group(storeId, p.groupKey);
    expect(saved.history[0].supplierName).toBe('Atlas Supplies');
    const options = await service.productOptions(storeId, undefined, 'PRODUCT');
    expect(options.find((x) => x.id === product.id)?.supplierNames).toEqual([
      'Replacement Supplier',
    ]);
    await request(server)
      .post('/warehouse/products')
      .send({
        ...body,
        idempotencyKey: randomUUID(),
        supplierNames: ['Atlas', ' atlas '],
      })
      .expect(400);
    await request(server)
      .patch(`/warehouse/products/${product.id}`)
      .send({ version: product.version + 1, supplierNames: null })
      .expect(400);
  });

  it('PUR-06 configures packaging suppliers through its API and rejects invalid lists', async () => {
    const created = await request(server)
      .post('/warehouse/packaging')
      .send({ name: 'Supplier box', supplierNames: [' Atlas ', 'Other'] })
      .expect(201);
    const material = created.body as { id: string; supplierNames: string[] };
    expect(material.supplierNames).toEqual(['Atlas', 'Other']);
    const updated = await request(server)
      .patch(`/warehouse/packaging/${material.id}`)
      .send({ supplierNames: [] })
      .expect(200);
    expect((updated.body as { supplierNames: string[] }).supplierNames).toEqual(
      [],
    );
    await request(server)
      .patch(`/warehouse/packaging/${material.id}`)
      .send({ supplierNames: ['  '] })
      .expect(400);
    await request(server)
      .patch(`/warehouse/packaging/${material.id}`)
      .send({ supplierNames: null })
      .expect(400);
    await request(server)
      .post('/warehouse/packaging')
      .send({
        name: 'Too many suppliers',
        supplierNames: Array.from({ length: 51 }, (_, i) => `Supplier ${i}`),
      })
      .expect(400);
  });
  it('PUR-01 handles overlapping deletes without a second stock reversal', async () => {
    const f = await fixture();
    const p = await service.create(access(), f);
    const concurrent = simultaneousReads();
    const results = await Promise.allSettled([
      concurrent.remove(storeId, p.id),
      concurrent.remove(storeId, p.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect((failure.reason as { getStatus(): number }).getStatus()).toBe(404);
    expect(await physical(f.packagingMaterialId)).toBe(0);
  });

  it('PUR-02 supports salary receipt attachment and payment deletion via SET NULL', async () => {
    const user = await db.user.create({
      data: { phone: `purchases-salary-${randomUUID()}` },
    });
    extraUsers.push(user.id);
    const staff = await db.staffMember.create({
      data: { storeId, userId: user.id, name: 'Receipt test' },
    });
    const payment = await db.staffSalaryPayment.create({
      data: {
        staffMemberId: staff.id,
        amount: '50',
        paymentDate: new Date('2026-01-01'),
        paymentMethod: 'CASH',
      },
    });
    const id = await receipt();
    await db.$transaction((tx) =>
      attachReceipt(tx, storeId, id, { salaryPaymentId: payment.id }),
    );
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id } }))
        .salaryPaymentId,
    ).toBe(payment.id);
    await db.staffSalaryPayment.delete({ where: { id: payment.id } });
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id } }))
        .salaryPaymentId,
    ).toBeNull();
    await media.deleteAttachedAsset(id);
  });
});
