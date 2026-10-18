import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpensePaymentMethod,
  InventoryItemKind,
  InventoryMovementType,
  MerchantPurchase,
  MerchantPurchaseSource,
  Prisma,
  WarehouseProductKind,
  WarehouseProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StoreAccess } from '../access/store-access.service';
import {
  attachReceipt,
  receiptPreviewPath,
} from '../common/media/attach-receipt.util';
import { MediaService } from '../warehouse/media.service';
import {
  isWriteConflict,
  moveOnHandInTx,
} from '../warehouse/inventory-balance.util';
import { resolvePackagingUnitCosts } from '../warehouse/packaging-cost.util';
import { packagingUnitLabel } from '../warehouse/packaging-unit.util';
import type {
  CreatePurchaseDto,
  ListPurchasesDto,
  PurchaseItemType,
  PurchaseListTab,
  UpdatePurchaseDto,
} from './dto/shop.dto';
import { createPurchaseExpense } from './purchase-expense.util';
import { money } from './shop-pricing.util';

const PURCHASE_INCLUDE = {
  expense: { select: { id: true, paymentMethod: true, receiptUrl: true } },
} satisfies Prisma.MerchantPurchaseInclude;

type PurchaseRow = Prisma.MerchantPurchaseGetPayload<{
  include: typeof PURCHASE_INCLUDE;
}>;

const STOCK_IN_USE =
  'Part of this stock is already reserved, sold or marked damaged, so this purchase can’t be reduced. Adjust the stock first.';

/** Where a manual purchase's units go. */
interface PurchaseTarget {
  warehouseProductId: string | null;
  warehouseVariantId: string | null;
  packagingMaterialId: string | null;
  productName: string;
  unitLabel: string;
  imageUrl: string | null;
  inventoryItemId: string | null;
}

// A purchases-list row groups every purchase of the same product from the
// same source. Keys are stable, URL-safe, and say where the product lives:
//   m_<warehouseProductId>   manual purchase of the merchant's own product
//   p_<packagingMaterialId>  manual purchase of the merchant's packaging
//   s_<shopProductId>        delivered Zomaal Shop product
//   mn_/sn_<base64url name>  product has since been deleted — grouped by name
function groupKey(
  p: Pick<
    MerchantPurchase,
    | 'source'
    | 'warehouseProductId'
    | 'packagingMaterialId'
    | 'shopProductId'
    | 'productName'
  >,
) {
  if (p.source === MerchantPurchaseSource.MANUAL && p.warehouseProductId)
    return `m_${p.warehouseProductId}`;
  if (p.source === MerchantPurchaseSource.MANUAL && p.packagingMaterialId)
    return `p_${p.packagingMaterialId}`;
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
    case 'p':
      return {
        storeId,
        source: MerchantPurchaseSource.MANUAL,
        packagingMaterialId: value,
      };
    case 's':
      return {
        storeId,
        source: MerchantPurchaseSource.SHOP,
        shopProductId: value,
      };
    case 'mn':
      return {
        storeId,
        source: MerchantPurchaseSource.MANUAL,
        warehouseProductId: null,
        packagingMaterialId: null,
        productName: Buffer.from(value, 'base64url').toString('utf8'),
      };
    case 'sn':
      return {
        storeId,
        source: MerchantPurchaseSource.SHOP,
        shopProductId: null,
        productName: Buffer.from(value, 'base64url').toString('utf8'),
      };
    default:
      throw new NotFoundException('Purchase group not found');
  }
}

function sourceLabel(source: MerchantPurchaseSource): 'Manual' | 'From Shop' {
  return source === MerchantPurchaseSource.SHOP ? 'From Shop' : 'Manual';
}

/** Zomaal Shop deliveries are credited as packaging. */
function itemType(
  p: Pick<MerchantPurchase, 'source' | 'packagingMaterialId'>,
): PurchaseItemType {
  return p.packagingMaterialId || p.source === MerchantPurchaseSource.SHOP
    ? 'PACKAGING'
    : 'PRODUCT';
}

