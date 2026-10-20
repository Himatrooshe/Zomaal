import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DuplicateOrderDecision, Prisma } from '@prisma/client';
import { DuplicateOrdersService } from './duplicate-orders.service';

const HOUR = 3_600_000;

function row(
  id: string,
  hoursAgo: number,
  opts: {
    sku?: string;
    platform?: 'SHOPIFY' | 'MANUAL';
    dispatch?: string | null;
    customerId?: string;
  } = {},
) {
  const customerId = opts.customerId ?? 'cust-1';
  return {
    id,
    orderName: `#${id}`,
    status: 'OPEN',
    providerCreatedAt: new Date(Date.now() - hoursAgo * HOUR),
    totalCollected: new Prisma.Decimal('100'),
    currency: 'MAD',
    itemCount: 1,
    connectionId: 'conn-1',
    customerId,
    connection: { platform: opts.platform ?? 'SHOPIFY' },
    dispatch: opts.dispatch ? { status: opts.dispatch } : null,
    customer: {
      id: customerId,
      phone: '+212600000000',
      name: null,
      isBlacklisted: false,
    },
    lines: [
      {
        name: `Item ${opts.sku ?? 'SKU-1'}`,
        quantity: 1,
        sku: opts.sku ?? 'SKU-1',
        warehouseVariantId: null,
        externalProductId: null,
        externalVariantId: null,
      },
    ],
  };
}

function build(rows: ReturnType<typeof row>[]) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    ecommerceOrderDispatch: {
      findUnique: jest.fn(({ where }: { where: { orderId: string } }) => {
        const r = rows.find((o) => o.id === where.orderId);
        return Promise.resolve(r?.dispatch ?? null);
      }),
    },
    duplicateOrderReview: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ecommerceOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ecommerceOrderEvent: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ecommerceOrder: {
      groupBy: jest.fn().mockResolvedValue([{ customerId: 'cust-1' }]),
      findMany: jest.fn(({ where }: { where: { id?: { in: string[] } } }) =>
        Promise.resolve(
          where.id ? rows.filter((r) => where.id!.in.includes(r.id)) : rows,
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
    },
    duplicateOrderReview: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  Object.assign(tx.ecommerceOrder, prisma.ecommerceOrder);
  tx.duplicateOrderReview.createMany = prisma.duplicateOrderReview.createMany;
  const notifications = {
    raise: jest.fn().mockResolvedValue({ id: 'n-1' }),
    resolve: jest.fn().mockResolvedValue(1),
  };
  const service = new DuplicateOrdersService(
    prisma as never,
    notifications as never,
  );
  return { service, prisma, tx, notifications };
}

describe('DuplicateOrdersService', () => {
  describe('list', () => {
    it('returns groups newest first with the oldest order as main', async () => {
      const { service } = build([
        row('a', 10),
        row('b', 5),
        row('x', 3, { sku: 'OTHER' }),
      ]);
      const result = await service.list('store-1', {
        days: 30,
        page: 1,
        limit: 20,
      });
      expect(result.totalGroups).toBe(1);
      expect(result.totalDuplicates).toBe(1);
      expect(result.data[0]).toMatchObject({
        id: 'a',
        reason: 'SAME_PHONE_SAME_PRODUCT',
        mainOrder: { id: 'a', totalCollected: '100.00', canCancel: true },
        duplicates: [{ id: 'b' }],
      });
    });

    it('returns nothing when no customer has more than one order', async () => {
      const { service, prisma } = build([]);
      prisma.ecommerceOrder.groupBy.mockResolvedValue([]);
      const result = await service.list('store-1', {
        days: 30,
        page: 1,
        limit: 20,
      });
      expect(result.totalGroups).toBe(0);
      expect(prisma.ecommerceOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels a platform duplicate in Zomaal only and asks for a platform cancel', async () => {
      const { service, tx, notifications } = build([row('a', 10), row('b', 5)]);
      const result = await service.cancel('store-1', 'user-1', ['b']);

      expect(result.cancelled).toEqual([
        {
          orderId: 'b',
          orderName: '#b',
          platform: 'SHOPIFY',
          platformCancelRequired: true,
        },
      ]);
      expect(tx.duplicateOrderReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'b',
          mainOrderId: 'a',
          decision: DuplicateOrderDecision.CANCELLED,
          decidedByUserId: 'user-1',
        }) as unknown,
      });
      expect(tx.ecommerceOrder.updateMany).not.toHaveBeenCalled();
      expect(notifications.resolve).toHaveBeenCalledWith('store-1', [
        'DUPLICATE_ORDERS:a',
      ]);
    });

    it('really cancels a manual duplicate', async () => {
      const { service, tx } = build([
        row('a', 10, { platform: 'MANUAL' }),
        row('b', 5, { platform: 'MANUAL' }),
      ]);
      const result = await service.cancel('store-1', 'user-1', ['b']);
      expect(result.cancelled[0].platformCancelRequired).toBe(false);
      expect(tx.ecommerceOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }) as unknown,
        }),
      );
    });

    it('refuses to cancel every order of a group', async () => {
      const { service } = build([row('a', 10), row('b', 5)]);
      await expect(
        service.cancel('store-1', 'user-1', ['a', 'b']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses orders that are not in a duplicate group', async () => {
      const { service } = build([row('a', 10), row('x', 5, { sku: 'OTHER' })]);
      await expect(
        service.cancel('store-1', 'user-1', ['x']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an order already handed to a courier', async () => {
      const { service } = build([
        row('a', 10),
        row('b', 5, { dispatch: 'DISPATCHED' }),
      ]);
      await expect(
        service.cancel('store-1', 'user-1', ['b']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('returns 404 for an order of another store', async () => {
      const { service } = build([row('a', 10), row('b', 5)]);
      await expect(
        service.cancel('store-1', 'user-1', ['missing']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('keepGroup', () => {
    it('marks every duplicate as kept', async () => {
      const { service, prisma } = build([row('a', 10), row('b', 5)]);
      await expect(
        service.keepGroup('store-1', 'user-1', 'a'),
      ).resolves.toEqual({ kept: 1 });
      expect(prisma.duplicateOrderReview.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            orderId: 'b',
            decision: DuplicateOrderDecision.KEPT,
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('returns 404 when the order is not a group main', async () => {
      const { service } = build([row('a', 10), row('b', 5)]);
      await expect(
        service.keepGroup('store-1', 'user-1', 'b'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('checkNewOrder', () => {
    it('raises one alert per group for a fresh duplicate', async () => {
      const { service, notifications } = build([row('a', 10), row('b', 1)]);
      await service.checkNewOrder({
        storeId: 'store-1',
        customerId: 'cust-1',
        orderId: 'b',
      });
      expect(notifications.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DUPLICATE_ORDERS',
          entityId: 'b',
          dedupeKey: 'DUPLICATE_ORDERS:a',
        }),
      );
    });

    it('stays quiet for old orders imported by a first sync', async () => {
      const { service, notifications } = build([row('a', 100), row('b', 90)]);
      await service.checkNewOrder({
        storeId: 'store-1',
        customerId: 'cust-1',
        orderId: 'b',
      });
      expect(notifications.raise).not.toHaveBeenCalled();
    });

    it('stays quiet when the order has no duplicate', async () => {
      const { service, notifications } = build([
        row('a', 10),
        row('b', 1, { sku: 'OTHER' }),
      ]);
      await service.checkNewOrder({
        storeId: 'store-1',
        customerId: 'cust-1',
        orderId: 'b',
      });
      expect(notifications.raise).not.toHaveBeenCalled();
    });
  });
});
