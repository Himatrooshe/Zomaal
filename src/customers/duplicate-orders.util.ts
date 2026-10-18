/** Orders from the same customer this close together can be duplicates. */
export const DUPLICATE_WINDOW_HOURS = 24;
export const DUPLICATE_WINDOW_MS = DUPLICATE_WINDOW_HOURS * 3_600_000;

export interface DuplicateLineInput {
  warehouseVariantId: string | null;
  externalProductId: string | null;
  externalVariantId: string | null;
  sku: string | null;
  name: string;
}

export interface DuplicateCandidate {
  id: string;
  customerId: string;
  placedAt: Date;
  productKeys: ReadonlySet<string>;
}

export interface DuplicateCluster<T extends DuplicateCandidate> {
  main: T;
  duplicates: T[];
}

/**
 * Every identity a line's product can be matched on. Platform ids only match
 * within the same connection; warehouse variant, SKU and name also match
 * across platforms (same customer ordering on Shopify and YouCan).
 */
export function lineProductKeys(
  line: DuplicateLineInput,
  connectionId: string,
): string[] {
  const keys: string[] = [];
  if (line.warehouseVariantId) keys.push(`wv:${line.warehouseVariantId}`);
  if (line.externalProductId) {
    keys.push(`ep:${connectionId}:${line.externalProductId}`);
  }
  if (line.externalVariantId) {
    keys.push(`ev:${connectionId}:${line.externalVariantId}`);
  }
  const sku = line.sku?.trim().toLowerCase();
  if (sku) keys.push(`sku:${sku}`);
  const name = line.name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (name) keys.push(`name:${name}`);
  return keys;
}

/**
 * Groups each customer's orders: an order joins a group when it was placed
 * within the window after the group's main (oldest) order and shares at
 * least one product with any order already in it. The window is measured
 * from the main order so a steady stream of orders can't chain forever.
 * Only groups with at least one duplicate are returned.
 */
export function clusterDuplicateOrders<T extends DuplicateCandidate>(
  orders: readonly T[],
  windowMs: number = DUPLICATE_WINDOW_MS,
): DuplicateCluster<T>[] {
  const byCustomer = new Map<string, T[]>();
  for (const order of orders) {
    const list = byCustomer.get(order.customerId) ?? [];
    list.push(order);
    byCustomer.set(order.customerId, list);
  }

  const clusters: DuplicateCluster<T>[] = [];
  for (const list of byCustomer.values()) {
    list.sort(
      (a, b) =>
        a.placedAt.getTime() - b.placedAt.getTime() || a.id.localeCompare(b.id),
    );
    const open: Array<DuplicateCluster<T> & { keys: Set<string> }> = [];
    for (const order of list) {
      const cluster = open.find(
        (c) =>
          order.placedAt.getTime() - c.main.placedAt.getTime() <= windowMs &&
          [...order.productKeys].some((key) => c.keys.has(key)),
      );
      if (cluster) {
        cluster.duplicates.push(order);
        for (const key of order.productKeys) cluster.keys.add(key);
      } else {
        open.push({
          main: order,
          duplicates: [],
          keys: new Set(order.productKeys),
        });
      }
    }
    for (const { main, duplicates } of open) {
      if (duplicates.length > 0) clusters.push({ main, duplicates });
    }
  }
  return clusters;
}
