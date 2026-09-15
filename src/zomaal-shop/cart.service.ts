import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShopProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopSettingsService } from './shop-settings.service';
import { imageUrl } from './shop-catalog.util';
import {
  effectivePrice,
  money,
  priceOrder,
  variantLabel,
} from './shop-pricing.util';

export const MAX_LINE_QUANTITY = 10000;

const CART_INCLUDE = {
  product: {
    include: {
      category: { select: { isActive: true } },
      images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true } },
      variants: { where: { isActive: true }, select: { id: true } },
    },
  },
  variant: true,
} satisfies Prisma.ShopCartItemInclude;

export type CartRow = Prisma.ShopCartItemGetPayload<{
  include: typeof CART_INCLUDE;
}>;

export type CartLineProblem =
  | 'UNAVAILABLE' // product/category no longer active, or variant removed/disabled
  | 'VARIANT_REQUIRED' // product gained variants after it was added
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_STOCK';

export interface EvaluatedLine {
  row: CartRow;
  unitPrice: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  stock: number;
  problem: CartLineProblem | null;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ShopSettingsService,
  ) {}

  rows(storeId: string) {
    return this.prisma.shopCartItem.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      include: CART_INCLUDE,
    });
  }

  // Re-checks every line against the live catalog: prices always come from
  // the product now (never from when it was added), and anything that can no
  // longer be bought is flagged instead of silently dropped.
  evaluate(rows: CartRow[]): EvaluatedLine[] {
    return rows.map((row) => {
      const p = row.product;
      const priced = effectivePrice(p, row.variant);
      const stock = row.variant ? row.variant.stock : p.stock;
      let problem: CartLineProblem | null = null;
      if (p.status !== ShopProductStatus.ACTIVE || !p.category.isActive)
        problem = 'UNAVAILABLE';
      else if (row.variant && !row.variant.isActive) problem = 'UNAVAILABLE';
      else if (!row.variant && p.variants.length > 0)
        problem = 'VARIANT_REQUIRED';
      else if (stock <= 0) problem = 'OUT_OF_STOCK';
      else if (row.quantity > stock) problem = 'INSUFFICIENT_STOCK';
      return {
        row,
        unitPrice: priced.price,
        compareAtPrice: priced.compareAtPrice,
        stock,
        problem,
      };
    });
  }

  lineResponse(line: EvaluatedLine, currency: string) {
    const { row } = line;
    return {
      id: row.id,
      product: {
        id: row.product.id,
        name: row.product.name,
        unitLabel: row.product.unitLabel,
        imageUrl: row.product.images[0]
          ? imageUrl(row.product.images[0].id)
          : null,
      },
      variant: row.variant
        ? { id: row.variant.id, label: variantLabel(row.variant) }
        : null,
      unitPrice: money(line.unitPrice),
      compareAtPrice: money(line.compareAtPrice),
      quantity: row.quantity,
      lineTotal: line.unitPrice.times(row.quantity).toFixed(2),
      compareAtLineTotal: line.compareAtPrice
        ? line.compareAtPrice.times(row.quantity).toFixed(2)
        : null,
      currency,
      stock: line.stock,
      problem: line.problem,
    };
  }

  async get(storeId: string) {
    const [settings, rows] = await Promise.all([
      this.settings.get(),
      this.rows(storeId),
    ]);
    const lines = this.evaluate(rows);
    const buyable = lines.filter((l) => !l.problem);
    const pricing = priceOrder({
      lines: buyable.map((l) => ({
        unitPrice: l.unitPrice,
        quantity: l.row.quantity,
      })),
      settings,
    });
    return {
      currency: settings.currency,
      items: lines.map((l) => this.lineResponse(l, settings.currency)),
      itemCount: rows.reduce((sum, r) => sum + r.quantity, 0),
      subtotal: pricing.subtotal.toFixed(2),
      deliveryFee: pricing.deliveryFee.toFixed(2),
      freeDeliveryMinSubtotal:
        settings.freeDeliveryMinSubtotal?.toFixed(2) ?? null,
      total: pricing.total.toFixed(2),
      hasProblems: lines.some((l) => l.problem),
      canCheckout: rows.length > 0 && lines.every((l) => !l.problem),
    };
  }

  async addItem(
    storeId: string,
    dto: { productId: string; variantId?: string; quantity: number },
  ) {
    const product = await this.prisma.shopProduct.findUnique({
      where: { id: dto.productId },
      include: {
        category: { select: { isActive: true } },
        variants: { where: { isActive: true } },
      },
    });
    if (
      !product ||
      product.status !== ShopProductStatus.ACTIVE ||
      !product.category.isActive
    ) {
      throw new NotFoundException('Product not found');
    }

    let stock = product.stock;
    if (product.variants.length) {
      if (!dto.variantId) {
        throw new BadRequestException(
          'Choose an option (size / color) for this product.',
        );
      }
      const variant = product.variants.find((v) => v.id === dto.variantId);
      if (!variant)
        throw new NotFoundException('That option is not available.');
      stock = variant.stock;
    } else if (dto.variantId) {
      throw new BadRequestException('This product has no options.');
    }

    const existing = await this.prisma.shopCartItem.findFirst({
      where: {
        storeId,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
      },
    });
    const newQuantity = (existing?.quantity ?? 0) + dto.quantity;
    this.assertStock(newQuantity, stock, product.name);

    if (existing) {
      await this.prisma.shopCartItem.update({
        where: { id: existing.id },
        data: { quantity: newQuantity },
      });
    } else {
      await this.prisma.shopCartItem.create({
        data: {
          storeId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
          quantity: dto.quantity,
        },
      });
    }
    return this.get(storeId);
  }

  async updateItem(storeId: string, itemId: string, quantity: number) {
    const row = await this.prisma.shopCartItem.findFirst({
      where: { id: itemId, storeId },
      include: { product: true, variant: true },
    });
    if (!row) throw new NotFoundException('Cart item not found');
    const stock = row.variant ? row.variant.stock : row.product.stock;
    // Lowering the quantity is always allowed, even when stock has since
    // dropped below it — that's how the merchant fixes the line.
    if (quantity > row.quantity)
      this.assertStock(quantity, stock, row.product.name);
    await this.prisma.shopCartItem.update({
      where: { id: row.id },
      data: { quantity },
    });
    return this.get(storeId);
  }

  async removeItem(storeId: string, itemId: string) {
    const { count } = await this.prisma.shopCartItem.deleteMany({
      where: { id: itemId, storeId },
    });
    if (!count) throw new NotFoundException('Cart item not found');
    return this.get(storeId);
  }

  async clear(storeId: string) {
    await this.prisma.shopCartItem.deleteMany({ where: { storeId } });
    return this.get(storeId);
  }

  private assertStock(quantity: number, stock: number, name: string) {
    if (quantity > MAX_LINE_QUANTITY) {
      throw new BadRequestException(
        `You can order at most ${MAX_LINE_QUANTITY} of one item at a time.`,
      );
    }
    if (stock <= 0) throw new ConflictException(`"${name}" is out of stock.`);
    if (quantity > stock) {
      throw new ConflictException(`Only ${stock} of "${name}" left in stock.`);
    }
  }
}
