import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';
import type { OrderStockService } from './order-stock.service';
import type { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';

describe('EcommerceService', () => {
  it('returns provider-neutral product lines for an internal order ID', async () => {
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: '12345678-1234-1234-1234-123456789012',
          externalOrderId: 'gid://shopify/Order/42',
          connection: { platform: 'SHOPIFY' },
        }),
      },
    } as any;
    const sourceProducts = {
      platform: 'SHOPIFY',
      externalOrderId: 'gid://shopify/Order/42',
      orderReference: '#42',
      currency: 'MAD',
      complete: true,
      products: [
        {
          lineItemId: 'gid://shopify/LineItem/1',
          productId: 'gid://shopify/Product/10',
          variantId: 'gid://shopify/ProductVariant/11',
          title: 'Leather bag',
          variantTitle: 'Brown',
          sku: 'BAG-BROWN',
          quantity: 2,
          unitPrice: '149.9000',
          totalPrice: '299.8000',
          currency: 'MAD',
          imageUrl: null,
        },
      ],
    };
    const shopify = {
      fetchOrderProducts: jest.fn().mockResolvedValue(sourceProducts),
    };
    const service = new EcommerceService(
      prisma,
      shopify as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    await expect(
      service.getOrderProducts(
        'user-id',
        '12345678-1234-1234-1234-123456789012',
      ),
    ).resolves.toEqual({
      orderId: '12345678-1234-1234-1234-123456789012',
      ...sourceProducts,
      itemCount: 2,
      productLineCount: 1,
    });
    expect(shopify.fetchOrderProducts).toHaveBeenCalledWith(
      'user-id',
      'gid://shopify/Order/42',
    );
  });

  it('dispatches a normalized order through the selected real courier client', async () => {
    const order = {
      id: '12345678-1234-1234-1234-123456789012',
      externalOrderId: 'gid://shopify/Order/42',
      connection: { platform: 'SHOPIFY' },
      dispatch: null,
      lines: [],
    };
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      ecommerceOrderDispatch: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({ status: 'DISPATCHED' }),
        updateMany: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: unknown) =>
          Array.isArray(ops) ? Promise.all(ops) : Promise.resolve([]),
        ),
    } as any;
    const fulfillment = {
      platform: 'SHOPIFY',
      externalOrderId: order.externalOrderId,
      orderReference: '#42',
      recipientName: 'Sara Amrani',
      recipientPhone: '0612345678',
      address: '12 Rue Al Massira',
      city: 'Casablanca',
      country: 'Morocco',
      currency: 'MAD',
      codAmount: '349.90',
      lineItems: [{ title: 'Leather bag', sku: 'BAG-1', quantity: 1 }],
      notes: 'Call first',
      status: 'OPEN',
      financialStatus: 'PENDING',
      fulfillmentStatus: 'UNFULFILLED',
    };
    const shopifyFulfillment = {
      fetchFulfillmentPreview: jest.fn().mockResolvedValue(fulfillment),
    };
    const shipping = {
      createQuickLivraisonDelivery: jest.fn().mockResolvedValue({
        success: 'Colis ajouté avec succès.',
        tracking_number: 'PARCEL_12345678',
      }),
    };
    const orderStock = { reserveOrder: jest.fn().mockResolvedValue(undefined) };
    const service = new EcommerceService(
      prisma,
      shopifyFulfillment as any,
      {} as any,
      {} as any,
      {
        convertAmount: jest
          .fn()
          .mockResolvedValue(new Prisma.Decimal('349.90')),
      } as any,
      shipping as any,
      orderStock as any,
      {} as any,
      {} as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    const result = await service.dispatchOrder('user-id', order.id, {
      provider: 'QUICKLIVRAISON' as any,
      options: { destinationDistrictId: 123, allowOpen: true },
    });

    expect(shipping.createQuickLivraisonDelivery).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({
        district_id: 123,
        name: 'Sara Amrani',
        amount: 349.9,
        code: 'ORD-12345678',
        open: true,
      }),
    );
    expect(prisma.ecommerceOrderDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING' }),
    });
    expect(prisma.ecommerceOrderDispatch.update).toHaveBeenCalledWith({
      where: { orderId: order.id },
      data: expect.objectContaining({
        status: 'DISPATCHED',
        providerTracking: 'PARCEL_12345678',
      }),
    });
    expect(orderStock.reserveOrder).toHaveBeenCalledWith(order.id);
    expect(result).toEqual({
      trackingNumber: 'PARCEL_12345678',
      status: 'DISPATCHED',
      provider: 'QUICKLIVRAISON',
      merchantTracking: 'ORD-12345678',
    });
  });

  it('refuses to dispatch an order cancelled as a duplicate', async () => {
    const prisma = {
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: '12345678-1234-1234-1234-123456789012',
          connection: { platform: 'SHOPIFY' },
          dispatch: null,
          duplicateReview: { decision: 'CANCELLED' },
        }),
      },
      ecommerceOrderDispatch: { create: jest.fn() },
    } as any;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      } as never,
    );

    await expect(
      service.dispatchOrder('user-id', '12345678-1234-1234-1234-123456789012', {
        provider: 'QUICKLIVRAISON' as any,
        options: {},
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.ecommerceOrderDispatch.create).not.toHaveBeenCalled();
  });

  it('converts all platform revenue to the store base currency', async () => {
    const rows = [
      aggregateRow('SHOPIFY', 'MAD', '100.0000'),
      aggregateRow('YOUCAN', 'AED', '50.0000'),
      aggregateRow('LIGHTFUNNELS', 'USD', '25.0000'),
    ];
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceConnection: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { lastSyncedAt: new Date('2026-07-19T10:00:00.000Z') },
          ]),
      },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {
        convertAmount: jest
          .fn()
          .mockImplementation(async (amount, from, to) => {
            if (from === 'MAD') return amount;
            if (from === 'AED') return amount.times(new Prisma.Decimal(2)); // mock AED -> MAD = x2
            if (from === 'USD') return amount.times(new Prisma.Decimal(10)); // mock USD -> MAD = x10
            return amount;
          }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    const result = await service.getRevenueSummary('user-id', {
      timezone: 'Africa/Casablanca',
    });

    expect(result.totalsByCurrency).toHaveLength(1);
    expect(result.totalsByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'MAD',
          totalCollected: '450.0000', // 100 + (50 * 2) + (25 * 10) = 450
        }),
      ]),
    );
    expect(result.byPlatform).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'SHOPIFY',
          currency: 'MAD',
          totalCollected: '100.0000',
        }),
        expect.objectContaining({
          platform: 'YOUCAN',
          currency: 'MAD',
          totalCollected: '100.0000',
        }),
        expect.objectContaining({
          platform: 'LIGHTFUNNELS',
          currency: 'MAD',
          totalCollected: '250.0000',
        }),
      ]),
    );
    expect(result.dataFreshAsOf).toBe('2026-07-19T10:00:00.000Z');
  });

  it('rejects invalid calendar dates before querying revenue', async () => {
    const queryRaw = jest.fn();
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'store-id' }),
      },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {
        convertAmount: jest
          .fn()
          .mockImplementation(async (amount, from, to) => amount),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    await expect(
      service.getRevenueSummary('user-id', {
        from: '2026-02-31',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('creates a manual order by resolving product codes to warehouse variants', async () => {
    const connectionUpsert = jest
      .fn()
      .mockResolvedValue({ id: 'connection-1' });
    let orderCreateArgs:
      | {
          data: {
            manualCustomerName: string;
            grossSales: Prisma.Decimal;
            itemCount: number;
            lines: { createMany: { data: unknown[] } };
          };
        }
      | undefined;
    const orderCreate = jest.fn((args: typeof orderCreateArgs) => {
      orderCreateArgs = args;
      return Promise.resolve({});
    });
    const tx = {
      ecommerceConnection: { upsert: connectionUpsert },
      ecommerceOrder: { create: orderCreate },
    };
    const orderFindUnique = jest.fn().mockResolvedValue({
      id: 'order-1',
      externalOrderId: 'MANUAL-order-1',
      orderName: '#ORDER-1',
      connection: { platform: 'MANUAL' },
      status: 'OPEN',
      financialStatus: 'PENDING',
      fulfillmentStatus: null,
      currency: 'MAD',
      grossSales: new Prisma.Decimal('600.0000'),
      discounts: new Prisma.Decimal(0),
      shipping: new Prisma.Decimal(0),
      refunds: new Prisma.Decimal(0),
      netSales: new Prisma.Decimal('600.0000'),
      totalCollected: new Prisma.Decimal('600.0000'),
      codAmount: null,
      codStatus: null,
      itemCount: 2,
      processedAt: new Date('2026-08-30T10:00:00.000Z'),
      cancelledAt: null,
      dispatch: null,
    });
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      warehouseVariant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'variant-1',
            productCode: 'DH564BJ0',
            price: new Prisma.Decimal('300.0000'),
            title: 'Black M',
            product: { name: 'Nike T-Shirt Black M' },
          },
        ]),
      },
      ecommerceOrder: { findUnique: orderFindUnique },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        upsertCustomer: jest.fn().mockResolvedValue(null),
        recordNewOrder: jest.fn(),
      } as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    const result = await service.createManualOrder('user-id', {
      customerName: 'Ahmed',
      customerPhone: '+212612345678',
      shippingAddress: '123 Rue Al Massira',
      items: [{ productCode: 'DH564BJ0', quantity: 2 }],
    });

    expect(connectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId_platform: { storeId: 'store-id', platform: 'MANUAL' },
        },
      }),
    );
    expect(orderCreateArgs?.data.manualCustomerName).toBe('Ahmed');
    expect(orderCreateArgs?.data.itemCount).toBe(2);
    expect(orderCreateArgs?.data.grossSales.toFixed(2)).toBe('600.00');
    expect(orderCreateArgs?.data.lines.createMany.data).toHaveLength(1);
    expect(result.id).toBe('order-1');
  });

  it('rejects a manual order referencing an unknown product code', async () => {
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      warehouseVariant: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        upsertCustomer: jest.fn().mockResolvedValue(null),
        recordNewOrder: jest.fn(),
      } as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    await expect(
      service.createManualOrder('user-id', {
        customerName: 'Ahmed',
        customerPhone: '+212612345678',
        shippingAddress: '123 Rue Al Massira',
        items: [{ productCode: 'UNKNOWN1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replays an existing manual order instead of duplicating it when the same idempotencyKey is reused', async () => {
    let orderFindFirstArgs: { where: Record<string, unknown> } | undefined;
    const orderFindFirst = jest.fn(
      (args: { where: Record<string, unknown> }) => {
        orderFindFirstArgs = args;
        return Promise.resolve({ id: 'existing-order-1' });
      },
    );
    const orderFindUnique = jest.fn().mockResolvedValue({
      id: 'existing-order-1',
      externalOrderId: 'MANUAL-existing-order-1',
      orderName: '#EXISTING1',
      connection: { platform: 'MANUAL' },
      status: 'OPEN',
      financialStatus: 'PENDING',
      fulfillmentStatus: null,
      currency: 'MAD',
      grossSales: new Prisma.Decimal(0),
      discounts: new Prisma.Decimal(0),
      shipping: new Prisma.Decimal(0),
      refunds: new Prisma.Decimal(0),
      netSales: new Prisma.Decimal(0),
      totalCollected: new Prisma.Decimal(0),
      codAmount: null,
      codStatus: null,
      itemCount: 1,
      processedAt: new Date(),
      cancelledAt: null,
      dispatch: null,
    });
    const variantFindMany = jest.fn();
    const transaction = jest.fn();
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      warehouseVariant: { findMany: variantFindMany },
      ecommerceOrder: {
        findFirst: orderFindFirst,
        findUnique: orderFindUnique,
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        upsertCustomer: jest.fn().mockResolvedValue(null),
        recordNewOrder: jest.fn(),
      } as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    const result = await service.createManualOrder('user-id', {
      idempotencyKey: 'whatsapp-retry-001',
      customerName: 'Ahmed',
      customerPhone: '+212612345678',
      shippingAddress: '123 Rue Al Massira',
      items: [{ productCode: 'DH564BJ0', quantity: 1 }],
    });

    expect(result.id).toBe('existing-order-1');
    expect(orderFindFirstArgs?.where).toMatchObject({
      externalOrderId: 'MANUAL-whatsapp-retry-001',
    });
    // Short-circuited before touching the catalog or writing anything.
    expect(variantFindMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('passes a condition correction to order stock and sets the line loss to the damage cost', async () => {
    const applyReturnCondition = jest.fn().mockResolvedValue(true);
    const setLineLoss = jest.fn().mockResolvedValue({});
    const line = {
      id: 'line-1',
      quantity: 1,
      condition: 'GOOD', // previously recorded as GOOD
      damageCost: null,
      warehouseVariant: {
        costPrice: new Prisma.Decimal('90.00'),
        productCode: 'DH564BJ0',
        inventoryItem: { id: 'inventory-item-1' },
      },
    };
    const order = {
      id: 'order-1',
      orderName: '#ORDER1',
      currency: 'MAD',
      lines: [line],
    };
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      ecommerceOrderLine: { update: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const orderStock = {
      applyReturnCondition,
    } as unknown as OrderStockService;
    const financialService = {
      setLineLoss,
    } as unknown as EcommerceOrderFinancialService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      orderStock,
      financialService,
      {} as any,
      {
        require: jest.fn(),
        requireOwner: jest.fn(),
        requireStore: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
        touchLastActive: jest.fn(),
      } as never,
    );

    const result = await service.recordProductCondition('user-id', 'order-1', {
      productCode: 'DH564BJ0',
      condition: 'DAMAGED',
      damageCost: 60,
    });

    expect(applyReturnCondition).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-id',
        orderId: 'order-1',
        lineId: 'line-1',
        condition: 'DAMAGED',
        isCorrection: true,
      }),
    );
    expect(result.inventoryUpdated).toBe(true);
    expect(setLineLoss).toHaveBeenCalledTimes(1);
    const [orderId, lineId, currency, target, reason] = setLineLoss.mock
      .calls[0] as [string, string, string, Prisma.Decimal, string];
    expect([orderId, lineId, currency]).toEqual(['order-1', 'line-1', 'MAD']);
    expect(target.toFixed(2)).toBe('60.00');
    expect(reason).toContain('corrected');
  });
});

function aggregateRow(
  platform: string,
  currency: string,
  totalCollected: string,
) {
  return {
    platform,
    currency,
    orderCount: 1,
    grossSales: new Prisma.Decimal(totalCollected),
    discounts: new Prisma.Decimal(0),
    refunds: new Prisma.Decimal(0),
    netSales: new Prisma.Decimal(totalCollected),
    shipping: new Prisma.Decimal(0),
    tax: new Prisma.Decimal(0),
    totalCollected: new Prisma.Decimal(totalCollected),
  };
}
