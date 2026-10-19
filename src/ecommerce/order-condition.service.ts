import { assertPersistedMoney } from '../common/persisted-money';
import type { CurrencyService } from '../currency/currency.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, WarehouseProductKind } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { withOrderTransaction } from '../prisma/order-transaction';
import { ProductCondition } from './constants/product-condition';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';
import { OrderStockService } from './order-stock.service';
import { conditionEffects } from './order-stock.util';

export interface ConditionInput {
  orderLineId: string;
  expectedRevision?: number;
  componentVariantId?: string;
  quantity?: number;
  condition: ProductCondition;
  damageCost?: number;
  notes?: string;
}

export interface StoredConditionEntry {
  componentVariantId: string | null;
  quantity: number;
  condition: ProductCondition;
  damageCost: string | null;
  unitCost: string;
  saleValue: string;
  physicalQuantity: number;
  units: { inventoryItemId: string; quantity: number }[];
}

export interface ConditionSnapshot {
  version: 1;
  completed: boolean;
  expectedQuantity: number;
  loss: string;
  entries: StoredConditionEntry[];
}

export function conditionSnapshot(value: unknown): ConditionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ConditionSnapshot>;
  return candidate.version === 1 &&
    Array.isArray(candidate.entries) &&
    typeof candidate.loss === 'string'
    ? (candidate as ConditionSnapshot)
    : null;
}

const physicalInclude = {
  inventoryItem: true,
  product: {
    include: {
      bundleComponents: {
        include: { componentVariant: { include: { inventoryItem: true } } },
      },
    },
  },
} satisfies Prisma.WarehouseVariantInclude;

