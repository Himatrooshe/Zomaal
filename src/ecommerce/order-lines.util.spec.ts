import type { Prisma } from '@prisma/client';
import { replaceOrderLines, type OrderLineWrite } from './order-lines.util';

function incoming(externalLineId: string, quantity = 1): OrderLineWrite {
  return {
    externalLineId,
    externalProductId: null,
    externalVariantId: null,
    sku: `SKU-${externalLineId}`,
    name: `Line ${externalLineId}`,
    quantity,
    unitPrice: '10.0000',
    totalPrice: (10 * quantity).toFixed(4),
    currency: 'MAD',
    warehouseVariantId: 'variant-new',
  };
}

function existing(
  id: string,
  externalLineId: string,
  state: {
    stockStatus?: string;
    condition?: string;
    returnRequestLines?: number;
  } = {},
) {
  return {
    id,
    externalLineId,
    stockStatus: state.stockStatus ?? null,
    condition: state.condition ?? null,
    _count: { returnRequestLines: state.returnRequestLines ?? 0 },
  };
}

function fakeDb(rows: ReturnType<typeof existing>[]) {
  const db = {
    ecommerceOrderLine: {
      findMany: jest.fn().mockResolvedValue(rows),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { db, client: db as unknown as Prisma.TransactionClient };
}

describe('replaceOrderLines', () => {
  it('updates existing lines in place instead of recreating them', async () => {
    const { db, client } = fakeDb([existing('line-1', 'ext-1')]);

    await replaceOrderLines(client, 'order-1', [incoming('ext-1', 2)]);

    expect(db.ecommerceOrderLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: expect.objectContaining({
        quantity: 2,
        warehouseVariantId: 'variant-new',
      }) as unknown,
    });
    expect(db.ecommerceOrderLine.deleteMany).not.toHaveBeenCalled();
    expect(db.ecommerceOrderLine.createMany).not.toHaveBeenCalled();
  });

  it('creates new lines and deletes dropped lines without history', async () => {
    const { db, client } = fakeDb([existing('line-old', 'ext-old')]);

    await replaceOrderLines(client, 'order-1', [incoming('ext-new')]);

    expect(db.ecommerceOrderLine.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['line-old'] } },
    });
    expect(db.ecommerceOrderLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          orderId: 'order-1',
          externalLineId: 'ext-new',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('keeps dropped lines that carry stock or return history', async () => {
    const { db, client } = fakeDb([
      existing('line-reserved', 'ext-a', { stockStatus: 'RESERVED' }),
      existing('line-scanned', 'ext-b', { condition: 'GOOD' }),
      existing('line-returned', 'ext-c', { returnRequestLines: 1 }),
    ]);

    await replaceOrderLines(client, 'order-1', []);

    expect(db.ecommerceOrderLine.deleteMany).not.toHaveBeenCalled();
  });

  it('does not re-match the product of a line whose stock already moved', async () => {
    const { db, client } = fakeDb([
      existing('line-1', 'ext-1', { stockStatus: 'RESERVED' }),
    ]);

    await replaceOrderLines(client, 'order-1', [incoming('ext-1')]);

    const [[args]] = db.ecommerceOrderLine.update.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(args.data).not.toHaveProperty('warehouseVariantId');
  });
});
