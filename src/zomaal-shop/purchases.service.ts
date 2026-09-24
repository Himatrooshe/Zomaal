import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MerchantPurchase,
  MerchantPurchaseSource,
  Prisma,
  WarehouseProductKind,
  WarehouseProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StoreAccess } from '../access/store-access.service';
import type { ListPurchasesDto, PurchaseListTab } from './dto/shop.dto';
import { money } from './shop-pricing.util';

// A purchases-list row groups every purchase of the same product from the
// same source. Keys are stable, URL-safe, and say where the product lives:
//   m_<warehouseProductId>  manual purchase of the merchant's own product
//   s_<shopProductId>       delivered Zomaal Shop product
//   mn_/sn_<base64url name> product has since been deleted — grouped by name
function groupKey(
  p: Pick<
    MerchantPurchase,
    'source' | 'warehouseProductId' | 'shopProductId' | 'productName'
  >,
) {
  if (p.source === MerchantPurchaseSource.MANUAL && p.warehouseProductId)
    return `m_${p.warehouseProductId}`;
  if (p.source === MerchantPurchaseSource.SHOP && p.shopProductId)
    return `s_${p.shopProductId}`;
  const prefix = p.source === MerchantPurchaseSource.MANUAL ? 'mn_' : 'sn_';
  return prefix + Buffer.from(p.productName, 'utf8').toString('base64url');
}

function whereForKey(
  storeId: string,
  key: string,
): Prisma.MerchantPurchaseWhereInput {
  const [prefix, ...rest] = key.split('_');
  const value = rest.join('_');
  if (!value) throw new NotFoundException('Purchase group not found');
  switch (prefix) {
    case 'm':
      return {
        storeId,
        source: MerchantPurchaseSource.MANUAL,
        warehouseProductId: value,
      };
    case 's':
      return {
        storeId,
        source: MerchantPurchaseSource.SHOP,
        shopProductId: value,
      };
    case 'mn':
    case 'sn':
      return {
        storeId,
        source:
          prefix === 'mn'
            ? MerchantPurchaseSource.MANUAL
            : MerchantPurchaseSource.SHOP,
        [prefix === 'mn' ? 'warehouseProductId' : 'shopProductId']: null,
        productName: Buffer.from(value, 'base64url').toString('utf8'),
      };
    default:
      throw new NotFoundException('Purchase group not found');
  }
}

function sourceLabel(source: MerchantPurchaseSource): 'Manual' | 'From Shop' {
  return source === MerchantPurchaseSource.SHOP ? 'From Shop' : 'Manual';
}

