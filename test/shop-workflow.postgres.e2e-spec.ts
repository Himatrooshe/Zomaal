import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { ShopController } from '../src/zomaal-shop/shop.controller';
import { ShopController as AdminCatalogController } from '../src/super-admin/shop/shop.controller';
import { ShopStorefrontAdminController } from '../src/super-admin/shop/shop-storefront-admin.controller';
import { StorefrontService } from '../src/zomaal-shop/storefront.service';
import { CartService } from '../src/zomaal-shop/cart.service';
import { AddressService } from '../src/zomaal-shop/address.service';
import { CheckoutService } from '../src/zomaal-shop/checkout.service';
import { ShopOrdersService } from '../src/zomaal-shop/shop-orders.service';
import { ShopSettingsService } from '../src/zomaal-shop/shop-settings.service';
import { ShopService } from '../src/super-admin/shop/shop.service';
import { ShopOrdersAdminService } from '../src/super-admin/shop/shop-orders-admin.service';
import { ShopBannersService } from '../src/super-admin/shop/shop-banners.service';
import { ShopPromoCodesService } from '../src/super-admin/shop/shop-promo-codes.service';
import { ActivityLogService } from '../src/super-admin/activity/activity-log.service';
import { PackagingService } from '../src/warehouse/packaging.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';
import {
  StoreAccessService,
  StoreAccess,
} from '../src/access/store-access.service';
import { PermissionGuard } from '../src/access/permission.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { SuperAdminJwtAuthGuard } from '../src/super-admin/guards/super-admin-jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { CurrencyService } from '../src/currency/currency.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { lockShopStore } from '../src/zomaal-shop/shop-lock.util';

