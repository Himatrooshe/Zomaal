import { NotFoundException } from '@nestjs/common';
import { Prisma, ReturnRequestStatus } from '@prisma/client';
import { ReturnRequestService } from './return-request.service';
import { ProductCondition } from './constants/product-condition';

function build() {
  const prisma = {
    store: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'store-1',
        baseCurrency: 'MAD',
      }),
    },
    returnRequest: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ecommerceOrder: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalCollected: null },
        _count: 0,
      }),
    },
    ecommerceOrderDispatch: {
      findFirst: jest.fn(),
    },
    ecommerceOrderEvent: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      {
        totalCount: 0n,
        totalValue: new Prisma.Decimal(0),
        pendingCount: 0n,
        pendingValue: new Prisma.Decimal(0),
      },
    ]),
  };

  const ecommerceService = {
    getFulfillmentPreview: jest.fn(),
    recordProductConditionByLineId: jest.fn(),
  };

  const financialService = {
    resolveEffectiveShippingCost: jest
      .fn()
      .mockResolvedValue(new Prisma.Decimal('15.00')),
  };

  const customerRisk = {
    upsertCustomer: jest.fn().mockResolvedValue({ id: 'customer-1' }),
    incrementRiskCounter: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ReturnRequestService(
    prisma as never,
    ecommerceService as never,
    financialService as never,
    customerRisk as never,
  );

  return { service, prisma, ecommerceService, financialService, customerRisk };
}

const ORDER_LINE = {
  id: 'line-1',
  sku: 'DH564BJ0',
  name: 'Product line-1',
  quantity: 1,
  totalPrice: new Prisma.Decimal('300.00'),
  condition: null,
  damageCost: null,
  warehouseVariant: {
    media: [{ id: 'media-variant-1' }],
    product: { media: [] },
  },
};

const ORDER = {
  id: 'order-1',
  orderName: 'ORD-1001',
  customerId: null,
  manualCustomerName: 'Customer One',
  manualCustomerPhone: '+212600000001',
  manualShippingAddress: 'Casablanca',
  lines: [ORDER_LINE],
};

describe('ReturnRequestService', () => {
  describe('list', () => {
    it('includes store baseCurrency on the response', async () => {
      const { service, prisma } = build();
      prisma.returnRequest.count.mockResolvedValue(0);
      prisma.returnRequest.findMany.mockResolvedValue([]);

      const result = await service.list('user-1', {});

      expect(result.currency).toBe('MAD');
      expect(result.summary.totalReturns).toEqual({
        value: '0.00',
        orders: 0,
      });
      expect(prisma.store.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true, baseCurrency: true },
      });
    });

    it('throws when the user has no store', async () => {
      const { service, prisma } = build();
      prisma.store.findUnique.mockResolvedValue(null);

      await expect(service.list('user-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('detect', () => {
    it('returns reason and warehouse imageUrl for an existing open return', async () => {
      const { service, prisma, financialService } = build();
      prisma.ecommerceOrder.findFirst.mockResolvedValue(ORDER);
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-1',
        orderId: ORDER.id,
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: 'Damaged in transit',
        createdAt: new Date(),
        lines: [{ orderLine: ORDER_LINE }],
      });

      const result = await service.detect('user-1', {
        value: 'ORD-1001',
        orderId: ORDER.id,
      });

      expect(result.reason).toBe('Damaged in transit');
      expect(result.products[0]).toMatchObject({
        orderLineId: 'line-1',
        productCode: 'DH564BJ0',
        imageUrl: '/warehouse/media/media-variant-1/content',
      });
      expect(result.lossSummary.deliveryCost).toBe('15.00');
      expect(financialService.resolveEffectiveShippingCost).toHaveBeenCalledWith(
        ORDER.id,
      );
    });

    it('leaves imageUrl null when the line has no warehouse media', async () => {
      const { service, prisma } = build();
      const bareLine = {
        ...ORDER_LINE,
        warehouseVariant: null,
      };
      prisma.ecommerceOrder.findFirst.mockResolvedValue({
        ...ORDER,
        lines: [bareLine],
      });
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-2',
        orderId: ORDER.id,
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: null,
        createdAt: new Date(),
        lines: [{ orderLine: bareLine }],
      });

      const result = await service.detect('user-1', {
        value: 'ORD-1001',
        orderId: ORDER.id,
      });

      expect(result.reason).toBeNull();
      expect(result.products[0].imageUrl).toBeNull();
    });
  });

  describe('verify', () => {
    it('records conditions and returns updated loss summary', async () => {
      const { service, prisma, ecommerceService } = build();
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-1',
        orderId: ORDER.id,
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: null,
        lines: [{ orderLineId: 'line-1' }],
        order: { id: ORDER.id },
      });
      prisma.returnRequest.update.mockResolvedValue({
        id: 'rr-1',
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: 'Box crushed',
        lines: [
          {
            orderLine: {
              ...ORDER_LINE,
              condition: ProductCondition.DAMAGED,
              damageCost: new Prisma.Decimal('120.00'),
            },
          },
        ],
      });

      const result = await service.verify('user-1', 'rr-1', {
        reason: 'Box crushed',
        lines: [
          {
            orderLineId: 'line-1',
            condition: ProductCondition.DAMAGED,
            damageCost: 120,
          },
        ],
      });

      expect(ecommerceService.recordProductConditionByLineId).toHaveBeenCalled();
      expect(result.status).toBe('PROCESSED');
      expect(result.lossSummary.netLoss).toBe('135.00'); // 15 delivery + 120 damage
    });
  });
});
