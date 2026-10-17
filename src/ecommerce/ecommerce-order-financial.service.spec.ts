import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';
import type { OrderStockService } from './order-stock.service';

type StoredEvent = Record<string, Prisma.Decimal | string>;

function deliveredLine() {
  return {
    id: 'line-1',
    quantity: 2,
    warehouseVariant: {
      id: 'variant-1',
      costPrice: new Prisma.Decimal(60),
      inventoryItem: null,
      product: {
        kind: 'STANDARD',
        bundleComponents: [],
        gift: {
          quantity: 1,
          giftVariant: {
            costPrice: new Prisma.Decimal(10),
            inventoryItem: null,
            product: { kind: 'STANDARD', bundleComponents: [] },
          },
        },
        packagingRequirements: [
          {
            variantId: null,
            quantityPerUnit: 1,
            packagingMaterialId: 'box',
            packagingMaterial: { inventoryItem: null },
          },
        ],
      },
    },
  };
}

function setup(status: ShippingShipmentStatus) {
  const events = new Map<string, StoredEvent>();
  const prisma = {
    ecommerceOrderDispatch: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'dispatch-1',
        order: {
          id: 'order-1',
          currency: 'MAD',
          totalCollected: new Prisma.Decimal(300),
          shipping: new Prisma.Decimal(25),
          lines: [deliveredLine()],
        },
        senditShipment: {
          normalizedStatus: status,
          fee: new Prisma.Decimal(30),
        },
        quickLivraisonShipment: null,
        forceLogShipment: null,
        ozoneExpressShipment: null,
      }),
    },
    ecommerceOrderFinancialEvent: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { orderId_idempotencyKey: { idempotencyKey: string } };
        }) =>
          Promise.resolve(
            events.get(where.orderId_idempotencyKey.idempotencyKey) ?? null,
          ),
      ),
      create: jest.fn(({ data }: { data: StoredEvent }) => {
        const stored = {
          giftCost: new Prisma.Decimal(0),
          packagingCost: new Prisma.Decimal(0),
          ...data,
        };
        events.set(data.idempotencyKey as string, stored);
        return Promise.resolve(stored);
      }),
      upsert: jest.fn(({ create }: { create: StoredEvent }) => {
        const key = create.idempotencyKey as string;
        if (!events.has(key)) events.set(key, create);
        return Promise.resolve(events.get(key));
      }),
    },
    packagingMaterial: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'box', storeId: 'store-1', zomaalShopVariantId: 'shop-box' },
        ]),
    },
    merchantPurchase: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ unitPrice: new Prisma.Decimal(5) }),
    },
  };
  const orderStock = {
    deliverOrder: jest.fn().mockResolvedValue(undefined),
    releaseOrder: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EcommerceOrderFinancialService(
    prisma as unknown as PrismaService,
    orderStock as unknown as OrderStockService,
  );
  return { service, prisma, events, orderStock };
}

