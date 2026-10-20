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
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { StoreAccessService } from '../src/access/store-access.service';
import { PermissionGuard } from '../src/access/permission.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExpensesService } from '../src/expenses/expenses.service';
import { ExpensesController } from '../src/expenses/expenses.controller';
import { CourierCostsService } from '../src/expenses/courier-costs.service';
import { CurrencyService } from '../src/currency/currency.service';
import { AdsSpendService } from '../src/ads/ads-spend.service';
import { MediaService } from '../src/warehouse/media.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';
import { EcommerceService } from '../src/ecommerce/ecommerce.service';
import { dateInZone } from '../src/expenses/expense-date.util';

const url = process.env.EXPENSES_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
type Expense = {
  id: string;
  amount: string;
  title: string;
  receiptUrl: string | null;
  notes: string | null;
};
type Summary = {
  totalAmount: string;
  byGroup: { group: string; total: string }[];
  unconvertedShippingCosts: { currency: string; amount: string }[];
};
postgres('Expenses production regressions with PostgreSQL', () => {
  let db: PrismaClient, pool: Pool, app: INestApplication, server: Server;
  let owner: string,
    storeId: string,
    categoryId: string,
    foreignOwner: string,
    foreignStore: string;
  let service: ExpensesService,
    costs: CourierCostsService,
    ads: AdsSpendService,
    currency: CurrencyService,
    access: StoreAccessService;
  let storageSpy: jest.SpyInstance;
  const users: string[] = [];
  const cloudDelete = jest.fn().mockResolvedValue(undefined);
  async function ownerStore() {
    const u = await db.user.create({
      data: { phone: `expenses-test-${randomUUID()}` },
    });
    users.push(u.id);
    const store = await db.store.create({
      data: {
        userId: u.id,
        ownerName: 'QA',
        businessName: 'Expenses test',
        address: 'Test',
        city: 'Test',
        country: 'Morocco',
        baseCurrency: 'MAD',
      },
    });
    await db.user.update({
      where: { id: u.id },
      data: { activeStoreId: store.id },
    });
    return { userId: u.id, storeId: store.id };
  }
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    )
      throw new Error('Dedicated local Expenses test database required');
    pool = new Pool({ connectionString: url, max: 15 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const foreign = await ownerStore();
    foreignOwner = foreign.userId;
    foreignStore = foreign.storeId;
    const prisma = db as PrismaService;
    access = new StoreAccessService(prisma);
    currency = new CurrencyService({ isReady: false } as never);
    jest
      .spyOn(currency, 'getExchangeRates')
      .mockResolvedValue({ USD: 1, MAD: 10 });
    ads = new AdsSpendService(prisma, currency);
    costs = new CourierCostsService(prisma, currency);
    storageSpy = jest.spyOn(Storage.prototype, 'bucket').mockReturnValue({
      file: () => ({
        delete: cloudDelete,
        createReadStream: () => Readable.from([Buffer.from('QA')]),
      }),
    } as never);
    const media = new MediaService(
      prisma,
      new ConfigService({ PRODUCT_IMAGE_BUCKET: 'test-only' }),
      new WarehouseStoreService(access),
    );
    service = new ExpensesService(prisma, media, ads, costs);
    const module = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [
        PermissionGuard,
        { provide: StoreAccessService, useValue: access },
        { provide: ExpensesService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest<{
            headers: Record<string, string>;
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
  });
  beforeEach(async () => {
    const current = await ownerStore();
    owner = current.userId;
    storeId = current.storeId;
    categoryId = (
      await db.expenseCategory.create({
        data: { storeId, name: 'Other', group: 'OTHER' },
      })
    ).id;
    cloudDelete.mockClear();
  });
  afterAll(async () => {
    await app?.close();
    storageSpy?.mockRestore();
    if (db) {
      await db.expense.deleteMany({
        where: { store: { userId: { in: users } } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
    await pool?.end();
  });
  const body = (extra: Record<string, unknown> = {}) => ({
    title: 'QA expense',
    amount: '10.25',
    spentAt: '2026-10-19T12:00:00Z',
    paymentMethod: 'CASH',
    categoryId,
    ...extra,
  });
  async function create(extra: Record<string, unknown> = {}) {
    const r = await request(server)
      .post('/expenses')
      .send(body(extra))
      .expect(201);
    return r.body as Expense;
  }
  async function upload(extra: Record<string, unknown> = {}) {
    return db.mediaAsset.create({
      data: {
        storeId,
        objectName: `test/${randomUUID()}`,
        purpose: 'RECEIPT',
        status: 'TEMPORARY',
        expiresAt: new Date(Date.now() + 60000),
        originalName: 'qa.png',
        contentType: 'image/png',
        sizeBytes: 1,
        checksum: 'test',
        ...extra,
      },
    });
  }

  it('replaces and replays a receipt without deleting the current image', async () => {
    const a = await upload(),
      b = await upload(),
      e = await create({ receiptAssetId: a.id });
    await request(server)
      .patch(`/expenses/${e.id}`)
      .send({ receiptAssetId: b.id })
      .expect(200);
    await request(server)
      .patch(`/expenses/${e.id}`)
      .send({ receiptAssetId: b.id, title: 'Updated with retry' })
      .expect(200);
    expect(await db.mediaAsset.findUnique({ where: { id: a.id } })).toBeNull();
    expect(
      await db.mediaAsset.findUnique({ where: { id: b.id } }),
    ).toMatchObject({ expenseId: e.id, status: 'ATTACHED', expiresAt: null });
    expect(cloudDelete).toHaveBeenCalledTimes(1);
  });
  it('serializes simultaneous replacements and preserves the final attachment', async () => {
    const a = await upload(),
      b = await upload(),
      c = await upload(),
      e = await create({ receiptAssetId: a.id });
    const rr = await Promise.all([
      request(server).patch(`/expenses/${e.id}`).send({ receiptAssetId: b.id }),
      request(server).patch(`/expenses/${e.id}`).send({ receiptAssetId: c.id }),
    ]);
    expect(rr.map((x) => x.status)).toEqual([200, 200]);
    const assets = await db.mediaAsset.findMany({ where: { expenseId: e.id } });
    expect(assets).toHaveLength(1);
    expect(
      (await db.expense.findUniqueOrThrow({ where: { id: e.id } })).receiptUrl,
    ).toBe(`/expenses/receipts/${assets[0].id}`);
  });
  it.each(['missing', 'expired', 'foreign', 'wrong-purpose'])(
    'rolls back %s replacement without losing receipt or metadata',
    async (kind) => {
      const a = await upload(),
        e = await create({ receiptAssetId: a.id });
      const b =
        kind === 'missing'
          ? { id: randomUUID() }
          : await upload(
              kind === 'expired'
                ? { expiresAt: new Date(0) }
                : kind === 'foreign'
                  ? { storeId: foreignStore }
                  : { purpose: 'PACKAGING' },
            );
      await request(server)
        .patch(`/expenses/${e.id}`)
        .send({ receiptAssetId: b.id, title: 'Must roll back' })
        .expect(400);
      expect(
        (await db.expense.findUniqueOrThrow({ where: { id: e.id } })).title,
      ).toBe('QA expense');
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: a.id } }))
          .expenseId,
      ).toBe(e.id);
      expect(cloudDelete).not.toHaveBeenCalled();
    },
  );
  it('clears a receipt atomically and makes repeated clearing safe', async () => {
    const a = await upload(),
      e = await create({ receiptAssetId: a.id });
    await request(server)
      .patch(`/expenses/${e.id}`)
      .send({ receiptUrl: null })
      .expect(200);
    await request(server)
      .patch(`/expenses/${e.id}`)
      .send({ receiptUrl: null })
      .expect(200);
    expect(await db.mediaAsset.findUnique({ where: { id: a.id } })).toBeNull();
    expect(cloudDelete).toHaveBeenCalledTimes(1);
  });
  it.each([
    '0',
    '-1',
    '10000000000000000',
    '0.00001',
    '0.004',
    '1.234',
    'Infinity',
  ])('rejects invalid money %s on create and edit', async (amount) => {
    const e = await create();
    await request(server).post('/expenses').send(body({ amount })).expect(400);
    await request(server)
      .patch(`/expenses/${e.id}`)
      .send({ amount })
      .expect(400);
    expect(
      (
        await db.expense.findUniqueOrThrow({ where: { id: e.id } })
      ).amount.toFixed(2),
    ).toBe('10.25');
  });
  it('accepts the largest supported money value and preserves its cents', async () => {
    const e = await create({ amount: '9999999999999999.99' });
    expect(e.amount).toBe('9999999999999999.99');
    expect(
      (
        await db.expense.findUniqueOrThrow({ where: { id: e.id } })
      ).amount.toFixed(2),
    ).toBe(e.amount);
  });
  it.each(['title', 'amount', 'spentAt', 'paymentMethod', 'categoryId'])(
    'rejects null required expense field %s',
    async (field) => {
      const e = await create();
      await request(server)
        .patch(`/expenses/${e.id}`)
        .send({ [field]: null })
        .expect(400);
      expect(
        (
          await db.expense.findUniqueOrThrow({ where: { id: e.id } })
        ).amount.toFixed(2),
      ).toBe('10.25');
    },
  );
  it.each(['name', 'group'])(
    'rejects null required category field %s',
    async (field) => {
      await request(server)
        .patch(`/expenses/categories/${categoryId}`)
        .send({ [field]: null })
        .expect(400);
    },
  );
  it('rejects whitespace and trims valid names while permitting nullable notes', async () => {
    await request(server)
      .post('/expenses')
      .send(body({ title: '   ' }))
      .expect(400);
    await request(server)
      .post('/expenses/categories')
      .send({ name: '   ' })
      .expect(400);
    const e = await create({ title: '  Trimmed  ', notes: 'Note' });
    expect(e.title).toBe('Trimmed');
    await request(server)
      .patch(`/expenses/${e.id}`)
      .send({ notes: null })
      .expect(200);
    expect(
      (await db.expense.findUniqueOrThrow({ where: { id: e.id } })).notes,
    ).toBeNull();
  });
  it.each(['SHIPPING', 'ADS', 'SALARY', 'PURCHASES'] as const)(
    'rejects manual create/edit into %s',
    async (group) => {
      const c = await db.expenseCategory.create({
          data: { storeId, name: group, group, isSystem: true },
        }),
        e = await create();
      await request(server)
        .post('/expenses')
        .send(body({ categoryId: c.id }))
        .expect(409);
      await request(server)
        .patch(`/expenses/${e.id}`)
        .send({ categoryId: c.id })
        .expect(409);
    },
  );
  it('deduplicates concurrent header retries and rejects changed data', async () => {
    const key = randomUUID(),
      b = body();
    const rr = await Promise.all([
      request(server).post('/expenses').set('Idempotency-Key', key).send(b),
      request(server).post('/expenses').set('Idempotency-Key', key).send(b),
    ]);
    expect(rr.map((x) => x.status)).toEqual([201, 201]);
    expect((rr[0].body as Expense).id).toBe((rr[1].body as Expense).id);
    expect(await db.expense.count({ where: { storeId } })).toBe(1);
    await request(server)
      .post('/expenses')
      .set('Idempotency-Key', key)
      .send({ ...b, amount: '11' })
      .expect(409);
  });
  it('replays an attached-receipt create and keeps a deletion tombstone', async () => {
    const a = await upload(),
      key = randomUUID(),
      b = body({ receiptAssetId: a.id, idempotencyKey: key });
    const e = await create({ receiptAssetId: a.id, idempotencyKey: key });
    const retry = await request(server).post('/expenses').send(b).expect(201);
    expect((retry.body as Expense).id).toBe(e.id);
    await request(server).delete(`/expenses/${e.id}`).expect(204);
    await request(server).post('/expenses').send(b).expect(409);
    expect(await db.expense.count({ where: { storeId } })).toBe(0);
  });
  it('rejects mismatched/malformed retry keys and scopes them to a store', async () => {
    await request(server)
      .post('/expenses')
      .set('Idempotency-Key', 'short')
      .send(body())
      .expect(400);
    await request(server)
      .post('/expenses')
      .set('Idempotency-Key', randomUUID())
      .send(body({ idempotencyKey: randomUUID() }))
      .expect(400);
    await create({ idempotencyKey: 'same-key-across-stores' });
    const prior = storeId;
    const next = await ownerStore();
    owner = next.userId;
    storeId = next.storeId;
    categoryId = (
      await db.expenseCategory.create({ data: { storeId, name: 'Other' } })
    ).id;
    await create({ idempotencyKey: 'same-key-across-stores' });
    expect(
      await db.expenseCreateRequest.count({
        where: {
          storeId: { in: [prior, storeId] },
          idempotencyKey: 'same-key-across-stores',
        },
      }),
    ).toBe(2);
  });
  it.each([
    'page=1.5',
    'page=1junk',
    'page=999999999999999999999999',
    'limit=1.5',
    'limit=2junk',
    'limit=101',
  ])('rejects malformed/bounded list query %s', async (q) => {
    await request(server)
      .get('/expenses?' + q)
      .expect(400);
  });
  it.each(['months=1.5', 'months=2junk', 'months=25', 'timezone=NoSuchZone'])(
    'rejects invalid monthly query %s',
    async (q) => {
      await request(server)
        .get('/expenses/trend?' + q)
        .expect(400);
    },
  );
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-10-19T12:00:00'])(
    'rejects impossible/ambiguous calendar value %s',
    async (spentAt) => {
      await request(server)
        .post('/expenses')
        .send(body({ spentAt }))
        .expect(400);
      await request(server)
        .get('/expenses?dateFrom=' + encodeURIComponent(spentAt))
        .expect(400);
    },
  );
  it('honors inclusive exact timestamp, whole day and phone-local day filters', async () => {
    const e = await create({ spentAt: '2026-10-19T23:59:59.999Z' });
    for (const q of [
      'dateFrom=2026-10-19&dateTo=2026-10-19',
      'dateFrom=2026-10-19T23%3A59%3A59.999Z&dateTo=2026-10-19T23%3A59%3A59.999Z',
      'dateFrom=2026-10-20&dateTo=2026-10-20&timezone=Asia%2FDhaka',
    ]) {
      const r = await request(server)
        .get('/expenses?' + q)
        .expect(200);
      expect(
        (r.body as { expenses: Expense[] }).expenses.map((x) => x.id),
      ).toContain(e.id);
    }
    await request(server)
      .get('/expenses?dateFrom=2026-10-20&dateTo=2026-10-19')
      .expect(400);
  });
  it('groups a phone-local month boundary correctly', async () => {
    const now = new Date(),
      month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    await create({ spentAt: `${month}-01T01:00:00+06:00` });
    const r = await request(server)
      .get('/expenses/trend?months=2&timezone=Asia%2FDhaka')
      .expect(200);
    const trend = r.body as {
      timezone: string;
      points: { month: string; total: string }[];
    };
    expect(trend.timezone).toBe('Asia/Dhaka');
    expect(trend.points.find((p) => p.month === month)?.total).toBe('10.25');
  });
  it.each(['Asia/Dhaka', 'America/New_York'])(
    'interprets date-only expense entry in phone timezone %s',
    async (timezone) => {
      const e = await create({ spentAt: '2026-10-01', timezone });
      const stored = await db.expense.findUniqueOrThrow({
        where: { id: e.id },
      });
      expect(stored.spentAt.toISOString()).toBe(
        dateInZone('2026-10-01', timezone).toISOString(),
      );
      await request(server)
        .patch(`/expenses/${e.id}`)
        .send({ spentAt: '2026-10-02', timezone })
        .expect(200);
      expect(
        (
          await db.expense.findUniqueOrThrow({ where: { id: e.id } })
        ).spentAt.toISOString(),
      ).toBe(dateInZone('2026-10-02', timezone).toISOString());
    },
  );
  it('uses DST-aware local day boundaries', () => {
    expect(dateInZone('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(dateInZone('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });
  it('handles supported calendar extremes without a server error', async () => {
    expect(dateInZone('0001-01-01', 'UTC').toISOString()).toBe(
      '0001-01-01T00:00:00.000Z',
    );
    await request(server).get('/expenses?dateTo=9999-12-31').expect(200);
  });
  async function fee(
    type: string,
    amount: string,
    currencyCode = 'MAD',
    createdAt = new Date(),
  ) {
    const connection = await db.ecommerceConnection.upsert({
      where: {
        storeId_platform: {
          storeId,
          platform: 'MANUAL',
        },
      },
      create: {
        storeId,
        platform: 'MANUAL',
        externalAccountId: `local-fee-${storeId}`,
      },
      update: {},
    });
    const order = await db.ecommerceOrder.create({
      data: {
        connectionId: connection.id,
        externalOrderId: randomUUID(),
        currency: currencyCode,
        processedAt: createdAt,
        grossSales: 0,
        discounts: 0,
        refunds: 0,
        netSales: 0,
        shipping: 0,
        tax: 0,
        totalCollected: 0,
        status: 'CLOSED',
        financialStatus: 'PAID',
        itemCount: 0,
        providerCreatedAt: createdAt,
        providerUpdatedAt: createdAt,
      },
    });
    const event = await db.ecommerceOrderFinancialEvent.create({
      data: {
        orderId: order.id,
        type,
        revenue: 0,
        productCost: 0,
        shippingCost: amount,
        damageCost: 0,
        netProfitImpact: new Prisma.Decimal(amount).negated(),
        currency: currencyCode,
        reason: 'Local synthetic courier fee fixture',
        idempotencyKey: randomUUID(),
        createdAt,
      },
    });
    return { order, event };
  }
  it('aggregates courier cost and legacy reversal signs, retaining return costs', async () => {
    const { event, order } = await fee('REVENUE_RECOGNIZED', '30');
    await db.ecommerceOrderFinancialEvent.create({
      data: {
        orderId: order.id,
        type: 'REVENUE_REVERSED',
        revenue: 0,
        productCost: 0,
        shippingCost: 0,
        damageCost: 0,
        netProfitImpact: 0,
        currency: 'MAD',
        reason: 'Return retains paid courier fee',
        idempotencyKey: randomUUID(),
      },
    });
    await fee('SHIPPING_LOSS', '20');
    await fee('REVENUE_REVERSED', '5');
    await fee('REVENUE_REINSTATED', '3');
    const r = await request(server).get('/expenses/summary').expect(200),
      summary = r.body as Summary;
    expect(summary.byGroup.find((x) => x.group === 'SHIPPING')?.total).toBe(
      '48.00',
    );
    expect(summary.totalAmount).toBe('48.00');
    expect(await db.expense.count({ where: { storeId } })).toBe(0);
    expect(event.id).toBeTruthy();
  });
  it('converts courier fees using real conversion logic and exposes missing FX', async () => {
    await fee('SHIPPING_LOSS', '2', 'USD');
    await fee('SHIPPING_LOSS', '7', 'XYZ');
    const r = await request(server).get('/expenses/summary').expect(200),
      summary = r.body as Summary;
    expect(summary.totalAmount).toBe('20.00');
    expect(summary.unconvertedShippingCosts).toEqual([
      { currency: 'XYZ', amount: '7.00' },
    ]);
  });
  it('filters courier fees and groups them using the phone timezone', async () => {
    const now = new Date(),
      month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    await fee(
      'SHIPPING_LOSS',
      '12',
      'MAD',
      new Date(`${month}-01T01:00:00+06:00`),
    );
    const r = await request(server)
      .get('/expenses/trend?months=2&timezone=Asia%2FDhaka')
      .expect(200);
    expect(
      (r.body as { points: { month: string; total: string }[] }).points.find(
        (x) => x.month === month,
      )?.total,
    ).toBe('12.00');
    const summary = await request(server)
      .get(
        `/expenses/summary?dateFrom=${month}-01&dateTo=${month}-01&timezone=Asia%2FDhaka`,
      )
      .expect(200);
    expect((summary.body as Summary).totalAmount).toBe('12.00');
  });
  it('includes courier costs in Home expenses without subtracting them from profit twice', async () => {
    await fee('SHIPPING_LOSS', '30');
    await create({ spentAt: new Date().toISOString(), amount: '5.00' });
    const ecommerce = new EcommerceService(
      db as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      currency,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      access,
      ads,
      costs,
    );
    const home = await ecommerce.getHome(owner, {});
    expect(home.expenses.total).toBe('35.00');
    expect(home.profit.value).toBe('-35.0000');
    expect(home.profit.operatingExpenses).toBe('5.0000');
  });
  it('keeps tracked daily ad spend in its provider calendar month and exposes missing rates', async () => {
    const now = new Date(),
      month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const connection = await db.adsConnection.create({
      data: {
        storeId,
        platform: 'GOOGLE',
        externalAdvertiserId: randomUUID(),
        status: 'DISCONNECTED',
      },
    });
    for (const [tracked, amount, code] of [
      [true, '2', 'USD'],
      [false, '100', 'MAD'],
      [true, '7', 'XYZ'],
    ] as const) {
      const campaign = await db.adsCampaign.create({
        data: {
          connectionId: connection.id,
          externalCampaignId: randomUUID(),
          name: 'Local daily spend',
          status: 'PAUSED',
          tracked,
        },
      });
      await db.adsMetricSnapshot.create({
        data: {
          campaignId: campaign.id,
          date: new Date(`${month}-01T00:00:00Z`),
          spend: amount,
          currency: code,
        },
      });
    }
    const r = await request(server)
      .get('/expenses/trend?months=1&timezone=Asia%2FDhaka')
      .expect(200);
    const trend = r.body as {
      points: { total: string }[];
      unconvertedAdSpend: { currency: string; amount: string }[];
    };
    expect(trend.points[0].total).toBe('20.00');
    expect(trend.unconvertedAdSpend).toEqual([
      { currency: 'XYZ', amount: '7.00' },
    ]);
  });
  it('serializes receipt replacement against deletion without leaving an attachment to a deleted expense', async () => {
    const a = await upload(),
      b = await upload(),
      e = await create({ receiptAssetId: a.id });
    const rr = await Promise.all([
      request(server).patch(`/expenses/${e.id}`).send({ receiptAssetId: b.id }),
      request(server).delete(`/expenses/${e.id}`),
    ]);
    expect([200, 404]).toContain(rr[0].status);
    expect(rr[1].status).toBe(204);
    expect(await db.expense.findUnique({ where: { id: e.id } })).toBeNull();
    expect(await db.mediaAsset.count({ where: { expenseId: e.id } })).toBe(0);
  });
  it('does not disclose or modify another store expense', async () => {
    const e = await create();
    await request(server)
      .get(`/expenses/${e.id}`)
      .set('x-foreign', '1')
      .expect(404);
    await request(server)
      .patch(`/expenses/${e.id}`)
      .set('x-foreign', '1')
      .send({ amount: '1' })
      .expect(404);
    await request(server)
      .delete(`/expenses/${e.id}`)
      .set('x-foreign', '1')
      .expect(404);
  });
});