function quantityLabel(quantity: number, unitLabel: string) {
  return `${quantity} ${unitLabel}`.trim();
}

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string, query: ListPurchasesDto = {}) {
    const source = this.resolveSource(query.tab, query.source);
    const rows = await this.prisma.merchantPurchase.findMany({
      where: {
        storeId,
        ...(source ? { source } : {}),
        ...(query.search
          ? {
              productName: {
                contains: query.search.trim(),
                mode: 'insensitive',
              },
            }
          : {}),
      },
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    });

    const groups = new Map<string, MerchantPurchase[]>();
    for (const row of rows) {
      const key = groupKey(row);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    // Money is never summed across currencies.
    const spent = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      spent.set(
        row.currency,
        (spent.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.totalCost),
      );
    }
    const byCurrency = [...spent.entries()].map(([currency, amount]) => ({
      currency,
      amount: amount.toFixed(2),
    }));

    return {
      summary: {
        totalSpent:
          byCurrency.length === 1
            ? byCurrency[0].amount
            : byCurrency.length === 0
              ? '0.00'
              : null,
        currency: byCurrency.length === 1 ? byCurrency[0].currency : null,
        totalSpentByCurrency: byCurrency,
        totalItems: rows.reduce((sum, r) => sum + r.quantity, 0),
        purchaseCount: rows.length,
        productCount: groups.size,
      },
      items: [...groups.entries()].map(([key, list]) => {
        const latest = list[0];
        const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
        const total = list.reduce(
          (sum, r) => sum.plus(r.totalCost),
          new Prisma.Decimal(0),
        );
        return {
          key,
          source: latest.source,
          sourceLabel: sourceLabel(latest.source),
          productName: latest.productName,
          imageUrl: list.find((r) => r.imageUrl)?.imageUrl ?? null,
          unitLabel: latest.unitLabel,
          totalQuantity: totalQty,
          quantityLabel: quantityLabel(totalQty, latest.unitLabel),
          totalCost: total.toFixed(2),
          currency: latest.currency,
          lastUnitPrice: money(latest.unitPrice),
          /** Figma list card price (last unit / box price). */
          lastBoxPrice: money(latest.unitPrice),
          lastPurchaseDate: latest.purchaseDate.toISOString(),
          purchaseCount: list.length,
          editable: latest.source === MerchantPurchaseSource.MANUAL,
        };
      }),
    };
  }

  async group(storeId: string, key: string) {
    const rows = await this.prisma.merchantPurchase.findMany({
      where: whereForKey(storeId, key),
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (!rows.length) throw new NotFoundException('Purchase group not found');
    const latest = rows[0];
    const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0);
    return {
      key,
      source: latest.source,
      sourceLabel: sourceLabel(latest.source),
      productName: latest.productName,
      imageUrl: rows.find((r) => r.imageUrl)?.imageUrl ?? null,
      unitLabel: latest.unitLabel,
      quantityLabel: quantityLabel(totalQty, latest.unitLabel),
      warehouseProductId: latest.warehouseProductId,
      shopProductId: latest.shopProductId,
      totalQuantity: totalQty,
      totalCost: rows
        .reduce((sum, r) => sum.plus(r.totalCost), new Prisma.Decimal(0))
        .toFixed(2),
      currency: latest.currency,
      editable: latest.source === MerchantPurchaseSource.MANUAL,
      history: rows.map((r) => this.toHistoryRow(r)),
    };
  }

  async create(
    access: StoreAccess,
    dto: {
      warehouseProductId: string;
      quantity: number;
      unitPrice: number;
      purchaseDate: string;
      notes?: string;
    },
  ) {
    const product = await this.requireWarehouseProduct(
      access.storeId,
      dto.warehouseProductId,
    );
    const unitPrice = new Prisma.Decimal(dto.unitPrice);
    const row = await this.prisma.merchantPurchase.create({
      data: {
        storeId: access.storeId,
        source: MerchantPurchaseSource.MANUAL,
        warehouseProductId: product.id,
        productName: product.name,
        unitLabel: 'piece',
        imageUrl: product.media[0]
          ? `/warehouse/media/${product.media[0].id}/content`
          : null,
        quantity: dto.quantity,
        unitPrice,
        totalCost: unitPrice.times(dto.quantity).toDecimalPlaces(2),
        currency: access.baseCurrency,
        purchaseDate: this.parseDate(dto.purchaseDate),
        notes: dto.notes?.trim() || null,
        createdByUserId: access.userId,
      },
    });
    return {
      ...this.toResponse(row),
      groupKey: groupKey(row),
      sourceLabel: sourceLabel(row.source),
    };
  }

  async update(
    storeId: string,
    id: string,
    dto: {
      quantity?: number;
      unitPrice?: number;
      purchaseDate?: string;
      notes?: string | null;
    },
  ) {
    const row = await this.requireEditable(storeId, id);
    const quantity = dto.quantity ?? row.quantity;
    const unitPrice =
      dto.unitPrice !== undefined
        ? new Prisma.Decimal(dto.unitPrice)
        : row.unitPrice;
    const updated = await this.prisma.merchantPurchase.update({
      where: { id },
      data: {
        quantity,
        unitPrice,
        totalCost: unitPrice.times(quantity).toDecimalPlaces(2),
        ...(dto.purchaseDate !== undefined
          ? { purchaseDate: this.parseDate(dto.purchaseDate) }
          : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() || null }
          : {}),
      },
    });
    return {
      ...this.toResponse(updated),
      groupKey: groupKey(updated),
      sourceLabel: sourceLabel(updated.source),
    };
  }

  async remove(storeId: string, id: string) {
    await this.requireEditable(storeId, id);
    await this.prisma.merchantPurchase.delete({ where: { id } });
    return { message: 'Purchase deleted' };
  }

  // "Select Product" sheet: the merchant's own active, non-bundle products
  // with available stock (on hand − reserved − damaged) and default price.
  async productOptions(storeId: string, search?: string) {
    const products = await this.prisma.warehouseProduct.findMany({
      where: {
        storeId,
        kind: WarehouseProductKind.STANDARD,
        status: { not: WarehouseProductStatus.ARCHIVED },
        ...(search
          ? { name: { contains: search.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
      select: {
        id: true,
        name: true,
        media: { orderBy: { position: 'asc' }, take: 1, select: { id: true } },
        variants: {
          orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
          select: {
            price: true,
            costPrice: true,
            inventoryItem: {
              select: {
                balances: {
                  select: { onHand: true, reserved: true, damaged: true },
                },
              },
            },
          },
        },
      },
    });
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { baseCurrency: true },
    });
    return products.map((p) => {
      const stock = p.variants.reduce(
        (sum, v) =>
          sum +
          (v.inventoryItem?.balances ?? []).reduce(
            (s, b) => s + b.onHand - b.reserved - b.damaged,
            0,
          ),
        0,
      );
      const first = p.variants[0];
      return {
        id: p.id,
        name: p.name,
        imageUrl: p.media[0]
          ? `/warehouse/media/${p.media[0].id}/content`
          : null,
        price: money(first?.price),
        // Suggested unit purchase price for the Add Purchase form.
        costPrice: money(first?.costPrice),
        currency: store.baseCurrency,
        stock,
      };
    });
  }

  private resolveSource(
    tab?: PurchaseListTab,
    source?: MerchantPurchaseSource,
  ): MerchantPurchaseSource | undefined {
    if (tab && tab !== 'ALL') {
      return tab === 'FROM_SHOP'
        ? MerchantPurchaseSource.SHOP
        : MerchantPurchaseSource.MANUAL;
    }
    return source;
  }

  private async requireWarehouseProduct(storeId: string, id: string) {
    const product = await this.prisma.warehouseProduct.findFirst({
      where: { id, storeId, status: { not: WarehouseProductStatus.ARCHIVED } },
      select: {
        id: true,
        name: true,
        kind: true,
        media: { orderBy: { position: 'asc' }, take: 1, select: { id: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.kind === WarehouseProductKind.BUNDLE) {
      throw new BadRequestException(
        'Bundles are made from other products — record purchases for the products inside it.',
      );
    }
    return product;
  }

  private async requireEditable(storeId: string, id: string) {
    const row = await this.prisma.merchantPurchase.findFirst({
      where: { id, storeId },
    });
    if (!row) throw new NotFoundException('Purchase not found');
    if (row.source === MerchantPurchaseSource.SHOP) {
      throw new ForbiddenException(
        'Purchases from the Zomaal Shop are recorded automatically and can’t be edited.',
      );
    }
    return row;
  }

  private parseDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new BadRequestException('purchaseDate must be a valid date');
    if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('purchaseDate can’t be in the future');
    }
    return date;
  }

  /** Figma Purchases History row. */
  private toHistoryRow(r: MerchantPurchase) {
    const unit = money(r.unitPrice);
    return {
      id: r.id,
      source: r.source,
      sourceLabel: sourceLabel(r.source),
      date: r.purchaseDate.toISOString(),
      purchaseDate: r.purchaseDate.toISOString(),
      quantity: r.quantity,
      quantityLabel: quantityLabel(r.quantity, r.unitLabel),
      unitLabel: r.unitLabel,
      /** Figma "Box Price" — same as unit purchase price. */
      boxPrice: unit,
      unitPrice: unit,
      totalCost: money(r.totalCost),
      currency: r.currency,
      notes: r.notes,
      editable: r.source === MerchantPurchaseSource.MANUAL,
      createdAt: r.createdAt.toISOString(),
    };
  }

  toResponse(r: MerchantPurchase) {
    const unit = money(r.unitPrice);
    return {
      id: r.id,
      source: r.source,
      sourceLabel: sourceLabel(r.source),
      productName: r.productName,
      unitLabel: r.unitLabel,
      imageUrl: r.imageUrl,
      quantity: r.quantity,
      quantityLabel: quantityLabel(r.quantity, r.unitLabel),
      unitPrice: unit,
      boxPrice: unit,
      totalCost: money(r.totalCost),
      currency: r.currency,
      purchaseDate: r.purchaseDate.toISOString(),
      notes: r.notes,
      editable: r.source === MerchantPurchaseSource.MANUAL,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
