import { Prisma } from '@prisma/client';
import { NotificationEvaluatorService } from './notification-evaluator.service';

const STORE = { id: 'store-1', userId: 'owner-1', baseCurrency: 'MAD' };
const NOW = new Date('2026-10-05T12:00:00.000Z');

function build() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    store: { findMany: jest.fn().mockResolvedValue([]) },
    staffSalaryPayment: { findMany: jest.fn().mockResolvedValue([]) },
    ecommerceConnection: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const notifications = {
    reconcile: jest.fn().mockResolvedValue({ raised: 0, resolved: 0 }),
  };
  const currency = {
    convertAmount: jest.fn(async (amount: Prisma.Decimal | string) =>
      new Prisma.Decimal(amount).times(10),
    ),
  };
  const service = new NotificationEvaluatorService(
    prisma as never,
    notifications as never,
    currency as never,
  );
  return { service, prisma, notifications, currency };
}

function salesRows(current: string, previous: string, previousOrders = 10) {
  return [
    {
      window: 'current',
      currency: 'MAD',
      orderCount: 3,
      netSales: new Prisma.Decimal(current),
    },
    {
      window: 'previous',
      currency: 'MAD',
      orderCount: previousOrders,
      netSales: new Prisma.Decimal(previous),
    },
  ];
}