const url = process.env.SHOP_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
postgres('Zomaal Shop live regressions with PostgreSQL', () => {
  let db: PrismaClient, pool: Pool, app: INestApplication, server: Server;
  let owner: string,
    store: string,
    second: string,
    category: string,
    product: string,
    addressId: string;
  let cart: CartService,
    addresses: AddressService,
    checkout: CheckoutService,
    orders: ShopOrdersService,
    settings: ShopSettingsService;
  const users: string[] = [],
    categories: string[] = [];
  const fx = { convertAmount: jest.fn() };
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    )
      throw new Error('Dedicated local Shop test DB required');
    pool = new Pool({ connectionString: url, max: 20 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const prisma = db as PrismaService,
      access = new StoreAccessService(prisma);
    settings = new ShopSettingsService(prisma);
    cart = new CartService(prisma, settings);
    addresses = new AddressService(prisma);
    const packaging = new PackagingService(
      prisma,
      new WarehouseStoreService(access),
      {} as never,
    );
    orders = new ShopOrdersService(
      prisma,
      packaging,
      fx as unknown as CurrencyService,
    );
    checkout = new CheckoutService(prisma, settings, cart, addresses, orders);
    const storefront = new StorefrontService(prisma, settings);
    const adminOrders = new ShopOrdersAdminService(
      prisma,
      orders,
      activity as unknown as ActivityLogService,
    );
    const catalog = new ShopService(
      prisma,
      {} as never,
      activity as unknown as ActivityLogService,
    );
    const module = await Test.createTestingModule({
      controllers: [
        ShopController,
        AdminCatalogController,
        ShopStorefrontAdminController,
      ],
      providers: [
        PermissionGuard,
        { provide: StoreAccessService, useValue: access },
        { provide: StorefrontService, useValue: storefront },
        { provide: CartService, useValue: cart },
        { provide: AddressService, useValue: addresses },
        { provide: CheckoutService, useValue: checkout },
        { provide: ShopOrdersService, useValue: orders },
        { provide: ShopSettingsService, useValue: settings },
        { provide: ShopService, useValue: catalog },
        { provide: ShopOrdersAdminService, useValue: adminOrders },
        { provide: ActivityLogService, useValue: activity },
        { provide: ShopBannersService, useValue: {} },
        { provide: ShopPromoCodesService, useValue: {} },
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
      .overrideGuard(SuperAdminJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });
  beforeEach(async () => {
    owner = (await db.user.create({ data: { phone: `shop-${randomUUID()}` } }))
      .id;
    users.push(owner);
    const data = {
      userId: owner,
      ownerName: 'QA',
      businessName: 'Shop tests',
      address: 'Test',
      city: 'Test',
      country: 'Morocco',
      baseCurrency: 'MAD',
    };
    store = (await db.store.create({ data })).id;
    second = (await db.store.create({ data })).id;
    await db.user.update({
      where: { id: owner },
      data: { activeStoreId: store },
    });
    category = (
      await db.shopCategory.create({ data: { name: 'QA', slug: randomUUID() } })
    ).id;
    categories.push(category);
    product = (
      await db.shopProduct.create({
        data: {
          categoryId: category,
          name: 'Boxes',
          slug: randomUUID(),
          price: '12.50',
          stock: 100,
          status: 'ACTIVE',
        },
      })
    ).id;
    addressId = (await addresses.create(store, address())).id;
    await settings.update({
      currency: 'MAD',
      deliveryFee: 0,
      freeDeliveryMinSubtotal: null,
      codEnabled: true,
      codCancellationLimit: 3,
      codCancellationWindowDays: 90,
    });
    fx.convertAmount
      .mockReset()
      .mockImplementation(
        (amount: Prisma.Decimal.Value, from: string, to: string) =>
          Promise.resolve(
            new Prisma.Decimal(amount).times(from === to ? 1 : 2),
          ),
      );
  });
  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItem: { store: { userId: { in: users } } } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.shopProduct.deleteMany({
        where: { categoryId: { in: categories } },
      });
      await db.shopCategory.deleteMany({ where: { id: { in: categories } } });
      await db.shopPromoCode.deleteMany({
        where: { code: { startsWith: 'SHOPTEST_' } },
      });
      await db.$disconnect();
    }
    await pool?.end();
  });
  function address() {
    return {
      label: 'Home',
      fullName: 'QA Tester',
      phone: '+212600000001',
      country: 'Morocco',
      city: 'Casablanca',
      address: 'Synthetic address',
    };
  }
  function access(id = store): StoreAccess {
    return {
      storeId: id,
      userId: owner,
      baseCurrency: 'MAD',
      isOwner: true,
      staffMemberId: null,
      permissions: [],
    };
  }
  async function place(id = store, addr = addressId, promoCode?: string) {
    return checkout.placeOrder(access(id), {
      addressId: addr,
      paymentMethod: 'COD',
      promoCode,
    });
  }
  async function seed(
    quantity = 2,
    id = store,
    pid = product,
    variantId?: string,
  ) {
    await cart.addItem(id, { productId: pid, quantity, variantId });
  }
  async function deliver(promoCode?: string) {
    await seed();
    const o = await place(store, addressId, promoCode);
    await orders.advance(o.id, 'DELIVERED');
    return o;
  }
  async function promo(extra: Partial<Prisma.ShopPromoCodeCreateInput> = {}) {
    return db.shopPromoCode.create({
      data: {
        code: `SHOPTEST_${randomUUID().slice(0, 12)}`.toUpperCase(),
        type: 'PERCENT',
        value: 50,
        ...extra,
      },
    });
  }

  it.each(['label', 'fullName', 'country', 'city', 'address'])(
    'rejects whitespace address %s',
    async (field) => {
      await request(server)
        .post('/shop/addresses')
        .send({ ...address(), [field]: '   ' })
        .expect(400);
    },
  );
  it.each([
    'label',
    'fullName',
    'phone',
    'country',
    'city',
    'address',
    'isDefault',
  ])('rejects PATCH null %s without writing', async (field) => {
    await request(server)
      .patch(`/shop/addresses/${addressId}`)
      .send({ [field]: null })
      .expect(400);
    expect((await addresses.require(store, addressId)).fullName).toBe(
      'QA Tester',
    );
  });
  it('keeps omitted optional fields and accepts trimmed valid addresses', async () => {
    const res = await request(server)
      .patch(`/shop/addresses/${addressId}`)
      .send({ fullName: '  Changed  ' })
      .expect(200);
    expect((res.body as { fullName: string }).fullName).toBe('Changed');
    expect((res.body as { phone: string }).phone).toBe(address().phone);
  });
  it.each([
    '/shop/products?page=999999999999999999999',
    '/admin/shop/orders?page=999999999999999999999',
  ])('rejects unsafe pagination %s', async (path) => {
    await request(server).get(path).expect(400);
  });
  it('treats oversized numeric order search as a safe unmatched search', async () => {
    const res = await request(server)
      .get('/admin/shop/orders?search=999999999999999999999')
      .expect(200);
    expect((res.body as { total: number }).total).toBe(0);
  });
  it.each([{ stock: 2147483648 }, { price: 1e16 }, { compareAtPrice: 1e16 }])(
    'rejects catalog persistence overflow %j',
    async (body) => {
      await request(server)
        .patch(`/admin/shop/products/${product}`)
        .send(body)
        .expect(400);
      expect(
        (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
          .stock,
      ).toBe(100);
    },
  );
  it('rejects variant stock overflow and combined overflow', async () => {
    await request(server)
      .put(`/admin/shop/products/${product}/variants`)
      .send({ variants: [{ size: 'M', stock: 2147483648 }] })
      .expect(400);
    await request(server)
      .put(`/admin/shop/products/${product}/variants`)
      .send({
        variants: [
          { size: 'M', stock: 2147483647 },
          { size: 'L', stock: 1 },
        ],
      })
      .expect(400);
  });
  it('rejects computed order overflow in preview and place with no side effects', async () => {
    await db.shopProduct.update({
      where: { id: product },
      data: { price: '1000000000000', stock: 10000 },
    });
    await seed(10000);
    await request(server).post('/shop/checkout/preview').send({}).expect(400);
    await request(server)
      .post('/shop/orders')
      .send({ addressId, paymentMethod: 'COD' })
      .expect(400);
    expect(await db.shopOrder.count({ where: { storeId: store } })).toBe(0);
    expect(await db.shopCartItem.count({ where: { storeId: store } })).toBe(1);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(10000);
  });
  it('deducts order discount from purchases and expenses', async () => {
    const p = await promo();
    await deliver(p.code);
    const pu = await db.merchantPurchase.findFirstOrThrow({
      where: { storeId: store },
      include: { expense: true },
    });
    expect(pu.totalCost.toFixed(2)).toBe('12.50');
    expect(pu.unitPrice.toFixed(2)).toBe('6.25');
    expect(pu.expense!.amount.toFixed(2)).toBe('12.50');
    const material = await db.packagingMaterial.findFirstOrThrow({
      where: { storeId: store },
    });
    expect(material).toBeDefined();
  });
  it('allocates discount + delivery cents exactly over multiple items', async () => {
    const p = await promo({ type: 'FIXED', value: '0.01' });
    await settings.update({ deliveryFee: 2 });
    const other = await db.shopProduct.create({
      data: {
        categoryId: category,
        name: 'Other',
        slug: randomUUID(),
        price: '0.01',
        stock: 10,
        status: 'ACTIVE',
      },
    });
    await seed(1);
    await seed(1, store, other.id);
    const o = await place(store, addressId, p.code);
    await orders.advance(o.id, 'DELIVERED');
    const rows = await db.merchantPurchase.findMany({
      where: { storeId: store },
      include: { expense: true },
    });
    expect(
      rows
        .reduce((n, p) => n.plus(p.totalCost), new Prisma.Decimal(0))
        .toFixed(2),
    ).toBe(o.total);
    expect(
      rows
        .reduce((n, p) => n.plus(p.expense!.amount), new Prisma.Decimal(0))
        .toFixed(2),
    ).toBe(o.total);
  });
  it('supports fully discounted zero-cost delivery without a positive fabricated cost', async () => {
    const p = await promo({ value: 100 });
    await deliver(p.code);
    const pu = await db.merchantPurchase.findFirstOrThrow({
      where: { storeId: store },
      include: { expense: true },
    });
    expect(pu.totalCost.isZero()).toBe(true);
    expect(pu.expense!.amount.isZero()).toBe(true);
  });
  it('converts actual acquisition cost to base currency and preserves source purchase currency', async () => {
    await db.store.update({
      where: { id: store },
      data: { baseCurrency: 'BDT' },
    });
    const p = await promo();
    await deliver(p.code);
    const pu = await db.merchantPurchase.findFirstOrThrow({
      where: { storeId: store },
      include: { expense: true },
    });
    expect(pu.currency).toBe('MAD');
    expect(pu.totalCost.toFixed(2)).toBe('12.50');
    expect(pu.expense!.amount.toFixed(2)).toBe('25.00');
  });
  it('FX unavailable leaves order undelivered and creates no purchases or expenses', async () => {
    await seed();
    const o = await place();
    fx.convertAmount.mockRejectedValueOnce(
      new ServiceUnavailableException('No real FX'),
    );
    await expect(orders.advance(o.id, 'DELIVERED')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(
      (await db.shopOrder.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe('PENDING');
    expect(await db.merchantPurchase.count({ where: { storeId: store } })).toBe(
      0,
    );
    expect(await db.expense.count({ where: { storeId: store } })).toBe(0);
  });
  it('FX overflow rolls back delivery atomically', async () => {
    await seed();
    const o = await place();
    fx.convertAmount.mockResolvedValueOnce(new Prisma.Decimal('1e16'));
    await expect(orders.advance(o.id, 'DELIVERED')).rejects.toThrow(/range/);
    expect(
      (await db.shopOrder.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe('PENDING');
    expect(await db.expense.count({ where: { storeId: store } })).toBe(0);
  });
  it('detects store currency change during the preflight FX lookup', async () => {
    await seed();
    const o = await place();
    fx.convertAmount.mockImplementationOnce(async () => {
      await db.store.update({
        where: { id: store },
        data: { baseCurrency: 'BDT' },
      });
      return new Prisma.Decimal(1);
    });
    await expect(orders.advance(o.id, 'DELIVERED')).rejects.toThrow(
      /currency changed/,
    );
    expect(
      (await db.shopOrder.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe('PENDING');
  });
  it('parallel initial cart adds merge once and existing increments are all retained', async () => {
    await Promise.all(Array.from({ length: 8 }, () => seed(1)));
    let rows = await db.shopCartItem.findMany({ where: { storeId: store } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(8);
    await Promise.all(Array.from({ length: 8 }, () => seed(1)));
    rows = await db.shopCartItem.findMany({ where: { storeId: store } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(16);
  });
  it('merges historical duplicate cart rows preserving their total quantity', async () => {
    await db.shopCartItem.createMany({
      data: [1, 2].map((quantity) => ({
        storeId: store,
        productId: product,
        quantity,
      })),
    });
    await seed(1);
    const rows = await db.shopCartItem.findMany({ where: { storeId: store } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(4);
  });
  it('concurrent default addresses and switches preserve one default', async () => {
    await db.shopAddress.deleteMany({ where: { storeId: store } });
    const rows = await Promise.all(
      Array.from({ length: 8 }, () =>
        addresses.create(store, { ...address(), isDefault: false }),
      ),
    );
    expect(
      await db.shopAddress.count({
        where: { storeId: store, isDefault: true },
      }),
    ).toBe(1);
    await Promise.all(
      rows.map((row) => addresses.update(store, row.id, { isDefault: true })),
    );
    expect(
      await db.shopAddress.count({
        where: { storeId: store, isDefault: true },
      }),
    ).toBe(1);
    await Promise.all(
      rows.slice(0, 7).map((row) => addresses.remove(store, row.id)),
    );
    expect(
      await db.shopAddress.count({
        where: { storeId: store, isDefault: true },
      }),
    ).toBe(1);
  });
  it('repairs historical multiple defaults on next address mutation', async () => {
    await db.shopAddress.create({
      data: { storeId: store, ...address(), isDefault: true },
    });
    await addresses.update(store, addressId, { label: 'Changed' });
    expect(
      await db.shopAddress.count({
        where: { storeId: store, isDefault: true },
      }),
    ).toBe(1);
  });
  it('double checkout creates one order and reserves stock once', async () => {
    await seed();
    const results = await Promise.allSettled([place(), place()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.shopOrder.count({ where: { storeId: store } })).toBe(1);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(98);
  });
  it('cart update and checkout serialize without using a stale quantity', async () => {
    await seed(1);
    const row = await db.shopCartItem.findFirstOrThrow({
      where: { storeId: store },
    });
    await Promise.allSettled([cart.updateItem(store, row.id, 3), place()]);
    const o = await db.shopOrder.findFirstOrThrow({
      where: { storeId: store },
      include: { items: true },
    });
    expect([1, 3]).toContain(o.items[0].quantity);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(100 - o.items[0].quantity);
  });
  it('parallel variant orders and cancels preserve parent stock sum', async () => {
    const variants = await Promise.all(
      ['M', 'L'].map((size) =>
        db.shopProductVariant.create({
          data: { productId: product, size, stock: 50 },
        }),
      ),
    );
    const a = await addresses.create(second, address());
    await seed(1, store, product, variants[0].id);
    await seed(1, second, product, variants[1].id);
    const oo = await Promise.all([place(), place(second, a.id)]);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(98);
    await Promise.all(
      oo.map((o) => orders.cancel(o.id, 'ADMIN', 'Test', ['PENDING'])),
    );
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(100);
    expect(
      (
        await db.shopProductVariant.aggregate({
          where: { productId: product },
          _sum: { stock: true },
        })
      )._sum.stock,
    ).toBe(100);
  });
  it('last-stock competing stores cannot oversell', async () => {
    await db.shopProduct.update({ where: { id: product }, data: { stock: 1 } });
    const a = await addresses.create(second, address());
    await seed(1);
    await seed(1, second);
    const rr = await Promise.allSettled([place(), place(second, a.id)]);
    expect(rr.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(0);
  });
  it('cancel and delivery cannot both win or duplicate stock/expense', async () => {
    await seed();
    const o = await place();
    await Promise.allSettled([
      orders.cancel(o.id, 'MERCHANT', 'QA', ['PENDING']),
      orders.advance(o.id, 'DELIVERED'),
    ]);
    const current = await db.shopOrder.findUniqueOrThrow({
        where: { id: o.id },
      }),
      count = await db.expense.count({ where: { storeId: store } });
    expect(count).toBe(current.status === 'DELIVERED' ? 1 : 0);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(current.status === 'DELIVERED' ? 98 : 100);
  });
  it('ALL tab wins over exact status and repeated delivery does not duplicate purchase', async () => {
    const o = await deliver();
    await expect(orders.advance(o.id, 'DELIVERED')).rejects.toThrow();
    const list = await orders.listForStore(store, {
      tab: 'ALL',
      status: 'CANCELLED',
    });
    expect(list.map((x) => x.id)).toContain(o.id);
    expect(await db.merchantPurchase.count({ where: { storeId: store } })).toBe(
      1,
    );
  });
  it('per-store and global promo use is restored once on simultaneous cancel', async () => {
    const p = await promo({ usageLimit: 1, perStoreLimit: 1 });
    await seed();
    const o = await place(store, addressId, p.code);
    await Promise.allSettled([
      orders.cancel(o.id, 'MERCHANT', 'QA', ['PENDING']),
      orders.cancel(o.id, 'MERCHANT', 'QA', ['PENDING']),
    ]);
    expect(
      (await db.shopPromoCode.findUniqueOrThrow({ where: { id: p.id } }))
        .usedCount,
    ).toBe(0);
    expect(
      (await db.shopProduct.findUniqueOrThrow({ where: { id: product } }))
        .stock,
    ).toBe(100);
  });
  it('store locking leaves other stores independent', async () => {
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((r) => (ready = r)),
      gate = new Promise<void>((r) => (release = r));
    const tx = db.$transaction(
      async (t) => {
        await lockShopStore(t, store);
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await held;
    try {
      await addresses.create(second, address());
    } finally {
      release();
      await tx;
    }
  });
});
