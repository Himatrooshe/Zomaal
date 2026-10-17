import type { PrismaService } from '../prisma/prisma.service';
import { ProductCondition } from './constants/product-condition';
import { OrderStockService } from './order-stock.service';

type Balance = {
  id: string;
  inventoryItemId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  damaged: number;
  incoming: number;
  version: number;
};

type Movement = {
  inventoryItemId: string;
  type: string;
  bucket: string;
  quantityDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string;
};

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Where[]).some((branch) => matches(row, branch));
    }
    if (condition && typeof condition === 'object' && 'in' in condition) {
      return (condition as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === condition;
  });
}

/** Minimal stand-in for the Prisma calls OrderStockService makes. */
function createFakePrisma(line: Record<string, unknown>) {
  const balances: Balance[] = [];
  const movements: Movement[] = [];

  const prisma = {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    ecommerceOrder: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 'order-1',
          orderName: '#1001',
          connection: { storeId: 'store-1' },
          lines: [line],
        }),
      ),
    },
    ecommerceOrderLine: {
      findUnique: jest.fn(() => Promise.resolve(line)),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(line, data);
        return Promise.resolve(line);
      }),
    },
    warehouseLocation: {
      upsert: jest.fn(() => Promise.resolve({ id: 'loc-main' })),
    },
    inventoryBalance: {
      findFirst: jest.fn(({ where }: { where: { inventoryItemId: string } }) =>
        Promise.resolve(
          balances.find((b) => b.inventoryItemId === where.inventoryItemId) ??
            null,
        ),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: { inventoryItemId: string; locationId: string };
        }) => {
          const balance: Balance = {
            id: `bal-${data.inventoryItemId}`,
            ...data,
            onHand: 0,
            reserved: 0,
            damaged: 0,
            incoming: 0,
            version: 0,
          };
          balances.push(balance);
          return Promise.resolve(balance);
        },
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Where }) => {
          const balance = balances.find((b) => b.id === where.id)!;
          for (const [key, value] of Object.entries(data)) {
            if (key !== 'version') {
              (balance as Record<string, unknown>)[key] = value;
            }
          }
          return Promise.resolve(balance);
        },
      ),
    },
    inventoryMovement: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            inventoryItemId_idempotencyKey: {
              inventoryItemId: string;
              idempotencyKey: string;
            };
          };
        }) => {
          const key = where.inventoryItemId_idempotencyKey;
          return Promise.resolve(
            movements.find(
              (m) =>
                m.inventoryItemId === key.inventoryItemId &&
                m.idempotencyKey === key.idempotencyKey,
            ) ?? null,
          );
        },
      ),
      create: jest.fn(({ data }: { data: Movement }) => {
        movements.push(data);
        return Promise.resolve(data);
      }),
      aggregate: jest.fn(({ where }: { where: Where }) => {
        const sum = movements
          .filter((m) =>
            matches(m as unknown as Record<string, unknown>, where),
          )
          .reduce((total, m) => total + m.quantityDelta, 0);
        return Promise.resolve({ _sum: { quantityDelta: sum } });
      }),
      groupBy: jest.fn(({ where }: { where: Where }) => {
        const sums = new Map<string, number>();
        for (const m of movements) {
          if (!matches(m, where)) {
            continue;
          }
          sums.set(
            m.inventoryItemId,
            (sums.get(m.inventoryItemId) ?? 0) + m.quantityDelta,
          );
        }
        return Promise.resolve(
          [...sums].map(([inventoryItemId, quantityDelta]) => ({
            inventoryItemId,
            _sum: { quantityDelta },
          })),
        );
      }),
    },
  };

  const seed = (inventoryItemId: string, onHand: number) =>
    balances.push({
      id: `bal-${inventoryItemId}`,
      inventoryItemId,
      locationId: 'loc-main',
      onHand,
      reserved: 0,
      damaged: 0,
      incoming: 0,
      version: 0,
    });
  const balanceOf = (inventoryItemId: string) =>
    balances.find((b) => b.inventoryItemId === inventoryItemId);

  return {
    service: new OrderStockService(prisma as unknown as PrismaService),
    seed,
    balanceOf,
    movements,
  };
}