describe('NotificationEvaluatorService', () => {
  describe('stockAlerts', () => {
    it('splits low and out-of-stock variants with per-variant dedupe keys', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([
        {
          variantId: 'v-1',
          variantTitle: 'Default',
          isDefault: true,
          productId: 'p-1',
          productName: 'Product A',
          threshold: 5,
          available: 3,
        },
        {
          variantId: 'v-2',
          variantTitle: 'Red / L',
          isDefault: false,
          productId: 'p-2',
          productName: 'Product B',
          threshold: 5,
          available: 0,
        },
        {
          variantId: 'v-3',
          variantTitle: 'Default',
          isDefault: true,
          productId: 'p-3',
          productName: 'Product C',
          threshold: 5,
          available: -2,
        },
      ]);

      const { low, out } = await service.stockAlerts('store-1');

      expect(low).toEqual([
        expect.objectContaining({
          type: 'LOW_STOCK',
          title: 'Product A is running low',
          message: '3 items left',
          entityType: 'WAREHOUSE_VARIANT',
          entityId: 'v-1',
          dedupeKey: 'LOW_STOCK:v-1',
          metadata: { productId: 'p-1', available: 3, threshold: 5 },
        }),
      ]);
      expect(out.map((o) => o.dedupeKey)).toEqual([
        'OUT_OF_STOCK:v-2',
        'OUT_OF_STOCK:v-3',
      ]);
      expect(out[0].title).toBe('Product B — Red / L is out of stock');
    });

    it('uses singular wording for one item', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([
        {
          variantId: 'v-1',
          variantTitle: 'Default',
          isDefault: true,
          productId: 'p-1',
          productName: 'Product A',
          threshold: 5,
          available: 1,
        },
      ]);

      const { low } = await service.stockAlerts('store-1');

      expect(low[0].message).toBe('1 item left');
    });
  });

  describe('salaryAlerts', () => {
    it('queries PENDING payments due before today (UTC) and keys by payment', async () => {
      const { service, prisma } = build();
      prisma.staffSalaryPayment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          amount: new Prisma.Decimal('3000'),
          paymentDate: new Date('2026-10-01T00:00:00.000Z'),
          staffMember: { id: 'staff-1', name: 'Staff One' },
        },
      ]);

      const alerts = await service.salaryAlerts('store-1', NOW);

      expect(prisma.staffSalaryPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PENDING',
            paymentDate: { lt: new Date('2026-10-05T00:00:00.000Z') },
            staffMember: { storeId: 'store-1' },
          },
        }),
      );
      expect(alerts).toEqual([
        expect.objectContaining({
          type: 'SALARY_OVERDUE',
          title: 'Salary overdue for Staff One',
          entityId: 'pay-1',
          dedupeKey: 'SALARY_OVERDUE:pay-1',
          metadata: expect.objectContaining({ amount: '3000.00' }),
        }),
      ]);
    });
  });

  describe('salesDropAlerts', () => {
    it('alerts at a 30%+ drop vs the previous 7 days', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue(salesRows('650', '1000'));

      const alerts = await service.salesDropAlerts(STORE, NOW);

      expect(alerts).toEqual([
        expect.objectContaining({
          type: 'SALES_DROP',
          message: 'Sales are down 35% vs last week.',
          dedupeKey: 'SALES_DROP',
          metadata: {
            currency: 'MAD',
            currentNetSales: '650.00',
            previousNetSales: '1000.00',
            changePercent: '-35.0',
          },
        }),
      ]);
    });

    it('does not alert for a drop under 30%', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue(salesRows('710', '1000'));

      await expect(service.salesDropAlerts(STORE, NOW)).resolves.toEqual([]);
    });

    it('does not alert when last week had too few orders to compare', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue(salesRows('0', '1000', 4));

      await expect(service.salesDropAlerts(STORE, NOW)).resolves.toEqual([]);
    });

    it('does not alert with no previous sales', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.salesDropAlerts(STORE, NOW)).resolves.toEqual([]);
    });

    it('converts other currencies to the store base currency before comparing', async () => {
      const { service, prisma, currency } = build();
      prisma.$queryRaw.mockResolvedValue([
        {
          window: 'current',
          currency: 'MAD',
          orderCount: 3,
          netSales: new Prisma.Decimal('500'),
        },
        {
          window: 'previous',
          currency: 'USD',
          orderCount: 10,
          netSales: new Prisma.Decimal('100'),
        },
      ]);

      const alerts = await service.salesDropAlerts(STORE, NOW);

      expect(currency.convertAmount).toHaveBeenCalledWith(
        expect.anything(),
        'USD',
        'MAD',
      );
      expect(alerts[0].metadata).toEqual(
        expect.objectContaining({
          previousNetSales: '1000.00',
          changePercent: '-50.0',
        }),
      );
    });
  });

  describe('platformAlerts', () => {
    it('flags non-active connections as disconnected and active ones with errors as sync failures', async () => {
      const { service, prisma } = build();
      prisma.ecommerceConnection.findMany.mockResolvedValue([
        {
          id: 'c-1',
          platform: 'SHOPIFY',
          displayName: null,
          status: 'REAUTHORIZATION_REQUIRED',
          lastSyncError: null,
        },
        {
          id: 'c-2',
          platform: 'YOUCAN',
          displayName: null,
          status: 'ACTIVE',
          lastSyncError: 'timeout',
        },
        {
          id: 'c-3',
          platform: 'LIGHTFUNNELS',
          displayName: null,
          status: 'ACTIVE',
          lastSyncError: null,
        },
      ]);

      const [[, disconnected], [, failed]] =
        await service.platformAlerts('store-1');

      expect(disconnected).toEqual([
        expect.objectContaining({
          title: 'Shopify is disconnected',
          dedupeKey: 'PLATFORM_DISCONNECTED:c-1',
        }),
      ]);
      expect(failed).toEqual([
        expect.objectContaining({
          title: 'YouCan sync failed',
          dedupeKey: 'PLATFORM_SYNC_FAILED:c-2',
        }),
      ]);
      // Raw provider errors can carry internal details; never shown to users.
      expect(JSON.stringify(failed)).not.toContain('timeout');
    });
  });

  describe('courierAlerts', () => {
    it('alerts per courier with a stored sync error', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        quickLivraisonConnection: { lastSyncError: 'HTTP 500' },
        forceLogConnection: { lastSyncError: null },
        ozoneExpressConnection: null,
        ameexConnection: { lastSyncError: 'bad key' },
      });

      const alerts = await service.courierAlerts(STORE);

      expect(alerts.map((a) => a.dedupeKey)).toEqual([
        'COURIER_SYNC_FAILED:QUICKLIVRAISON',
        'COURIER_SYNC_FAILED:AMEEX',
      ]);
    });
  });

  describe('runAll', () => {
    it('reconciles every type for every active store, paging by cursor', async () => {
      const { service, prisma, notifications } = build();
      prisma.store.findMany
        .mockResolvedValueOnce([STORE])
        .mockResolvedValueOnce([]);
      notifications.reconcile.mockResolvedValue({ raised: 1, resolved: 0 });

      const summary = await service.runAll(NOW);

      const types = notifications.reconcile.mock.calls.map((c) => c[1]);
      expect(types.sort()).toEqual(
        [
          'COURIER_SYNC_FAILED',
          'LOW_STOCK',
          'OUT_OF_STOCK',
          'PLATFORM_DISCONNECTED',
          'PLATFORM_SYNC_FAILED',
          'SALARY_OVERDUE',
          'SALES_DROP',
        ].sort(),
      );
      expect(prisma.store.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 1, cursor: { id: 'store-1' } }),
      );
      expect(summary).toEqual({
        stores: 1,
        failedStores: 0,
        raised: 7,
        resolved: 0,
      });
    });

    it('keeps going when one store fails', async () => {
      const { service, prisma } = build();
      prisma.store.findMany
        .mockResolvedValueOnce([STORE, { ...STORE, id: 'store-2' }])
        .mockResolvedValueOnce([]);
      prisma.$queryRaw.mockRejectedValueOnce(new Error('boom'));

      const summary = await service.runAll(NOW);

      expect(summary.stores).toBe(2);
      expect(summary.failedStores).toBe(1);
    });
  });
});
