import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import type { StoreAccess } from '../access/store-access.service';

const OWNER: StoreAccess = {
  storeId: 'store-1',
  baseCurrency: 'MAD',
  userId: 'owner-1',
  isOwner: true,
  staffMemberId: null,
  permissions: [],
};

const STAFF: StoreAccess = {
  storeId: 'store-1',
  baseCurrency: 'MAD',
  userId: 'staff-user-1',
  isOwner: false,
  staffMemberId: 'staff-1',
  permissions: ['products.view', 'orders.view'],
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function build(pushEnabled = false) {
  const prisma = {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notificationRead: {
      upsert: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pushDevice: { upsert: jest.fn(), deleteMany: jest.fn() },
    store: { findUnique: jest.fn().mockResolvedValue({ userId: 'owner-1' }) },
    staffMember: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const push = {
    isEnabled: pushEnabled,
    sendToUsers: jest.fn().mockResolvedValue(1),
  };
  const service = new NotificationsService(prisma as never, push as never);
  return { service, prisma, push };
}

const LOW_STOCK_INPUT = {
  storeId: 'store-1',
  type: 'LOW_STOCK' as const,
  title: 'Item is running low',
  message: '3 items left',
  entityType: 'WAREHOUSE_VARIANT',
  entityId: 'variant-1',
  dedupeKey: 'LOW_STOCK:variant-1',
};

describe('NotificationsService', () => {
  describe('raise', () => {
    it('stores severity, category and audience from the type definition', async () => {
      const { service, prisma } = build();

      await service.raise(LOW_STOCK_INPUT);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storeId: 'store-1',
            type: 'LOW_STOCK',
            severity: 'WARNING',
            category: 'INVENTORY',
            audiencePermission: 'products.view',
            dedupeKey: 'LOW_STOCK:variant-1',
          }),
        }),
      );
    });

    it('returns null instead of duplicating an alert that is still active', async () => {
      const { service, prisma, push } = build(true);
      prisma.notification.create.mockRejectedValue(uniqueViolation());

      await expect(service.raise(LOW_STOCK_INPUT)).resolves.toBeNull();
      expect(push.sendToUsers).not.toHaveBeenCalled();
    });

    it('rethrows non-dedupe database errors', async () => {
      const { service, prisma } = build();
      prisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.raise(LOW_STOCK_INPUT)).rejects.toThrow('db down');
    });

    it('pushes owner-only alerts to the owner alone', async () => {
      const { service, prisma, push } = build(true);

      await service.raise({
        storeId: 'store-1',
        type: 'SALARY_OVERDUE',
        title: 'Salary overdue',
        dedupeKey: 'SALARY_OVERDUE:p-1',
      });

      expect(prisma.staffMember.findMany).not.toHaveBeenCalled();
      expect(push.sendToUsers).toHaveBeenCalledWith(
        ['owner-1'],
        expect.objectContaining({ title: 'Salary overdue' }),
      );
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n-1' },
        data: { pushedAt: expect.any(Date) },
      });
    });

    it('pushes permission-scoped alerts to the owner and only staff holding that permission', async () => {
      const { service, prisma, push } = build(true);
      prisma.staffMember.findMany.mockResolvedValue([
        {
          userId: 'staff-with-role',
          permissionOverrides: [],
          role: { permissions: ['products.view'] },
        },
        {
          userId: 'staff-without',
          permissionOverrides: [],
          role: { permissions: ['orders.view'] },
        },
        {
          // Overrides replace the role outright.
          userId: 'staff-override',
          permissionOverrides: ['products.view'],
          role: { permissions: [] },
        },
      ]);

      await service.raise(LOW_STOCK_INPUT);

      expect(push.sendToUsers).toHaveBeenCalledWith(
        ['owner-1', 'staff-with-role', 'staff-override'],
        expect.objectContaining({
          data: expect.objectContaining({
            notificationId: 'n-1',
            type: 'LOW_STOCK',
            entityId: 'variant-1',
          }),
        }),
      );
    });

    it('still returns the notification when push fails', async () => {
      const { service, push } = build(true);
      push.sendToUsers.mockRejectedValue(new Error('fcm down'));

      await expect(service.raise(LOW_STOCK_INPUT)).resolves.toEqual({
        id: 'n-1',
      });
    });

    it('skips push entirely when push is disabled', async () => {
      const { service, push, prisma } = build(false);

      await service.raise(LOW_STOCK_INPUT);

      expect(push.sendToUsers).not.toHaveBeenCalled();
      expect(prisma.store.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('raises new conditions, keeps active ones, and resolves cleared ones', async () => {
      const { service, prisma } = build();
      prisma.notification.findMany.mockResolvedValue([
        { dedupeKey: 'LOW_STOCK:variant-1' },
        { dedupeKey: 'LOW_STOCK:variant-old' },
      ]);
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcile('store-1', 'LOW_STOCK', [
        LOW_STOCK_INPUT,
        {
          ...LOW_STOCK_INPUT,
          entityId: 'variant-2',
          dedupeKey: 'LOW_STOCK:variant-2',
        },
      ]);

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dedupeKey: 'LOW_STOCK:variant-2' }),
        }),
      );
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          storeId: 'store-1',
          dedupeKey: { in: ['LOW_STOCK:variant-old'] },
        },
        data: { dedupeKey: null, resolvedAt: expect.any(Date) },
      });
      expect(result).toEqual({ raised: 1, resolved: 1 });
    });

    it('does nothing when state is unchanged', async () => {
      const { service, prisma } = build();
      prisma.notification.findMany.mockResolvedValue([
        { dedupeKey: 'LOW_STOCK:variant-1' },
      ]);

      const result = await service.reconcile('store-1', 'LOW_STOCK', [
        LOW_STOCK_INPUT,
      ]);

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ raised: 0, resolved: 0 });
    });
  });

  describe('list', () => {
    it('lets owners see every notification in their store', async () => {
      const { service, prisma } = build();

      await service.list(OWNER, { tab: 'ALL' });

      const where = prisma.notification.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ storeId: 'store-1' });
    });

    it('limits staff to alerts for permissions they hold (owner-only rows excluded)', async () => {
      const { service, prisma } = build();

      await service.list(STAFF, { tab: 'ALL' });

      const where = prisma.notification.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        storeId: 'store-1',
        audiencePermission: { in: ['products.view', 'orders.view'] },
      });
    });

    it.each([
      ['CRITICAL', { severity: 'CRITICAL' }],
      ['WARNING', { severity: 'WARNING' }],
      ['INVENTORY', { category: 'INVENTORY' }],
    ] as const)('filters the %s tab', async (tab, expected) => {
      const { service, prisma } = build();

      await service.list(OWNER, { tab });

      expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
        storeId: 'store-1',
        ...expected,
      });
    });

    it('returns per-user read state, newest first, with pagination', async () => {
      const { service, prisma } = build();
      const createdAt = new Date('2026-10-01T10:00:00.000Z');
      const readAt = new Date('2026-10-01T11:00:00.000Z');
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n-1',
          type: 'LOW_STOCK',
          severity: 'WARNING',
          category: 'INVENTORY',
          title: 'Item is running low',
          message: '3 items left',
          entityType: 'WAREHOUSE_VARIANT',
          entityId: 'variant-1',
          metadata: { available: 3 },
          dedupeKey: 'LOW_STOCK:variant-1',
          resolvedAt: null,
          createdAt,
          reads: [{ readAt }],
        },
      ]);
      prisma.notification.count
        .mockResolvedValueOnce(41)
        .mockResolvedValueOnce(7);

      const result = await service.list(OWNER, { page: 2, limit: 20 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 20,
          take: 20,
          include: {
            reads: { where: { userId: 'owner-1' }, select: { readAt: true } },
          },
        }),
      );
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'n-1',
          isRead: true,
          readAt: readAt.toISOString(),
          resolvedAt: null,
          createdAt: createdAt.toISOString(),
          metadata: { available: 3 },
        }),
      );
      expect(result.unreadCount).toBe(7);
      expect(result.pagination).toEqual({
        total: 41,
        page: 2,
        limit: 20,
        totalPages: 3,
      });
    });

    it('filters to unread for the calling user', async () => {
      const { service, prisma } = build();

      await service.list(OWNER, { unreadOnly: true });

      expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
        storeId: 'store-1',
        reads: { none: { userId: 'owner-1' } },
      });
    });
  });

  describe('markRead', () => {
    it('404s for a notification the user cannot see', async () => {
      const { service, prisma } = build();
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead(STAFF, 'n-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'n-1',
          storeId: 'store-1',
          audiencePermission: { in: STAFF.permissions },
        },
        select: { id: true },
      });
      expect(prisma.notificationRead.upsert).not.toHaveBeenCalled();
    });

    it('records the read idempotently', async () => {
      const { service, prisma } = build();
      prisma.notification.findFirst.mockResolvedValue({ id: 'n-1' });

      await service.markRead(OWNER, 'n-1');

      expect(prisma.notificationRead.upsert).toHaveBeenCalledWith({
        where: {
          notificationId_userId: { notificationId: 'n-1', userId: 'owner-1' },
        },
        create: { notificationId: 'n-1', userId: 'owner-1' },
        update: {},
      });
    });
  });

  describe('markAllRead', () => {
    it('marks only visible unread rows in the tab', async () => {
      const { service, prisma } = build();
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n-1' },
        { id: 'n-2' },
      ]);
      prisma.notificationRead.createMany.mockResolvedValue({ count: 2 });

      const result = await service.markAllRead(STAFF, 'INVENTORY');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          storeId: 'store-1',
          audiencePermission: { in: STAFF.permissions },
          category: 'INVENTORY',
          reads: { none: { userId: 'staff-user-1' } },
        },
        select: { id: true },
      });
      expect(prisma.notificationRead.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'n-1', userId: 'staff-user-1' },
          { notificationId: 'n-2', userId: 'staff-user-1' },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual({ marked: 2 });
    });

    it('skips the write when nothing is unread', async () => {
      const { service, prisma } = build();

      await expect(service.markAllRead(OWNER)).resolves.toEqual({ marked: 0 });
      expect(prisma.notificationRead.createMany).not.toHaveBeenCalled();
    });
  });

  describe('devices', () => {
    it('moves a token to whoever registered it last', async () => {
      const { service, prisma } = build();

      await service.registerDevice('user-2', 'tok_abc', 'ANDROID');

      expect(prisma.pushDevice.upsert).toHaveBeenCalledWith({
        where: { token: 'tok_abc' },
        create: { token: 'tok_abc', platform: 'ANDROID', userId: 'user-2' },
        update: {
          userId: 'user-2',
          platform: 'ANDROID',
          lastSeenAt: expect.any(Date),
        },
      });
    });

    it("only removes the caller's own token", async () => {
      const { service, prisma } = build();

      await service.unregisterDevice('user-1', 'tok_abc');

      expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
        where: { token: 'tok_abc', userId: 'user-1' },
      });
    });
  });
});
