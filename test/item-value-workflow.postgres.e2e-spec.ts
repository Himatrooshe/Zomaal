import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PrismaClient,
  Prisma,
  WarehouseProductKind,
  WarehouseProductStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PermissionGuard } from '../src/access/permission.guard';
import { StoreAccessService } from '../src/access/store-access.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { CurrencyService } from '../src/currency/currency.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ItemValueController } from '../src/warehouse/item-value.controller';
import { ItemValueService } from '../src/warehouse/item-value.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';
import type { ItemValueListDto } from '../src/warehouse/dto/item-value.dto';

const url = process.env.ITEM_VALUE_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
type TestRequest = {
  headers: Record<string, string>;
  user?: { userId: string };
};

postgres('Item Value real PostgreSQL HTTP workflow', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let server: Server;
  const users: string[] = [];
  const catalog: string[] = [];
  const categories: string[] = [];
  let owner: string;
  let other: string;
  let store: string;
  const convert = jest.fn();

  async function user() {
    const value = await db.user.create({
      data: { phone: 'item-value-test-' + randomUUID() },
    });
    users.push(value.id);
    return value.id;
  }
  async function freshStore(userId: string) {
    const value = await db.store.create({
      data: {
        userId,
        ownerName: 'QA',
        businessName: 'QA Item Value',
        address: 'QA',
        city: 'QA',
        country: 'Morocco',
        baseCurrency: 'MAD',
      },
    });
    await db.user.update({
      where: { id: userId },
      data: { activeStoreId: value.id },
    });
    return value.id;
  }
  const balances = (
    values: Array<{
      onHand: number;
      reserved?: number;
      damaged?: number;
      incoming?: number;
    }>,
    storeId: string,
  ) => ({
    create: values.map((value) => ({
      ...value,
      location: { create: { storeId, name: 'QA', code: randomUUID() } },
    })),
  });
  async function product(
    name: string,
    cost: string,
    amounts: Parameters<typeof balances>[0],
    options: {
      storeId?: string;
      kind?: WarehouseProductKind;
      status?: WarehouseProductStatus;
    } = {},
  ) {
    const storeId = options.storeId ?? store;
    const p = await db.warehouseProduct.create({
      data: {
        storeId,
        name,
        kind: options.kind ?? 'STANDARD',
        status: options.status ?? 'ACTIVE',
        variants: {
          create: { storeId, title: 'Default', price: 20, costPrice: cost },
        },
      },
      include: { variants: true },
    });
    return db.inventoryItem.create({
      data: {
        storeId,
        kind: 'PRODUCT_VARIANT',
        variantId: p.variants[0].id,
        balances: balances(amounts, storeId),
      },
    });
  }
  async function packaging(name: string, quantity: number) {
    const material = await db.packagingMaterial.create({
      data: { storeId: store, name },
    });
    const item = await db.inventoryItem.create({
      data: {
        storeId: store,
        kind: 'PACKAGING_MATERIAL',
        packagingMaterialId: material.id,
        balances: balances([{ onHand: quantity }], store),
      },
    });
    return { material, item };
  }
  async function purchase(
    materialId: string,
    totalCost: string,
    quantity: number,
    currency = 'MAD',
    date = new Date(),
  ) {
    return db.merchantPurchase.create({
      data: {
        storeId: store,
        source: 'MANUAL',
        packagingMaterialId: materialId,
        productName: 'QA packaging',
        unitLabel: 'piece',
        quantity,
        unitPrice:
          quantity > 0 ? new Prisma.Decimal(totalCost).div(quantity) : 0,
        totalCost,
        currency,
        purchaseDate: date,
      },
    });
  }
  const get = (query = '', identity = owner) =>
    request(server)
      .get('/warehouse/item-value' + query)
      .set('x-test-user', identity);
  const body = (response: { body: unknown }) =>
    response.body as ItemValueListDto;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      !/test|_ci$/.test(parsed.pathname)
    )
      throw Error('Item Value tests require a disposable local test database');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    owner = await user();
    other = await user();
    const module = await Test.createTestingModule({
      controllers: [ItemValueController],
      providers: [
        ItemValueService,
        WarehouseStoreService,
        StoreAccessService,
        PermissionGuard,
        { provide: PrismaService, useValue: db },
        { provide: CurrencyService, useValue: { convertOrNull: convert } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<TestRequest>();
          const id = req.headers['x-test-user'];
          if (!id || !users.includes(id)) throw new UnauthorizedException();
          req.user = { userId: id };
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
    store = await freshStore(owner);
    convert.mockReset().mockResolvedValue(null);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.shopProduct.deleteMany({ where: { id: { in: catalog } } });
      await db.shopCategory.deleteMany({ where: { id: { in: categories } } });
      await db.$disconnect();
    }
  });

  it('returns a complete empty snapshot with no cacheable merchant data', async () => {
    const r = await get().expect(200);
    expect(body(r)).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      summary: {
        currency: 'MAD',
        complete: true,
        knownOnHandValue: '0.00',
        onHandUnits: 0,
      },
    });
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(Number.isNaN(Date.parse(body(r).summary.asOf))).toBe(false);
  });

  it('values archived physical stock across locations, excludes incoming-only stock and virtual bundles', async () => {
    await product('A product', '12.50', [
      { onHand: 5, reserved: 1, damaged: 1 },
      { onHand: 3 },
    ]);
    await product('Archived', '2', [{ onHand: 2 }], { status: 'ARCHIVED' });
    await product('Incoming only', '8', [{ onHand: 0, incoming: 20 }]);
    await product('Virtual pack', '99', [{ onHand: 5 }], { kind: 'BUNDLE' });
    const b = body(await get().expect(200));
    expect(b.items.map((x) => x.name)).toEqual(['A product', 'Archived']);
    expect(b.summary).toMatchObject({
      onHandUnits: 10,
      availableUnits: 8,
      reservedUnits: 1,
      damagedUnits: 1,
      knownOnHandValue: '104.00',
      knownAvailableValue: '79.00',
      knownReservedValue: '12.50',
      knownDamagedValue: '12.50',
      complete: true,
    });
  });

  it('keeps legacy zero product costs and unpurchased packaging explicitly unknown', async () => {
    await product('Imported unknown', '0', [{ onHand: 4 }]);
    await packaging('Unpriced box', 2);
    const b = body(await get().expect(200));
    expect(
      b.items.every((x) => x.unitCost === null && x.onHandValue === null),
    ).toBe(true);
    expect(b.summary).toMatchObject({
      knownOnHandValue: '0.00',
      unvaluedItemCount: 2,
      unvaluedOnHandUnits: 6,
      complete: false,
    });
  });

  it('uses the latest purchase date rather than the last inserted historical record', async () => {
    const { material } = await packaging('Purchased box', 6);
    await purchase(material.id, '18', 6, 'MAD', new Date('2026-10-20'));
    await purchase(material.id, '60', 6, 'MAD', new Date('2026-09-01'));
    const b = body(await get().expect(200));
    expect(b.items[0]).toMatchObject({
      unitCost: '3.0000',
      onHandValue: '18.00',
    });
  });

  it('does not replace an invalid latest purchase with an older known cost', async () => {
    const { material } = await packaging('Invalid latest quantity', 2);
    await purchase(material.id, '8', 2, 'MAD', new Date('2026-09-01'));
    await purchase(material.id, '10', 0, 'MAD', new Date('2026-10-20'));
    const b = body(await get().expect(200));
    expect(b.items[0].unitCost).toBeNull();
    expect(b.summary.complete).toBe(false);
  });

  it('treats a fully discounted purchase as known zero without an FX request', async () => {
    const { material } = await packaging('Free box', 4);
    await purchase(material.id, '0', 4, 'EUR');
    const b = body(await get().expect(200));
    expect(b.items[0]).toMatchObject({
      unitCost: '0.0000',
      onHandValue: '0.00',
    });
    expect(b.summary.complete).toBe(true);
    expect(convert).not.toHaveBeenCalled();
  });

  it.each(['variant', 'product'] as const)(
    'uses legacy Shop %s links and actual paid totals without a packaging FK',
    async (mode) => {
      const category = await db.shopCategory.create({
        data: { name: 'QA', slug: randomUUID() },
      });
      categories.push(category.id);
      const p = await db.shopProduct.create({
        data: {
          name: 'QA',
          slug: randomUUID(),
          categoryId: category.id,
          price: 100,
          variants: { create: {} },
        },
        include: { variants: true },
      });
      catalog.push(p.id);
      const { material } = await packaging('Shop box', 4);
      await db.packagingMaterial.update({
        where: { id: material.id },
        data: {
          zomaalShopVariantId: mode === 'variant' ? p.variants[0].id : p.id,
        },
      });
      await purchase(material.id, '40', 2, 'MAD', new Date('2026-09-01'));
      const order = await db.shopOrder.create({
        data: {
          storeId: store,
          status: 'DELIVERED',
          paymentMethod: 'COD',
          currency: 'MAD',
          subtotal: 200,
          discount: 194,
          total: 6,
          shipLabel: 'QA',
          shipName: 'QA',
          shipPhone: 'QA',
          shipCountry: 'Morocco',
          shipCity: 'QA',
          shipAddress: 'QA',
        },
      });
      const line = await db.shopOrderItem.create({
        data: {
          orderId: order.id,
          productId: p.id,
          variantId: mode === 'variant' ? p.variants[0].id : null,
          productName: 'QA',
          unitLabel: 'piece',
          unitPrice: 100,
          quantity: 2,
          lineTotal: 200,
        },
      });
      await db.merchantPurchase.create({
        data: {
          storeId: store,
          source: 'SHOP',
          shopOrderItemId: line.id,
          productName: 'QA',
          unitLabel: 'piece',
          quantity: 2,
          unitPrice: 3,
          totalCost: 6,
          currency: 'MAD',
          purchaseDate: new Date('2026-10-20'),
        },
      });
      const b = body(await get().expect(200));
      expect(b.items[0]).toMatchObject({
        unitCost: '3.0000',
        onHandValue: '12.00',
      });
    },
  );

  it('applies an actual supplied FX quote and reports a missing quote as incomplete', async () => {
    const { material } = await packaging('FX box', 4);
    await purchase(material.id, '10', 2, 'EUR');
    convert.mockResolvedValue(new Prisma.Decimal(11));
    expect(body(await get().expect(200)).summary.knownOnHandValue).toBe(
      '220.00',
    );
    convert.mockResolvedValue(null);
    const b = body(await get().expect(200));
    expect(b.items[0].unitCost).toBeNull();
    expect(b.summary.complete).toBe(false);
  });

  it('returns stable pagination with summary over all filtered items', async () => {
    await product('B', '2', [{ onHand: 3 }]);
    await product('A', '3', [{ onHand: 2 }]);
    const { material } = await packaging('C', 4);
    await purchase(material.id, '8', 4);
    const first = body(await get('?limit=1&page=1').expect(200));
    const second = body(await get('?limit=1&page=2').expect(200));
    expect(first.items[0].name).toBe('A');
    expect(second.items[0].name).toBe('B');
    expect(first.summary.knownOnHandValue).toBe('20.00');
    expect(second.summary.knownOnHandValue).toBe('20.00');
    const filtered = body(await get('?kind=PACKAGING_MATERIAL').expect(200));
    expect(filtered.total).toBe(1);
    expect(filtered.summary.knownOnHandValue).toBe('8.00');
    const beyond = body(await get('?page=9007199254740991').expect(200));
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(3);
    expect(beyond.summary.knownOnHandValue).toBe('20.00');
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1junk',
    'page=1e2',
    'page=0x10',
    'page=9007199254740993',
    'limit=0',
    'limit=101',
    'limit=2junk',
    'kind=UNKNOWN',
    'storeId=foreign',
    'page=1&page=2',
  ])('rejects malformed query %s', async (query) => {
    await get('?' + query).expect(400);
  });

  it('never exposes another merchant or changes business rows while reading', async () => {
    const own = await product('Own', '2', [{ onHand: 3 }]);
    const foreignStore = await freshStore(other);
    await product('Foreign', '999', [{ onHand: 100 }], {
      storeId: foreignStore,
    });
    const before = await db.inventoryBalance.findMany({
      where: { inventoryItem: { storeId: store } },
    });
    const b = body(await get().expect(200));
    expect(b.items.map((x) => x.id)).toEqual([own.id]);
    expect(b.summary.knownOnHandValue).toBe('6.00');
    expect(
      await db.inventoryBalance.findMany({
        where: { inventoryItem: { storeId: store } },
      }),
    ).toEqual(before);
    expect(
      await db.inventoryMovement.count({
        where: { inventoryItem: { storeId: store } },
      }),
    ).toBe(0);
  });

  it('never uses another store purchase even if an old record points at this material', async () => {
    const { material } = await packaging('Own unpriced box', 2);
    const foreignStore = await freshStore(other);
    await db.merchantPurchase.create({
      data: {
        storeId: foreignStore,
        source: 'MANUAL',
        packagingMaterialId: material.id,
        productName: 'Foreign legacy row',
        unitLabel: 'piece',
        quantity: 2,
        unitPrice: 999,
        totalCost: 1998,
        currency: 'MAD',
        purchaseDate: new Date(),
      },
    });
    const b = body(await get().expect(200));
    expect(b.items[0].unitCost).toBeNull();
    expect(b.summary).toMatchObject({
      knownOnHandValue: '0.00',
      complete: false,
    });
  });

  it('follows the owner active store but keeps permitted staff on their assigned store', async () => {
    await product('Assigned', '2', [{ onHand: 3 }]);
    const assigned = store;
    const staff = await user();
    const membership = await db.staffMember.create({
      data: {
        name: 'QA viewer',
        userId: staff,
        storeId: assigned,
        permissionOverrides: ['products.view'],
      },
    });
    const second = await freshStore(owner);
    expect(body(await get().expect(200)).items).toEqual([]);
    expect(body(await get('', staff).expect(200)).items[0].name).toBe(
      'Assigned',
    );
    await db.staffMember.update({
      where: { id: membership.id },
      data: { permissionOverrides: ['orders.view'] },
    });
    await get('', staff).expect(403);
    await db.staffMember.update({
      where: { id: membership.id },
      data: { permissionOverrides: ['products.view'], status: 'INACTIVE' },
    });
    await get('', staff).expect(403);
    expect(
      (await db.user.findUnique({ where: { id: owner } }))?.activeStoreId,
    ).toBe(second);
  });

  it('rejects missing authentication and returns 404 for a user without a store', async () => {
    await request(server).get('/warehouse/item-value').expect(401);
    await get('', await user()).expect(404);
  });
});
