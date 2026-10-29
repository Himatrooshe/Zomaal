import type { RequiredCurrencyConverter } from '../currency/required-currency-converter';
import { MerchantPurchaseSource, Prisma } from '@prisma/client';

type PackagingCostClient = Pick<
  Prisma.TransactionClient,
  | 'packagingMaterial'
  | 'merchantPurchase'
  | 'shopProductVariant'
  | 'shopProduct'
  | 'shopSettings'
>;

/**
 * Unit cost per packaging material: what the merchant last paid for it in a
 * manual purchase or a Zomaal Shop purchase, else the shop's current catalog
 * price. Materials with none of these are left out (their cost counts as 0).
 */
export async function resolvePackagingUnitCosts(
  db: PackagingCostClient,
  materialIds: string[],
  options?: { targetCurrency: string; convert: RequiredCurrencyConverter },
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
        OR: [
          { packagingMaterialId: material.id },
          ...(key
            ? [
                {
                  source: MerchantPurchaseSource.SHOP,
                  shopOrderItem: {
                    OR: [
                      { variantId: key },
                      { variantId: null, productId: key },
                    ],
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
      select: { unitPrice: true, currency: true },
    });
    if (!key) {
      if (purchase)
        costs.set(
          material.id,
          options
            ? await options.convert(
                purchase.unitPrice,
                purchase.currency,
                options.targetCurrency,
              )
            : purchase.unitPrice,
        );
      continue;
    }
    if (purchase) {
      costs.set(
        material.id,
        options
          ? await options.convert(
              purchase.unitPrice,
              purchase.currency,
              options.targetCurrency,
            )
          : purchase.unitPrice,
      );
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
    if (catalogPrice) {
      const sourceCurrency = options
        ? (
            await db.shopSettings.findUniqueOrThrow({
              where: { id: 'default' },
              select: { currency: true },
            })
          ).currency
        : null;
      costs.set(
        material.id,
        options
          ? await options.convert(
              catalogPrice,
              sourceCurrency!,
              options.targetCurrency,
            )
          : catalogPrice,
      );
    }
  }
  return costs;
}
