import { Injectable } from '@nestjs/common';
import { Prisma, WarehouseProductKind } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ItemValueListDto,
  ItemValueLineDto,
  ItemValueQueryDto,
  ItemValueSummaryDto,
} from './dto/item-value.dto';
import { WarehouseStoreService } from './warehouse-store.service';

const ITEM_SELECT = {
  id: true,
  kind: true,
  variant: {
    select: {
      id: true,
      title: true,
      sku: true,
      costPrice: true,
      product: { select: { name: true, kind: true } },
    },
  },
  packagingMaterial: {
    select: { id: true, name: true, sku: true, zomaalShopVariantId: true },
  },
  balances: { select: { onHand: true, reserved: true, damaged: true } },
} satisfies Prisma.InventoryItemSelect;

type ItemRow = Prisma.InventoryItemGetPayload<{ select: typeof ITEM_SELECT }>;
type PurchaseCost = {
  totalCost: Prisma.Decimal;
  quantity: number;
  currency: string;
};

@Injectable()
export class ItemValueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
    private readonly currency: CurrencyService,
  ) {}

  async get(
    userId: string,
    query: ItemValueQueryDto,
  ): Promise<ItemValueListDto> {
    const store = await this.stores.requireStore(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, costs } = await this.prisma.$transaction(
      async (tx) => {
        const items = await tx.inventoryItem.findMany({
          where: {
            storeId: store.id,
            ...(query.kind ? { kind: query.kind } : {}),
            balances: { some: { onHand: { gt: 0 } } },
          },
          select: ITEM_SELECT,
        });
        const packaging = items.flatMap((item) =>
          item.packagingMaterial ? [item.packagingMaterial] : [],
        );
        const ids = packaging.map((material) => material.id);
        // Fetch only one cost per material, rather than loading its entire
        // purchase history. Both the material and purchase are store-scoped.
        const purchases = ids.length
          ? await tx.$queryRaw<
              Array<PurchaseCost & { packagingMaterialId: string }>
            >(Prisma.sql`
              SELECT material.id AS "packagingMaterialId",
                     latest."totalCost", latest.quantity, latest.currency
              FROM "PackagingMaterial" AS material
              JOIN LATERAL (
                SELECT purchase."totalCost", purchase.quantity, purchase.currency
                FROM "MerchantPurchase" AS purchase
                LEFT JOIN "ShopOrderItem" AS line ON line.id = purchase."shopOrderItemId"
                WHERE purchase."storeId" = ${store.id}
                  AND (
                    purchase."packagingMaterialId" = material.id
                    OR (
                      purchase."packagingMaterialId" IS NULL
                      AND material."zomaalShopVariantId" IS NOT NULL
                      AND (line."variantId" = material."zomaalShopVariantId"
                        OR (line."variantId" IS NULL AND line."productId" = material."zomaalShopVariantId"))
                    )
                  )
                ORDER BY purchase."purchaseDate" DESC, purchase."createdAt" DESC, purchase.id DESC
                LIMIT 1
              ) AS latest ON TRUE
              WHERE material."storeId" = ${store.id}
                AND material.id IN (${Prisma.join(ids)})
            `)
          : [];
        const costs = new Map<string, PurchaseCost>(
          purchases.map((purchase) => [purchase.packagingMaterialId, purchase]),
        );
        return { items, costs };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const asOf = new Date().toISOString();

    const rateByCurrency = new Map<string, Prisma.Decimal | null>();
    for (const cost of costs.values()) {
      if (
        cost.currency === store.baseCurrency ||
        cost.quantity <= 0 ||
        cost.totalCost.lte(0) ||
        rateByCurrency.has(cost.currency)
      )
        continue;
      const rate = await this.currency.convertOrNull(
        new Prisma.Decimal(1),
        cost.currency,
        store.baseCurrency,
      );
      rateByCurrency.set(
        cost.currency,
        rate?.isFinite() && rate.gt(0) ? rate : null,
      );
    }
    const lines = items
      .map((item) => this.line(item, costs, rateByCurrency))
      .filter((line): line is ItemValueLineDto => line !== null)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      items: lines.slice((page - 1) * limit, page * limit),
      total: lines.length,
      page,
      limit,
      summary: summarize(lines, store.baseCurrency, asOf),
    };
  }

  private line(
    item: ItemRow,
    costs: Map<string, PurchaseCost>,
    rates: Map<string, Prisma.Decimal | null>,
  ): ItemValueLineDto | null {
    // A bundle is assembled from physical component variants; valuing its
    // calculated stock as another inventory item would count components twice.
    if (item.variant?.product.kind === WarehouseProductKind.BUNDLE) return null;
    const source = item.variant ?? item.packagingMaterial;
    if (!source) return null;
    const onHand = item.balances.reduce(
      (sum, balance) => sum + balance.onHand,
      0,
    );
    if (onHand <= 0) return null;
    const reserved = item.balances.reduce(
      (sum, balance) => sum + balance.reserved,
      0,
    );
    const damaged = item.balances.reduce(
      (sum, balance) => sum + balance.damaged,
      0,
    );
    const available = onHand - reserved - damaged;
    // Imported product cost 0 does not distinguish unknown from genuinely free.
    let unitCost: Prisma.Decimal | null = item.variant?.costPrice.gt(0)
      ? item.variant.costPrice
      : null;
    if (item.packagingMaterial) {
      const purchase = costs.get(item.packagingMaterial.id);
      if (purchase && purchase.quantity > 0 && purchase.totalCost.gte(0)) {
        const rate = rates.get(purchase.currency);
        unitCost = purchase.totalCost.div(purchase.quantity);
        // A confirmed free purchase is known zero, even without an FX quote.
        if (unitCost.gt(0) && rate !== undefined)
          unitCost = rate ? unitCost.times(rate) : null;
      }
    }
    const value = (quantity: number) =>
      unitCost?.times(quantity).toFixed(2) ?? null;
    return {
      id: item.id,
      kind: item.kind,
      sourceId: source.id,
      name: item.variant?.product.name ?? item.packagingMaterial!.name,
      variantTitle: item.variant?.title ?? null,
      sku: source.sku,
      onHand,
      reserved,
      damaged,
      available,
      unitCost: unitCost?.toFixed(4) ?? null,
      onHandValue: value(onHand),
      availableValue: value(available),
      reservedValue: value(reserved),
      damagedValue: value(damaged),
    };
  }
}