function standardLine(quantity: number) {
  return {
    id: 'line-1',
    quantity,
    stockStatus: null as string | null,
    warehouseVariant: {
      id: 'variant-1',
      costPrice: null,
      inventoryItem: { id: 'item-product' },
      product: {
        kind: 'STANDARD',
        bundleComponents: [],
        gift: {
          quantity: 1,
          giftVariant: {
            costPrice: null,
            inventoryItem: { id: 'item-gift' },
            product: { kind: 'STANDARD', bundleComponents: [] },
          },
        },
        packagingRequirements: [
          {
            variantId: null,
            quantityPerUnit: 1,
            packagingMaterialId: 'box',
            packagingMaterial: { inventoryItem: { id: 'item-box' } },
          },
        ],
      },
    },
  };
}

describe('OrderStockService', () => {
  it('reserves product and gift at dispatch, then deducts them and packaging at delivery', async () => {
    const line = standardLine(2);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 10);
    seed('item-gift', 5);
    seed('item-box', 20);

    await service.reserveOrder('order-1');
    expect(balanceOf('item-product')).toMatchObject({
      onHand: 10,
      reserved: 2,
    });
    expect(balanceOf('item-gift')).toMatchObject({ onHand: 5, reserved: 2 });
    expect(balanceOf('item-box')).toMatchObject({ onHand: 20, reserved: 0 });
    expect(line.stockStatus).toBe('RESERVED');

    await service.deliverOrder('order-1');
    expect(balanceOf('item-product')).toMatchObject({ onHand: 8, reserved: 0 });
    expect(balanceOf('item-gift')).toMatchObject({ onHand: 3, reserved: 0 });
    expect(balanceOf('item-box')).toMatchObject({ onHand: 18 });
    expect(line.stockStatus).toBe('DELIVERED');
  });

  it('is idempotent when couriers report the same status repeatedly', async () => {
    const line = standardLine(1);
    const { service, seed, balanceOf, movements } = createFakePrisma(line);
    seed('item-product', 4);

    await service.reserveOrder('order-1');
    await service.reserveOrder('order-1');
    await service.deliverOrder('order-1');
    line.stockStatus = 'RESERVED';
    await service.deliverOrder('order-1');

    expect(balanceOf('item-product')).toMatchObject({ onHand: 3, reserved: 0 });
    expect(
      movements.filter((m) => m.inventoryItemId === 'item-product'),
    ).toHaveLength(3);
  });

  it('skips a platform delivery that happened before Zomaal first synced the line', async () => {
    const line = {
      ...standardLine(1),
      createdAt: new Date('2026-10-10T00:00:00Z'),
    };
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 5);

    await service.deliverOrder('order-1', new Date('2026-10-01T00:00:00Z'));
    expect(balanceOf('item-product')).toMatchObject({ onHand: 5 });
    expect(line.stockStatus).toBeNull();

    await service.deliverOrder('order-1', new Date('2026-10-12T00:00:00Z'));
    expect(balanceOf('item-product')).toMatchObject({ onHand: 4 });
  });

  it('releases the reservation when the order is cancelled', async () => {
    const line = standardLine(2);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 10);

    await service.reserveOrder('order-1');
    await service.releaseOrder('order-1');

    expect(balanceOf('item-product')).toMatchObject({
      onHand: 10,
      reserved: 0,
    });
    expect(line.stockStatus).toBe('RELEASED');
  });

  it('releases a gift reservation even after the gift was removed from the product', async () => {
    const line = standardLine(2);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 10);
    seed('item-gift', 5);

    await service.reserveOrder('order-1');
    (line.warehouseVariant.product as { gift: unknown }).gift = null;
    await service.releaseOrder('order-1');

    expect(balanceOf('item-gift')).toMatchObject({ onHand: 5, reserved: 0 });
    expect(balanceOf('item-product')).toMatchObject({ reserved: 0 });
  });

  it('deducts the gift that actually shipped when the gift changed after dispatch', async () => {
    const line = standardLine(1);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 10);
    seed('item-gift', 5);
    seed('item-box', 5);

    await service.reserveOrder('order-1');
    (line.warehouseVariant.product as { gift: unknown }).gift = null;
    await service.deliverOrder('order-1');

    expect(balanceOf('item-gift')).toMatchObject({ onHand: 4, reserved: 0 });
    expect(balanceOf('item-product')).toMatchObject({ onHand: 9, reserved: 0 });
  });

  it('reserves only what is in stock instead of failing the order', async () => {
    const line = standardLine(3);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 1);

    await service.reserveOrder('order-1');
    expect(balanceOf('item-product')).toMatchObject({ onHand: 1, reserved: 1 });
  });

  it('puts a delivered good return back on hand', async () => {
    const line = standardLine(1);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 5);
    await service.reserveOrder('order-1');
    await service.deliverOrder('order-1');

    const updated = await service.applyReturnCondition({
      storeId: 'store-1',
      orderId: 'order-1',
      orderLabel: '#1001',
      lineId: 'line-1',
      condition: ProductCondition.GOOD,
      isCorrection: false,
      recordedAt: new Date('2026-10-16T10:00:00Z'),
    });

    expect(updated).toBe(true);
    expect(balanceOf('item-product')).toMatchObject({ onHand: 5, damaged: 0 });
  });

  it('does not double count a good return that was never delivered', async () => {
    const line = standardLine(1);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 5);
    await service.reserveOrder('order-1');

    const updated = await service.applyReturnCondition({
      storeId: 'store-1',
      orderId: 'order-1',
      orderLabel: '#1001',
      lineId: 'line-1',
      condition: ProductCondition.GOOD,
      isCorrection: false,
      recordedAt: new Date('2026-10-16T10:00:00Z'),
    });

    expect(updated).toBe(false);
    expect(balanceOf('item-product')).toMatchObject({ onHand: 5, reserved: 0 });
    expect(line.stockStatus).toBe('RELEASED');
  });

  it('writes off an undelivered lost unit', async () => {
    const line = standardLine(1);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 5);
    await service.reserveOrder('order-1');

    await service.applyReturnCondition({
      storeId: 'store-1',
      orderId: 'order-1',
      orderLabel: '#1001',
      lineId: 'line-1',
      condition: ProductCondition.LOST,
      isCorrection: false,
      recordedAt: new Date('2026-10-16T10:00:00Z'),
    });

    expect(balanceOf('item-product')).toMatchObject({ onHand: 4, reserved: 0 });
  });

  it('undoes the earlier condition when a return is corrected', async () => {
    const line = standardLine(1);
    const { service, seed, balanceOf } = createFakePrisma(line);
    seed('item-product', 5);
    await service.reserveOrder('order-1');
    await service.deliverOrder('order-1');

    await service.applyReturnCondition({
      storeId: 'store-1',
      orderId: 'order-1',
      orderLabel: '#1001',
      lineId: 'line-1',
      condition: ProductCondition.GOOD,
      isCorrection: false,
      recordedAt: new Date('2026-10-16T10:00:00Z'),
    });
    await service.applyReturnCondition({
      storeId: 'store-1',
      orderId: 'order-1',
      orderLabel: '#1001',
      lineId: 'line-1',
      condition: ProductCondition.DAMAGED,
      isCorrection: true,
      recordedAt: new Date('2026-10-16T11:00:00Z'),
    });

    expect(balanceOf('item-product')).toMatchObject({ onHand: 5, damaged: 1 });
  });
});
