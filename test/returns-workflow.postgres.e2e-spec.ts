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
    financial = new EcommerceOrderFinancialService(prisma, stock, {
      onShipmentStatus: jest.fn().mockResolvedValue(undefined),
    } as never);
    const risk = new CustomerRiskService(
      prisma,
      access,
      {
        raise: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
    );
    const ecommerce = new EcommerceService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
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

  async function fixture(lineCount = 1, linked = true) {
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
        currency: 'MAD',
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
            currency: 'MAD',
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
