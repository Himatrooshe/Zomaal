import { Prisma, ShopProductStatus } from '@prisma/client';
import { effectivePrice, money } from './shop-pricing.util';

// A product a merchant may see and buy: ACTIVE, in an active category.
export const VISIBLE_PRODUCT_WHERE: Prisma.ShopProductWhereInput = {
  status: ShopProductStatus.ACTIVE,
  category: { isActive: true },
};

export const imageUrl = (imageId: string) => `/shop-media/images/${imageId}`;
export const bannerImageUrl = (bannerId: string, updatedAt: Date) =>
  `/shop-media/banners/${bannerId}?v=${updatedAt.getTime()}`;

export const PRODUCT_CARD_INCLUDE = {
  category: { select: { id: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true } },
  variants: {
    where: { isActive: true },
    select: { price: true, compareAtPrice: true, stock: true },
  },
} satisfies Prisma.ShopProductInclude;

export type ProductCard = Prisma.ShopProductGetPayload<{
  include: typeof PRODUCT_CARD_INCLUDE;
}>;

/** Stock a merchant can buy: per-variant when the product has active variants. */
export function availableStock(product: {
  stock: number;
  variants: { stock: number }[];
}) {
  return product.variants.length
    ? product.variants.reduce((sum, v) => sum + v.stock, 0)
    : product.stock;
}

/**
 * Card shown in grids (Popular items, category lists, favorites). For a
 * product with variants, the "from" price is the cheapest active variant.
 */
export function toProductCard(
  product: ProductCard,
  currency: string,
  favoriteIds: Set<string>,
) {
  let priced = effectivePrice(product);
  if (product.variants.length) {
    const cheapest = product.variants
      .map((v) => effectivePrice(product, v))
      .sort((a, b) => a.price.comparedTo(b.price))[0];
    priced = cheapest;
  }
  const stock = availableStock(product);
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: money(priced.price),
    compareAtPrice: money(priced.compareAtPrice),
    priceFrom: product.variants.length > 1,
    currency,
    unitLabel: product.unitLabel,
    imageUrl: product.images[0] ? imageUrl(product.images[0].id) : null,
    inStock: stock > 0,
    hasVariants: product.variants.length > 0,
    isFavorite: favoriteIds.has(product.id),
  };
}
