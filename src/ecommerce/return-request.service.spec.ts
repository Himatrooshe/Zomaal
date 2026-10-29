import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReturnRequestStatus } from '@prisma/client';
import { ReturnRequestService } from './return-request.service';
import type { StoreAccess } from '../access/store-access.service';
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
      findUniqueOrThrow: jest.fn(),
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
      groupBy: jest.fn().mockResolvedValue([]),
    },
    ecommerceOrderDispatch: {
      findFirst: jest.fn(),
    },
    ecommerceOrderEvent: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      {
        currency: 'MAD',
        totalCount: 0n,
        totalValue: new Prisma.Decimal(0),
        pendingCount: 0n,
        pendingValue: new Prisma.Decimal(0),
      },
    ]),
  };

  const ecommerceService = {
    resolveScannedCode: jest.fn().mockRejectedValue(new NotFoundException()),
    getFulfillmentPreview: jest.fn(),
    recordProductConditionByLineId: jest.fn(),
    verifyProductConditions: jest.fn().mockResolvedValue(undefined),
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

  const storeAccess = {
    require: jest.fn(),
    requireOwner: jest.fn(),
    requireStore: jest
      .fn()
      .mockResolvedValue({ id: 'store-1', baseCurrency: 'MAD' }),
    touchLastActive: jest.fn(),
  };

  const currency = { convertOrNull: jest.fn().mockResolvedValue(null) };
  const service = new ReturnRequestService(
    prisma as never,
    ecommerceService as never,
    financialService as never,
    customerRisk as never,
    storeAccess as never,
    currency as never,
  );

  return {
    service,
    prisma,
    ecommerceService,
    financialService,
    customerRisk,
    storeAccess,
    currency,
  };
}

const ORDER_LINE = {
  id: 'line-1',
  sku: 'PLATFORM-SKU-1',
  name: 'Product line-1',
  quantity: 1,
  totalPrice: new Prisma.Decimal('300.00'),
  condition: null,
  damageCost: null,
  warehouseVariant: {
    costPrice: new Prisma.Decimal('90.00'),
    productCode: 'DH564BJ0',
    media: [{ id: 'media-variant-1' }],
    product: { media: [] },
  },
};

const ORDER = {
  id: 'order-1',
  currency: 'MAD',
  orderName: 'ORD-1001',
  customerId: null,
  manualCustomerName: 'Customer One',
  manualCustomerPhone: '+212600000001',
  manualShippingAddress: 'Casablanca',
  lines: [ORDER_LINE],
};

