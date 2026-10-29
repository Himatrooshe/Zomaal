import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';
import type { OrderStockService } from './order-stock.service';
import type { WhatsAppTriggerService } from '../whatsapp/whatsapp-trigger.service';

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
  const transaction = jest.fn();
  const dispatch = {
    id: 'dispatch-1',
    orderId: 'order-1',
    order: {
      id: 'order-1',
      currency: 'MAD',
      connection: { store: { baseCurrency: 'MAD' } },
      totalCollected: new Prisma.Decimal(300),
      shipping: new Prisma.Decimal(25),
      lines: [deliveredLine()],
    },
    senditShipment: {
      currency: 'MAD',
      normalizedStatus: status,
      fee: new Prisma.Decimal(30),
      recipientPhone: '0600000001',
      recipientName: 'Test Recipient',
      lastActionAt: new Date('2026-01-01T10:00:00Z'),
      providerUpdatedAt: null,
    },
    quickLivraisonShipment: null,
    forceLogShipment: null,
    ozoneExpressShipment: null,
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: transaction,
    ecommerceOrderDispatch: {
      findUnique: jest.fn().mockResolvedValue(dispatch),
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
      findFirst: jest.fn(({ where }: { where: { type: string } }) =>
        Promise.resolve(
          [...events.values()]
            .reverse()
            .find((event) => event.type === where.type) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: StoredEvent }) => {
        const stored = {
          id: `event-${events.size + 1}`,
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
      findFirst: jest.fn().mockResolvedValue({
        unitPrice: new Prisma.Decimal(5),
        currency: 'MAD',
      }),
    },
  };
  transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) =>
    work(prisma),
  );
  const orderStock = {
    forTransaction: jest.fn(),
    deliverOrder: jest.fn().mockResolvedValue(undefined),
    releaseOrder: jest.fn().mockResolvedValue(undefined),
  };
  orderStock.forTransaction.mockReturnValue(orderStock);
  const whatsAppTrigger = {
    onShipmentStatus: jest.fn().mockResolvedValue('NOT_CONNECTED'),
  };
  const currency = { convertOrNull: jest.fn().mockResolvedValue(null) };
  const service = new EcommerceOrderFinancialService(
    prisma as unknown as PrismaService,
    orderStock as unknown as OrderStockService,
    whatsAppTrigger as unknown as WhatsAppTriggerService,
    undefined,
    currency as never,
  );
  return {
    service,
    prisma,
    events,
    orderStock,
    whatsAppTrigger,
    currency,
    dispatch,
  };
}

