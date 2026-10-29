import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Prisma, EcommercePlatform } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { NotificationsService } from '../src/notifications/notifications.service';
import { StoreAccessService } from '../src/access/store-access.service';
import { PermissionGuard } from '../src/access/permission.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { CustomerRiskService } from '../src/customers/customer-risk.service';
import { EcommerceService } from '../src/ecommerce/ecommerce.service';
import { EcommerceOrderFinancialService } from '../src/ecommerce/ecommerce-order-financial.service';
import { OrderStockService } from '../src/ecommerce/order-stock.service';
import { ReturnRequestController } from '../src/ecommerce/return-request.controller';
import { ReturnRequestService } from '../src/ecommerce/return-request.service';
import type {
  DetectedReturnResponseDto,
  VerifiedReturnResponseDto,
  ReturnListResponseDto,
} from '../src/ecommerce/dto/return-request.dto';
import { OrderEventType } from '../src/ecommerce/constants/order-event-type';
import type { PrismaService } from '../src/prisma/prisma.service';

// Explicit opt-in to a disposable local database; never use DATABASE_URL.
const url = process.env.RETURNS_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Returns workflow with PostgreSQL', () => {
  let db: PrismaClient;
  let pool: Pool;
  let app: INestApplication;
  let server: Server;
  let financial: EcommerceOrderFinancialService;
  let stock: OrderStockService;
  let ecommerce: EcommerceService;
  const currency = {
    convertOrNull: jest.fn(
      (amount: number | string | Prisma.Decimal, from: string, to: string) => {
        const rates: Record<string, number> = { USD: 1, MAD: 10 };
        return Promise.resolve(
          rates[from] && rates[to]
            ? new Prisma.Decimal(amount).times(rates[to]).dividedBy(rates[from])
            : null,
        );
      },
    ),
  };
  const users: string[] = [];
  const stores: string[] = [];
  let owner: string;
  let otherOwner: string;
  let viewer: string;
  let connectionId: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    ) {
      throw new Error(
        'RETURNS_TEST_DATABASE_URL must identify a dedicated local test database',
      );
    }
    pool = new Pool({ connectionString: url, max: 10 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    for (let index = 0; index < 2; index++) {
      const user = await db.user.create({
        data: { phone: `returns-test-${randomUUID()}` },
      });
      users.push(user.id);
      const store = await db.store.create({
        data: {
          userId: user.id,
          ownerName: 'Test owner',
          businessName: 'Returns fixture',
          address: 'Test',
          city: 'Test',
          country: 'MA',
          baseCurrency: 'MAD',
        },
      });
      stores.push(store.id);
      await db.user.update({
        where: { id: user.id },
        data: { activeStoreId: store.id },
      });
    }
    [owner, otherOwner] = users;
    const staffUser = await db.user.create({
      data: { phone: `returns-viewer-${randomUUID()}` },
    });
    viewer = staffUser.id;
    users.push(viewer);
    await db.staffMember.create({
      data: {
        userId: viewer,
        storeId: stores[0],
        name: 'Returns viewer',
        permissionOverrides: ['returns.view'],
      },
    });
    connectionId = (
      await db.ecommerceConnection.create({
        data: {
          storeId: stores[0],
          platform: EcommercePlatform.MANUAL,
          externalAccountId: `returns-fixture-${randomUUID()}`,
        },
      })
    ).id;

    const prisma = db as PrismaService;
    const access = new StoreAccessService(prisma);
    stock = new OrderStockService(prisma);
    financial = new EcommerceOrderFinancialService(
      prisma,
      stock,
      {
        onShipmentStatus: jest.fn().mockResolvedValue(undefined),
      } as never,
      access,
      currency as never,
    );
    const risk = new CustomerRiskService(
      prisma,
      access,
      {
        raise: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
    );
    ecommerce = new EcommerceService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      currency as never,
      {} as never,
      stock,
      financial,
      risk,
      access,
      {} as never,
      {
        getTotals: jest
          .fn()
          .mockResolvedValue({ total: new Prisma.Decimal(0), unconverted: [] }),
      } as never,
    );
    const returns = new ReturnRequestService(
      prisma,
      ecommerce,
      financial,
      risk,
      access,
      currency as never,
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ReturnRequestController],
      providers: [
        { provide: ReturnRequestService, useValue: returns },
        { provide: StoreAccessService, useValue: access },
        PermissionGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            headers: Record<string, string | undefined>;
            user?: { userId: string };
          }>();
          const userId = req.headers['x-test-user'];
          if (!userId || !users.includes(userId)) return false;
          req.user = { userId };
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
    if (db) {
      // Movements deliberately restrict deletion of their inventory items.
      await db.inventoryMovement.deleteMany({
        where: { inventoryItem: { storeId: { in: stores } } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });

  async function fixture(lineCount = 1, linked = true, orderCurrency = 'MAD') {
    const customer = await db.customer.create({
      data: {
        storeId: stores[0],
        name: 'Test customer',
        phone: `fixture-${randomUUID()}`,
      },
    });
    const product = await db.warehouseProduct.create({
      data: {
        storeId: stores[0],
        name: 'Return fixture product',
        status: 'ACTIVE',
      },
    });
    const variant = await db.warehouseVariant.create({
      data: {
        storeId: stores[0],
        productId: product.id,
        title: 'Default',
        price: '100',
        costPrice: '30',
        productCode: `TEST-${randomUUID()}`,
      },
    });
    const item = await db.inventoryItem.create({
      data: {
        storeId: stores[0],
        variantId: variant.id,
        kind: 'PRODUCT_VARIANT',
      },
    });
    const location = await db.warehouseLocation.upsert({
      where: { storeId_code: { storeId: stores[0], code: 'DEFAULT' } },
      create: {
        storeId: stores[0],
        code: 'DEFAULT',
        name: 'Default',
        isDefault: true,
      },
      update: {},
    });
    await db.inventoryBalance.create({
      data: { inventoryItemId: item.id, locationId: location.id, onHand: 20 },
    });
    const now = new Date();
    const order = await db.ecommerceOrder.create({
      data: {
        connectionId,
        externalOrderId: `return-${randomUUID()}`,
        orderName: `RT-${randomUUID()}`,
        customerId: customer.id,
        manualCustomerName: 'Test customer',
        manualCustomerPhone: customer.phone,
        status: 'CLOSED',
        financialStatus: 'PAID',
        fulfillmentStatus: 'fulfilled',
        currency: orderCurrency,
        grossSales: 200 * lineCount,
        discounts: 0,
        refunds: 0,
        netSales: 200 * lineCount,
        shipping: 15,
        tax: 0,
        totalCollected: 200 * lineCount + 15,
        itemCount: 2 * lineCount,
        providerCreatedAt: now,
        providerUpdatedAt: now,
        processedAt: now,
        lines: {
          create: Array.from({ length: lineCount }, (_, index) => ({
            externalLineId: `line-${index}`,
            name: `Test product ${index}`,
            quantity: 2,
            unitPrice: 100,
            totalPrice: 200,
            currency: orderCurrency,
            warehouseVariantId: linked ? variant.id : null,
          })),
        },
      },
      include: { lines: true },
    });
    await stock.reserveOrder(order.id);
    const tracking = `TEST-TRACK-${randomUUID()}`;
    await db.ecommerceOrderEvent.create({
      data: {
        orderId: order.id,
        providerEventId: 'fixture-delivered',
        source: 'SYSTEM',
        type: OrderEventType.DELIVERED,
        title: 'Test delivery',
        occurredAt: new Date(now.getTime() + 1000),
        metadata: { number: tracking },
      },
    });
    await financial.syncUndispatchedOrder(order.id);
    await db.ecommerceOrderEvent.create({
      data: {
        orderId: order.id,
        providerEventId: 'fixture-returned',
        source: 'SYSTEM',
        type: OrderEventType.RETURNED,
        title: 'Test returned parcel',
        occurredAt: new Date(now.getTime() + 2000),
        metadata: { number: tracking },
      },
    });
    await financial.syncUndispatchedOrder(order.id);
    return { order, item, customer, tracking };
  }

  async function detect(
    f: Awaited<ReturnType<typeof fixture>>,
    userId = owner,
  ) {
    const response = await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', userId)
      .send({ value: f.order.orderName, orderId: f.order.id })
      .expect(200);
    return response.body as DetectedReturnResponseDto;
  }

  async function verify(
    returnId: string,
    lines: Array<{
      orderLineId: string;
      condition: string;
      damageCost?: number;
      quantity?: number;
    }>,
    expected = 200,
    userId = owner,
  ) {
    const response = await request(server)
      .post(`/ecommerce/returns/${returnId}/verify`)
      .set('x-test-user', userId)
      .send({ lines })
      .expect(expected);
    return { body: response.body as VerifiedReturnResponseDto };
  }

  async function balance(itemId: string) {
    return db.inventoryBalance.findFirstOrThrow({
      where: { inventoryItemId: itemId },
    });
  }

  it.each([
    ['GOOD', 20, 0, '15.00'],
    ['RETURNED', 20, 0, '15.00'],
    ['DAMAGED', 20, 2, '75.00'],
    ['LOST', 18, 0, '75.00'],
    ['MISSING', 18, 0, '75.00'],
  ] as const)(
    'verifies %s with correct stock, losses, and repeat behavior',
    async (condition, onHand, damaged, loss) => {
      const f = await fixture();
      const detected = await detect(f);
      expect(detected.status).toBe('NEED_VERIFICATION');
      expect(detected.products).toHaveLength(1);
      const payload = [{ orderLineId: f.order.lines[0].id, condition }];
      const result = await verify(detected.returnRequestId, payload);
      expect(result.body.status).toBe('PROCESSED');
      expect(result.body.lossSummary.netLoss).toBe(loss);
      expect(await balance(f.item.id)).toMatchObject({
        onHand,
        reserved: 0,
        damaged,
      });
      const before = {
        movements: await db.inventoryMovement.count({
          where: { inventoryItemId: f.item.id },
        }),
        ledger: await db.ecommerceOrderFinancialEvent.count({
          where: { orderId: f.order.id },
        }),
      };
      await verify(detected.returnRequestId, payload);
      expect(await balance(f.item.id)).toMatchObject({
        onHand,
        reserved: 0,
        damaged,
      });
      expect(
        await db.inventoryMovement.count({
          where: { inventoryItemId: f.item.id },
        }),
      ).toBe(before.movements);
      expect(
        await db.ecommerceOrderFinancialEvent.count({
          where: { orderId: f.order.id },
        }),
      ).toBe(before.ledger);
      const totals = await financial.getSummary(owner, f.order.id);
      expect(totals.revenue).toBe('0.00');
      expect(totals.netProfit).toBe(`-${loss}`);
    },
  );

  it('applies only the difference for damage-cost and condition corrections', async () => {
    const f = await fixture();
    const detected = await detect(f);
    const lineId = f.order.lines[0].id;
    for (const [condition, damageCost, onHand, damaged, loss] of [
      ['DAMAGED', 7.5, 20, 2, '22.50'],
      ['DAMAGED', 10, 20, 2, '25.00'],
      ['LOST', undefined, 18, 0, '75.00'],
      ['GOOD', undefined, 20, 0, '15.00'],
    ] as const) {
      const result = await verify(detected.returnRequestId, [
        { orderLineId: lineId, condition, damageCost },
      ]);
      expect(result.body.lossSummary.netLoss).toBe(loss);
      expect(await balance(f.item.id)).toMatchObject({ onHand, damaged });
      expect((await financial.getSummary(owner, f.order.id)).netProfit).toBe(
        `-${loss}`,
      );
    }
  });

  it('keeps partially verified returns open until every line is checked', async () => {
    const f = await fixture(2);
    const detected = await detect(f);
    const partial = await verify(detected.returnRequestId, [
      { orderLineId: f.order.lines[0].id, condition: 'GOOD' },
    ]);
    expect(partial.body.status).toBe('NEED_VERIFICATION');
    const complete = await verify(detected.returnRequestId, [
      { orderLineId: f.order.lines[1].id, condition: 'LOST' },
    ]);
    expect(complete.body.status).toBe('PROCESSED');
    expect(complete.body.lossSummary.netLoss).toBe('75.00');
    expect(await balance(f.item.id)).toMatchObject({ onHand: 18, reserved: 0 });
  });

  it('does not invent product costs or stock for an unmatched line', async () => {
    const f = await fixture(1, false);
    const detected = await detect(f);
    const lineId = f.order.lines[0].id;
    const lost = await verify(detected.returnRequestId, [
      { orderLineId: lineId, condition: 'LOST' },
    ]);
    expect(lost.body.lossSummary.netLoss).toBe('15.00');
    const damaged = await verify(detected.returnRequestId, [
      { orderLineId: lineId, condition: 'DAMAGED', damageCost: 7.5 },
    ]);
    expect(damaged.body.lossSummary.netLoss).toBe('22.50');
    expect(await balance(f.item.id)).toMatchObject({ onHand: 20, damaged: 0 });
  });

  it('deduplicates concurrent scans and counts customer return risk once', async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([detect(f), detect(f)]);
    expect(first.returnRequestId).toBe(second.returnRequestId);
    expect(
      await db.returnRequest.count({ where: { orderId: f.order.id } }),
    ).toBe(1);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: f.customer.id } }))
        .returnsCount,
    ).toBe(1);
  });

  it('resolves a third-party tracking barcode and a Zomaal QR payload', async () => {
    const f = await fixture();
    const first = await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', owner)
      .send({ value: `${f.tracking}\n` })
      .expect(200);
    const qr = await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', owner)
      .send({ value: JSON.stringify({ trackingNumber: f.tracking }) })
      .expect(200);
    expect((qr.body as DetectedReturnResponseDto).returnRequestId).toBe(
      (first.body as DetectedReturnResponseDto).returnRequestId,
    );
  });

  it('finds orders and returns by their internal ID only within the active store', async () => {
    const f = await fixture();
    const detected = await detect(f);
    for (const user of [owner, otherOwner]) {
      const search = await request(server)
        .get('/ecommerce/returns/search')
        .set('x-test-user', user)
        .query({ q: f.order.id })
        .expect(200);
      const list = await request(server)
        .get('/ecommerce/returns')
        .set('x-test-user', user)
        .query({ search: `  ${f.order.id}  ` })
        .expect(200);
      if (user === owner) {
        expect(
          (search.body as { data: { orderId: string }[] }).data.map(
            (o) => o.orderId,
          ),
        ).toEqual([f.order.id]);
        expect(
          (list.body as ReturnListResponseDto).data.map(
            (r) => r.returnRequestId,
          ),
        ).toEqual([detected.returnRequestId]);
      } else {
        expect((search.body as { data: unknown[] }).data).toEqual([]);
        expect((list.body as ReturnListResponseDto).data).toEqual([]);
      }
    }
  });

  it('rejects unknown scans without creating any return', async () => {
    const before = await db.returnRequest.count();
    await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', owner)
      .send({ value: `UNKNOWN-${randomUUID()}` })
      .expect(404);
    expect(await db.returnRequest.count()).toBe(before);
  });

  it('rejects ambiguous order references and tracking codes without creating returns', async () => {
    const first = await fixture();
    const second = await fixture();
    await db.ecommerceOrder.update({
      where: { id: second.order.id },
      data: { orderName: first.order.orderName },
    });
    await db.ecommerceOrderEvent.create({
      data: {
        orderId: second.order.id,
        providerEventId: `ambiguous-${randomUUID()}`,
        source: 'SYSTEM',
        type: OrderEventType.RETURNED,
        title: 'Shared tracking',
        occurredAt: new Date(),
        metadata: { number: first.tracking },
      },
    });
    for (const value of [first.order.orderName, first.tracking]) {
      await request(server)
        .post('/ecommerce/returns/detect')
        .set('x-test-user', owner)
        .send({ value })
        .expect(409);
    }
    expect(
      await db.returnRequest.count({
        where: { orderId: { in: [first.order.id, second.order.id] } },
      }),
    ).toBe(0);
  });

  it("keeps grouped unread counts scoped to store, permissions, and each user's reads", async () => {
    const notifications = new NotificationsService(
      db as PrismaService,
      { isEnabled: false } as never,
    );
    const access = new StoreAccessService(db as PrismaService);
    const rows = await Promise.all([
      ...Array.from({ length: 2 }, () =>
        db.notification.create({
          data: {
            storeId: stores[0],
            type: 'TEST',
            title: 'Critical inventory',
            severity: 'CRITICAL',
            category: 'INVENTORY',
            audiencePermission: 'returns.view',
          },
        }),
      ),
      db.notification.create({
        data: {
          storeId: stores[0],
          type: 'TEST',
          title: 'Warning inventory',
          severity: 'WARNING',
          category: 'INVENTORY',
          audiencePermission: 'returns.view',
        },
      }),
      db.notification.create({
        data: {
          storeId: stores[0],
          type: 'TEST',
          title: 'Hidden sales',
          severity: 'INFO',
          category: 'SALES',
          audiencePermission: 'products.view',
        },
      }),
      db.notification.create({
        data: {
          storeId: stores[0],
          type: 'TEST',
          title: 'Owner only',
          severity: 'WARNING',
          category: 'STAFF',
        },
      }),
      db.notification.create({
        data: {
          storeId: stores[0],
          type: 'TEST',
          title: 'Read inventory',
          severity: 'WARNING',
          category: 'INVENTORY',
          audiencePermission: 'returns.view',
        },
      }),
      db.notification.create({
        data: {
          storeId: stores[1],
          type: 'TEST',
          title: 'Other store',
          severity: 'CRITICAL',
          category: 'INVENTORY',
          audiencePermission: 'returns.view',
        },
      }),
    ]);
    await db.notificationRead.create({
      data: { notificationId: rows[5].id, userId: viewer },
    });
    const ownerAccess = await access.require(owner);
    const viewerAccess = await access.require(viewer);
    await expect(notifications.unreadCounts(ownerAccess)).resolves.toEqual({
      all: 6,
      critical: 2,
      warning: 3,
      inventory: 4,
    });
    await expect(notifications.unreadCounts(viewerAccess)).resolves.toEqual({
      all: 3,
      critical: 2,
      warning: 1,
      inventory: 3,
    });
    await notifications.markRead(ownerAccess, rows[0].id);
    await expect(notifications.unreadCounts(ownerAccess)).resolves.toEqual({
      all: 5,
      critical: 1,
      warning: 3,
      inventory: 3,
    });
    await expect(notifications.unreadCounts(viewerAccess)).resolves.toEqual({
      all: 3,
      critical: 2,
      warning: 1,
      inventory: 3,
    });
  });

  it('searches manual and synced customers in both endpoints without exposing another store', async () => {
    const manual = await fixture();
    const synced = await fixture();
    const sharedName = `Search-${randomUUID()}`;
    manual.customer.phone = '+212600000071';
    synced.customer.phone = '+212600000072';
    for (const f of [manual, synced]) {
      await db.customer.update({
        where: { id: f.customer.id },
        data: { phone: f.customer.phone },
      });
    }
    await db.ecommerceOrder.update({
      where: { id: manual.order.id },
      data: {
        manualCustomerName: `${sharedName} Manual`,
        manualCustomerPhone: manual.customer.phone,
      },
    });
    await db.customer.update({
      where: { id: synced.customer.id },
      data: { name: `${sharedName} Synced` },
    });
    await db.ecommerceOrder.update({
      where: { id: synced.order.id },
      data: { manualCustomerName: null, manualCustomerPhone: null },
    });
    await detect(manual);
    await detect(synced);
    for (const path of ['/ecommerce/returns', '/ecommerce/returns/search']) {
      const key = path.endsWith('/search') ? 'q' : 'search';
      const matches = await request(server)
        .get(path)
        .set('x-test-user', owner)
        .query({ [key]: `  ${sharedName.toLowerCase()}  ` })
        .expect(200);
      const rows = (
        matches.body as {
          data: {
            orderId: string;
            customerName: string;
            customerPhone: string;
          }[];
        }
      ).data;
      expect(rows.map((row) => row.orderId).sort()).toEqual(
        [manual.order.id, synced.order.id].sort(),
      );
      expect(rows.find((row) => row.orderId === synced.order.id)).toMatchObject(
        {
          customerName: `${sharedName} Synced`,
          customerPhone: synced.customer.phone,
        },
      );
      for (const fixture of [manual, synced]) {
        const phone = fixture.customer.phone;
        const formattedPhone = `${phone.slice(0, 4)} ${phone.slice(4)}`;
        const result = await request(server)
          .get(path)
          .set('x-test-user', owner)
          .query({ [key]: formattedPhone })
          .expect(200);
        expect(
          (result.body as { data: { orderId: string }[] }).data.map(
            (row) => row.orderId,
          ),
        ).toEqual([fixture.order.id]);
      }
      const other = await request(server)
        .get(path)
        .set('x-test-user', otherOwner)
        .query({ [key]: sharedName })
        .expect(200);
      expect((other.body as { data: unknown[] }).data).toEqual([]);
    }
  });

  it('normalizes mixed-currency list totals and prorated return buckets without changing order-currency allocations', async () => {
    const beforeList = await request(server)
      .get('/ecommerce/returns')
      .set('x-test-user', owner)
      .expect(200);
    const beforeBuckets = await ecommerce.getReturnsSummary(owner, {});
    const mad = await fixture();
    const usd = await fixture(1, true, 'USD');
    await detect(mad);
    const detected = await detect(usd);
    expect(detected.currency).toBe('USD');
    expect(detected.lossSummary).toEqual({
      originalOrderValue: '200.00',
      deliveryCost: '15.00',
      netLoss: '15.00',
    });
    const { body: result } = await verify(detected.returnRequestId, [
      { orderLineId: usd.order.lines[0].id, quantity: 1, condition: 'GOOD' },
      { orderLineId: usd.order.lines[0].id, quantity: 1, condition: 'LOST' },
    ]);
    expect(result.currency).toBe('USD');
    expect(result.lossSummary.netLoss).toBe('18.00');
    const stored = await db.ecommerceOrderLine.findUniqueOrThrow({
      where: { id: usd.order.lines[0].id },
    });
    expect((stored.conditionAllocations as { loss: string }).loss).toBe(
      '3.0000',
    );
    const read = await request(server)
      .get(`/ecommerce/returns/${detected.returnRequestId}`)
      .set('x-test-user', owner)
      .expect(200);
    expect((read.body as DetectedReturnResponseDto).lossSummary.netLoss).toBe(
      '18.00',
    );
    const list = await request(server)
      .get('/ecommerce/returns')
      .set('x-test-user', owner)
      .query({ search: usd.order.id })
      .expect(200);
    const body = list.body as ReturnListResponseDto;
    expect(body.currency).toBe('MAD');
    expect(body.data[0].value).toBe('2000.00');
    expect(
      new Prisma.Decimal(body.summary.totalReturns.value)
        .minus(
          (beforeList.body as ReturnListResponseDto).summary.totalReturns.value,
        )
        .toFixed(2),
    ).toBe('2200.00');
    const buckets = await ecommerce.getReturnsSummary(owner, {});
    expect(
      new Prisma.Decimal(buckets.received.value)
        .minus(beforeBuckets.received.value)
        .toFixed(2),
    ).toBe('1000.00');
    expect(
      new Prisma.Decimal(buckets.missing.value)
        .minus(beforeBuckets.missing.value)
        .toFixed(2),
    ).toBe('30.00');
    const ledger = await db.ecommerceOrderFinancialEvent.findMany({
      where: { orderId: usd.order.id },
    });
    expect(ledger.every((event) => event.currency === 'USD')).toBe(true);
    const revenue = ledger.find(
      (event) => event.type === 'REVENUE_RECOGNIZED',
    )!;
    expect(revenue.productCost.toFixed(2)).toBe('6.00');
    expect(revenue.shippingCost.toFixed(2)).toBe('15.00');
  });

  it('returns 503 without recording conditions when required FX is unavailable', async () => {
    const f = await fixture(1, true, 'USD');
    const detected = await detect(f);
    const beforeEvents = await db.ecommerceOrderFinancialEvent.count({
      where: { orderId: f.order.id },
    });
    const implementation = currency.convertOrNull.getMockImplementation()!;
    currency.convertOrNull.mockResolvedValue(null);
    try {
      await verify(
        detected.returnRequestId,
        [{ orderLineId: f.order.lines[0].id, condition: 'LOST' }],
        503,
      );
      expect(
        (
          await db.ecommerceOrderLine.findUniqueOrThrow({
            where: { id: f.order.lines[0].id },
          })
        ).conditionAllocations,
      ).toBeNull();
      expect(
        await db.ecommerceOrderFinancialEvent.count({
          where: { orderId: f.order.id },
        }),
      ).toBe(beforeEvents);
      await request(server)
        .get('/ecommerce/returns')
        .set('x-test-user', owner)
        .expect(503);
      await expect(ecommerce.getReturnsSummary(owner, {})).rejects.toThrow(
        'Exchange rate USD → MAD is unavailable',
      );
    } finally {
      currency.convertOrNull.mockImplementation(implementation);
    }
  });

  it('does not convert legacy warehouse purchase losses as though they were order amounts', async () => {
    const f = await fixture(1, true, 'USD');
    await db.ecommerceOrderLine.update({
      where: { id: f.order.lines[0].id },
      data: { condition: 'LOST' },
    });
    const before = await ecommerce.getReturnsSummary(owner, {});
    const detected = await detect(f);
    expect(detected.currency).toBe('USD');
    expect(detected.lossSummary.netLoss).toBe('21.00');
    await db.ecommerceOrderLine.update({
      where: { id: f.order.lines[0].id },
      data: { condition: null },
    });
    const after = await ecommerce.getReturnsSummary(owner, {});
    expect(
      new Prisma.Decimal(before.missing.value)
        .minus(after.missing.value)
        .toFixed(2),
    ).toBe('60.00');
  });

  it('shows delayed requests and removes them from that tab when processed', async () => {
    const f = await fixture();
    const detected = await detect(f);
    await db.returnRequest.update({
      where: { id: detected.returnRequestId },
      data: { createdAt: new Date(Date.now() - 3 * 86400000) },
    });
    const delayed = await request(server)
      .get('/ecommerce/returns')
      .set('x-test-user', owner)
      .query({ status: 'DELAYED', search: f.order.orderName })
      .expect(200);
    expect((delayed.body as ReturnListResponseDto).data).toHaveLength(1);
    expect((delayed.body as ReturnListResponseDto).data[0].status).toBe(
      'DELAYED',
    );
    await verify(detected.returnRequestId, [
      { orderLineId: f.order.lines[0].id, condition: 'GOOD' },
    ]);
    const after = await request(server)
      .get('/ecommerce/returns')
      .set('x-test-user', owner)
      .query({ status: 'DELAYED', search: f.order.orderName })
      .expect(200);
    expect((after.body as ReturnListResponseDto).data).toHaveLength(0);
  });

  it('blocks another store from detecting, verifying, or listing the return', async () => {
    const f = await fixture();
    const detected = await detect(f);
    await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', otherOwner)
      .send({ value: f.order.orderName, orderId: f.order.id })
      .expect(404);
    await verify(
      detected.returnRequestId,
      [{ orderLineId: f.order.lines[0].id, condition: 'GOOD' }],
      404,
      otherOwner,
    );
    const list = await request(server)
      .get('/ecommerce/returns')
      .set('x-test-user', otherOwner)
      .expect(200);
    expect((list.body as ReturnListResponseDto).data).toHaveLength(0);
    const search = await request(server)
      .get('/ecommerce/returns/search')
      .set('x-test-user', otherOwner)
      .query({ q: f.order.orderName })
      .expect(200);
    expect((search.body as { data: unknown[] }).data).toHaveLength(0);
  });

  it('allows view-only staff to read and blocks scanning and verification', async () => {
    const f = await fixture();
    const detected = await detect(f);
    await request(server)
      .get('/ecommerce/returns')
      .set('x-test-user', viewer)
      .expect(200);
    await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', viewer)
      .send({ value: f.order.orderName, orderId: f.order.id })
      .expect(403);
    await verify(
      detected.returnRequestId,
      [{ orderLineId: f.order.lines[0].id, condition: 'GOOD' }],
      403,
      viewer,
    );
    expect(await balance(f.item.id)).toMatchObject({ onHand: 18, damaged: 0 });
  });

  it('rejects an invalid line without partially verifying earlier valid lines', async () => {
    const f = await fixture();
    const detected = await detect(f);
    await verify(
      detected.returnRequestId,
      [
        { orderLineId: f.order.lines[0].id, condition: 'LOST' },
        { orderLineId: randomUUID(), condition: 'GOOD' },
      ],
      400,
    );
    const line = await db.ecommerceOrderLine.findUniqueOrThrow({
      where: { id: f.order.lines[0].id },
    });
    expect(line.condition).toBeNull();
    expect((await financial.getSummary(owner, f.order.id)).damageCost).toBe(
      '0.00',
    );
  });
});