describe('ReturnRequestService', () => {
  describe('search', () => {
    it.each([undefined, null, '', '   ', '\t\n', [], {}, 123])(
      'rejects invalid search input %j before querying orders',
      async (query) => {
        const { service, prisma } = build();

        await expect(
          service.search('user-1', query as never),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.ecommerceOrder.findMany).not.toHaveBeenCalled();
      },
    );

    it('trims valid searches and keeps them scoped to the current store', async () => {
      const { service, prisma } = build();

      await expect(service.search('user-1', '  ORD-1001  ')).resolves.toEqual({
        data: [],
      });
      expect(prisma.ecommerceOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            connection: { storeId: 'store-1' },
            OR: expect.arrayContaining([
              { id: 'ORD-1001' },
              {
                externalOrderId: { contains: 'ORD-1001', mode: 'insensitive' },
              },
              { orderName: { contains: 'ORD-1001', mode: 'insensitive' } },
              {
                manualCustomerName: {
                  contains: 'ORD-1001',
                  mode: 'insensitive',
                },
              },
              { manualCustomerPhone: { contains: 'ORD-1001' } },
            ]) as Prisma.EcommerceOrderWhereInput[],
          },
          take: 20,
        }),
      );
    });
  });

  describe('list', () => {
    it('includes store baseCurrency on the response', async () => {
      const { service, storeAccess } = build();

      const result = await service.list('user-1', {});

      expect(result.currency).toBe('MAD');
      expect(result.summary.totalReturns).toEqual({
        value: '0.00',
        orders: 0,
      });
      expect(storeAccess.requireStore).toHaveBeenCalledWith('user-1');
    });

    it('searches returns by internal order ID within the active store', async () => {
      const { service, prisma } = build();
      await service.list('user-1', { search: 'internal-order-id' });
      expect(prisma.returnRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            order: {
              connection: { storeId: 'store-1' },
              OR: expect.arrayContaining([
                { id: 'internal-order-id' },
                {
                  externalOrderId: {
                    contains: 'internal-order-id',
                    mode: 'insensitive',
                  },
                },
                {
                  orderName: {
                    contains: 'internal-order-id',
                    mode: 'insensitive',
                  },
                },
              ]) as Prisma.EcommerceOrderWhereInput[],
            },
          },
        }),
      );
    });

    it('reuses request access without another store lookup', async () => {
      const { service, storeAccess } = build();
      const access: StoreAccess = {
        userId: 'user-1',
        storeId: 'store-2',
        baseCurrency: 'BDT',
        isOwner: true,
        staffMemberId: null,
        permissions: [],
      };
      const result = await service.list('user-1', {}, access);
      expect(result.currency).toBe('BDT');
      expect(storeAccess.requireStore).not.toHaveBeenCalled();
    });

    it('does not reuse access belonging to another user', async () => {
      const { service, storeAccess } = build();
      await service.list(
        'user-1',
        {},
        {
          userId: 'other-user',
          storeId: 'other-store',
          baseCurrency: 'USD',
          isOwner: true,
          staffMemberId: null,
          permissions: [],
        },
      );
      expect(storeAccess.requireStore).toHaveBeenCalledWith('user-1');
    });

    it('converts mixed-currency rows and all summary cards before adding them', async () => {
      const { service, prisma, currency } = build();
      currency.convertOrNull.mockResolvedValue(new Prisma.Decimal(10));
      prisma.$queryRaw.mockResolvedValue([
        {
          currency: 'MAD',
          totalCount: 1n,
          pendingCount: 0n,
          totalValue: new Prisma.Decimal(100),
          pendingValue: new Prisma.Decimal(0),
        },
        {
          currency: 'USD',
          totalCount: 1n,
          pendingCount: 1n,
          totalValue: new Prisma.Decimal(10),
          pendingValue: new Prisma.Decimal(10),
        },
      ]);
      prisma.ecommerceOrder.groupBy.mockResolvedValue([
        {
          currency: 'USD',
          _sum: { totalCollected: new Prisma.Decimal(5) },
          _count: 1,
        },
        {
          currency: 'MAD',
          _sum: { totalCollected: new Prisma.Decimal(20) },
          _count: 1,
        },
      ]);
      prisma.returnRequest.findMany.mockResolvedValue([
        {
          id: 'rr-usd',
          order: { id: 'order-usd', currency: 'USD' },
          createdAt: new Date(),
          status: 'NEED_VERIFICATION',
          lines: [
            {
              orderLine: { ...ORDER_LINE, totalPrice: new Prisma.Decimal(10) },
            },
          ],
        },
      ]);
      const result = await service.list('user-1', {});
      expect(result.summary).toEqual({
        totalReturns: { value: '200.00', orders: 2 },
        pendingVerification: { value: '100.00', orders: 1 },
        totalOrderConfirm: { value: '70.00', orders: 2 },
      });
      expect(result.data[0].value).toBe('100.00');
      expect(currency.convertOrNull).toHaveBeenCalledTimes(1);
    });

    it('fails rather than showing incomplete totals when a rate is unavailable', async () => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([
        {
          currency: 'USD',
          totalCount: 1n,
          pendingCount: 1n,
          totalValue: new Prisma.Decimal(10),
          pendingValue: new Prisma.Decimal(10),
        },
      ]);
      await expect(service.list('user-1', {})).rejects.toThrow(
        'Exchange rate USD → MAD is unavailable',
      );
    });

    it('throws when the user has no store', async () => {
      const { service, storeAccess } = build();
      storeAccess.requireStore.mockRejectedValue(
        new NotFoundException('Store not found'),
      );

      await expect(service.list('user-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('detect', () => {
    it('rejects an unknown code without creating a return', async () => {
      const { service, prisma } = build();
      await expect(
        service.detect('user-1', { value: 'ORD-NOT-EXIST' }),
      ).rejects.toThrow('No order matches this code');
      expect(prisma.ecommerceOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            connection: { storeId: 'store-1' },
            OR: [
              { id: 'ORD-NOT-EXIST' },
              { externalOrderId: 'ORD-NOT-EXIST' },
              { orderName: 'ORD-NOT-EXIST' },
            ],
          },
        }),
      );
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it('rejects ambiguous order references without creating a return', async () => {
      const { service, prisma } = build();
      prisma.ecommerceOrder.findMany.mockResolvedValue([
        ORDER,
        { ...ORDER, id: 'order-2' },
      ]);
      await expect(
        service.detect('user-1', { value: 'ORD-1001' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it('preserves ambiguous tracking errors instead of falling back to an order reference', async () => {
      const { service, prisma, ecommerceService } = build();
      ecommerceService.resolveScannedCode.mockRejectedValue(
        new ConflictException('Ambiguous tracking'),
      );
      await expect(
        service.detect('user-1', { value: 'TRACK-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.ecommerceOrder.findMany).not.toHaveBeenCalled();
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it('does not reinterpret an unknown QR payload as an order reference', async () => {
      const { service, prisma } = build();
      await expect(
        service.detect('user-1', { value: '{"trackingNumber":"UNKNOWN"}' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ecommerceOrder.findMany).not.toHaveBeenCalled();
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it("rejects another store's explicit order without creating a return", async () => {
      const { service, prisma } = build();
      prisma.ecommerceOrder.findFirst.mockResolvedValue(null);
      await expect(
        service.detect('user-1', {
          value: 'ORD-OTHER',
          orderId: 'other-order',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ecommerceOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'other-order', connection: { storeId: 'store-1' } },
        }),
      );
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it.each([
      {
        condition: ProductCondition.LOST,
        damageCost: null,
        conditionAllocations: undefined,
        expected: '24.00',
        calls: 1,
      },
      {
        condition: ProductCondition.DAMAGED,
        damageCost: new Prisma.Decimal(2),
        conditionAllocations: undefined,
        expected: '17.00',
        calls: 0,
      },
      {
        condition: ProductCondition.LOST,
        damageCost: null,
        conditionAllocations: {
          version: 1,
          entries: [],
          loss: '4.00',
          completed: true,
        },
        expected: '19.00',
        calls: 0,
      },
    ])(
      'keeps the loss preview in order currency without double-converting saved loss ($expected)',
      async ({
        condition,
        damageCost,
        conditionAllocations,
        expected,
        calls,
      }) => {
        const { service, prisma, currency } = build();
        currency.convertOrNull.mockResolvedValue(new Prisma.Decimal('0.1'));
        const line = {
          ...ORDER_LINE,
          condition,
          damageCost,
          conditionAllocations,
        };
        prisma.ecommerceOrder.findFirst.mockResolvedValue({
          ...ORDER,
          currency: 'USD',
          lines: [line],
        });
        prisma.returnRequest.findFirst.mockResolvedValue({
          id: 'rr-usd',
          status: 'NEED_VERIFICATION',
          createdAt: new Date(),
          lines: [{ orderLine: line }],
        });
        const result = await service.detect('user-1', {
          value: 'ORD-1001',
          orderId: ORDER.id,
        });
        expect(result.currency).toBe('USD');
        expect(result.lossSummary.netLoss).toBe(expected);
        expect(currency.convertOrNull).toHaveBeenCalledTimes(calls);
      },
    );

    it('checks required conversion before creating a return', async () => {
      const { service, prisma } = build();
      prisma.ecommerceOrder.findFirst.mockResolvedValue({
        ...ORDER,
        currency: 'USD',
        lines: [{ ...ORDER_LINE, condition: ProductCondition.LOST }],
      });
      await expect(
        service.detect('user-1', { value: 'ORD-1001', orderId: ORDER.id }),
      ).rejects.toThrow('Exchange rate MAD → USD is unavailable');
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

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
      expect(
        financialService.resolveEffectiveShippingCost,
      ).toHaveBeenCalledWith(ORDER.id);
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
    it('validates every line before writing any conditions', async () => {
      const { service, prisma, ecommerceService } = build();
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-1',
        orderId: ORDER.id,
        lines: [{ orderLineId: 'line-1' }],
      });

      await expect(
        service.verify('user-1', 'rr-1', {
          lines: [
            { orderLineId: 'line-1', condition: ProductCondition.LOST },
            { orderLineId: 'foreign-line', condition: ProductCondition.GOOD },
          ],
        }),
      ).rejects.toThrow('is not part of this return request');
      expect(ecommerceService.verifyProductConditions).not.toHaveBeenCalled();
      expect(prisma.returnRequest.update).not.toHaveBeenCalled();
    });

    it('checks conversion before committing any conditions', async () => {
      const { service, prisma, ecommerceService } = build();
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-usd',
        orderId: ORDER.id,
        order: { id: ORDER.id, currency: 'USD' },
        lines: [{ orderLineId: 'line-1' }],
      });
      await expect(
        service.verify('user-1', 'rr-usd', {
          lines: [{ orderLineId: 'line-1', condition: ProductCondition.LOST }],
        }),
      ).rejects.toThrow('Exchange rate MAD → USD is unavailable');
      expect(ecommerceService.verifyProductConditions).not.toHaveBeenCalled();
    });

    it('records conditions and returns updated loss summary', async () => {
      const { service, prisma, ecommerceService } = build();
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-1',
        orderId: ORDER.id,
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: null,
        lines: [{ orderLineId: 'line-1' }],
        order: { id: ORDER.id, currency: ORDER.currency },
      });
      prisma.returnRequest.findUniqueOrThrow.mockResolvedValue({
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

      expect(ecommerceService.verifyProductConditions).toHaveBeenCalled();
      expect(result.status).toBe('PROCESSED');
      expect(result.lossSummary.netLoss).toBe('135.00'); // 15 delivery + 120 damage
    });

    it('counts a lost product at cost price, not selling price', async () => {
      const { service, prisma } = build();
      prisma.returnRequest.findFirst.mockResolvedValue({
        id: 'rr-1',
        orderId: ORDER.id,
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: null,
        lines: [{ orderLineId: 'line-1' }],
        order: { id: ORDER.id, currency: ORDER.currency },
      });
      prisma.returnRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'rr-1',
        status: ReturnRequestStatus.NEED_VERIFICATION,
        reason: null,
        lines: [
          {
            orderLine: { ...ORDER_LINE, condition: ProductCondition.LOST },
          },
        ],
      });

      const result = await service.verify('user-1', 'rr-1', {
        lines: [{ orderLineId: 'line-1', condition: ProductCondition.LOST }],
      });

      expect(result.lossSummary.netLoss).toBe('105.00'); // 15 delivery + 90 cost
    });
  });
});
