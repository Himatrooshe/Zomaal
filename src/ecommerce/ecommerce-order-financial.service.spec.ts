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

  it('keeps gift and packaging cost when a delivered order is reversed', async () => {
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
    // Undoes 300 − 120 − 30 = 150; the 30 of gift + packaging stays as a cost.
    expect((reversed.netProfitImpact as Prisma.Decimal).toFixed(2)).toBe(
      '-150.00',
    );
    const net = [...events.values()].reduce(
      (sum, event) => sum.plus(event.netProfitImpact as Prisma.Decimal),
      new Prisma.Decimal(0),
    );
    expect(net.toFixed(2)).toBe('-30.00');
  });
});
