import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShopOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopSettingsService } from './shop-settings.service';
import {
  PRODUCT_CARD_INCLUDE,
  VISIBLE_PRODUCT_WHERE,
  availableStock,
  bannerImageUrl,
  imageUrl,
  toProductCard,
} from './shop-catalog.util';
import { effectivePrice, money, variantLabel } from './shop-pricing.util';

const POPULAR_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'name';

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ShopSettingsService,
  ) {}

  private async favoriteIds(storeId: string) {
    const rows = await this.prisma.shopFavorite.findMany({
      where: { storeId },
      select: { productId: true },
    });
    return new Set(rows.map((r) => r.productId));
  }

  async home(storeId: string) {
    const now = new Date();
    const [settings, banners, categories, popular, cartCount, favoritesCount] =
      await Promise.all([
        this.settings.get(),
        this.prisma.shopBanner.findMany({
          where: {
            isActive: true,
            imageObjectName: { not: null },
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        }),
        this.categories(),
        this.popular(storeId),
        this.prisma.shopCartItem.aggregate({
          where: { storeId },
          _sum: { quantity: true },
        }),
        this.prisma.shopFavorite.count({ where: { storeId } }),
      ]);

    return {
      currency: settings.currency,
      banners: banners.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        imageUrl: bannerImageUrl(b.id, b.updatedAt),
        linkType: b.linkType,
        linkId: b.linkId,
      })),
      categories,
      popular,
      cartItemCount: cartCount._sum.quantity ?? 0,
      favoritesCount,
    };
  }

  // Active categories that have at least one visible product. The circle
  // image is the cover photo of the category's newest product with a photo.
  async categories() {
    const categories = await this.prisma.shopCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        products: {
          where: VISIBLE_PRODUCT_WHERE,
          orderBy: { createdAt: 'desc' },
          select: {
            images: {
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    return categories
      .filter((c) => c.products.length > 0)
      .map((c) => {
        const withImage = c.products.find((p) => p.images.length);
        return {
          id: c.id,
          name: c.name,
          productCount: c.products.length,
          imageUrl: withImage ? imageUrl(withImage.images[0].id) : null,
        };
      });
  }

  // Featured products first, then best sellers of the last 90 days, then
  // the newest — so the section is never empty while the catalog isn't.
  async popular(storeId: string) {
    const [settings, favorites] = await Promise.all([
      this.settings.get(),
      this.favoriteIds(storeId),
    ]);
    const featured = await this.prisma.shopProduct.findMany({
      where: { ...VISIBLE_PRODUCT_WHERE, isFeatured: true },
      orderBy: { updatedAt: 'desc' },
      take: POPULAR_LIMIT,
      include: PRODUCT_CARD_INCLUDE,
    });
    const picked = [...featured];
    const seen = new Set(picked.map((p) => p.id));

    if (picked.length < POPULAR_LIMIT) {
      const best = await this.prisma.shopOrderItem.groupBy({
        by: ['productId'],
        where: {
          productId: { not: null },
          order: {
            status: { not: ShopOrderStatus.CANCELLED },
            createdAt: { gte: new Date(Date.now() - 90 * DAY_MS) },
          },
        },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: POPULAR_LIMIT * 2,
      });
      const ids = best.map((b) => b.productId!).filter((id) => !seen.has(id));
      if (ids.length) {
        const products = await this.prisma.shopProduct.findMany({
          where: { ...VISIBLE_PRODUCT_WHERE, id: { in: ids } },
          include: PRODUCT_CARD_INCLUDE,
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        for (const id of ids) {
          const p = byId.get(id);
          if (p && picked.length < POPULAR_LIMIT) {
            picked.push(p);
            seen.add(id);
          }
        }
      }
    }

    if (picked.length < POPULAR_LIMIT) {
      const newest = await this.prisma.shopProduct.findMany({
        where: { ...VISIBLE_PRODUCT_WHERE, id: { notIn: [...seen] } },
        orderBy: { createdAt: 'desc' },
        take: POPULAR_LIMIT - picked.length,
        include: PRODUCT_CARD_INCLUDE,
      });
      picked.push(...newest);
    }

    return picked.map((p) => toProductCard(p, settings.currency, favorites));
  }

  async listProducts(
    storeId: string,
    query: {
      categoryId?: string;
      search?: string;
      sort?: ProductSort;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
    const where: Prisma.ShopProductWhereInput = {
      ...VISIBLE_PRODUCT_WHERE,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? { name: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
    };
    const orderBy: Prisma.ShopProductOrderByWithRelationInput =
      query.sort === 'price_asc'
        ? { price: 'asc' }
        : query.sort === 'price_desc'
          ? { price: 'desc' }
          : query.sort === 'name'
            ? { name: 'asc' }
            : { createdAt: 'desc' };

    const [settings, favorites, total, products] = await Promise.all([
      this.settings.get(),
      this.favoriteIds(storeId),
      this.prisma.shopProduct.count({ where }),
      this.prisma.shopProduct.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PRODUCT_CARD_INCLUDE,
      }),
    ]);

    return {
      items: products.map((p) =>
        toProductCard(p, settings.currency, favorites),
      ),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  async productDetail(storeId: string, productId: string) {
    const product = await this.prisma.shopProduct.findFirst({
      where: { ...VISIBLE_PRODUCT_WHERE, id: productId },
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true } },
        variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        specs: {
          orderBy: { sortOrder: 'asc' },
          select: { label: true, value: true },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [settings, favorite, inCart] = await Promise.all([
      this.settings.get(),
      this.prisma.shopFavorite.findUnique({
        where: { storeId_productId: { storeId, productId } },
        select: { id: true },
      }),
      this.prisma.shopCartItem.aggregate({
        where: { storeId, productId },
        _sum: { quantity: true },
      }),
    ]);

    const base = effectivePrice(product);
    const variants = product.variants.map((v) => {
      const p = effectivePrice(product, v);
      return {
        id: v.id,
        label: variantLabel(v),
        size: v.size,
        color: v.color,
        colorHex: v.colorHex,
        price: money(p.price),
        compareAtPrice: money(p.compareAtPrice),
        stock: v.stock,
        inStock: v.stock > 0,
      };
    });
    const sizes = [
      ...new Set(
        product.variants.map((v) => v.size).filter((s): s is string => !!s),
      ),
    ];
    const colors = [
      ...new Map(
        product.variants
          .filter((v) => v.color)
          .map((v) => [v.color!, { name: v.color!, hex: v.colorHex }]),
      ).values(),
    ];
    const stock = availableStock(product);

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      currency: settings.currency,
      unitLabel: product.unitLabel,
      price: money(base.price),
      compareAtPrice: money(base.compareAtPrice),
      stock,
      inStock: stock > 0,
      images: product.images.map((i) => ({ id: i.id, url: imageUrl(i.id) })),
      imageUrl: product.images[0] ? imageUrl(product.images[0].id) : null,
      hasVariants: variants.length > 0,
      sizes,
      colors,
      variants,
      specifications: product.specs,
      isFavorite: !!favorite,
      quantityInCart: inCart._sum.quantity ?? 0,
    };
  }

  // ---- Favorites ----

  async favorites(storeId: string) {
    const [settings, rows] = await Promise.all([
      this.settings.get(),
      this.prisma.shopFavorite.findMany({
        where: { storeId, product: VISIBLE_PRODUCT_WHERE },
        orderBy: { createdAt: 'desc' },
        include: { product: { include: PRODUCT_CARD_INCLUDE } },
      }),
    ]);
    const ids = new Set(rows.map((r) => r.productId));
    return rows.map((r) => toProductCard(r.product, settings.currency, ids));
  }

  async addFavorite(storeId: string, productId: string) {
    const product = await this.prisma.shopProduct.findFirst({
      where: { ...VISIBLE_PRODUCT_WHERE, id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.shopFavorite.upsert({
      where: { storeId_productId: { storeId, productId } },
      update: {},
      create: { storeId, productId },
    });
    return { productId, isFavorite: true };
  }

  async removeFavorite(storeId: string, productId: string) {
    await this.prisma.shopFavorite.deleteMany({
      where: { storeId, productId },
    });
    return { productId, isFavorite: false };
  }
}