describe('EcommerceOrderFinancialService', () => {
  it('counts gift and packaging cost in net profit at delivery', async () => {
    const { service, events, orderStock } = setup(
      ShippingShipmentStatus.DELIVERED,
    );

    await service.syncFromDispatchId('dispatch-1');

    const recognized = events.get('revenue-recognized')!;
    expect((recognized.productCost as Prisma.Decimal).toFixed(2)).toBe(
      '120.00',
    );
    expect((recognized.giftCost as Prisma.Decimal).toFixed(2)).toBe('20.00');
    expect((recognized.packagingCost as Prisma.Decimal).toFixed(2)).toBe(
      '10.00',
    );
    expect((recognized.shippingCost as Prisma.Decimal).toFixed(2)).toBe(
      '30.00',
    );
    // 300 − 120 product − 30 shipping − 20 gift − 10 packaging
    expect((recognized.netProfitImpact as Prisma.Decimal).toFixed(2)).toBe(
      '120.00',
    );
    expect(orderStock.deliverOrder).toHaveBeenCalledWith('order-1', undefined);
  });

  it('books the courier fee as a loss when a parcel is refused before delivery', async () => {
    const { service, events } = setup(ShippingShipmentStatus.REFUSED);

    await service.syncFromDispatchId('dispatch-1');
    await service.syncFromDispatchId('dispatch-1');

    expect([...events.keys()]).toEqual(['shipping-loss']);
    const loss = events.get('shipping-loss')!;
    expect(loss.type).toBe('SHIPPING_LOSS');
    expect((loss.netProfitImpact as Prisma.Decimal).toFixed(2)).toBe('-30.00');
  });

  it('books shipping as a loss when a plugin-shipped parcel is returned undelivered', async () => {
    const { service, prisma, events } = setup(ShippingShipmentStatus.PENDING);
    Object.assign(prisma, {
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue({ dispatch: null }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'order-1',
          currency: 'MAD',
          shipping: new Prisma.Decimal(25),
        }),
      },
      ecommerceOrderEvent: {
        findMany: jest.fn().mockResolvedValue([
          { type: 'IN_TRANSIT', occurredAt: new Date('2026-10-01') },
          { type: 'RETURNED', occurredAt: new Date('2026-10-03') },
        ]),
      },
    });

    await service.syncUndispatchedOrder('order-1');

    expect(
      (events.get('shipping-loss')!.netProfitImpact as Prisma.Decimal).toFixed(
        2,
      ),
    ).toBe('-25.00');
  });

  it('marks cash on delivery failed when the courier reports a refusal', async () => {
    const { service, prisma } = setup(ShippingShipmentStatus.REFUSED);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    Object.assign(prisma, {
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue({
          codStatus: 'PENDING',
          financialStatus: 'PENDING',
          dispatch: {
            senditShipment: {
              normalizedStatus: ShippingShipmentStatus.REFUSED,
            },
            quickLivraisonShipment: null,
            forceLogShipment: null,
            ozoneExpressShipment: null,
          },
        }),
        updateMany,
      },
    });

    await service.syncFromDispatchId('dispatch-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', codStatus: 'PENDING' },
      data: { codStatus: 'FAILED' },
    });
  });

  it('books no shipping loss for a plain cancellation', async () => {
    const { service, events } = setup(ShippingShipmentStatus.CANCELLED);
    await service.syncFromDispatchId('dispatch-1');
    expect(events.size).toBe(0);
  });

  it('keeps shipping, gift and packaging cost when a delivered order is reversed', async () => {
    const { service, prisma, events } = setup(ShippingShipmentStatus.DELIVERED);
    await service.syncFromDispatchId('dispatch-1');

    prisma.ecommerceOrderDispatch.findUnique.mockResolvedValueOnce({
      ...(await prisma.ecommerceOrderDispatch.findUnique()),
      senditShipment: {
        normalizedStatus: ShippingShipmentStatus.RETURNED_TO_SELLER,
        fee: new Prisma.Decimal(30),
      },
    });
    await service.syncFromDispatchId('dispatch-1');

    const reversed = events.get('revenue-reversed')!;
    // Undoes revenue 300 − product 120 = 180; shipping 30 and gift +
    // packaging 30 stay as costs.
    expect((reversed.netProfitImpact as Prisma.Decimal).toFixed(2)).toBe(
      '-180.00',
    );
    expect((reversed.shippingCost as Prisma.Decimal).toFixed(2)).toBe('0.00');
    expect(events.has('shipping-loss')).toBe(false);
    const net = [...events.values()].reduce(
      (sum, event) => sum.plus(event.netProfitImpact as Prisma.Decimal),
      new Prisma.Decimal(0),
    );
    expect(net.toFixed(2)).toBe('-60.00');
  });

  it('books only the change when a return condition loss is corrected', async () => {
    const ledger: Array<{
      idempotencyKey: string;
      damageCost: Prisma.Decimal;
      netProfitImpact: Prisma.Decimal;
    }> = [];
    const prisma = {
      ecommerceOrderFinancialEvent: {
        aggregate: jest.fn(() => {
          const sum = ledger.reduce(
            (total, event) => total.plus(event.damageCost),
            new Prisma.Decimal(0),
          );
          return Promise.resolve({
            _sum: { damageCost: ledger.length ? sum : null },
          });
        }),
        upsert: jest.fn(({ create }: { create: (typeof ledger)[number] }) => {
          ledger.push(create);
          return Promise.resolve(create);
        }),
      },
    };
    const service = new EcommerceOrderFinancialService(
      prisma as unknown as PrismaService,
      {} as OrderStockService,
    );
    const at = (ms: number) => new Date(ms);

    await service.setLineLoss(
      'o',
      'l',
      'MAD',
      new Prisma.Decimal(80),
      'Lost',
      at(1),
    );
    await service.setLineLoss(
      'o',
      'l',
      'MAD',
      new Prisma.Decimal(80),
      'Lost',
      at(2),
    );
    await service.setLineLoss(
      'o',
      'l',
      'MAD',
      new Prisma.Decimal(15),
      'Damaged',
      at(3),
    );
    await service.setLineLoss(
      'o',
      'l',
      'MAD',
      new Prisma.Decimal(0),
      'Good',
      at(4),
    );

    expect(ledger.map((event) => event.damageCost.toFixed(2))).toEqual([
      '80.00',
      '-65.00',
      '-15.00',
    ]);
    expect(ledger[0].idempotencyKey).toBe('damage-loss:l');
    const net = ledger.reduce(
      (sum, event) => sum.plus(event.netProfitImpact),
      new Prisma.Decimal(0),
    );
    expect(net.toFixed(2)).toBe('0.00');
  });
});
