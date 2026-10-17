import type { Prisma } from '@prisma/client';
import type { NormalizedEcommerceOrderLine } from './interfaces/ecommerce-revenue-adapter.interface';

export type OrderLineWrite = NormalizedEcommerceOrderLine & {
  warehouseVariantId: string | null;
};

/**
 * Applies the platform's current line items to an order without recreating
 * existing rows: line ids, return conditions, return-request links and stock
 * status must survive every order update. Lines the platform dropped are
 * deleted unless they already carry stock or return history.
 */
export async function replaceOrderLines(
  db: Prisma.TransactionClient,
  orderId: string,
  lines: OrderLineWrite[],
): Promise<void> {
  const existing = await db.ecommerceOrderLine.findMany({
    where: { orderId },
    select: {
      id: true,
      externalLineId: true,
      stockStatus: true,
      condition: true,
      _count: { select: { returnRequestLines: true } },
    },
  });
  const byExternalId = new Map(existing.map((l) => [l.externalLineId, l]));
  const incomingIds = new Set(lines.map((l) => l.externalLineId));

  const removable = existing
    .filter(
      (l) =>
        !incomingIds.has(l.externalLineId) &&
        l.stockStatus === null &&
        l.condition === null &&
        l._count.returnRequestLines === 0,
    )
    .map((l) => l.id);
  if (removable.length > 0) {
    await db.ecommerceOrderLine.deleteMany({
      where: { id: { in: removable } },
    });
  }

  const created: Prisma.EcommerceOrderLineCreateManyInput[] = [];
  for (const line of lines) {
    const current = byExternalId.get(line.externalLineId);
    if (!current) {
      created.push({ orderId, ...line });
      continue;
    }
    await db.ecommerceOrderLine.update({
      where: { id: current.id },
      data: {
        externalProductId: line.externalProductId,
        externalVariantId: line.externalVariantId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.totalPrice,
        currency: line.currency,
        // Re-matching a line whose units are already reserved or deducted
        // would leave that stock attached to the wrong item.
        ...(current.stockStatus === null
          ? { warehouseVariantId: line.warehouseVariantId }
          : {}),
      },
    });
  }
  if (created.length > 0) {
    await db.ecommerceOrderLine.createMany({
      data: created,
      skipDuplicates: true,
    });
  }
}
