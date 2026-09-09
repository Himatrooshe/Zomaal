import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';

const SETTINGS = {
  storeId: 'store-1',
  returnsLimit: 3,
  cancellationsLimit: 0,
  refusalsLimit: 0,
  noAnswerLimit: 0,
  useCombinedLimit: false,
  combinedLimit: 0,
  warnOnNewOrder: true,
};

function build() {
  const prisma = {
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    ecommerceOrder: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const risk = {
    getSettings: jest.fn().mockResolvedValue(SETTINGS),
  };
  const service = new CustomersService(prisma as never, risk as never);
  return { service, prisma, risk };
}

const CUSTOMER_ROW = {
  id: 'customer-1',
  phone: '+8801400715037',
  name: 'Alex Sansioun',
  address: '123 Main Street',
  city: 'New York',
  totalOrders: 9,
  returnsCount: 2,
  cancellationsCount: 0,
  refusalsCount: 0,
  noAnswerCount: 0,
  isBlacklisted: false,
  blacklistReason: null,
  blacklistedAt: null,
  updatedAt: new Date('2026-04-16T00:00:00.000Z'),
};

describe('CustomersService', () => {
  describe('list', () => {
    it('returns totals across every matching customer, not just the page', async () => {
      const { service, prisma } = build();
      prisma.customer.findMany
        .mockResolvedValueOnce([
          {
            isBlacklisted: false,
            returnsCount: 2,
            cancellationsCount: 0,
            refusalsCount: 0,
            noAnswerCount: 0,
          }, // at risk (2/3)
          {
            isBlacklisted: true,
            returnsCount: 5,
            cancellationsCount: 0,
            refusalsCount: 0,
            noAnswerCount: 0,
          }, // blacklisted, not "high risk"
          {
            isBlacklisted: false,
            returnsCount: 0,
            cancellationsCount: 0,
            refusalsCount: 0,
            noAnswerCount: 0,
          }, // not at risk
        ])
        .mockResolvedValueOnce([CUSTOMER_ROW]);

      const result = await service.list('store-1', {});

      expect(result.totalCustomers).toBe(3);
      expect(result.highRiskCount).toBe(1);
      expect(result.customers).toEqual([
        expect.objectContaining({
          id: 'customer-1',
          phone: '+8801400715037',
          address: '123 Main Street, New York',
          isHighRisk: true, // 2/3 returns
          isBlacklisted: false,
        }),
      ]);
    });

    it('filters by phone or name when search is supplied', async () => {
      const { service, prisma } = build();

      await service.list('store-1', { search: '0140' });

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId: 'store-1',
            OR: [
              { phone: { contains: '0140', mode: 'insensitive' } },
              { name: { contains: '0140', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('paginates using page/limit', async () => {
      const { service, prisma } = build();

      await service.list('store-1', { page: 3, limit: 10 });

      expect(prisma.customer.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('getById', () => {
    it('throws NotFoundException for a customer outside the store', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.getById('store-1', 'customer-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the risk score breakdown and order history, newest first', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue(CUSTOMER_ROW);
      prisma.ecommerceOrder.findMany.mockResolvedValue([
        {
          id: 'order-1',
          orderName: '#12345',
          processedAt: new Date('2026-04-16T00:00:00.000Z'),
          status: 'CLOSED',
          lines: [{ name: 'Wireless Headphones' }],
          events: [{ type: 'DELIVERED' }],
        },
      ]);

      const result = await service.getById('store-1', 'customer-1');

      expect(result.riskScore).toEqual({
        returns: 2,
        cancellations: 0,
        refusals: 0,
        noAnswer: 0,
        totalRiskActions: 2,
      });
      // 2/3 returns against the store's configured limit — the "N actions
      // away from blacklist" banner's data.
      expect(result.riskProximity).toEqual({
        category: 'returns',
        current: 2,
        limit: 3,
        remaining: 1,
      });
      expect(result.orders).toEqual([
        {
          orderId: 'order-1',
          orderName: '#12345',
          productSummary: 'Wireless Headphones',
          status: 'Delivered',
          occurredAt: '2026-04-16T00:00:00.000Z',
        },
      ]);
    });

    it('falls back to the order status when there are no timeline events yet', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue(CUSTOMER_ROW);
      prisma.ecommerceOrder.findMany.mockResolvedValue([
        {
          id: 'order-1',
          orderName: '#12345',
          processedAt: new Date('2026-04-16T00:00:00.000Z'),
          status: 'CANCELLED',
          lines: [],
          events: [],
        },
      ]);

      const result = await service.getById('store-1', 'customer-1');

      expect(result.orders[0]).toMatchObject({
        productSummary: null,
        status: 'Cancelled',
      });
    });

    it('never returns riskProximity for an already-blacklisted customer', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue({
        ...CUSTOMER_ROW,
        isBlacklisted: true,
        returnsCount: 2, // would otherwise compute a proximity
      });

      const result = await service.getById('store-1', 'customer-1');

      expect(result.riskProximity).toBeNull();
    });
  });

  describe('getBlacklistScreen', () => {
    it('splits customers into atRisk and blacklisted, with proximity only on the at-risk ones', async () => {
      const { service, prisma } = build();
      prisma.customer.count.mockResolvedValue(1);
      prisma.customer.findMany
        .mockResolvedValueOnce([
          {
            id: 'blacklisted-1',
            phone: '+212600000001',
            name: 'Blocked Customer',
            returnsCount: 5,
            cancellationsCount: 0,
            refusalsCount: 0,
            noAnswerCount: 0,
            blacklistedAt: new Date('2026-04-20T00:00:00.000Z'),
            updatedAt: new Date('2026-04-20T00:00:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'at-risk-1',
            phone: '+212600000002',
            name: 'Almost Blocked',
            returnsCount: 2,
            cancellationsCount: 0,
            refusalsCount: 0,
            noAnswerCount: 0,
          },
          {
            id: 'not-at-risk-1',
            phone: '+212600000003',
            name: 'Fine Customer',
            returnsCount: 0,
            cancellationsCount: 0,
            refusalsCount: 0,
            noAnswerCount: 0,
          },
        ]);

      const result = await service.getBlacklistScreen('store-1', {});

      expect(result.totalBlacklisted).toBe(1);
      expect(result.blacklistedCustomers).toEqual([
        expect.objectContaining({ id: 'blacklisted-1', returnsCount: 5 }),
      ]);
      expect(result.atRiskCustomers).toEqual([
        expect.objectContaining({
          id: 'at-risk-1',
          riskProximity: {
            category: 'returns',
            current: 2,
            limit: 3,
            remaining: 1,
          },
        }),
      ]);
    });

    it('paginates blacklistedCustomers using page/limit and echoes them back', async () => {
      const { service, prisma } = build();

      await service.getBlacklistScreen('store-1', { page: 2, limit: 5 });

      expect(prisma.customer.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('does not paginate the atRiskCustomers scan — bounded by AT_RISK_SCAN_LIMIT instead', async () => {
      const { service, prisma } = build();

      const result = await service.getBlacklistScreen('store-1', {
        page: 2,
        limit: 5,
      });

      expect(prisma.customer.findMany).toHaveBeenNthCalledWith(
        2,
        expect.not.objectContaining({ skip: expect.anything() }),
      );
      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
    });
  });
});