/** Quantity allocations replace the current snapshot for each included order line. */
export class OrderConditionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: EcommerceOrderFinancialService,
    private readonly currency?: CurrencyService,
  ) {}

  async record(
    storeId: string,
    orderId: string,
    inputs: ConditionInput[],
    context?: { returnRequestId: string; reason?: string },
  ) {
    const pricing = await this.prisma.ecommerceOrder.findFirst({
      where: { id: orderId, connection: { storeId } },
      select: {
        currency: true,
        connection: { select: { store: { select: { baseCurrency: true } } } },
      },
    });
    if (!pricing) throw new NotFoundException('Order not found');
    const baseCurrency = pricing.connection.store.baseCurrency;
    const costRate =
      baseCurrency === pricing.currency
        ? new Prisma.Decimal(1)
        : await this.currency?.convertOrNull(1, baseCurrency, pricing.currency);
    if (!costRate || !costRate.isFinite() || costRate.lte(0))
      throw new ServiceUnavailableException(
        'A real exchange rate is required to record return costs in order currency',
      );
    return withOrderTransaction(this.prisma, orderId, async (tx) => {
      const order = await tx.ecommerceOrder.findFirst({
        where: { id: orderId, connection: { storeId } },
        include: {
          lines: {
            include: { warehouseVariant: { include: physicalInclude } },
          },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const groups = new Map<string, ConditionInput[]>();
      for (const input of inputs) {
        if (!order.lines.some((line) => line.id === input.orderLineId))
          throw new BadRequestException(
            'Order line does not belong to this order',
          );
        groups.set(input.orderLineId, [
          ...(groups.get(input.orderLineId) ?? []),
          input,
        ]);
      }
      // Prepare every allocation before the first write, then commit stock, lines and loss together.
      const prepared = [...groups].map(([lineId, rows]) => {
        const line = order.lines.find((candidate) => candidate.id === lineId)!;
        const variant = line.warehouseVariant;
        if (variant && variant.storeId !== storeId)
          throw new BadRequestException('Product is unavailable in this store');
        const components =
          variant?.product.kind === WarehouseProductKind.BUNDLE
            ? variant.product.bundleComponents
            : [];
        if (
          components.some(
            (component) => component.componentVariant.storeId !== storeId,
          )
        )
          throw new BadRequestException(
            'Pack component is unavailable in this store',
          );
        const componentMode = rows.some(
          (row) => row.componentVariantId != null,
        );
        if (
          componentMode &&
          (!components.length || rows.some((row) => !row.componentVariantId))
        ) {
          throw new BadRequestException(
            'Component allocations require a pack and cannot mix with whole-pack allocations',
          );
        }
        if (rows.length > 1 && rows.some((row) => row.quantity === undefined)) {
          throw new BadRequestException(
            'Repeated order lines require explicit quantity allocations',
          );
        }
        const totals = new Map<string, number>();
        const identities = new Set<string>();
        const entries = rows
          .map((row) => {
            const component = componentMode
              ? components.find(
                  (c) => c.componentVariantId === row.componentVariantId,
                )
              : undefined;
            if (componentMode && !component)
              throw new BadRequestException(
                'Component does not belong to this pack',
              );
            if (!Object.values(ProductCondition).includes(row.condition))
              throw new BadRequestException('Invalid product condition');
            if (
              row.damageCost != null &&
              (!Number.isFinite(row.damageCost) || row.damageCost < 0)
            )
              throw new BadRequestException(
                'Damage cost must be a finite nonnegative amount',
              );
            const quantity = row.quantity ?? line.quantity;
            if (!Number.isSafeInteger(quantity) || quantity < 1)
              throw new BadRequestException(
                'Allocation quantity must be a positive integer',
              );
            const key = component?.componentVariantId ?? 'LINE';
            const capacity = component
              ? component.quantity * line.quantity
              : line.quantity;
            totals.set(key, (totals.get(key) ?? 0) + quantity);
            if (totals.get(key)! > capacity)
              throw new BadRequestException(
                'Condition quantities exceed ordered quantity',
              );
            const identity = `${key}:${row.condition}`;
            if (identities.has(identity))
              throw new BadRequestException(
                'Combine repeated conditions for the same component into one quantity',
              );
            identities.add(identity);
            const physical = component?.componentVariant ?? variant;
            const unitCost = (
              physical?.costPrice ?? new Prisma.Decimal(0)
            ).times(costRate);
            const units = component
              ? component.componentVariant.inventoryItem
                ? [
                    {
                      inventoryItemId:
                        component.componentVariant.inventoryItem.id,
                      quantity,
                    },
                  ]
                : []
              : components.length
                ? components.flatMap((c) =>
                    c.componentVariant.inventoryItem
                      ? [
                          {
                            inventoryItemId:
                              c.componentVariant.inventoryItem.id,
                            quantity: c.quantity * quantity,
                          },
                        ]
                      : [],
                  )
                : variant?.inventoryItem
                  ? [{ inventoryItemId: variant.inventoryItem.id, quantity }]
                  : [];
            return {
              componentVariantId: component?.componentVariantId ?? null,
              quantity,
              condition: row.condition,
              damageCost:
                row.condition === ProductCondition.DAMAGED &&
                row.damageCost != null
                  ? new Prisma.Decimal(row.damageCost).toFixed(4)
                  : null,
              // Allocate the actual pack selling value by component purchase cost.
              // When all costs are unknown/zero, split by physical unit count;
              // this allocates a known order total and never invents product revenue.
              saleValue: component
                ? (() => {
                    const totalCost = components.reduce(
                      (sum, c) =>
                        sum.plus(
                          c.componentVariant.costPrice
                            .times(costRate)
                            .times(c.quantity * line.quantity),
                        ),
                      new Prisma.Decimal(0),
                    );
                    return totalCost.gt(0)
                      ? line.totalPrice
                          .times(unitCost)
                          .times(quantity)
                          .div(totalCost)
                          .toFixed(4)
                      : line.totalPrice
                          .times(quantity)
                          .div(
                            components.reduce(
                              (sum, c) => sum + c.quantity * line.quantity,
                              0,
                            ),
                          )
                          .toFixed(4);
                  })()
                : line.totalPrice.times(quantity).div(line.quantity).toFixed(4),
              physicalQuantity: component
                ? quantity
                : components.length
                  ? components.reduce((sum, c) => sum + c.quantity, 0) *
                    quantity
                  : quantity,
              unitCost: unitCost.toFixed(4),
              units,
            } satisfies StoredConditionEntry;
          })
          .sort((a, b) =>
            `${a.componentVariantId}:${a.condition}`.localeCompare(
              `${b.componentVariantId}:${b.condition}`,
            ),
          );
        const previous = conditionSnapshot(line.conditionAllocations);
        // Identical retries retain the original cost snapshot even after catalog costs change.
        if (
          previous &&
          JSON.stringify(previous.entries.map(requestFields)) ===
            JSON.stringify(entries.map(requestFields))
        ) {
          return {
            line,
            snapshot: previous,
            unchanged: true,
            notes: rows[0].notes,
          };
        }
        if (
          rows.some(
            (row) =>
              row.expectedRevision !== undefined &&
              row.expectedRevision !== line.conditionRevision,
          )
        )
          throw new ConflictException(
            'Conditions changed; reload the saved return before replacing allocations',
          );
        const completed = componentMode
          ? components.every(
              (c) =>
                totals.get(c.componentVariantId) === c.quantity * line.quantity,
            )
          : totals.get('LINE') === line.quantity;
        const loss = entries.reduce((sum, entry) => {
          const cost = new Prisma.Decimal(entry.unitCost).times(entry.quantity);
          return sum.plus(
            entry.condition === ProductCondition.DAMAGED
              ? (entry.damageCost ?? cost)
              : entry.condition === ProductCondition.LOST ||
                  entry.condition === ProductCondition.MISSING
                ? cost
                : 0,
          );
        }, new Prisma.Decimal(0));
        assertPersistedMoney(loss, 'Allocated loss');
        return {
          line,
          snapshot: {
            version: 1,
            completed,
            expectedQuantity: components.length
              ? components.reduce(
                  (sum, c) => sum + c.quantity * line.quantity,
                  0,
                )
              : line.quantity,
            loss: loss.toFixed(4),
            entries,
          } satisfies ConditionSnapshot,
          unchanged: false,
          notes: rows[0].notes,
        };
      });
      const returnRequest = context
        ? await tx.returnRequest.findFirst({
            where: { id: context.returnRequestId, orderId },
            include: { lines: true },
          })
        : null;
      if (context && !returnRequest)
        throw new NotFoundException('Return request not found');
      if (returnRequest) {
        const members = new Set(
          returnRequest.lines.map((line) => line.orderLineId),
        );
        if (inputs.some((input) => !members.has(input.orderLineId)))
          throw new BadRequestException(
            'Order line is not part of this return request',
          );
        const complete = order.lines
          .filter((line) => members.has(line.id))
          .every(
            (line) =>
              prepared.find((entry) => entry.line.id === line.id)?.snapshot
                .completed ??
              conditionSnapshot(line.conditionAllocations)?.completed ??
              line.condition !== null,
          );
        if (
          !complete &&
          (await tx.returnRequest.findFirst({
            where: {
              orderId,
              status: 'NEED_VERIFICATION',
              id: { not: returnRequest.id },
            },
          }))
        )
          throw new ConflictException(
            'Another open return exists; verify that return before reopening this one',
          );
      }
      const stock = new OrderStockService(tx);
      const financial = this.financial.forTransaction(tx);
      const inventoryUpdates: Record<string, boolean> = {};
      for (const { line, snapshot, unchanged, notes } of prepared) {
        inventoryUpdates[line.id] = false;
        if (unchanged) {
          if (notes !== undefined)
            await tx.ecommerceOrderLine.update({
              where: { id: line.id },
              data: { conditionNotes: notes?.trim() || null },
            });
          continue;
        }
        const revision = line.conditionRevision + 1;
        const targets = new Map<string, { onHand: number; damaged: number }>();
        for (const entry of snapshot.entries)
          for (const unit of entry.units) {
            const target = targets.get(unit.inventoryItemId) ?? {
              onHand: 0,
              damaged: 0,
            };
            for (const effect of conditionEffects(
              entry.condition,
              line.stockStatus === 'DELIVERED',
            )) {
              if (effect.bucket === 'ON_HAND')
                target.onHand += effect.sign * unit.quantity;
              if (effect.bucket === 'DAMAGED')
                target.damaged += effect.sign * unit.quantity;
            }
            targets.set(unit.inventoryItemId, target);
          }
        const old = conditionSnapshot(line.conditionAllocations);
        for (const entry of old?.entries ?? [])
          for (const unit of entry.units) {
            if (!targets.has(unit.inventoryItemId))
              targets.set(unit.inventoryItemId, { onHand: 0, damaged: 0 });
          }
        inventoryUpdates[line.id] = await stock.reconcileReturnTargets({
          storeId,
          orderId,
          lineId: line.id,
          revision,
          targets,
        });
        const kinds = new Set(snapshot.entries.map((entry) => entry.condition));
        await tx.ecommerceOrderLine.update({
          where: { id: line.id },
          data: {
            condition: snapshot.completed
              ? kinds.size === 1
                ? snapshot.entries[0].condition
                : 'MIXED'
              : null,
            damageCost: snapshot.entries.some(
              (entry) => entry.damageCost !== null,
            )
              ? snapshot.entries
                  .filter(
                    (entry) => entry.condition === ProductCondition.DAMAGED,
                  )
                  .reduce(
                    (sum, entry) =>
                      sum.plus(
                        entry.damageCost ??
                          new Prisma.Decimal(entry.unitCost).times(
                            entry.quantity,
                          ),
                      ),
                    new Prisma.Decimal(0),
                  )
              : null,
            ...(notes === undefined
              ? {}
              : { conditionNotes: notes?.trim() || null }),
            conditionAllocations: snapshot as unknown as Prisma.InputJsonValue,
            conditionRevision: revision,
            conditionRecordedAt: new Date(),
          },
        });
        await financial.setLineLoss(
          order.id,
          line.id,
          order.currency,
          new Prisma.Decimal(snapshot.loss),
          'Warehouse quantity/component conditions reconciled',
          new Date(),
        );
      }
      const updated = await tx.ecommerceOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          lines: {
            include: { warehouseVariant: { select: { costPrice: true } } },
          },
        },
      });
      if (context && returnRequest) {
        const members = new Set(
          returnRequest.lines.map((line) => line.orderLineId),
        );
        const complete = updated.lines
          .filter((line) => members.has(line.id))
          .every(
            (line) =>
              conditionSnapshot(line.conditionAllocations)?.completed ??
              line.condition !== null,
          );
        await tx.returnRequest.update({
          where: { id: returnRequest.id },
          data: {
            status: complete ? 'PROCESSED' : 'NEED_VERIFICATION',
            verifiedAt: complete ? new Date() : null,
            reason: context.reason ?? returnRequest.reason,
          },
        });
      }
      return { ...updated, inventoryUpdates };
    });
  }
}

function requestFields(entry: StoredConditionEntry) {
  return {
    componentVariantId: entry.componentVariantId,
    quantity: entry.quantity,
    condition: entry.condition,
    damageCost: entry.damageCost,
  };
}

export function publicConditionEntries(value: unknown) {
  return (conditionSnapshot(value)?.entries ?? []).map((entry) => ({
    componentVariantId: entry.componentVariantId,
    quantity: entry.quantity,
    physicalQuantity: entry.physicalQuantity,
    condition: entry.condition,
    damageCost: entry.damageCost,
    unitCost: entry.unitCost,
    saleValue: entry.saleValue,
  }));
}
