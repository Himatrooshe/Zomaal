import { NotFoundException } from '@nestjs/common';
import { CustomerRiskService } from './customer-risk.service';

const DEFAULT_SETTINGS = {
  storeId: 'store-1',
  returnsLimit: 0,
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
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    blacklistSettings: {
      upsert: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
      update: jest.fn(),
    },
    ecommerceOrderEvent: {
      upsert: jest.fn(),
    },
  };
  const service = new CustomerRiskService(prisma as never);
  return { service, prisma };
}

describe('CustomerRiskService', () => {
  describe('upsertCustomer', () => {
    it('returns null without touching the database when there is no phone', async () => {
      const { service, prisma } = build();

      const result = await service.upsertCustomer({
        storeId: 'store-1',
        phone: null,
        name: 'Ahmed',
      });

      expect(result).toBeNull();
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
    });

    it('returns null for a blank/whitespace-only phone', async () => {
      const { service, prisma } = build();

      const result = await service.upsertCustomer({
        storeId: 'store-1',
        phone: '   ',
      });

      expect(result).toBeNull();
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
    });

    it('upserts by (storeId, phone) with trimmed values', async () => {
      const { service, prisma } = build();
      prisma.customer.upsert.mockResolvedValue({ id: 'customer-1' });

      await service.upsertCustomer({
        storeId: 'store-1',
        phone: ' +212612345678 ',
        name: ' Ahmed Alaoui ',
        address: ' 123 Rue Hassan II ',
        city: ' Casablanca ',
      });

      expect(prisma.customer.upsert).toHaveBeenCalledWith({
        where: {
          storeId_phone: { storeId: 'store-1', phone: '+212612345678' },
        },
        create: {
          storeId: 'store-1',
          phone: '+212612345678',
          name: 'Ahmed Alaoui',
          address: '123 Rue Hassan II',
          city: 'Casablanca',
        },
        update: {
          name: 'Ahmed Alaoui',
          address: '123 Rue Hassan II',
          city: 'Casablanca',
        },
      });
    });

    it('only updates fields that were actually supplied', async () => {
      const { service, prisma } = build();
      prisma.customer.upsert.mockResolvedValue({ id: 'customer-1' });

      await service.upsertCustomer({
        storeId: 'store-1',
        phone: '+212600000001',
      });

      const call = prisma.customer.upsert.mock.calls[0][0];
      expect(call.update).toEqual({});
    });
  });

  describe('incrementRiskCounter — auto-blacklist', () => {
    it('increments the right counter and does not blacklist while every limit is disabled', async () => {
      const { service, prisma } = build();
      prisma.customer.update.mockResolvedValueOnce({
        id: 'customer-1',
        isBlacklisted: false,
        returnsCount: 1,
        cancellationsCount: 0,
        refusalsCount: 0,
        noAnswerCount: 0,
      });

      const result = await service.incrementRiskCounter(
        'store-1',
        'customer-1',
        'RETURNS',
      );

      expect(prisma.customer.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'customer-1' },
        data: { returnsCount: { increment: 1 } },
      });
      expect(result).toEqual({ isBlacklisted: false });
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
    });

    it('auto-blacklists once the crossed category reaches its configured limit', async () => {
      const { service, prisma } = build();
      prisma.customer.update
        .mockResolvedValueOnce({
          id: 'customer-1',
          isBlacklisted: false,
          returnsCount: 3,
          cancellationsCount: 0,
          refusalsCount: 0,
          noAnswerCount: 0,
        })
        .mockResolvedValueOnce({}); // the blacklisting update
      prisma.blacklistSettings.upsert.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        returnsLimit: 3,
      });

      const result = await service.incrementRiskCounter(
        'store-1',
        'customer-1',
        'RETURNS',
      );

      expect(result).toEqual({ isBlacklisted: true });
      expect(prisma.customer.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'customer-1' },
        data: {
          isBlacklisted: true,
          blacklistReason: '3 returns',
          blacklistedAt: expect.any(Date),
        },
      });
    });

    it('does not re-blacklist (or re-check thresholds) a customer already blacklisted', async () => {
      const { service, prisma } = build();
      prisma.customer.update.mockResolvedValueOnce({
        id: 'customer-1',
        isBlacklisted: true,
        returnsCount: 5,
        cancellationsCount: 0,
        refusalsCount: 0,
        noAnswerCount: 0,
      });

      const result = await service.incrementRiskCounter(
        'store-1',
        'customer-1',
        'RETURNS',
      );

      expect(result).toEqual({ isBlacklisted: true });
      expect(prisma.customer.update).toHaveBeenCalledTimes(1); // only the increment
      expect(prisma.blacklistSettings.upsert).not.toHaveBeenCalled();
    });

    it('respects combined mode over the individual category limits', async () => {
      const { service, prisma } = build();
      prisma.customer.update
        .mockResolvedValueOnce({
          id: 'customer-1',
          isBlacklisted: false,
          returnsCount: 1,
          cancellationsCount: 1,
          refusalsCount: 1,
          noAnswerCount: 0,
        })
        .mockResolvedValueOnce({});
      prisma.blacklistSettings.upsert.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        returnsLimit: 100, // would not fire alone
        useCombinedLimit: true,
        combinedLimit: 3,
      });

      const result = await service.incrementRiskCounter(
        'store-1',
        'customer-1',
        'REFUSALS',
      );

      expect(result).toEqual({ isBlacklisted: true });
    });
  });

  describe('addToBlacklist / removeFromBlacklist', () => {
    it('throws NotFoundException for a customer outside the store', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.addToBlacklist('store-1', 'customer-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('uses the supplied reason when given', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue({
        id: 'customer-1',
        returnsCount: 0,
        cancellationsCount: 0,
        refusalsCount: 0,
        noAnswerCount: 0,
      });
      prisma.customer.update.mockResolvedValue({});

      await service.addToBlacklist('store-1', 'customer-1', 'Manual flag');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: {
          isBlacklisted: true,
          blacklistReason: 'Manual flag',
          blacklistedAt: expect.any(Date),
        },
      });
    });

    it('auto-fills the reason from the risk breakdown when none is supplied', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue({
        id: 'customer-1',
        returnsCount: 3,
        cancellationsCount: 1,
        refusalsCount: 0,
        noAnswerCount: 0,
      });
      prisma.customer.update.mockResolvedValue({});

      await service.addToBlacklist('store-1', 'customer-1');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: {
          isBlacklisted: true,
          blacklistReason: '3 returns, 1 cancellation',
          blacklistedAt: expect.any(Date),
        },
      });
    });

    it('resets every counter to zero — "monitored again from zero"', async () => {
      const { service, prisma } = build();
      prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
      prisma.customer.update.mockResolvedValue({});

      await service.removeFromBlacklist('store-1', 'customer-1');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: {
          isBlacklisted: false,
          blacklistReason: null,
          blacklistedAt: null,
          returnsCount: 0,
          cancellationsCount: 0,
          refusalsCount: 0,
          noAnswerCount: 0,
        },
      });
    });
  });

  describe('recordNewOrder', () => {
    it('increments totalOrders and skips the warning for a non-blacklisted customer', async () => {
      const { service, prisma } = build();

      await service.recordNewOrder({
        storeId: 'store-1',
        customerId: 'customer-1',
        isBlacklisted: false,
        orderId: 'order-1',
        occurredAt: new Date('2026-04-16T00:00:00.000Z'),
      });

      expect(prisma.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: { totalOrders: { increment: 1 } },
      });
      expect(prisma.ecommerceOrderEvent.upsert).not.toHaveBeenCalled();
    });

    it('writes the SYSTEM warning event for a blacklisted customer when warnOnNewOrder is on', async () => {
      const { service, prisma } = build();
      prisma.blacklistSettings.upsert.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        warnOnNewOrder: true,
      });

      await service.recordNewOrder({
        storeId: 'store-1',
        customerId: 'customer-1',
        isBlacklisted: true,
        orderId: 'order-1',
        occurredAt: new Date('2026-04-16T00:00:00.000Z'),
      });

      expect(prisma.ecommerceOrderEvent.upsert).toHaveBeenCalledWith({
        where: {
          orderId_providerEventId: {
            orderId: 'order-1',
            providerEventId: 'system-blacklist-warning-order-1',
          },
        },
        create: expect.objectContaining({
          orderId: 'order-1',
          source: 'SYSTEM',
          type: 'CUSTOMER_BLACKLISTED_WARNING',
          synthetic: false,
        }),
        update: {},
      });
    });

    it('skips the warning for a blacklisted customer when warnOnNewOrder is off', async () => {
      const { service, prisma } = build();
      prisma.blacklistSettings.upsert.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        warnOnNewOrder: false,
      });

      await service.recordNewOrder({
        storeId: 'store-1',
        customerId: 'customer-1',
        isBlacklisted: true,
        orderId: 'order-1',
        occurredAt: new Date('2026-04-16T00:00:00.000Z'),
      });

      expect(prisma.ecommerceOrderEvent.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getSettings / updateSettings', () => {
    it('creates the default (auto-blacklist off) row on first read', async () => {
      const { service, prisma } = build();

      await service.getSettings('store-1');

      expect(prisma.blacklistSettings.upsert).toHaveBeenCalledWith({
        where: { storeId: 'store-1' },
        create: { storeId: 'store-1' },
        update: {},
      });
    });

    it('applies a partial update', async () => {
      const { service, prisma } = build();
      prisma.blacklistSettings.update.mockResolvedValue({});

      await service.updateSettings('store-1', { returnsLimit: 5 });

      expect(prisma.blacklistSettings.update).toHaveBeenCalledWith({
        where: { storeId: 'store-1' },
        data: { returnsLimit: 5 },
      });
    });
  });

  describe('recordShipmentOutcome', () => {
    it('no-ops when the user has no store', async () => {
      const { prisma } = build();
      const prismaWithStore = {
        ...prisma,
        store: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const serviceWithStore = new CustomerRiskService(
        prismaWithStore as never,
      );

      await serviceWithStore.recordShipmentOutcome({
        userId: 'user-1',
        phone: '+212600000001',
        outcome: 'REFUSALS',
      });

      expect(prisma.customer.upsert).not.toHaveBeenCalled();
    });

    it('resolves the store from userId, then upserts the customer and increments the counter', async () => {
      const { prisma } = build();
      const findUnique = jest.fn().mockResolvedValue({ id: 'store-1' });
      const prismaWithStore = { ...prisma, store: { findUnique } };
      const serviceWithStore = new CustomerRiskService(
        prismaWithStore as never,
      );
      prisma.customer.upsert.mockResolvedValue({
        id: 'customer-1',
        isBlacklisted: false,
      });
      prisma.customer.update.mockResolvedValue({
        id: 'customer-1',
        isBlacklisted: false,
        returnsCount: 0,
        cancellationsCount: 0,
        refusalsCount: 0,
        noAnswerCount: 1,
      });

      await serviceWithStore.recordShipmentOutcome({
        userId: 'user-1',
        phone: '+212600000001',
        name: 'Sara',
        outcome: 'NO_ANSWER',
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true },
      });
      expect(prisma.customer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId_phone: { storeId: 'store-1', phone: '+212600000001' },
          },
        }),
      );
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: { noAnswerCount: { increment: 1 } },
      });
    });
  });
});
