import { OrderConditionService } from '../src/ecommerce/order-condition.service';
import { ProductCondition } from '../src/ecommerce/constants/product-condition';
import { QuickLivraisonShipmentService } from '../src/shipping/quicklivraison-shipment.service';
import { OzoneExpressShipmentService } from '../src/shipping/ozoneexpress-shipment.service';
import { randomUUID } from 'node:crypto';
import { AmeexShipmentService } from '../src/shipping/ameex-shipment.service';
import { ForceLogShipmentService } from '../src/shipping/forcelog-shipment.service';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, EcommercePlatform, Prisma } from '@prisma/client';
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
const url = process.env.TRACKING_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Tracking, pack and return edge cases with PostgreSQL', () => {
  let db: PrismaClient;
  let pool: Pool;
  let app: INestApplication;
  let server: Server;
  let financial: EcommerceOrderFinancialService;
  let stock: OrderStockService;
  let ecommerce: EcommerceService;
  const ticketShipping = {
    createSenditDelivery: jest.fn().mockResolvedValue({}),
    createQuickLivraisonDelivery: jest.fn().mockResolvedValue({}),
    addForceLogParcel: jest.fn().mockResolvedValue({}),
    addOzoneExpressParcel: jest.fn().mockResolvedValue({}),
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
        'TRACKING_TEST_DATABASE_URL must identify a dedicated local test database',
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
    ecommerce = new EcommerceService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      ticketShipping as never,
      stock,
      financial,
      risk,
      access,
      {} as never,
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
  async function physical(cost = 30) {
    const product = await db.warehouseProduct.create({
      data: { storeId: stores[0], name: 'Edge fixture', status: 'ACTIVE' },
    });
    const variant = await db.warehouseVariant.create({
      data: {
        storeId: stores[0],
        productId: product.id,
        title: 'Default',
        price: 100,
        costPrice: cost,
        productCode: `CODE-${randomUUID()}`,
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
    const item = await db.inventoryItem.create({
      data: {
        storeId: stores[0],
        variantId: variant.id,
        kind: 'PRODUCT_VARIANT',
        balances: { create: { locationId: location.id, onHand: 20 } },
      },
    });
    return { product, variant, item };
  }

  async function edgeOrder(
    variantId: string,
    quantity = 2,
    tracking = `EDGE-${randomUUID()}`,
  ) {
    const now = new Date();
    const order = await db.ecommerceOrder.create({
      data: {
        connectionId,
        externalOrderId: randomUUID(),
        orderName: `EDGE-${randomUUID()}`,
        manualCustomerName: 'QA',
        manualCustomerPhone: `qa-${randomUUID()}`,
        currency: 'MAD',
        grossSales: 100 * quantity,
        discounts: 0,
        refunds: 0,
        netSales: 100 * quantity,
        shipping: 15,
        tax: 0,
        totalCollected: 100 * quantity + 15,
        status: 'OPEN',
        financialStatus: 'PENDING',
        processedAt: now,
        providerCreatedAt: now,
        providerUpdatedAt: now,
        lines: {
          create: {
            externalLineId: randomUUID(),
            name: 'Edge item',
            quantity,
            unitPrice: 100,
            totalPrice: 100 * quantity,
            currency: 'MAD',
            warehouseVariantId: variantId,
          },
        },
      },
      include: { lines: true },
    });
    await db.ecommerceOrderEvent.create({
      data: {
        orderId: order.id,
        providerEventId: randomUUID(),
        source: 'SYSTEM',
        type: OrderEventType.IN_TRANSIT,
        title: 'Fixture in transit',
        occurredAt: now,
        metadata: { number: tracking },
      },
    });
    await stock.reserveOrder(order.id);
    return { order, tracking };
  }

  async function edgeEvent(orderId: string, type: string, time: number) {
    await db.ecommerceOrderEvent.create({
      data: {
        orderId,
        providerEventId: randomUUID(),
        source: 'SYSTEM',
        type,
        title: 'Fixture event',
        occurredAt: new Date(time),
      },
    });
    await financial.syncUndispatchedOrder(orderId);
  }

  async function edgeDetect(f: Awaited<ReturnType<typeof edgeOrder>>) {
    const r = await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', owner)
      .send({ value: f.tracking })
      .expect(200);
    return r.body as DetectedReturnResponseDto;
  }

  async function packFixture() {
    const a = await physical(30),
      b = await physical(10);
    const product = await db.warehouseProduct.create({
      data: {
        storeId: stores[0],
        name: 'Summer pack',
        kind: 'BUNDLE',
        status: 'ACTIVE',
        bundleComponents: {
          create: [
            { componentVariantId: a.variant.id, quantity: 2, position: 0 },
            { componentVariantId: b.variant.id, quantity: 1, position: 1 },
          ],
        },
      },
    });
    const variant = await db.warehouseVariant.create({
      data: {
        storeId: stores[0],
        productId: product.id,
        title: 'Pack',
        productCode: `PACK-${randomUUID()}`,
        price: 100,
        costPrice: 70,
        isDefault: true,
      },
    });
    return { a, b, product, variant };
  }

  it('EDGE same product on separate orders resolves the right tracking and releases only that order stock', async () => {
    const p = await physical(),
      a = await edgeOrder(p.variant.id, 2),
      b = await edgeOrder(p.variant.id, 3);
    expect(
      (await ecommerce.resolveScannedCode(owner, a.tracking)).orderId,
    ).toBe(a.order.id);
    expect(
      (await ecommerce.resolveScannedCode(owner, b.tracking)).orderId,
    ).toBe(b.order.id);
    const detected = await edgeDetect(a);
    await verify(detected.returnRequestId, [
      { orderLineId: a.order.lines[0].id, condition: 'GOOD' },
    ]);
    expect(await balance(p.item.id)).toMatchObject({
      onHand: 20,
      reserved: 3,
      damaged: 0,
    });
    expect(
      (
        await db.ecommerceOrderLine.findUniqueOrThrow({
          where: { id: b.order.lines[0].id },
        })
      ).condition,
    ).toBeNull();
  });

  it('EDGE a QR with a misleading product/order id still resolves by the store-owned tracking number', async () => {
    const p = await physical(),
      a = await edgeOrder(p.variant.id);
    const result = await ecommerce.resolveScannedCode(
      owner,
      JSON.stringify({
        trackingNumber: a.tracking,
        orderId: 'wrong-order',
        productCode: 'wrong-product',
      }),
    );
    expect(result.orderId).toBe(a.order.id);
    expect(result.products[0].productCode).toBe(p.variant.productCode);
  });

  it('EDGE ambiguous tracking numbers must not silently choose one of two orders', async () => {
    const p = await physical(),
      tracking = `COLLISION-${randomUUID()}`;
    await edgeOrder(p.variant.id, 1, tracking);
    await edgeOrder(p.variant.id, 1, tracking);
    await expect(
      ecommerce.resolveScannedCode(owner, tracking),
    ).rejects.toThrow();
  });

  it.each(['GOOD', 'RETURNED', 'DAMAGED', 'LOST', 'MISSING'])(
    'EDGE whole-pack delivery and %s return update every component correctly',
    async (condition) => {
      const p = await packFixture(),
        f = await edgeOrder(p.variant.id, 2),
        time = Date.now() + 1000;
      await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
      expect(await balance(p.a.item.id)).toMatchObject({
        onHand: 16,
        reserved: 0,
      });
      expect(await balance(p.b.item.id)).toMatchObject({
        onHand: 18,
        reserved: 0,
      });
      await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
      const detected = await edgeDetect(f);
      await verify(detected.returnRequestId, [
        { orderLineId: f.order.lines[0].id, condition },
      ]);
      const restocks = ['GOOD', 'RETURNED', 'DAMAGED'].includes(condition),
        damaged = condition === 'DAMAGED';
      expect(await balance(p.a.item.id)).toMatchObject({
        onHand: restocks ? 20 : 16,
        reserved: 0,
        damaged: damaged ? 4 : 0,
      });
      expect(await balance(p.b.item.id)).toMatchObject({
        onHand: restocks ? 20 : 18,
        reserved: 0,
        damaged: damaged ? 2 : 0,
      });
      expect((await financial.getSummary(owner, f.order.id)).netProfit).toBe(
        ['GOOD', 'RETURNED'].includes(condition) ? '-15.00' : '-155.00',
      );
    },
  );

  it('EDGE scanning a pack must expose physical component codes and quantities', async () => {
    const p = await packFixture(),
      f = await edgeOrder(p.variant.id, 2);
    const scan = await ecommerce.resolveScannedCode(owner, f.tracking);
    expect(JSON.stringify(scan.products)).toContain(p.a.variant.productCode!);
    expect(JSON.stringify(scan.products)).toContain(p.b.variant.productCode!);
  });

  it('EDGE pack QR must retain component quantities rather than just code strings', async () => {
    const p = await packFixture(),
      f = await edgeOrder(p.variant.id, 2);
    await db.ecommerceOrderDispatch.create({
      data: {
        orderId: f.order.id,
        provider: 'FORCELOG',
        status: 'DISPATCHED',
        merchantTracking: randomUUID(),
        providerTracking: f.tracking,
      },
    });
    const qr = await ecommerce.getShipmentQrPayload(owner, f.order.id);
    expect(qr).toMatchObject({
      type: 'PACK',
      items: expect.arrayContaining([
        expect.objectContaining({
          productCode: p.a.variant.productCode,
          quantity: 4,
        }),
      ]) as unknown,
    });
  });

  it('EDGE mixed conditions for different pack components must be supported independently', async () => {
    const p = await packFixture(),
      f = await edgeOrder(p.variant.id, 1);
    const detected = await edgeDetect(f);
    await request(server)
      .post(`/ecommerce/returns/${detected.returnRequestId}/verify`)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            componentVariantId: p.a.variant.id,
            quantity: 1,
            condition: 'DAMAGED',
            damageCost: 30,
          },
          {
            orderLineId: f.order.lines[0].id,
            componentVariantId: p.b.variant.id,
            quantity: 1,
            condition: 'GOOD',
          },
        ],
      })
      .expect(200);
  });

  it('EDGE two units on one line need independently recorded partial conditions', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f);
    await request(server)
      .post(`/ecommerce/returns/${detected.returnRequestId}/verify`)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            quantity: 1,
            condition: 'DAMAGED',
            damageCost: 30,
          },
          { orderLineId: f.order.lines[0].id, quantity: 1, condition: 'GOOD' },
        ],
      })
      .expect(200);
  });

  it('EDGE conflicting repeated line IDs must be rejected rather than silently overwriting conditions', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f);
    await verify(
      detected.returnRequestId,
      [
        { orderLineId: f.order.lines[0].id, condition: 'GOOD' },
        {
          orderLineId: f.order.lines[0].id,
          condition: 'DAMAGED',
          damageCost: 30,
        },
      ],
      400,
    );
  });

  it('EDGE duplicate delivery events do not duplicate stock deductions or revenue', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    const counts = {
      movements: await db.inventoryMovement.count({
        where: { inventoryItemId: p.item.id },
      }),
      events: await db.ecommerceOrderFinancialEvent.count({
        where: { orderId: f.order.id },
      }),
    };
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    expect(await balance(p.item.id)).toMatchObject({ onHand: 18, reserved: 0 });
    expect(
      await db.inventoryMovement.count({
        where: { inventoryItemId: p.item.id },
      }),
    ).toBe(counts.movements);
    expect(
      await db.ecommerceOrderFinancialEvent.count({
        where: { orderId: f.order.id },
      }),
    ).toBe(counts.events);
  });

  it('EDGE stale terminal delivery arriving after a newer return does not resurrect revenue', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 2000);
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time + 1000);
    expect((await ecommerce.resolveScannedCode(owner, f.tracking)).status).toBe(
      OrderEventType.RETURNED,
    );
    expect((await financial.getSummary(owner, f.order.id)).revenue).toBe(
      '0.00',
    );
  });

  it('EDGE a later genuine Delivered correction after a returned status restores revenue', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time + 2000);
    expect((await ecommerce.resolveScannedCode(owner, f.tracking)).status).toBe(
      OrderEventType.DELIVERED,
    );
    expect((await financial.getSummary(owner, f.order.id)).revenue).toBe(
      '215.00',
    );
  });

  it('EDGE concurrent delivery syncs both finish without duplicate stock or financial events', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await db.ecommerceOrderEvent.create({
      data: {
        orderId: f.order.id,
        providerEventId: randomUUID(),
        source: 'SYSTEM',
        type: OrderEventType.DELIVERED,
        title: 'Concurrent test',
        occurredAt: new Date(time),
      },
    });
    const outcomes = await Promise.allSettled([
      financial.syncUndispatchedOrder(f.order.id),
      financial.syncUndispatchedOrder(f.order.id),
    ]);
    console.log(
      'Concurrent delivery outcomes',
      outcomes.map((r) =>
        r.status === 'rejected'
          ? { status: r.status, code: (r.reason as { code?: string }).code }
          : { status: r.status },
      ),
    );
    expect(outcomes.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await balance(p.item.id)).toMatchObject({ onHand: 18, reserved: 0 });
    expect(
      await db.ecommerceOrderFinancialEvent.count({
        where: { orderId: f.order.id, type: 'REVENUE_RECOGNIZED' },
      }),
    ).toBe(1);
  });

  it('EDGE an Ameex-only shipment reference can resolve to its manual order', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      tracking = `AMEEX-${randomUUID()}`;
    await db.ameexShipment.create({
      data: {
        userId: owner,
        providerCode: tracking,
        providerStatus: 'DELIVERED',
        normalizedStatus: 'DELIVERED',
        reference: f.order.orderName,
        fee: 15,
        currency: 'MAD',
      },
    });
    expect((await ecommerce.resolveScannedCode(owner, tracking)).orderId).toBe(
      f.order.id,
    );
  });
  it('EDGE ticket requests contain product codes and quantities for all four dispatch adapters', async () => {
    const preview = {
      recipientName: 'QA',
      recipientPhone: 'QA-NO-CONTACT',
      address: 'Test only',
      city: 'Test',
      notes: null,
      orderReference: 'QA-ORDER',
      lineItems: [
        { productCode: 'DH564BJ0', title: 'Long product title', quantity: 2 },
      ],
    };
    const send = Reflect.get(ecommerce, 'createProviderShipment') as (
      userId: string,
      provider: string,
      options: Record<string, unknown>,
      preview: object,
      reference: string,
      amount: number,
    ) => Promise<unknown>;
    for (const provider of [
      'SENDIT',
      'QUICKLIVRAISON',
      'FORCELOG',
      'OZONEEXPRESS',
    ]) {
      await send.call(
        ecommerce,
        owner,
        provider,
        {
          pickupDistrictId: 1,
          destinationDistrictId: 1,
          destinationCity: 'Test',
        },
        preview,
        'QA-REFERENCE',
        215,
      );
    }
    for (const mock of Object.values(ticketShipping)) {
      expect(JSON.stringify(mock.mock.calls)).toContain('DH564BJ0 x2');
      expect(JSON.stringify(mock.mock.calls)).not.toContain(
        'Long product title',
      );
    }
  });

  it('EDGE ForceLog status ingestion links the order and duplicate Delivered snapshots are idempotent', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      reference = `QA-${randomUUID()}`;
    await db.ecommerceOrderDispatch.create({
      data: {
        orderId: f.order.id,
        provider: 'FORCELOG',
        merchantTracking: reference,
        providerTracking: f.tracking,
        status: 'DISPATCHED',
      },
    });
    const carrier = new ForceLogShipmentService(
      db as PrismaService,
      {} as never,
      {} as never,
      financial,
      {
        recordShipmentOutcome: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    const snapshot = {
      PARCEL: {
        TRACKING_NUMBER: f.tracking,
        ORDER_NUM: reference,
        STATUS: 'Livré',
        DELIVERY_FEES: '15',
        PRICE: '215',
      },
    };
    await carrier.reconcileProviderParcel(owner, f.tracking, snapshot);
    const first = await financial.getSummary(owner, f.order.id);
    await carrier.reconcileProviderParcel(owner, f.tracking, snapshot);
    expect((await ecommerce.resolveScannedCode(owner, f.tracking)).status).toBe(
      'DELIVERED',
    );
    expect(await balance(p.item.id)).toMatchObject({ onHand: 18, reserved: 0 });
    expect((await financial.getSummary(owner, f.order.id)).revenue).toBe(
      first.revenue,
    );
    expect(first.revenue).toBe('215.00');
  });

  it('EDGE ForceLog stale In Transit snapshot must not replace a Delivered outcome', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      reference = `QA-${randomUUID()}`;
    await db.ecommerceOrderDispatch.create({
      data: {
        orderId: f.order.id,
        provider: 'FORCELOG',
        merchantTracking: reference,
        providerTracking: f.tracking,
        status: 'DISPATCHED',
      },
    });
    const carrier = new ForceLogShipmentService(
      db as PrismaService,
      {} as never,
      {} as never,
      financial,
      {
        recordShipmentOutcome: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    await carrier.reconcileProviderParcel(owner, f.tracking, {
      PARCEL: {
        TRACKING_NUMBER: f.tracking,
        ORDER_NUM: reference,
        STATUS: 'Livré',
        DELIVERY_FEES: '15',
        UPDATED_AT: '2026-10-20T10:00:00Z',
      },
    });
    await carrier.reconcileProviderParcel(owner, f.tracking, {
      PARCEL: {
        TRACKING_NUMBER: f.tracking,
        ORDER_NUM: reference,
        STATUS: 'IN_TRANSIT',
        DELIVERY_FEES: '15',
        UPDATED_AT: '2026-10-20T09:00:00Z',
      },
    });
    expect((await ecommerce.resolveScannedCode(owner, f.tracking)).status).toBe(
      'DELIVERED',
    );
  });
  it.each([
    'CANCELLED',
    'REFUSED',
    'RETURNED_TO_SELLER',
    'RETURNED_TO_WAREHOUSE',
    'RETURN_INSPECTION',
    'RETURNED_TO_STOCK',
  ])(
    'EDGE ForceLog %s before delivery releases reservation and books only incurred shipping',
    async (status) => {
      const p = await physical(),
        f = await edgeOrder(p.variant.id, 2),
        reference = `QA-${randomUUID()}`;
      await db.ecommerceOrderDispatch.create({
        data: {
          orderId: f.order.id,
          provider: 'FORCELOG',
          merchantTracking: reference,
          providerTracking: f.tracking,
          status: 'DISPATCHED',
        },
      });
      const carrier = new ForceLogShipmentService(
        db as PrismaService,
        {} as never,
        {} as never,
        financial,
        {
          recordShipmentOutcome: jest.fn().mockResolvedValue(undefined),
        } as never,
      );
      await carrier.reconcileProviderParcel(owner, f.tracking, {
        PARCEL: {
          TRACKING_NUMBER: f.tracking,
          ORDER_NUM: reference,
          STATUS: status,
          DELIVERY_FEES: '15',
        },
      });
      expect(await balance(p.item.id)).toMatchObject({
        onHand: 20,
        reserved: 0,
        damaged: 0,
      });
      const summary = await financial.getSummary(owner, f.order.id);
      expect(summary.revenue).toBe('0.00');
      expect(summary.netProfit).toBe(
        status === 'CANCELLED' ? '0.00' : '-15.00',
      );
    },
  );
  it('ALLOC two delivered units with mixed conditions update only the affected quantities', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
    const detected = await edgeDetect(f);
    const response = await request(server)
      .post(`/ecommerce/returns/${detected.returnRequestId}/verify`)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            quantity: 1,
            condition: 'DAMAGED',
            damageCost: 30,
          },
          { orderLineId: f.order.lines[0].id, quantity: 1, condition: 'GOOD' },
        ],
      })
      .expect(200);
    expect((response.body as VerifiedReturnResponseDto).status).toBe(
      'PROCESSED',
    );
    expect(
      (response.body as VerifiedReturnResponseDto).lossSummary.netLoss,
    ).toBe('45.00');
    expect(await balance(p.item.id)).toMatchObject({
      onHand: 20,
      reserved: 0,
      damaged: 1,
    });
    expect((await financial.getSummary(owner, f.order.id)).netProfit).toBe(
      '-45.00',
    );
    expect(
      (
        await db.ecommerceOrderLine.findUniqueOrThrow({
          where: { id: f.order.lines[0].id },
        })
      ).condition,
    ).toBe('MIXED');
  });

  it('ALLOC an incomplete quantity stays open and later replacement does not restock twice', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
    const detected = await edgeDetect(f);
    const url = `/ecommerce/returns/${detected.returnRequestId}/verify`;
    const first = await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({
        lines: [
          { orderLineId: f.order.lines[0].id, quantity: 1, condition: 'GOOD' },
        ],
      })
      .expect(200);
    expect((first.body as VerifiedReturnResponseDto).status).toBe(
      'NEED_VERIFICATION',
    );
    expect(await balance(p.item.id)).toMatchObject({ onHand: 19 });
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({
        lines: [
          { orderLineId: f.order.lines[0].id, quantity: 3, condition: 'GOOD' },
        ],
      })
      .expect(400);
    expect(await balance(p.item.id)).toMatchObject({ onHand: 19 });
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({
        lines: [
          { orderLineId: f.order.lines[0].id, quantity: 1, condition: 'GOOD' },
          { orderLineId: f.order.lines[0].id, quantity: 1, condition: 'LOST' },
        ],
      })
      .expect(200);
    expect(await balance(p.item.id)).toMatchObject({ onHand: 19, damaged: 0 });
    expect((await financial.getSummary(owner, f.order.id)).damageCost).toBe(
      '30.00',
    );
  });

  it('ALLOC pack component quantities, losses, retries and corrections stay consistent', async () => {
    const p = await packFixture(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
    const detected = await edgeDetect(f),
      url = `/ecommerce/returns/${detected.returnRequestId}/verify`;
    const lines = [
      {
        orderLineId: f.order.lines[0].id,
        componentVariantId: p.a.variant.id,
        quantity: 1,
        condition: 'DAMAGED',
        damageCost: 30,
      },
      {
        orderLineId: f.order.lines[0].id,
        componentVariantId: p.a.variant.id,
        quantity: 3,
        condition: 'GOOD',
      },
      {
        orderLineId: f.order.lines[0].id,
        componentVariantId: p.b.variant.id,
        quantity: 2,
        condition: 'MISSING',
      },
    ];
    const first = await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({ lines })
      .expect(200);
    expect((first.body as VerifiedReturnResponseDto).status).toBe('PROCESSED');
    expect(await balance(p.a.item.id)).toMatchObject({
      onHand: 20,
      damaged: 1,
    });
    expect(await balance(p.b.item.id)).toMatchObject({
      onHand: 18,
      damaged: 0,
    });
    expect((await financial.getSummary(owner, f.order.id)).netProfit).toBe(
      '-65.00',
    );
    const before = {
      movements: await db.inventoryMovement.count({
        where: { referenceId: f.order.lines[0].id },
      }),
      events: await db.ecommerceOrderFinancialEvent.count({
        where: { orderId: f.order.id },
      }),
    };
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({ lines })
      .expect(200);
    expect(
      await db.inventoryMovement.count({
        where: { referenceId: f.order.lines[0].id },
      }),
    ).toBe(before.movements);
    expect(
      await db.ecommerceOrderFinancialEvent.count({
        where: { orderId: f.order.id },
      }),
    ).toBe(before.events);
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            componentVariantId: p.a.variant.id,
            quantity: 4,
            condition: 'GOOD',
          },
          {
            orderLineId: f.order.lines[0].id,
            componentVariantId: p.b.variant.id,
            quantity: 2,
            condition: 'GOOD',
          },
        ],
      })
      .expect(200);
    expect(await balance(p.a.item.id)).toMatchObject({
      onHand: 20,
      damaged: 0,
    });
    expect(await balance(p.b.item.id)).toMatchObject({
      onHand: 20,
      damaged: 0,
    });
    expect((await financial.getSummary(owner, f.order.id)).netProfit).toBe(
      '-15.00',
    );
  });

  it('ALLOC a foreign second component leaves every stock bucket and condition unchanged', async () => {
    const p = await packFixture(),
      f = await edgeOrder(p.variant.id, 1),
      detected = await edgeDetect(f);
    await request(server)
      .post(`/ecommerce/returns/${detected.returnRequestId}/verify`)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            componentVariantId: p.a.variant.id,
            quantity: 1,
            condition: 'DAMAGED',
          },
          {
            orderLineId: f.order.lines[0].id,
            componentVariantId: randomUUID(),
            quantity: 1,
            condition: 'GOOD',
          },
        ],
      })
      .expect(400);
    expect(await balance(p.a.item.id)).toMatchObject({
      onHand: 20,
      reserved: 2,
      damaged: 0,
    });
    expect(
      (
        await db.ecommerceOrderLine.findUniqueOrThrow({
          where: { id: f.order.lines[0].id },
        })
      ).conditionAllocations,
    ).toBeNull();
  });

  it('ALLOC a ledger failure rolls back condition changes and stock movements', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f);
    const spy = jest
      .spyOn(financial, 'forTransaction')
      .mockImplementationOnce((client) => {
        const scoped = new EcommerceOrderFinancialService(
          client,
          new OrderStockService(client),
          { onShipmentStatus: jest.fn().mockResolvedValue(undefined) } as never,
        );
        jest
          .spyOn(scoped, 'setLineLoss')
          .mockRejectedValue(new Error('Injected ledger failure'));
        return scoped;
      });
    try {
      await request(server)
        .post(`/ecommerce/returns/${detected.returnRequestId}/verify`)
        .set('x-test-user', owner)
        .send({
          lines: [
            {
              orderLineId: f.order.lines[0].id,
              quantity: 1,
              condition: 'DAMAGED',
            },
          ],
        })
        .expect(500);
      expect(await balance(p.item.id)).toMatchObject({
        onHand: 20,
        reserved: 2,
        damaged: 0,
      });
      expect(
        (
          await db.ecommerceOrderLine.findUniqueOrThrow({
            where: { id: f.order.lines[0].id },
          })
        ).conditionAllocations,
      ).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('FIN repeated delivery/return corrections retain one incurred shipping charge', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    for (const [i, type] of [
      OrderEventType.DELIVERED,
      OrderEventType.RETURNED,
      OrderEventType.DELIVERED,
      OrderEventType.RETURNED,
      OrderEventType.DELIVERED,
    ].entries()) {
      await edgeEvent(f.order.id, type, time + i * 1000);
      expect((await financial.getSummary(owner, f.order.id)).revenue).toBe(
        type === OrderEventType.DELIVERED ? '215.00' : '0.00',
      );
    }
    const summary = await financial.getSummary(owner, f.order.id);
    expect(summary.shippingCost).toBe('15.00');
    expect(summary.netProfit).toBe('140.00');
  });

  it('AMEEX provider ingestion links a manual order and applies real matching-currency fee once', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2);
    const carrier = new AmeexShipmentService(
      db as PrismaService,
      {} as never,
      {} as never,
      {
        recordShipmentOutcome: jest.fn().mockResolvedValue(undefined),
      } as never,
      financial,
    );
    const snapshot = {
      CODE: f.tracking,
      STATUT: 'DELIVERED',
      ORDER_NUM: f.order.orderName,
      DELIVERY_FEES: '18',
      UPDATED_AT: new Date(Date.now() + 1000).toISOString(),
    };
    await carrier.reconcileInfo(owner, f.tracking, snapshot);
    await carrier.reconcileInfo(owner, f.tracking, snapshot);
    expect((await ecommerce.resolveScannedCode(owner, f.tracking)).status).toBe(
      'DELIVERED',
    );
    expect(await balance(p.item.id)).toMatchObject({ onHand: 18, reserved: 0 });
    const summary = await financial.getSummary(owner, f.order.id);
    expect(summary.revenue).toBe('215.00');
    expect(summary.shippingCost).toBe('18.00');
    expect(summary.netProfit).toBe('137.00');
  });
  it('READ mixed quantities appear in Returns tiles and completed return reads create no new request', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
    const before = await ecommerce.getReturnsSummary(owner, {}),
      detected = await edgeDetect(f);
    await request(server)
      .post(`/ecommerce/returns/${detected.returnRequestId}/verify`)
      .set('x-test-user', owner)
      .send({
        lines: [
          { orderLineId: f.order.lines[0].id, quantity: 1, condition: 'GOOD' },
          {
            orderLineId: f.order.lines[0].id,
            quantity: 1,
            condition: 'DAMAGED',
            damageCost: 30,
          },
        ],
      })
      .expect(200);
    const after = await ecommerce.getReturnsSummary(owner, {});
    expect(after.received.items - before.received.items).toBe(1);
    expect(after.damaged.items - before.damaged.items).toBe(1);
    expect(Number(after.damaged.value) - Number(before.damaged.value)).toBe(30);
    const count = await db.returnRequest.count({
      where: { orderId: f.order.id },
    });
    const read = await request(server)
      .get(`/ecommerce/returns/${detected.returnRequestId}`)
      .set('x-test-user', owner)
      .expect(200);
    expect((read.body as DetectedReturnResponseDto).products[0].condition).toBe(
      'MIXED',
    );
    expect(
      (read.body as DetectedReturnResponseDto).products[0].allocations,
    ).toHaveLength(2);
    await request(server)
      .get(`/ecommerce/returns/${detected.returnRequestId}`)
      .set('x-test-user', otherOwner)
      .expect(404);
    expect(
      await db.returnRequest.count({ where: { orderId: f.order.id } }),
    ).toBe(count);
  });

  it('READ scan and return detection both reject a cross-source tracking collision', async () => {
    const p = await physical(),
      tracking = `CROSS-${randomUUID()}`,
      a = await edgeOrder(p.variant.id, 1, tracking),
      b = await edgeOrder(p.variant.id, 1);
    await db.ecommerceOrderDispatch.create({
      data: {
        orderId: b.order.id,
        provider: 'FORCELOG',
        providerTracking: tracking,
        merchantTracking: randomUUID(),
        status: 'DISPATCHED',
      },
    });
    await expect(ecommerce.resolveScannedCode(owner, tracking)).rejects.toThrow(
      'Tracking number matches multiple orders',
    );
    await request(server)
      .post('/ecommerce/returns/detect')
      .set('x-test-user', owner)
      .send({ value: tracking })
      .expect(409);
    expect(
      await db.returnRequest.count({
        where: { orderId: { in: [a.order.id, b.order.id] } },
      }),
    ).toBe(0);
  });

  it('READ pack return screen exposes component identifiers and full ordered quantities', async () => {
    const p = await packFixture(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f);
    expect(detected.products[0].components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentVariantId: p.a.variant.id,
          quantityPerPack: 2,
          quantity: 4,
        }),
        expect.objectContaining({
          componentVariantId: p.b.variant.id,
          quantityPerPack: 1,
          quantity: 2,
        }),
      ]),
    );
  });

  it('FIN simultaneous deliveries of different orders retain all shared-product stock movements', async () => {
    const p = await physical(),
      a = await edgeOrder(p.variant.id, 2),
      b = await edgeOrder(p.variant.id, 3);
    for (const f of [a, b])
      await db.ecommerceOrderEvent.create({
        data: {
          orderId: f.order.id,
          providerEventId: randomUUID(),
          source: 'SYSTEM',
          type: OrderEventType.DELIVERED,
          title: 'Concurrent shared stock',
          occurredAt: new Date(Date.now() + 1000),
        },
      });
    await Promise.all([
      financial.syncUndispatchedOrder(a.order.id),
      financial.syncUndispatchedOrder(b.order.id),
    ]);
    expect(await balance(p.item.id)).toMatchObject({ onHand: 15, reserved: 0 });
    expect(
      await db.ecommerceOrderFinancialEvent.count({
        where: {
          orderId: { in: [a.order.id, b.order.id] },
          type: 'REVENUE_RECOGNIZED',
        },
      }),
    ).toBe(2);
  });

  it('FIN reinstated deliveries are included again in revenue summaries', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      time = Date.now() + 1000;
    const before = await ecommerce.getRevenueSummary(owner, {});
    const count = (r: typeof before) =>
      r.totalsByCurrency.find((t) => t.currency === 'MAD')?.orderCount ?? 0;
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time);
    await edgeEvent(f.order.id, OrderEventType.RETURNED, time + 1000);
    expect(count(await ecommerce.getRevenueSummary(owner, {}))).toBe(
      count(before),
    );
    await edgeEvent(f.order.id, OrderEventType.DELIVERED, time + 2000);
    expect(count(await ecommerce.getRevenueSummary(owner, {}))).toBe(
      count(before) + 1,
    );
  });
  it('REV stale changes conflict while an identical revision retry remains safe', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f),
      url = `/ecommerce/returns/${detected.returnRequestId}/verify`;
    const first = {
      lines: [
        {
          orderLineId: f.order.lines[0].id,
          quantity: 1,
          condition: 'GOOD',
          expectedRevision: 0,
        },
      ],
    };
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send(first)
      .expect(200);
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send(first)
      .expect(200);
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            quantity: 2,
            condition: 'DAMAGED',
            expectedRevision: 0,
          },
        ],
      })
      .expect(409);
    expect(
      (
        await db.ecommerceOrderLine.findUniqueOrThrow({
          where: { id: f.order.lines[0].id },
        })
      ).conditionRevision,
    ).toBe(1);
    await request(server)
      .post(url)
      .set('x-test-user', owner)
      .send({
        lines: [
          {
            orderLineId: f.order.lines[0].id,
            quantity: 2,
            componentVariantId: null,
            damageCost: null,
            condition: 'GOOD',
            expectedRevision: 1,
          },
        ],
      })
      .expect(200);
  });

  it('REV completed returns reopen atomically for incomplete allocations', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f);
    const endpoint = `/ecommerce/returns/${detected.returnRequestId}/verify`;
    const line = f.order.lines[0].id;
    await request(server)
      .post(endpoint)
      .set('x-test-user', owner)
      .send({ lines: [{ orderLineId: line, condition: 'GOOD' }] })
      .expect(200);
    expect(
      await db.returnRequest.findUniqueOrThrow({
        where: { id: detected.returnRequestId },
      }),
    ).toMatchObject({ status: 'PROCESSED' });
    await request(server)
      .post(endpoint)
      .set('x-test-user', owner)
      .send({ lines: [{ orderLineId: line, quantity: 1, condition: 'GOOD' }] })
      .expect(200);
    expect(
      await db.returnRequest.findUniqueOrThrow({
        where: { id: detected.returnRequestId },
      }),
    ).toMatchObject({ status: 'NEED_VERIFICATION', verifiedAt: null });
    const read = await request(server)
      .get(`/ecommerce/returns/${detected.returnRequestId}`)
      .set('x-test-user', owner)
      .expect(200);
    expect(
      (read.body as DetectedReturnResponseDto).products[0].conditionComplete,
    ).toBe(false);
  });

  it('REV another open return prevents reopening an older one without stock mutation', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2),
      detected = await edgeDetect(f);
    const endpoint = `/ecommerce/returns/${detected.returnRequestId}/verify`;
    const line = f.order.lines[0].id;
    await request(server)
      .post(endpoint)
      .set('x-test-user', owner)
      .send({ lines: [{ orderLineId: line, condition: 'GOOD' }] })
      .expect(200);
    await edgeDetect(f);
    const before = await balance(p.item.id);
    const saved = await db.ecommerceOrderLine.findUniqueOrThrow({
      where: { id: line },
    });
    await request(server)
      .post(endpoint)
      .set('x-test-user', owner)
      .send({
        lines: [{ orderLineId: line, quantity: 1, condition: 'DAMAGED' }],
      })
      .expect(409);
    expect(await balance(p.item.id)).toEqual(before);
    expect(
      (await db.ecommerceOrderLine.findUniqueOrThrow({ where: { id: line } }))
        .conditionRevision,
    ).toBe(saved.conditionRevision);
    expect(
      (
        await db.returnRequest.findUniqueOrThrow({
          where: { id: detected.returnRequestId },
        })
      ).status,
    ).toBe('PROCESSED');
  });

  it('FX return costs use an actual adapter rate and missing rates leave stock unchanged', async () => {
    const p = await physical(),
      f = await edgeOrder(p.variant.id, 2);
    await db.store.update({
      where: { id: stores[0] },
      data: { baseCurrency: 'USD' },
    });
    try {
      const missing = new OrderConditionService(
        db as PrismaService,
        financial,
        { convertOrNull: jest.fn().mockResolvedValue(null) } as never,
      );
      await expect(
        missing.record(stores[0], f.order.id, [
          {
            orderLineId: f.order.lines[0].id,
            quantity: 1,
            condition: ProductCondition.LOST,
          },
        ]),
      ).rejects.toThrow('real exchange rate');
      expect(await balance(p.item.id)).toMatchObject({
        onHand: 20,
        reserved: 2,
      });
      const known = new OrderConditionService(db as PrismaService, financial, {
        convertOrNull: jest.fn().mockResolvedValue(new Prisma.Decimal(10)),
      } as never);
      await known.record(stores[0], f.order.id, [
        {
          orderLineId: f.order.lines[0].id,
          quantity: 1,
          condition: ProductCondition.LOST,
        },
      ]);
      expect((await financial.getSummary(owner, f.order.id)).damageCost).toBe(
        '300.00',
      );
    } finally {
      await db.store.update({
        where: { id: stores[0] },
        data: { baseCurrency: 'MAD' },
      });
    }
  });

  it('STATUS QuickLivraison imports cannot regress a delivered parcel', async () => {
    await db.quickLivraisonConnection.create({
      data: {
        userId: owner,
        encryptedApiKey: 'test-only-encrypted-placeholder',
        keyType: 'TEST',
      },
    });
    const code = `QUICK-${randomUUID()}`,
      newer = new Date(Date.now() + 2000),
      older = new Date(Date.now() + 1000);
    await db.quickLivraisonShipment.create({
      data: {
        userId: owner,
        providerCode: code,
        providerStatus: 'DELIVERED',
        normalizedStatus: 'DELIVERED',
        lastActionAt: newer,
        providerUpdatedAt: newer,
      },
    });
    const carrier = new QuickLivraisonShipmentService(
      db as PrismaService,
      {} as never,
      financial,
      {
        recordShipmentOutcome: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    await carrier.reconcileProviderDeliveries(owner, [
      {
        tracking_number: code,
        status: 'IN_TRANSIT',
        updated_at: older.toISOString(),
      },
    ]);
    expect(
      (
        await db.quickLivraisonShipment.findUniqueOrThrow({
          where: { userId_providerCode: { userId: owner, providerCode: code } },
        })
      ).normalizedStatus,
    ).toBe('DELIVERED');
  });

  it('STATUS Ozone tracking cannot regress a delivered parcel', async () => {
    const code = `OZONE-${randomUUID()}`,
      newer = new Date(Date.now() + 2000),
      older = new Date(Date.now() + 1000);
    await db.ozoneExpressShipment.create({
      data: {
        userId: owner,
        providerCode: code,
        providerStatus: 'DELIVERED',
        normalizedStatus: 'DELIVERED',
        lastActionAt: newer,
      },
    });
    const carrier = new OzoneExpressShipmentService(
      db as PrismaService,
      {} as never,
      {} as never,
      financial,
      {
        recordShipmentOutcome: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    await carrier.reconcileTracking(owner, {
      TRACKING: {
        'TRACKING-NUMBER': code,
        LAST_TRACKING: {
          STATUT: 'IN_TRANSIT',
          TIME: String(Math.floor(older.getTime() / 1000)),
        },
      },
    });
    expect(
      (
        await db.ozoneExpressShipment.findUniqueOrThrow({
          where: { userId_providerCode: { userId: owner, providerCode: code } },
        })
      ).normalizedStatus,
    ).toBe('DELIVERED');
  });
});
