import {
  DUPLICATE_WINDOW_MS,
  clusterDuplicateOrders,
  lineProductKeys,
  type DuplicateCandidate,
} from './duplicate-orders.util';

const T0 = new Date('2026-10-01T10:00:00.000Z').getTime();
const HOUR = 3_600_000;

function order(
  id: string,
  hoursAfterT0: number,
  keys: string[],
  customerId = 'c-1',
): DuplicateCandidate {
  return {
    id,
    customerId,
    placedAt: new Date(T0 + hoursAfterT0 * HOUR),
    productKeys: new Set(keys),
  };
}

describe('lineProductKeys', () => {
  it('builds every key a product can match on', () => {
    expect(
      lineProductKeys(
        {
          warehouseVariantId: 'wv-1',
          externalProductId: 'p-1',
          externalVariantId: 'v-1',
          sku: ' SKU-1 ',
          name: '  Test   Product ',
        },
        'conn-1',
      ),
    ).toEqual([
      'wv:wv-1',
      'ep:conn-1:p-1',
      'ev:conn-1:v-1',
      'sku:sku-1',
      'name:test product',
    ]);
  });

  it('scopes platform ids to the connection but not sku / name', () => {
    const line = {
      warehouseVariantId: null,
      externalProductId: 'p-1',
      externalVariantId: null,
      sku: null,
      name: 'Item',
    };
    const a = lineProductKeys(line, 'shopify');
    const b = lineProductKeys(line, 'youcan');
    expect(a).not.toContain(b[0]);
    expect(a).toContain('name:item');
    expect(b).toContain('name:item');
  });
});

describe('clusterDuplicateOrders', () => {
  it('groups same-customer orders sharing a product within the window, oldest as main', () => {
    const clusters = clusterDuplicateOrders([
      order('b', 3, ['sku:x']),
      order('a', 0, ['sku:x', 'sku:y']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].main.id).toBe('a');
    expect(clusters[0].duplicates.map((d) => d.id)).toEqual(['b']);
  });

  it('ignores orders with no product in common', () => {
    expect(
      clusterDuplicateOrders([
        order('a', 0, ['sku:x']),
        order('b', 1, ['sku:y']),
      ]),
    ).toEqual([]);
  });

  it('ignores orders from different customers', () => {
    expect(
      clusterDuplicateOrders([
        order('a', 0, ['sku:x'], 'c-1'),
        order('b', 1, ['sku:x'], 'c-2'),
      ]),
    ).toEqual([]);
  });

  it('measures the window from the main order, so groups cannot chain forever', () => {
    const clusters = clusterDuplicateOrders([
      order('a', 0, ['sku:x']),
      order('b', 20, ['sku:x']),
      order('c', 30, ['sku:x']),
      order('d', 40, ['sku:x']),
    ]);
    expect(
      clusters.map((c) => [c.main.id, ...c.duplicates.map((d) => d.id)]),
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('includes an order exactly at the window edge', () => {
    const clusters = clusterDuplicateOrders([
      order('a', 0, ['sku:x']),
      {
        ...order('b', 0, ['sku:x']),
        placedAt: new Date(T0 + DUPLICATE_WINDOW_MS),
      },
    ]);
    expect(clusters).toHaveLength(1);
  });

  it('matches a product shared with any member, not only the main', () => {
    const clusters = clusterDuplicateOrders([
      order('a', 0, ['sku:x']),
      order('b', 1, ['sku:x', 'sku:y']),
      order('c', 2, ['sku:y']),
    ]);
    expect(clusters[0].duplicates.map((d) => d.id)).toEqual(['b', 'c']);
  });
});
