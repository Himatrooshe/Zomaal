import { MerchantPurchaseSource, Prisma } from '@prisma/client';

type PackagingCostClient = Pick<
  Prisma.TransactionClient,
  | 'packagingMaterial'
  | 'merchantPurchase'
  | 'shopProductVariant'
  | 'shopProduct'
>;

/**
 * Unit cost per packaging material: what the merchant last paid for it in a
 * Zomaal Shop purchase, else the shop's current catalog price. Materials
 * with neither are left out (their cost counts as 0).
 */
export async function resolvePackagingUnitCosts(
  db: PackagingCostClient,
  materialIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  const costs = new Map<string, Prisma.Decimal>();
  const ids = [...new Set(materialIds)];
  if (ids.length === 0) return costs;

  const materials = await db.packagingMaterial.findMany({
    where: { id: { in: ids } },
    select: { id: true, storeId: true, zomaalShopVariantId: true },
  });
  for (const material of materials) {
    // The catalog key is the shop variant id, or the shop product id for
    // products without options.
    const key = material.zomaalShopVariantId;
    const purchase = await db.merchantPurchase.findFirst({
      where: {
        storeId: material.storeId,
        source: MerchantPurchaseSource.SHOP,
        shopOrderItem: {
          OR: [{ variantId: key }, { variantId: null, productId: key }],
        },
      },
      orderBy: { purchaseDate: 'desc' },
      select: { unitPrice: true },
    });
    if (purchase) {
      costs.set(material.id, purchase.unitPrice);
      continue;
    }
    const variant = await db.shopProductVariant.findUnique({
      where: { id: key },
      select: { price: true, product: { select: { price: true } } },
    });
    const catalogPrice =
      (variant ? (variant.price ?? variant.product.price) : null) ??
      (
        await db.shopProduct.findUnique({
          where: { id: key },
          select: { price: true },
        })
      )?.price;
    if (catalogPrice) costs.set(material.id, catalogPrice);
  }
  return costs;
}
