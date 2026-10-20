import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { StoreAccessService } from '../src/access/store-access.service';
import { PermissionGuard } from '../src/access/permission.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { PrismaService } from '../src/prisma/prisma.service';
import { PackagingController } from '../src/warehouse/packaging.controller';
import { PackagingService } from '../src/warehouse/packaging.service';
import { InventoryController } from '../src/warehouse/inventory.controller';
import { InventoryService } from '../src/warehouse/inventory.service';
import { MediaService } from '../src/warehouse/media.service';
import { WarehouseStoreService } from '../src/warehouse/warehouse-store.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationEvaluatorService } from '../src/notifications/notification-evaluator.service';
import { PackagingOwnerAlertService } from '../src/notifications/packaging-owner-alert.service';
import { NotificationsController } from '../src/notifications/notifications.controller';
import { MetaGraphError } from '../src/whatsapp/meta-whatsapp-api.service';
import { NotificationType } from '../src/notifications/notification-type';

const url = process.env.PACKAGING_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
postgres('Packaging fixes with PostgreSQL', () => {
  let db: PrismaClient, pool: Pool, app: INestApplication, server: Server;
  let storeId: string, owner: string, foreignOwner: string;
  let stores: WarehouseStoreService, packaging: PackagingService;
  let notifications: NotificationsService, alerts: PackagingOwnerAlertService;
  let config: ConfigService;
  const cloudDelete = jest.fn().mockResolvedValue(undefined);
  const meta = {
    isEnabled: jest.fn().mockReturnValue(false),
    listTemplates: jest.fn(),
    sendTemplate: jest.fn(),
  };
  const users: string[] = [];
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    )
      throw new Error('Dedicated local packaging test DB required');
    pool = new Pool({ connectionString: url, max: 10 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: { phone: i ? `packaging-${randomUUID()}` : '+8801798200654' },
          })
        ).id,
      );
    [owner, foreignOwner] = users;
    const store = await db.store.create({
      data: {
        userId: owner,
        ownerName: 'QA',
        businessName: 'Packaging test',
        address: 'Test',
        city: 'Test',
        country: 'Morocco',
        baseCurrency: 'MAD',
      },
    });
    storeId = store.id;
    const prisma = db as PrismaService;
    const access = new StoreAccessService(prisma);
    stores = new WarehouseStoreService(access);
    const media = {
      deleteAttachedAsset: async (id: string) => {
        await db.mediaAsset.delete({ where: { id } });
        await cloudDelete(id);
      },
    };
    packaging = new PackagingService(prisma, stores, media as never);
    notifications = new NotificationsService(prisma, {
      isEnabled: false,
    } as never);
    config = new ConfigService({
      PACKAGING_OWNER_WHATSAPP_TEMPLATE: 'inventory_alert',
      PACKAGING_OWNER_WHATSAPP_LANGUAGE: 'fr',
    });
    alerts = new PackagingOwnerAlertService(
      prisma,
      config,
      meta as never,
      { decrypt: () => 'test-only-token' } as never,
    );
    const evaluator = new NotificationEvaluatorService(
      prisma,
      notifications,
      {} as never,
      alerts,
    );
    const module = await Test.createTestingModule({
      controllers: [
        PackagingController,
        InventoryController,
        NotificationsController,
      ],
      providers: [
        PermissionGuard,
        { provide: PackagingService, useValue: packaging },
        {
          provide: InventoryService,
          useValue: new InventoryService(prisma, stores),
        },
        { provide: MediaService, useValue: media },
        { provide: StoreAccessService, useValue: access },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationEvaluatorService, useValue: evaluator },
        { provide: PackagingOwnerAlertService, useValue: alerts },
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
    await db.whatsAppConnection.create({
      data: {
        storeId,
        wabaId: 'qa-waba',
        phoneNumberId: 'qa-number',
        encryptedAccessToken: 'test-only',
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.inventoryMovement.deleteMany({
        where: { inventoryItem: { storeId } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
    await pool?.end();
  });
  beforeEach(async () => {
    await db.packagingOwnerAlert.updateMany({
      where: { notification: { storeId } },
      data: { status: 'CANCELLED' },
    });
    meta.isEnabled.mockReturnValue(false);
    meta.listTemplates
      .mockReset()
      .mockResolvedValue([
        { name: 'inventory_alert', language: 'fr', status: 'APPROVED' },
      ]);
    meta.sendTemplate
      .mockReset()
      .mockImplementation(() => Promise.resolve({ messageId: randomUUID() }));
    config.set('PACKAGING_OWNER_WHATSAPP_TEMPLATE', 'inventory_alert');
  });
  async function material() {
    return packaging.create(owner, {
      name: `QA ${randomUUID()}`,
      openingStock: 10,
      minimumLevel: 10,
      lowStockAlert: true,
    });
  }
  async function upload() {
    return db.mediaAsset.create({
      data: {
        storeId,
        objectName: `test/${randomUUID()}`,
        purpose: 'PACKAGING',
        status: 'TEMPORARY',
        expiresAt: new Date(Date.now() + 60000),
        originalName: 'qa.png',
        contentType: 'image/png',
        sizeBytes: 1,
        checksum: 'test-only',
      },
    });
  }
  async function notice() {
    const m = await material();
    const n = await notifications.raise({
      storeId,
      type: NotificationType.LOW_STOCK,
      title: 'Low stock',
      entityType: 'PACKAGING_MATERIAL',
      entityId: m.id,
      dedupeKey: `LOW_STOCK:${m.id}`,
    });
    await alerts.syncStore(storeId);
    // Dispatch assertions require an already-due job, independent of the
    // millisecond rounding of PostgreSQL timestamp defaults.
    await db.packagingOwnerAlert.update({
      where: { notificationId: n!.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    return { m, n: n! };
  }
  async function queue(notificationId: string) {
    return db.packagingOwnerAlert.findUniqueOrThrow({
      where: { notificationId },
    });
  }
  it('replays the same image successfully without deleting it; metadata is still updated', async () => {
    const m = await material(),
      image = await upload();
    await request(server)
      .patch(`/warehouse/packaging/${m.id}`)
      .send({ imageUploadId: image.id })
      .expect(200);
    await request(server)
      .patch(`/warehouse/packaging/${m.id}`)
      .send({ imageUploadId: image.id, name: 'Replay name' })
      .expect(200);
    expect(
      await db.mediaAsset.findUnique({ where: { id: image.id } }),
    ).toMatchObject({ packagingMaterialId: m.id, status: 'ATTACHED' });
    expect((await packaging.get(owner, m.id)).name).toBe('Replay name');
    expect(cloudDelete).not.toHaveBeenCalledWith(image.id);
  });
  it('serializes concurrent replacements and retains exactly the final attachment', async () => {
    const m = await material(),
      a = await upload(),
      b = await upload();
    await Promise.all([
      packaging.update(owner, m.id, { imageUploadId: a.id }),
      packaging.update(owner, m.id, { imageUploadId: b.id }),
    ]);
    const attached = await db.mediaAsset.findMany({
      where: { packagingMaterialId: m.id },
    });
    expect(attached).toHaveLength(1);
    expect(
      (await db.packagingMaterial.findUniqueOrThrow({ where: { id: m.id } }))
        .imageObjectName,
    ).toBe(attached[0].objectName);
    expect(cloudDelete).not.toHaveBeenCalledWith(attached[0].id);
  });
  it('rejects invalid replacements and rolls metadata and image back together', async () => {
    const m = await material(),
      a = await upload();
    await packaging.update(owner, m.id, { imageUploadId: a.id });
    await request(server)
      .patch(`/warehouse/packaging/${m.id}`)
      .send({ imageUploadId: randomUUID(), name: 'Must roll back' })
      .expect(400);
    expect((await packaging.get(owner, m.id)).name).toBe(m.name);
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: a.id } }))
        .packagingMaterialId,
    ).toBe(m.id);
  });
  it.each([2147483648, -1, 1.1])(
    'rejects invalid absolute quantity %s without changing stock',
    async (quantity) => {
      const m = await material();
      await request(server)
        .put(`/warehouse/inventory/items/${m.inventoryItemId}/stock`)
        .send({ quantity, reason: 'QA count', idempotencyKey: randomUUID() })
        .expect(400);
      expect((await packaging.get(owner, m.id)).onHand).toBe(10);
    },
  );
  it.each([2147483648, 2147483640])(
    'rejects input or resulting stock overflow %s without a journal entry',
    async (quantityDelta) => {
      const m = await material(),
        key = randomUUID();
      await request(server)
        .post(`/warehouse/inventory/items/${m.inventoryItemId}/adjustments`)
        .send({
          bucket: 'ON_HAND',
          quantityDelta,
          reason: 'QA count',
          idempotencyKey: key,
        })
        .expect(400);
      expect((await packaging.get(owner, m.id)).onHand).toBe(10);
      expect(
        await db.inventoryMovement.count({ where: { idempotencyKey: key } }),
      ).toBe(0);
    },
  );
  it.each(['   ', ' a ', ' ab '])(
    'rejects trimmed short reasons %j',
    async (reason) => {
      const m = await material();
      await request(server)
        .post(`/warehouse/inventory/items/${m.inventoryItemId}/adjustments`)
        .send({
          bucket: 'ON_HAND',
          quantityDelta: 1,
          reason,
          idempotencyKey: randomUUID(),
        })
        .expect(400);
      await request(server)
        .put(`/warehouse/inventory/items/${m.inventoryItemId}/stock`)
        .send({ quantity: 11, reason, idempotencyKey: randomUUID() })
        .expect(400);
      expect((await packaging.get(owner, m.id)).onHand).toBe(10);
    },
  );
  it('accepts the integer boundary and persists a trimmed valid reason', async () => {
    const m = await material();
    const r = await request(server)
      .put(`/warehouse/inventory/items/${m.inventoryItemId}/stock`)
      .send({
        quantity: 2147483647,
        reason: '  QA count  ',
        idempotencyKey: randomUUID(),
      })
      .expect(200);
    expect((r.body as { reason: string }).reason).toBe('QA count');
    expect((await packaging.get(owner, m.id)).onHand).toBe(2147483647);
  });
  it('deduplicates concurrent queue creation and exposes the real Meta blocker', async () => {
    const { n } = await notice();
    await Promise.all([alerts.syncStore(storeId), alerts.syncStore(storeId)]);
    await alerts.dispatchDue(storeId);
    expect(await queue(n.id)).toMatchObject({
      status: 'BLOCKED',
      lastErrorCode: 'WHATSAPP_DISABLED',
      attempts: 0,
    });
    expect(
      await db.packagingOwnerAlert.count({ where: { notificationId: n.id } }),
    ).toBe(1);
    const feed = await request(server)
      .get('/notifications?tab=INVENTORY&limit=100')
      .expect(200);
    expect(
      (
        feed.body as { items: { id: string; ownerWhatsApp: unknown }[] }
      ).items.find((x) => x.id === n.id)?.ownerWhatsApp,
    ).toMatchObject({ status: 'BLOCKED', lastErrorCode: 'WHATSAPP_DISABLED' });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });
  it('sends an approved owner template exactly once across concurrent workers without wallet charges', async () => {
    const { n } = await notice();
    meta.isEnabled.mockReturnValue(true);
    await Promise.all([
      alerts.dispatchDue(storeId),
      alerts.dispatchDue(storeId),
    ]);
    await alerts.dispatchDue(storeId);
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    expect(await queue(n.id)).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(await db.whatsAppMessage.count({ where: { storeId } })).toBe(0);
  });
  it.each(['missing', 'unapproved'])(
    'blocks %s template without sending',
    async (kind) => {
      const { n } = await notice();
      meta.isEnabled.mockReturnValue(true);
      if (kind === 'missing')
        config.set('PACKAGING_OWNER_WHATSAPP_TEMPLATE', '');
      else meta.listTemplates.mockResolvedValue([]);
      await alerts.dispatchDue(storeId);
      expect(await queue(n.id)).toMatchObject({
        status: 'BLOCKED',
        lastErrorCode:
          kind === 'missing'
            ? 'TEMPLATE_NOT_CONFIGURED'
            : 'TEMPLATE_NOT_APPROVED',
      });
      expect(meta.sendTemplate).not.toHaveBeenCalled();
    },
  );
  it('cancels a resolved condition and allows a new notification cycle', async () => {
    const { m, n } = await notice();
    await db.notification.update({
      where: { id: n.id },
      data: { resolvedAt: new Date(), dedupeKey: null },
    });
    await alerts.syncStore(storeId);
    expect((await queue(n.id)).status).toBe('CANCELLED');
    const next = await notifications.raise({
      storeId,
      type: NotificationType.LOW_STOCK,
      title: 'New cycle',
      entityType: 'PACKAGING_MATERIAL',
      entityId: m.id,
      dedupeKey: `LOW_STOCK:${m.id}`,
    });
    await alerts.syncStore(storeId);
    expect((await queue(next!.id)).id).not.toBe((await queue(n.id)).id);
  });
  it('does not resend an ambiguous timeout', async () => {
    const { n } = await notice();
    meta.isEnabled.mockReturnValue(true);
    meta.sendTemplate.mockRejectedValue(
      new MetaGraphError('timeout', 0, null, null),
    );
    await alerts.dispatchDue(storeId);
    await alerts.dispatchDue(storeId);
    expect((await queue(n.id)).status).toBe('UNKNOWN');
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
  });
  it('converts abandoned sending rows to UNKNOWN without replay', async () => {
    const { n } = await notice();
    await db.packagingOwnerAlert.update({
      where: { notificationId: n.id },
      data: { status: 'SENDING', updatedAt: new Date(Date.now() - 1200000) },
    });
    await alerts.dispatchDue(storeId);
    expect((await queue(n.id)).status).toBe('UNKNOWN');
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });
  it('evaluates the owner store and resolves alerts after restocking', async () => {
    const m = await material();
    await request(server).post('/notifications/evaluate').expect(200);
    const n = await db.notification.findFirstOrThrow({
      where: { storeId, entityId: m.id, type: 'LOW_STOCK', resolvedAt: null },
    });
    expect((await queue(n.id)).status).toBe('BLOCKED');
    await db.inventoryBalance.updateMany({
      where: { inventoryItemId: m.inventoryItemId },
      data: { onHand: 11 },
    });
    await request(server).post('/notifications/evaluate').expect(200);
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: n.id } }))
        .resolvedAt,
    ).not.toBeNull();
    expect((await queue(n.id)).status).toBe('CANCELLED');
  });
  it('prevents staff from invoking the owner refresh', async () => {
    const staff = await db.staffMember.create({
      data: { storeId, userId: foreignOwner, name: 'QA staff' },
    });
    try {
      await request(server)
        .post('/notifications/evaluate')
        .set('x-foreign', '1')
        .expect(403);
    } finally {
      await db.staffMember.delete({ where: { id: staff.id } });
    }
  });
  it('does not refresh a store for an unrelated account', async () => {
    await request(server)
      .post('/notifications/evaluate')
      .set('x-foreign', '1')
      .expect(404);
  });
});