function quantityLabel(quantity: number, unitLabel: string) {
  return `${quantity} ${unitLabel}`.trim();
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

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
          itemType: itemType(latest),
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
      include: PURCHASE_INCLUDE,
      orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (!rows.length) throw new NotFoundException('Purchase group not found');
    const latest = rows[0];
    const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0);
    return {
      key,
      source: latest.source,
      sourceLabel: sourceLabel(latest.source),
      itemType: itemType(latest),
      productName: latest.productName,
      imageUrl: rows.find((r) => r.imageUrl)?.imageUrl ?? null,
      unitLabel: latest.unitLabel,
      quantityLabel: quantityLabel(totalQty, latest.unitLabel),
      warehouseProductId: latest.warehouseProductId,
      packagingMaterialId: latest.packagingMaterialId,
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

  async create(access: StoreAccess, dto: CreatePurchaseDto) {
    const { storeId } = access;
    if (dto.packagingMaterialId && dto.warehouseProductId) {
      throw new BadRequestException(
        'Choose either a product or a packaging item, not both.',
      );
    }
    const target = dto.packagingMaterialId
      ? await this.packagingTarget(storeId, dto.packagingMaterialId)
      : await this.productTarget(
          storeId,
          dto.warehouseProductId!,
          dto.warehouseVariantId,
        );
    const addToStock = dto.addToStock ?? true;
    const unitPrice = new Prisma.Decimal(dto.unitPrice);
    const totalCost = unitPrice.times(dto.quantity).toDecimalPlaces(2);
    const purchaseDate = this.parseDate(dto.purchaseDate);
    const notes = dto.notes?.trim() || null;

    const row = await this.serializable(async (tx) => {
      const expense = await createPurchaseExpense(tx, {
        storeId,
        productName: target.productName,
        amount: totalCost,
        paymentMethod: dto.paymentMethod ?? ExpensePaymentMethod.CASH,
        spentAt: purchaseDate,
        notes,
        createdByUserId: access.userId,
        receiptUrl: dto.receiptAssetId
          ? receiptPreviewPath(dto.receiptAssetId)
          : null,
      });
      if (dto.receiptAssetId) {
        await attachReceipt(tx, storeId, dto.receiptAssetId, {
          expenseId: expense.id,
        });
      }
      const created = await tx.merchantPurchase.create({
        data: {
          storeId,
          source: MerchantPurchaseSource.MANUAL,
          warehouseProductId: target.warehouseProductId,
          warehouseVariantId: target.warehouseVariantId,
          packagingMaterialId: target.packagingMaterialId,
          productName: target.productName,
          unitLabel: target.unitLabel,
          imageUrl: target.imageUrl,
          quantity: dto.quantity,
          unitPrice,
          totalCost,
          currency: access.baseCurrency,
          purchaseDate,
          notes,
          createdByUserId: access.userId,
          stockAdded: addToStock,
          expenseId: expense.id,
        },
        include: PURCHASE_INCLUDE,
      });
      if (addToStock) {
        await moveOnHandInTx(
          tx,
          storeId,
          target.inventoryItemId ??
            (await this.ensureInventoryItem(tx, storeId, target)),
          {
            type: InventoryMovementType.PURCHASE_RECEIVED,
            quantityDelta: dto.quantity,
            reason: 'Stock bought (manual purchase)',
            referenceType: 'MERCHANT_PURCHASE',
            referenceId: created.id,
            idempotencyKey: `purchase:${created.id}`,
          },
        );
      }
      return created;
    });
    return this.toResponse(row);
  }

  async update(storeId: string, id: string, dto: UpdatePurchaseDto) {
    const row = await this.requireEditable(storeId, id);
    const quantity = dto.quantity ?? row.quantity;
    const unitPrice =
      dto.unitPrice !== undefined
        ? new Prisma.Decimal(dto.unitPrice)
        : row.unitPrice;
    const totalCost = unitPrice.times(quantity).toDecimalPlaces(2);
    const purchaseDate =
      dto.purchaseDate !== undefined
        ? this.parseDate(dto.purchaseDate)
        : row.purchaseDate;
    const notes =
      dto.notes !== undefined ? dto.notes?.trim() || null : row.notes;
    const delta = quantity - row.quantity;
    const inventoryItemId =
      row.stockAdded && delta !== 0 ? await this.stockItemId(row) : null;
    const previousReceipt =
      dto.receiptAssetId !== undefined && row.expenseId
        ? await this.prisma.mediaAsset.findUnique({
            where: { expenseId: row.expenseId },
            select: { id: true },
          })
        : null;
    const replacedReceipt =
      previousReceipt && previousReceipt.id !== dto.receiptAssetId
        ? previousReceipt
        : null;

    const updated = await this.serializable(async (tx) => {
      if (inventoryItemId) {
        await this.moveStock(tx, storeId, inventoryItemId, delta, {
          reason: 'Manual purchase quantity changed',
          referenceId: id,
        });
      }

      let expenseId = row.expenseId;
      if (expenseId) {
        if (replacedReceipt) {
          await tx.mediaAsset.update({
            where: { id: replacedReceipt.id },
            data: { expenseId: null },
          });
        }
        if (dto.receiptAssetId && dto.receiptAssetId !== previousReceipt?.id) {
          await attachReceipt(tx, storeId, dto.receiptAssetId, { expenseId });
        }
        await tx.expense.update({
          where: { id: expenseId },
          data: {
            amount: totalCost,
            spentAt: purchaseDate,
            notes,
            ...(dto.paymentMethod ? { paymentMethod: dto.paymentMethod } : {}),
            ...(dto.receiptAssetId !== undefined
              ? {
                  receiptUrl: dto.receiptAssetId
                    ? receiptPreviewPath(dto.receiptAssetId)
                    : null,
                }
              : {}),
          },
        });
      } else {
        const expense = await createPurchaseExpense(tx, {
          storeId,
          productName: row.productName,
          amount: totalCost,
          paymentMethod: dto.paymentMethod ?? ExpensePaymentMethod.CASH,
          spentAt: purchaseDate,
          notes,
          createdByUserId: row.createdByUserId,
          receiptUrl: dto.receiptAssetId
            ? receiptPreviewPath(dto.receiptAssetId)
            : null,
        });
        expenseId = expense.id;
        if (dto.receiptAssetId) {
          await attachReceipt(tx, storeId, dto.receiptAssetId, { expenseId });
        }
      }

      return tx.merchantPurchase.update({
        where: { id },
        data: {
          quantity,
          unitPrice,
          totalCost,
          purchaseDate,
          notes,
          expenseId,
        },
        include: PURCHASE_INCLUDE,
      });
    });

    if (replacedReceipt) {
      await this.media
        .deleteAttachedAsset(replacedReceipt.id)
        .catch(() => undefined);
    }
    return this.toResponse(updated);
  }

  async remove(storeId: string, id: string) {
    const row = await this.requireEditable(storeId, id);
    const inventoryItemId = row.stockAdded ? await this.stockItemId(row) : null;
    const receipt = row.expenseId
      ? await this.prisma.mediaAsset.findUnique({
          where: { expenseId: row.expenseId },
          select: { id: true },
        })
      : null;

    await this.serializable(async (tx) => {
      if (inventoryItemId) {
        await this.moveStock(tx, storeId, inventoryItemId, -row.quantity, {
          reason: 'Manual purchase deleted',
          referenceId: id,
        });
      }
      await tx.merchantPurchase.delete({ where: { id } });
      if (row.expenseId) {
        await tx.expense.delete({ where: { id: row.expenseId } });
      }
    });

    if (receipt) {
      await this.media.deleteAttachedAsset(receipt.id).catch(() => undefined);
    }
    return { message: 'Purchase deleted' };
  }

  // "Select Product" sheet: the merchant's own active, non-bundle products
  // (with their variants) and active packaging, each with available stock
  // (on hand − reserved − damaged) and a suggested unit purchase price.
  async productOptions(
    storeId: string,
    search?: string,
    type?: PurchaseItemType,
  ) {
    const nameFilter = search
      ? { contains: search.trim(), mode: 'insensitive' as const }
      : undefined;
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { baseCurrency: true },
    });

    const products =
      type === 'PACKAGING'
        ? []
        : await this.prisma.warehouseProduct.findMany({
            where: {
              storeId,
              kind: WarehouseProductKind.STANDARD,
              status: { not: WarehouseProductStatus.ARCHIVED },
              ...(nameFilter ? { name: nameFilter } : {}),
            },
            orderBy: { name: 'asc' },
            take: 50,
            select: {
              id: true,
              name: true,
              media: {
                orderBy: { position: 'asc' },
                take: 1,
                select: { id: true },
              },
              variants: {
                orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
                select: {
                  id: true,
                  title: true,
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

    const packaging =
      type === 'PRODUCT'
        ? []
        : await this.prisma.packagingMaterial.findMany({
            where: {
              storeId,
              isActive: true,
              ...(nameFilter ? { name: nameFilter } : {}),
            },
            orderBy: { name: 'asc' },
            take: 50,
            select: {
              id: true,
              name: true,
              unit: true,
              imageObjectName: true,
              inventoryItem: {
                select: {
                  balances: {
                    select: { onHand: true, reserved: true, damaged: true },
                  },
                },
              },
            },
          });
    const packagingCosts = await resolvePackagingUnitCosts(
      this.prisma,
      packaging.map((p) => p.id),
    );

    const available = (
      balances: { onHand: number; reserved: number; damaged: number }[] = [],
    ) => balances.reduce((s, b) => s + b.onHand - b.reserved - b.damaged, 0);

    return [
      ...products.map((p) => {
        const variants = p.variants.map((v) => ({
          id: v.id,
          title: v.title,
          price: money(v.price),
          costPrice: money(v.costPrice),
          stock: available(v.inventoryItem?.balances),
        }));
        const first = p.variants[0];
        return {
          itemType: 'PRODUCT' as const,
          id: p.id,
          name: p.name,
          imageUrl: p.media[0]
            ? `/warehouse/media/${p.media[0].id}/content`
            : null,
          unit: null,
          price: money(first?.price),
          // Suggested unit purchase price for the Add Purchase form.
          costPrice: money(first?.costPrice),
          currency: store.baseCurrency,
          stock: variants.reduce((sum, v) => sum + v.stock, 0),
          variants,
        };
      }),
      ...packaging.map((m) => ({
        itemType: 'PACKAGING' as const,
        id: m.id,
        name: m.name,
        imageUrl: m.imageObjectName
          ? `/warehouse/packaging/${m.id}/image`
          : null,
        unit: m.unit,
        price: null,
        // Last price paid for it, if any.
        costPrice: money(packagingCosts.get(m.id)),
        currency: store.baseCurrency,
        stock: available(m.inventoryItem?.balances),
        variants: [],
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));
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

  private async productTarget(
    storeId: string,
    productId: string,
    variantId?: string,
  ): Promise<PurchaseTarget> {
    const product = await this.prisma.warehouseProduct.findFirst({
      where: {
        id: productId,
        storeId,
        status: { not: WarehouseProductStatus.ARCHIVED },
      },
      select: {
        id: true,
        name: true,
        kind: true,
        media: { orderBy: { position: 'asc' }, take: 1, select: { id: true } },
        variants: {
          orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
          select: { id: true, inventoryItem: { select: { id: true } } },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.kind === WarehouseProductKind.BUNDLE) {
      throw new BadRequestException(
        'Bundles are made from other products — record purchases for the products inside it.',
      );
    }
    const variant = variantId
      ? product.variants.find((v) => v.id === variantId)
      : product.variants.length === 1
        ? product.variants[0]
        : undefined;
    if (!variant) {
      throw new BadRequestException(
        variantId
          ? 'This variant does not belong to the product.'
          : 'This product has several variants — choose which one you bought (warehouseVariantId).',
      );
    }
    return {
      warehouseProductId: product.id,
      warehouseVariantId: variant.id,
      packagingMaterialId: null,
      productName: product.name,
      unitLabel: 'piece',
      imageUrl: product.media[0]
        ? `/warehouse/media/${product.media[0].id}/content`
        : null,
      inventoryItemId: variant.inventoryItem?.id ?? null,
    };
  }

  private async packagingTarget(
    storeId: string,
    packagingMaterialId: string,
  ): Promise<PurchaseTarget> {
    const material = await this.prisma.packagingMaterial.findFirst({
      where: { id: packagingMaterialId, storeId, isActive: true },
      select: {
        id: true,
        name: true,
        unit: true,
        imageObjectName: true,
        inventoryItem: { select: { id: true } },
      },
    });
    if (!material) throw new NotFoundException('Packaging not found');
    return {
      warehouseProductId: null,
      warehouseVariantId: null,
      packagingMaterialId: material.id,
      productName: material.name,
      unitLabel: packagingUnitLabel(material.unit, 1),
      imageUrl: material.imageObjectName
        ? `/warehouse/packaging/${material.id}/image`
        : null,
      inventoryItemId: material.inventoryItem?.id ?? null,
    };
  }

  private async ensureInventoryItem(
    tx: Prisma.TransactionClient,
    storeId: string,
    target: PurchaseTarget,
  ): Promise<string> {
    const item = target.packagingMaterialId
      ? await tx.inventoryItem.upsert({
          where: { packagingMaterialId: target.packagingMaterialId },
          create: {
            storeId,
            kind: InventoryItemKind.PACKAGING_MATERIAL,
            packagingMaterialId: target.packagingMaterialId,
          },
          update: {},
          select: { id: true },
        })
      : await tx.inventoryItem.upsert({
          where: { variantId: target.warehouseVariantId! },
          create: {
            storeId,
            kind: InventoryItemKind.PRODUCT_VARIANT,
            variantId: target.warehouseVariantId,
          },
          update: {},
          select: { id: true },
        });
    return item.id;
  }

  /** The inventory item a purchase added stock to; null once it is gone. */
  private async stockItemId(row: MerchantPurchase): Promise<string | null> {
    if (!row.packagingMaterialId && !row.warehouseVariantId) return null;
    const item = await this.prisma.inventoryItem.findFirst({
      where: row.packagingMaterialId
        ? { packagingMaterialId: row.packagingMaterialId }
        : { variantId: row.warehouseVariantId },
      select: { id: true },
    });
    return item?.id ?? null;
  }

  private async moveStock(
    tx: Prisma.TransactionClient,
    storeId: string,
    inventoryItemId: string,
    quantityDelta: number,
    ref: { reason: string; referenceId: string },
  ) {
    try {
      await moveOnHandInTx(tx, storeId, inventoryItemId, {
        type: InventoryMovementType.PURCHASE_RECEIVED,
        quantityDelta,
        reason: ref.reason,
        referenceType: 'MERCHANT_PURCHASE',
        referenceId: ref.referenceId,
      });
    } catch (error) {
      if (error instanceof BadRequestException && quantityDelta < 0) {
        throw new ConflictException(STOCK_IN_USE);
      }
      throw error;
    }
  }

  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        if (attempt === 3) {
          throw new ConflictException(
            'Stock changed at the same time; please try again.',
          );
        }
      }
    }
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
  private toHistoryRow(r: PurchaseRow) {
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
      warehouseVariantId: r.warehouseVariantId,
      stockAdded: r.stockAdded,
      expenseId: r.expenseId,
      paymentMethod: r.expense?.paymentMethod ?? null,
      receiptUrl: r.expense?.receiptUrl ?? null,
      editable: r.source === MerchantPurchaseSource.MANUAL,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toResponse(r: PurchaseRow) {
    const unit = money(r.unitPrice);
    return {
      id: r.id,
      source: r.source,
      sourceLabel: sourceLabel(r.source),
      itemType: itemType(r),
      groupKey: groupKey(r),
      warehouseProductId: r.warehouseProductId,
      warehouseVariantId: r.warehouseVariantId,
      packagingMaterialId: r.packagingMaterialId,
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
      stockAdded: r.stockAdded,
      expenseId: r.expenseId,
      paymentMethod: r.expense?.paymentMethod ?? null,
      receiptUrl: r.expense?.receiptUrl ?? null,
      editable: r.source === MerchantPurchaseSource.MANUAL,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