describe('EcommerceOrderFinancialService', () => {
  it('converts warehouse, gift, packaging and courier costs into order currency before posting', async () => {
    const { service, prisma, events, currency } = setup(
      ShippingShipmentStatus.DELIVERED,
    );
    const dispatch =
      (await prisma.ecommerceOrderDispatch.findUnique()) as ReturnType<
        typeof setup
      >['dispatch'];
    dispatch.order.currency = 'USD';
    currency.convertOrNull.mockResolvedValue(new Prisma.Decimal('0.1'));
    await service.syncFromDispatchId('dispatch-1');
    const event = events.get('revenue-recognized')!;
    expect(event.currency).toBe('USD');
    for (const [key, value] of Object.entries({
      productCost: '12.00',
      giftCost: '2.00',
      packagingCost: '1.00',
      shippingCost: '3.00',
      netProfitImpact: '282.00',
    })) {
      expect((event[key] as Prisma.Decimal).toFixed(2)).toBe(value);
    }
    await service.syncFromDispatchId('dispatch-1');
    expect(events.size).toBe(1);
  });

  it.each([
    'senditShipment',
    'quickLivraisonShipment',
    'forceLogShipment',
    'ozoneExpressShipment',
  ])('converts %s fees for a returned parcel', async (provider) => {
    const { service, prisma, events, currency } = setup(
      ShippingShipmentStatus.REFUSED,
    );
    const dispatch =
      (await prisma.ecommerceOrderDispatch.findUnique()) as ReturnType<
        typeof setup
      >['dispatch'];
    const shipment = dispatch.senditShipment;
    Object.assign(dispatch, { senditShipment: null, [provider]: shipment });
    dispatch.order.currency = 'USD';
    currency.convertOrNull.mockResolvedValue(new Prisma.Decimal('0.1'));
    await service.syncFromDispatchId('dispatch-1');
    expect(
      (events.get('shipping-loss')!.shippingCost as Prisma.Decimal).toFixed(2),
    ).toBe('3.00');
    expect(events.get('shipping-loss')!.currency).toBe('USD');
  });

  it('does not post a ledger event or move stock if a required rate is unavailable', async () => {
    const { service, prisma, events, orderStock } = setup(
      ShippingShipmentStatus.DELIVERED,
    );
    (
      (await prisma.ecommerceOrderDispatch.findUnique()) as ReturnType<
        typeof setup
      >['dispatch']
    ).order.currency = 'USD';
    await expect(service.syncFromDispatchId('dispatch-1')).rejects.toThrow(
      'Exchange rate MAD → USD is unavailable',
    );
    expect(events.size).toBe(0);
    expect(orderStock.deliverOrder).not.toHaveBeenCalled();
  });

  it.each(['DELIVERED', 'RETURNED'])(
    'converts Ameex fee metadata on timeline outcome %s',
    async (outcome) => {
      const { service, prisma, events, currency } = setup(
        ShippingShipmentStatus.PENDING,
      );
      const dispatch =
        (await prisma.ecommerceOrderDispatch.findUnique()) as ReturnType<
          typeof setup
        >['dispatch'];
      Object.assign(prisma, {
        ecommerceOrder: {
          findUnique: jest.fn().mockResolvedValue({ dispatch: null }),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ ...dispatch.order, currency: 'USD' }),
        },
        ecommerceOrderEvent: {
          findMany: jest.fn().mockResolvedValue([
            {
              type: outcome,
              occurredAt: new Date(),
              metadata: { carrier: 'AMEEX', fee: '30', currency: 'MAD' },
            },
          ]),
        },
      });
      currency.convertOrNull.mockResolvedValue(new Prisma.Decimal('0.1'));
      await service.syncUndispatchedOrder('order-1');
      const event = events.get(
        outcome === 'DELIVERED' ? 'revenue-recognized' : 'shipping-loss',
      )!;
      expect((event.shippingCost as Prisma.Decimal).toFixed(2)).toBe('3.00');
      expect(event.currency).toBe('USD');
    },
  );

  it.each(['dispatch', 'ameex'])(
    'converts the effective shipping cost from %s into order currency',
    async (source) => {
      const { service, prisma, currency } = setup(
        ShippingShipmentStatus.PENDING,
      );
      Object.assign(prisma, {
        ecommerceOrder: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            currency: 'USD',
            shipping: new Prisma.Decimal(7),
            dispatch:
              source === 'dispatch'
                ? {
                    senditShipment: {
                      fee: new Prisma.Decimal(30),
                      currency: 'MAD',
                    },
                    quickLivraisonShipment: null,
                    forceLogShipment: null,
                    ozoneExpressShipment: null,
                  }
                : null,
            events:
              source === 'ameex'
                ? [{ metadata: { fee: '30', currency: 'MAD' } }]
                : [],
          }),
        },
      });
      currency.convertOrNull.mockResolvedValue(new Prisma.Decimal('0.1'));
      await expect(
        service.resolveEffectiveShippingCost('order-1'),
      ).resolves.toEqual(new Prisma.Decimal(3));
    },
  );

  it('hands the courier status to the WhatsApp trigger', async () => {
    const { service, whatsAppTrigger } = setup(
      ShippingShipmentStatus.OUT_FOR_DELIVERY,
    );

    await service.syncFromDispatchId('dispatch-1');

    expect(whatsAppTrigger.onShipmentStatus).toHaveBeenCalledWith({
      orderId: 'order-1',
      status: ShippingShipmentStatus.OUT_FOR_DELIVERY,
      statusChangedAt: new Date('2026-01-01T10:00:00Z'),
      recipientPhone: '0600000001',
      recipientName: 'Test Recipient',
    });
  });

  it('keeps the ledger working when the WhatsApp trigger throws', async () => {
    const { service, whatsAppTrigger, events } = setup(
      ShippingShipmentStatus.DELIVERED,
    );
    whatsAppTrigger.onShipmentStatus.mockRejectedValue(new Error('boom'));

    await service.syncFromDispatchId('dispatch-1');

    expect(events.get('revenue-recognized')).toBeDefined();
  });

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
          connection: { store: { baseCurrency: 'MAD' } },
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

    prisma.ecommerceOrderDispatch.findUnique.mockResolvedValue({
      ...((await prisma.ecommerceOrderDispatch.findUnique()) as ReturnType<
        typeof setup
      >['dispatch']),
      senditShipment: {
        normalizedStatus: ShippingShipmentStatus.RETURNED_TO_SELLER,
        currency: 'MAD',
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
      {} as WhatsAppTriggerService,
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
