import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PermissionGuard } from '../src/access/permission.guard';
import { StoreAccessService } from '../src/access/store-access.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { SubscriptionService } from '../src/billing/subscription.service';
import { StripeBillingService } from '../src/billing/stripe-billing.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfileMediaService } from '../src/profile-media/profile-media.service';
import { RolesController } from '../src/roles/roles.controller';
import { RolesService } from '../src/roles/roles.service';
import { StoresController } from '../src/stores/stores.controller';
import { StoresService } from '../src/stores/stores.service';
import { CategoryController } from '../src/warehouse/category.controller';
import { CategoryService } from '../src/warehouse/category.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';

const url = process.env.BACKEND_AUDIT_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
type TestRequest = {
  headers: Record<string, string>;
  user?: { userId: string };
};

postgres('Live audit regressions through HTTP and PostgreSQL', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let server: Server;
  let owner: string;
  let peer: string;
  let store: string;
  let role: string;
  let category: string;
  const users: string[] = [];
  const stores: string[] = [];
  const call = (
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    identity = owner,
  ) => request(server)[method](path).set('x-test-user', identity);

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      !/test|_ci$/.test(parsed.pathname)
    ) {
      throw Error(
        'Backend audit tests require a disposable local test database',
      );
    }
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({
        data: { phone: 'backend-audit-test-' + randomUUID() },
      });
      users.push(user.id);
    }
    [owner, peer] = users;
    const module = await Test.createTestingModule({
      controllers: [StoresController, RolesController, CategoryController],
      providers: [
        StoresService,
        RolesService,
        CategoryService,
        WarehouseStoreService,
        StoreAccessService,
        PermissionGuard,
        SubscriptionService,
        // Store/role/category auditing does not call the billing provider.
        { provide: StripeBillingService, useValue: {} },
        { provide: PrismaService, useValue: db },
        { provide: ConfigService, useValue: new ConfigService() },
        // This suite performs no uploads and does not call object storage.
        { provide: ProfileMediaService, useValue: {} },
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
    const otherStore = await call('post', '/stores', peer)
      .send({
        ownerName: 'QA peer',
        businessName: 'QA peer',
        address: 'QA',
        city: 'QA',
      })
      .expect(201);
    stores.push((otherStore.body as { id: string }).id);
  });
  beforeEach(async () => {
    const response = await call('post', '/stores')
      .send({
        ownerName: 'QA owner',
        businessName: 'QA Audit',
        address: 'QA',
        city: 'QA',
        baseCurrency: 'mad',
      })
      .expect(201);
    store = (response.body as { id: string }).id;
    stores.push(store);
    role = (
      await db.role.create({
        data: {
          storeId: store,
          name: 'QA role',
          permissions: ['products.view'],
        },
      })
    ).id;
    category = (
      await db.productCategory.create({
        data: {
          storeId: store,
          name: 'QA category',
          slug: 'qa',
          description: 'Before',
          isActive: true,
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.expense.deleteMany({ where: { storeId: { in: stores } } });
      await db.store.deleteMany({ where: { id: { in: stores } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  });

  it('does not relabel a recorded MAD expense or partially save a mixed settings update', async () => {
    const expenseCategory = await db.expenseCategory.findFirstOrThrow({
      where: { storeId: store, group: 'OTHER' },
    });
    const expense = await db.expense.create({
      data: {
        storeId: store,
        categoryId: expenseCategory.id,
        title: 'QA MAD expense',
        amount: 10,
        paymentMethod: 'CASH',
        spentAt: new Date(),
      },
    });
    const res = await call('put', '/stores/me')
      .send({ baseCurrency: 'USD', businessName: 'Must not persist' })
      .expect(409);
    expect(res.body).toMatchObject({ reason: 'STORE_CURRENCY_IMMUTABLE' });
    expect(
      await db.store.findUniqueOrThrow({ where: { id: store } }),
    ).toMatchObject({ baseCurrency: 'MAD', businessName: 'QA Audit' });
    expect(
      (
        await db.expense.findUniqueOrThrow({ where: { id: expense.id } })
      ).amount.toFixed(2),
    ).toBe('10.00');
  });
  it('also protects an empty store and accepts same-currency requests with ordinary settings', async () => {
    await call('put', '/stores/me').send({ baseCurrency: 'USD' }).expect(409);
    const res = await call('put', '/stores/me')
      .send({ baseCurrency: 'mad', businessName: '  Renamed  ' })
      .expect(200);
    expect(res.body).toMatchObject({
      baseCurrency: 'MAD',
      businessName: 'Renamed',
    });
  });
  it.each([
    'ownerName',
    'businessName',
    'address',
    'city',
    'country',
    'baseCurrency',
  ])('rejects null Store %s before PostgreSQL writes', async (field) => {
    const before = await db.store.findUniqueOrThrow({ where: { id: store } });
    await call('put', '/stores/me')
      .send({ [field]: null, city: field === 'city' ? null : 'Changed' })
      .expect(400);
    expect(await db.store.findUniqueOrThrow({ where: { id: store } })).toEqual(
      before,
    );
  });
  it.each(['name', 'permissions'])(
    'rejects null Role %s atomically',
    async (field) => {
      const before = await db.role.findUniqueOrThrow({ where: { id: role } });
      await call('patch', '/roles/' + role)
        .send({ [field]: null })
        .expect(400);
      expect(await db.role.findUniqueOrThrow({ where: { id: role } })).toEqual(
        before,
      );
    },
  );
  it.each(['name', 'isActive', 'position'])(
    'rejects null Category %s without mutation',
    async (field) => {
      const before = await db.productCategory.findUniqueOrThrow({
        where: { id: category },
      });
      await call('patch', '/warehouse/categories/' + category)
        .send({ [field]: null })
        .expect(400);
      expect(
        await db.productCategory.findUniqueOrThrow({ where: { id: category } }),
      ).toEqual(before);
    },
  );
  it('supports clearing an optional category description', async () => {
    await call('patch', '/warehouse/categories/' + category)
      .send({ description: null })
      .expect(200);
    expect(
      (await db.productCategory.findUniqueOrThrow({ where: { id: category } }))
        .description,
    ).toBeNull();
  });
  it('rejects category position overflow and permits the database integer maximum', async () => {
    await call('patch', '/warehouse/categories/' + category)
      .send({ position: 2147483648 })
      .expect(400);
    await call('patch', '/warehouse/categories/' + category)
      .send({ position: 2147483647 })
      .expect(200);
    expect(
      (await db.productCategory.findUniqueOrThrow({ where: { id: category } }))
        .position,
    ).toBe(2147483647);
  });
  it('rejects whitespace names and unknown ISO currencies on create and update', async () => {
    await call('put', '/stores/me').send({ businessName: '  ' }).expect(400);
    await call('post', '/stores')
      .send({ ownerName: 'QA', businessName: '  ', address: 'QA', city: 'QA' })
      .expect(400);
    await call('post', '/roles')
      .send({ name: '  ', permissions: [] })
      .expect(400);
    await call('patch', '/roles/' + role)
      .send({ name: '  ' })
      .expect(400);
    await call('post', '/warehouse/categories')
      .send({ name: '  ' })
      .expect(400);
    await call('put', '/stores/me').send({ baseCurrency: 'ZZZ' }).expect(400);
    await call('post', '/stores')
      .send({
        ownerName: 'QA',
        businessName: 'QA',
        address: 'QA',
        city: 'QA',
        baseCurrency: 'ZZZ',
      })
      .expect(400);
  });
  it('preserves real boolean semantics through the global pipe and actual category controller', async () => {
    await db.productCategory.update({
      where: { id: category },
      data: { isActive: false },
    });
    const hidden = await call(
      'get',
      '/warehouse/categories?includeInactive=false',
    ).expect(200);
    expect(
      (hidden.body as Array<{ id: string }>).some((c) => c.id === category),
    ).toBe(false);
    const shown = await call(
      'get',
      '/warehouse/categories?includeInactive=true',
    ).expect(200);
    expect(
      (shown.body as Array<{ id: string }>).some((c) => c.id === category),
    ).toBe(true);
    for (const value of [
      'invalid',
      '1',
      'TRUE',
      'false&includeInactive=true',
    ]) {
      await call(
        'get',
        '/warehouse/categories?includeInactive=' + value,
      ).expect(400);
    }
  });
  it('retains cross-store protection and missing-auth rejection', async () => {
    await call('patch', '/roles/' + role, peer)
      .send({ name: 'Forbidden' })
      .expect(404);
    await call('patch', '/warehouse/categories/' + category, peer)
      .send({ name: 'Forbidden' })
      .expect(404);
    await request(server)
      .put('/stores/me')
      .send({ city: 'Forbidden' })
      .expect(401);
  });
});
