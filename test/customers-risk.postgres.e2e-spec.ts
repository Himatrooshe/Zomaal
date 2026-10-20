import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, EcommercePlatform } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { CustomersController } from '../src/customers/customers.controller';
import { DuplicateOrdersController } from '../src/customers/duplicate-orders.controller';
import { CustomersService } from '../src/customers/customers.service';
import { CustomerRiskService } from '../src/customers/customer-risk.service';
import { DuplicateOrdersService } from '../src/customers/duplicate-orders.service';
import { lockDuplicateReviewStore } from '../src/customers/duplicate-review-lock.util';
import { NotificationsService } from '../src/notifications/notifications.service';
import { StoreAccessService } from '../src/access/store-access.service';
import { PermissionGuard } from '../src/access/permission.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';

const url = process.env.CUSTOMERS_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
postgres('Customers Risk Center production regressions with PostgreSQL', () => {
  let db: PrismaClient, pool: Pool, app: INestApplication, server: Server;
  let owner: string, store: string, customer: string, connection: string;
  let risk: CustomerRiskService,
    duplicates: DuplicateOrdersService,
    customers: CustomersService;
  const users: string[] = [];
  const notifications = {
    raise: jest.fn().mockResolvedValue({ id: 'local-only' }),
    resolve: jest.fn().mockResolvedValue(1),
  };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    )
      throw new Error('Dedicated local Customers test database required');
    pool = new Pool({ connectionString: url, max: 15 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const access = new StoreAccessService(db as PrismaService);
    duplicates = new DuplicateOrdersService(
      db as PrismaService,
      notifications as unknown as NotificationsService,
    );
    risk = new CustomerRiskService(
      db as PrismaService,
      access,
      notifications as unknown as NotificationsService,
      duplicates,
    );
    customers = new CustomersService(db as PrismaService, risk);
    const module = await Test.createTestingModule({
      controllers: [DuplicateOrdersController, CustomersController],
      providers: [
        PermissionGuard,
        { provide: StoreAccessService, useValue: access },
        { provide: CustomersService, useValue: customers },
        { provide: CustomerRiskService, useValue: risk },
        { provide: DuplicateOrdersService, useValue: duplicates },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          ctx.switchToHttp().getRequest<{ user: { userId: string } }>().user = {
            userId: owner,
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
    owner = (
      await db.user.create({
        data: { phone: `customers-owner-${randomUUID()}` },
      })
    ).id;
    users.push(owner);
    store = (
      await db.store.create({
        data: {
          userId: owner,
          ownerName: 'QA',
          businessName: 'Customer regressions',
          address: 'Test',
          city: 'Test',
          country: 'Morocco',
        },
      })
    ).id;
    await db.user.update({
      where: { id: owner },
      data: { activeStoreId: store },
    });
    customer = (
      await db.customer.create({
        data: {
          storeId: store,
          phone: '+212600000301',
          name: 'QA',
          totalOrders: 0,
        },
      })
    ).id;
    connection = (
      await db.ecommerceConnection.create({
        data: { storeId: store, platform: 'MANUAL', externalAccountId: store },
      })
    ).id;
    notifications.raise.mockClear();
    notifications.resolve.mockClear();
  });
  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
    await pool?.end();
  });
  async function order(
    extra: {
      variant?: string;
      sku?: string | null;
      externalProductId?: string;
      externalVariantId?: string;
      connectionId?: string;
      placedAt?: Date;
      event?: string;
    } = {},
  ) {
    return db.ecommerceOrder.create({
      data: {
        connectionId: extra.connectionId ?? connection,
        customerId: customer,
        externalOrderId: randomUUID(),
        orderName: 'QA',
        status: 'OPEN',
        financialStatus: 'PENDING',
        currency: 'MAD',
        itemCount: 1,
        grossSales: '100',
        discounts: '0',
        refunds: '0',
        netSales: '100',
        shipping: '0',
        tax: '0',
        totalCollected: '100',
        providerCreatedAt: extra.placedAt ?? new Date(),
        providerUpdatedAt: new Date(),
        processedAt: new Date(),
        lines: {
          create: {
            externalLineId: randomUUID(),
            name: 'Same Displayed Title',
            quantity: 1,
            unitPrice: '100',
            totalPrice: '100',
            currency: 'MAD',
            sku: extra.sku === undefined ? 'SAME-SKU' : extra.sku,
            warehouseVariantId: extra.variant,
            externalProductId: extra.externalProductId,
            externalVariantId: extra.externalVariantId,
          },
        },
        events: {
          create: {
            providerEventId: randomUUID(),
            source: 'SYSTEM',
            type: extra.event ?? 'ORDER_CREATED',
            title: 'Created',
            occurredAt: new Date(),
          },
        },
      },
    });
  }
  async function variant() {
    const p = await db.warehouseProduct.create({
      data: { storeId: store, name: 'Same Displayed Title' },
    });
    return db.warehouseVariant.create({
      data: {
        storeId: store,
        productId: p.id,
        title: 'Default',
        price: '100',
        costPrice: '20',
      },
    });
  }
  it.each([
    'returnsLimit',
    'cancellationsLimit',
    'refusalsLimit',
    'noAnswerLimit',
    'combinedLimit',
    'useCombinedLimit',
    'warnOnNewOrder',
  ])('null %s fails400 without changing settings', async (field) => {
    const initial = await risk.getSettings(store);
    await request(server)
      .put('/customers/blacklist/settings')
      .send({ [field]: null })
      .expect(400);
    expect(await risk.getSettings(store)).toEqual(initial);
  });
  it.each([
    'returnsLimit',
    'cancellationsLimit',
    'refusalsLimit',
    'noAnswerLimit',
    'combinedLimit',
  ])('%s rejects overflow and accepts documented maximum', async (field) => {
    await request(server)
      .put('/customers/blacklist/settings')
      .send({ [field]: 2147483648 })
      .expect(400);
    await request(server)
      .put('/customers/blacklist/settings')
      .send({ [field]: 100001 })
      .expect(400);
    await request(server)
      .put('/customers/blacklist/settings')
      .send({ [field]: 100000 })
      .expect(200);
  });
  it.each([
    '/customers',
    '/customers/blacklist',
    '/customers/duplicate-orders',
  ])('%s rejects coercion and unsafe pages', async (path) => {
    for (const q of [
      { page: '1.5' },
      { page: '1junk' },
      { page: '999999999999999999999' },
      { page: '1000001' },
      { page: '1e3' },
      { limit: '1.5' },
      { limit: '2junk' },
      { limit: '101' },
    ])
      await request(server).get(path).query(q).expect(400);
    await request(server)
      .get(path)
      .query({ page: '1000000', limit: '1' })
      .expect(200);
  });
  it('lookback days rejects malformed and out of range values', async () => {
    for (const days of ['1.5', '2junk', '0', '91', '1e1'])
      await request(server)
        .get('/customers/duplicate-orders')
        .query({ days })
        .expect(400);
  });
  it('normalizes spacing, punctuation, national and international prefixes to one customer', async () => {
    await db.customer.update({
      where: { id: customer },
      data: {
        isBlacklisted: true,
        blacklistReason: 'existing reason',
        returnsCount: 3,
      },
    });
    for (const phone of [
      '+212 600 000301',
      '0600000301',
      '00212600000301',
      '+212(600)000-301',
      '212600000301',
    ]) {
      const result = await risk.upsertCustomer({ storeId: store, phone });
      expect(result?.id).toBe(customer);
      expect(result?.isBlacklisted).toBe(true);
      expect(result?.returnsCount).toBe(3);
    }
    expect(await db.customer.count({ where: { storeId: store } })).toBe(1);
  });
  it('renames one legacy phone in place preserving ID, blacklist, counters and order history', async () => {
    await db.customer.update({
      where: { id: customer },
      data: {
        phone: '0600000301',
        isBlacklisted: true,
        blacklistReason: 'preserved',
        returnsCount: 3,
        totalOrders: 1,
      },
    });
    const prior = await order();
    const result = await risk.upsertCustomer({
      storeId: store,
      phone: '+212 600 000301',
    });
    expect(result).toMatchObject({
      id: customer,
      phone: '+212600000301',
      isBlacklisted: true,
      returnsCount: 3,
      totalOrders: 1,
      blacklistReason: 'preserved',
    });
    expect(
      (await db.ecommerceOrder.findUniqueOrThrow({ where: { id: prior.id } }))
        .customerId,
    ).toBe(customer);
  });
  it('refuses ambiguous legacy collisions without merging, deleting or clearing risk', async () => {
    const alias = await db.customer.create({
      data: {
        storeId: store,
        phone: '0600000301',
        isBlacklisted: true,
        returnsCount: 2,
      },
    });
    await expect(
      risk.upsertCustomer({ storeId: store, phone: '+212600000301' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.customer.count({ where: { storeId: store } })).toBe(2);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: alias.id } }))
        .returnsCount,
    ).toBe(2);
  });
  it('concurrent first sightings of formatted equivalents create one identity', async () => {
    const rows = await Promise.all(
      ['+212600000302', '+212 600 000302', '0600000302'].map((phone) =>
        risk.upsertCustomer({ storeId: store, phone }),
      ),
    );
    expect(new Set(rows.map((c) => c!.id)).size).toBe(1);
    expect(
      await db.customer.count({
        where: { storeId: store, phone: '+212600000302' },
      }),
    ).toBe(1);
  });
  it('uses the store country for national numbers and accepts landlines', async () => {
    await db.store.update({
      where: { id: store },
      data: { country: 'Bangladesh' },
    });
    const bd = await risk.upsertCustomer({
      storeId: store,
      phone: '01798200654',
    });
    expect(bd?.phone).toBe('+8801798200654');
    const fixed = await risk.upsertCustomer({
      storeId: store,
      phone: '+212522123456',
    });
    expect(fixed?.phone).toBe('+212522123456');
  });
  it('keeps non-phone legacy identifiers separate from a real number with matching digits', async () => {
    const placeholder = await risk.upsertCustomer({
      storeId: store,
      phone: 'QA-212600000301',
    });
    expect(placeholder?.id).not.toBe(customer);
    expect(placeholder?.phone).toBe('QA-212600000301');
  });
  it('formatted phone lookup preserves blacklist order warning protection', async () => {
    await db.customer.update({
      where: { id: customer },
      data: { isBlacklisted: true },
    });
    const c = await risk.upsertCustomer({
      storeId: store,
      phone: '+212 600 000301',
    });
    const o = await order();
    await risk.recordNewOrder({
      storeId: store,
      customerId: c!.id,
      isBlacklisted: c!.isBlacklisted,
      orderId: o.id,
      occurredAt: new Date(),
    });
    expect(
      await db.ecommerceOrderEvent.count({
        where: { orderId: o.id, type: 'CUSTOMER_BLACKLISTED_WARNING' },
      }),
    ).toBe(1);
    expect(notifications.raise).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BLACKLISTED_CUSTOMER_ORDER' }),
    );
  });
  it('formatted phone search finds canonical customers and blacklist rows', async () => {
    await db.customer.update({
      where: { id: customer },
      data: { isBlacklisted: true, blacklistedAt: new Date() },
    });
    const search = '+212 600 000301';
    expect((await customers.list(store, { search })).totalCustomers).toBe(1);
    expect(
      (await customers.getBlacklistScreen(store, { search })).totalBlacklisted,
    ).toBe(1);
  });
  it('different warehouse variants cannot match by shared SKU/title', async () => {
    const a = await variant(),
      b = await variant();
    await order({ variant: a.id });
    await order({ variant: b.id });
    expect(
      (await duplicates.list(store, { days: 30, page: 1, limit: 20 }))
        .totalGroups,
    ).toBe(0);
  });
  it('same warehouse variant matches even after a display title/SKU change', async () => {
    const a = await variant();
    await order({ variant: a.id, sku: 'old' });
    await order({ variant: a.id, sku: 'new' });
    expect(
      (await duplicates.list(store, { days: 30, page: 1, limit: 20 }))
        .totalGroups,
    ).toBe(1);
  });
  it('different platform variants of one product are not duplicates by title', async () => {
    await order({ externalProductId: 'parent', externalVariantId: 'red' });
    await order({ externalProductId: 'parent', externalVariantId: 'blue' });
    expect(
      (await duplicates.list(store, { days: 30, page: 1, limit: 20 }))
        .totalGroups,
    ).toBe(0);
  });
  it('cross-platform SKU matches remain available despite connection-scoped IDs', async () => {
    const shop = await db.ecommerceConnection.create({
      data: {
        storeId: store,
        platform: EcommercePlatform.SHOPIFY,
        externalAccountId: 'local-shop',
      },
    });
    await order({ externalProductId: 'manual-product' });
    await order({ connectionId: shop.id, externalProductId: 'shop-product' });
    expect(
      (await duplicates.list(store, { days: 30, page: 1, limit: 20 }))
        .totalGroups,
    ).toBe(1);
  });
  it('title fallback remains for unidentified lines, but conflicting SKUs do not match', async () => {
    await order({ sku: 'first' });
    await order({ sku: 'second' });
    expect(
      (await duplicates.list(store, { days: 30, page: 1, limit: 20 }))
        .totalGroups,
    ).toBe(0);
    await db.ecommerceOrder.deleteMany({ where: { connectionId: connection } });
    await order({ sku: null });
    await order({ sku: null });
    expect(
      (await duplicates.list(store, { days: 30, page: 1, limit: 20 }))
        .totalGroups,
    ).toBe(1);
  });
  it('customer history reports a cancelled duplicate as Cancelled despite ORDER_CREATED', async () => {
    const a = await order(),
      b = await order();
    await duplicates.cancel(store, owner, [b.id]);
    const d = await customers.getById(store, customer);
    expect(d.orders.find((o) => o.orderId === b.id)?.status).toBe('Cancelled');
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer } }))
        .cancellationsCount,
    ).toBe(0);
    expect(
      (await db.ecommerceOrder.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe('OPEN');
  });
  it('concurrent cancellation of opposite group members retains one open order', async () => {
    for (let i = 0; i < 5; i++) {
      await db.ecommerceOrder.deleteMany({
        where: { connectionId: connection },
      });
      const a = await order(),
        b = await order();
      const results = await Promise.allSettled([
        duplicates.cancel(store, owner, [a.id]),
        duplicates.cancel(store, owner, [b.id]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await db.ecommerceOrder.count({
          where: { id: { in: [a.id, b.id] }, status: 'OPEN' },
        }),
      ).toBe(1);
      expect(
        await db.duplicateOrderReview.count({
          where: { orderId: { in: [a.id, b.id] } },
        }),
      ).toBe(1);
    }
  });
  it('keep and cancel serialize and persist only one merchant decision', async () => {
    const a = await order(),
      b = await order();
    await Promise.allSettled([
      duplicates.keepGroup(store, owner, a.id),
      duplicates.cancel(store, owner, [b.id]),
    ]);
    expect(
      await db.duplicateOrderReview.count({ where: { orderId: b.id } }),
    ).toBe(1);
    expect(
      (await db.ecommerceOrder.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe('OPEN');
  });
  it('rejects whole-group and mixed-unknown cancellation atomically', async () => {
    const a = await order(),
      b = await order();
    await expect(
      duplicates.cancel(store, owner, [a.id, b.id]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      duplicates.cancel(store, owner, [b.id, randomUUID()]),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await db.duplicateOrderReview.count({ where: { storeId: store } }),
    ).toBe(0);
  });
  it('a dispatch claim using the same lock prevents duplicate cancellation', async () => {
    const a = await order(),
      b = await order();
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const claim = db.$transaction(async (tx) => {
      await lockDuplicateReviewStore(tx, store);
      entered();
      await gate;
      await tx.ecommerceOrderDispatch.create({
        data: {
          orderId: b.id,
          provider: 'QUICKLIVRAISON',
          merchantTracking: randomUUID(),
          status: 'PENDING',
        },
      });
    });
    await ready;
    const cancel = duplicates.cancel(store, owner, [b.id]);
    release();
    await claim;
    await expect(cancel).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.ecommerceOrder.findUniqueOrThrow({ where: { id: b.id } }))
        .status,
    ).toBe('OPEN');
    expect(
      (await db.ecommerceOrder.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe('OPEN');
  });
  it('duplicate window includes24h exactly and excludes24h plus1ms', async () => {
    const now = Date.now();
    await order({ placedAt: new Date(now - 2 * 86400000) });
    await order({ placedAt: new Date(now - 86400000) });
    let groups = await duplicates.list(store, { days: 30, page: 1, limit: 20 });
    expect(groups.totalGroups).toBe(1);
    await db.ecommerceOrder.deleteMany({ where: { connectionId: connection } });
    await order({ placedAt: new Date(now - 2 * 86400000) });
    await order({ placedAt: new Date(now - 86400000 + 1) });
    groups = await duplicates.list(store, { days: 30, page: 1, limit: 20 });
    expect(groups.totalGroups).toBe(0);
  });
});
