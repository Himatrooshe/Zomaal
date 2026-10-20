import { Prisma } from '@prisma/client';

// Cart, address and order mutations share the store lock. Catalog stock is
// locked parent-first in sorted order across stores, then variants/promos.
export async function lockShopStore(
  tx: Prisma.TransactionClient,
  storeId: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'shop-store:' + storeId}, 0))::text`;
}

export async function lockShopProducts(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM "ShopProduct" WHERE id IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY id FOR UPDATE`;
}

export async function lockShopOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const [order] = await tx.$queryRaw<
    { storeId: string }[]
  >`SELECT "storeId" FROM "ShopOrder" WHERE id = ${orderId}`;
  if (!order) return;
  await lockShopStore(tx, order.storeId);
  await tx.$queryRaw`SELECT p.id FROM "ShopProduct" p WHERE p.id IN (SELECT "productId" FROM "ShopOrderItem" WHERE "orderId" = ${orderId}) ORDER BY p.id FOR UPDATE`;
}