function summarize(
  lines: ItemValueLineDto[],
  currency: string,
  asOf: string,
): ItemValueSummaryDto {
  const sumValue = (
    field: 'onHandValue' | 'availableValue' | 'reservedValue' | 'damagedValue',
  ) =>
    lines
      .reduce((sum, line) => sum.plus(line[field] ?? 0), new Prisma.Decimal(0))
      .toFixed(2);
  const unvalued = lines.filter((line) => line.unitCost === null);
  return {
    currency,
    asOf,
    itemCount: lines.length,
    onHandUnits: lines.reduce((sum, line) => sum + line.onHand, 0),
    availableUnits: lines.reduce((sum, line) => sum + line.available, 0),
    reservedUnits: lines.reduce((sum, line) => sum + line.reserved, 0),
    damagedUnits: lines.reduce((sum, line) => sum + line.damaged, 0),
    knownOnHandValue: sumValue('onHandValue'),
    knownAvailableValue: sumValue('availableValue'),
    knownReservedValue: sumValue('reservedValue'),
    knownDamagedValue: sumValue('damagedValue'),
    unvaluedItemCount: unvalued.length,
    unvaluedOnHandUnits: unvalued.reduce((sum, line) => sum + line.onHand, 0),
    complete: unvalued.length === 0,
  };
}
