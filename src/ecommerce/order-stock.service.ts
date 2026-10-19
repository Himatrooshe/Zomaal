import { isOrderTransaction } from '../prisma/order-transaction';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  InventoryBucket,
  InventoryMovementType,
  OrderLineStockStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductCondition } from './constants/product-condition';
import {
  bucketField,
  ensureDefaultBalance,
  isWriteConflict,
} from '../warehouse/inventory-balance.util';
import {
  clampDelta,
  conditionEffects,
  expandOrderLine,
  ORDER_LINE_STOCK_INCLUDE,
  type OrderLineWithStock,
  type StockUnit,
} from './order-stock.util';

export const ORDER_LINE_REFERENCE = 'ORDER_LINE';
// Return movements recorded before order-driven stock referenced the order.
const LEGACY_RETURN_REFERENCES = ['ORDER_RETURN', 'ORDER_RETURN_CORRECTION'];
const RETURN_MOVEMENT_TYPES = [
  InventoryMovementType.RETURN_GOOD,
  InventoryMovementType.RETURN_DAMAGED,
  InventoryMovementType.RETURN_LOST,
];

interface MoveInput {
  type: InventoryMovementType;
  bucket: InventoryBucket;
  delta: number;
  reason: string;
  lineId: string;
  idempotencyKey: string;
}

/**
 * Order-driven stock: units are reserved when an order is handed to a
 * courier, deducted for good on delivery, and released when the order is
 * cancelled or comes back. Every change is an idempotent InventoryMovement
 * referencing the order line, so courier syncs can call these repeatedly.
 */
@Injectable()
export class OrderStockService {
  private readonly logger = new Logger(OrderStockService.name);

  constructor(private readonly prisma: PrismaService) {}

  forTransaction(prisma: PrismaService) {
    return new OrderStockService(prisma);
  }

  async reserveOrder(orderId: string): Promise<void> {
    const order = await this.loadOrder(orderId);
    if (!order) return;
    for (const line of order.lines) {
      if (!line.warehouseVariant || line.stockStatus) continue;
      for (const unit of physicalUnits(line)) {
        await this.move(order.storeId, unit, {
          type: InventoryMovementType.ORDER_RESERVED,
          bucket: InventoryBucket.RESERVED,
          delta: unit.quantity,
          reason: `Reserved for order ${order.label}`,
          lineId: line.id,
          idempotencyKey: `order-reserve:${line.id}`,
        });
      }
      await this.setStatus(line.id, OrderLineStockStatus.RESERVED);
    }
  }

  /**
   * `deliveredAt` comes from platform timelines: an unreserved line first
   * synced after that delivery predates stock tracking (the merchant's
   * on-hand count already excludes it), so it is not deducted again.
   */
  async deliverOrder(orderId: string, deliveredAt?: Date): Promise<void> {
    const order = await this.loadOrder(orderId);
    if (!order) return;
    for (const line of order.lines) {
      if (
        !line.warehouseVariant ||
        line.stockStatus === OrderLineStockStatus.DELIVERED
      ) {
        continue;
      }
      if (
        deliveredAt &&
        line.stockStatus === null &&
        line.createdAt > deliveredAt
      ) {
        continue;
      }
      for (const unit of expandOrderLine(line)) {
        if (unit.role === 'PACKAGING') {
          await this.move(order.storeId, unit, {
            type: InventoryMovementType.PACKAGING_CONSUMED,
            bucket: InventoryBucket.ON_HAND,
            delta: -unit.quantity,
            reason: `Packaging used for delivered order ${order.label}`,
            lineId: line.id,
            idempotencyKey: `order-packaging:${line.id}`,
          });
          continue;
        }
        const reserved = await this.netReserved(line.id, unit.inventoryItemId);
        if (reserved > 0) {
          await this.move(order.storeId, unit, {
            type: InventoryMovementType.ORDER_DELIVERED,
            bucket: InventoryBucket.RESERVED,
            delta: -reserved,
            reason: `Reservation settled: order ${order.label} delivered`,
            lineId: line.id,
            idempotencyKey: `order-deliver-release:${line.id}`,
          });
        }
        await this.move(order.storeId, unit, {
          type: InventoryMovementType.ORDER_DELIVERED,
          bucket: InventoryBucket.ON_HAND,
          delta: -unit.quantity,
          reason: `Order ${order.label} delivered`,
          lineId: line.id,
          idempotencyKey: `order-deliver:${line.id}`,
        });
      }
      for (const [inventoryItemId, reserved] of await this.orphanReservations(
        line,
      )) {
        const unit: StockUnit = {
          inventoryItemId,
          quantity: reserved,
          role: 'PRODUCT',
        };
        await this.move(order.storeId, unit, {
          type: InventoryMovementType.ORDER_DELIVERED,
          bucket: InventoryBucket.RESERVED,
          delta: -reserved,
          reason: `Reservation settled: order ${order.label} delivered`,
          lineId: line.id,
          idempotencyKey: `order-deliver-release:${line.id}`,
        });
        await this.move(order.storeId, unit, {
          type: InventoryMovementType.ORDER_DELIVERED,
          bucket: InventoryBucket.ON_HAND,
          delta: -reserved,
          reason: `Order ${order.label} delivered`,
          lineId: line.id,
          idempotencyKey: `order-deliver:${line.id}`,
        });
      }
      await this.setStatus(line.id, OrderLineStockStatus.DELIVERED);
    }
  }

  async releaseOrder(orderId: string): Promise<void> {
    const order = await this.loadOrder(orderId);
    if (!order) return;
    for (const line of order.lines) {
      if (line.stockStatus !== OrderLineStockStatus.RESERVED) continue;
      await this.releaseLine(order.storeId, order.label, line);
    }
  }

  /**
   * Stock effect of a return condition recorded at the warehouse scan.
   * A correction (different condition than before) first undoes what the
   * earlier return movements on this line actually applied.
   */
  async applyReturnCondition(input: {
    storeId: string;
    orderId: string;
    orderLabel: string;
    lineId: string;
    condition: ProductCondition;
    isCorrection: boolean;
    recordedAt: Date;
  }): Promise<boolean> {
    const line = await this.prisma.ecommerceOrderLine.findUnique({
      where: { id: input.lineId },
      include: ORDER_LINE_STOCK_INCLUDE,
    });
    if (!line?.warehouseVariant) return false;

    const delivered = line.stockStatus === OrderLineStockStatus.DELIVERED;
    if (line.stockStatus === OrderLineStockStatus.RESERVED) {
      await this.releaseLine(input.storeId, input.orderLabel, line);
    }

    const stamp = input.recordedAt.getTime();
    let updated = false;
    for (const unit of expandOrderLine(line)) {
      if (unit.role !== 'PRODUCT') continue;

      if (input.isCorrection) {
        for (const bucket of [
          InventoryBucket.DAMAGED,
          InventoryBucket.ON_HAND,
        ]) {
          const applied = await this.netReturned(
            input.orderId,
            line.id,
            unit.inventoryItemId,
            bucket,
          );
          if (applied === 0) continue;
          await this.move(input.storeId, unit, {
            type:
              bucket === InventoryBucket.DAMAGED
                ? InventoryMovementType.RETURN_DAMAGED
                : applied > 0
                  ? InventoryMovementType.RETURN_GOOD
                  : InventoryMovementType.RETURN_LOST,
            bucket,
            delta: -applied,
            reason: `Correction: reversing earlier return condition (order ${input.orderLabel})`,
            lineId: line.id,
            idempotencyKey: `return-reverse:${line.id}:${bucket}:${stamp}`,
          });
        }
      }

      const effects = conditionEffects(input.condition, delivered);
      for (const [index, effect] of effects.entries()) {
        const applied = await this.move(input.storeId, unit, {
          type: effect.type,
          bucket: effect.bucket,
          delta: effect.sign * unit.quantity,
          reason: `Return condition: ${input.condition} (order ${input.orderLabel})`,
          lineId: line.id,
          idempotencyKey: input.isCorrection
            ? `return:${line.id}:${input.condition}:${index}:${stamp}`
            : index === 0
              ? `return:${line.id}:${input.condition}`
              : `return:${line.id}:${input.condition}:${index}`,
        });
        updated ||= applied !== 0;
      }
    }
    return updated;
  }

  async reconcileReturnTargets(input: {
    storeId: string;
    orderId: string;
    lineId: string;
    revision: number;
    targets: Map<string, { onHand: number; damaged: number }>;
  }) {
    let updated = false;
    const order = await this.loadOrder(input.orderId);
    const line = order?.lines.find(
      (candidate) => candidate.id === input.lineId,
    );
    if (!order || !line) return false;
    if (line.stockStatus === OrderLineStockStatus.RESERVED)
      await this.releaseLine(input.storeId, order.label, line);
    const prior = await this.prisma.inventoryMovement.findMany({
      where: {
        referenceType: ORDER_LINE_REFERENCE,
        referenceId: input.lineId,
        type: { in: RETURN_MOVEMENT_TYPES },
      },
      select: { inventoryItemId: true },
      distinct: ['inventoryItemId'],
    });
    for (const movement of prior)
      if (!input.targets.has(movement.inventoryItemId))
        input.targets.set(movement.inventoryItemId, { onHand: 0, damaged: 0 });
    for (const [inventoryItemId, target] of input.targets) {
      const onHand = await this.netReturned(
        input.orderId,
        input.lineId,
        inventoryItemId,
        InventoryBucket.ON_HAND,
      );
      const damaged = await this.netReturned(
        input.orderId,
        input.lineId,
        inventoryItemId,
        InventoryBucket.DAMAGED,
      );
      const deltas: [InventoryBucket, number][] = [];
      if (target.damaged < damaged)
        deltas.push([InventoryBucket.DAMAGED, target.damaged - damaged]);
      deltas.push([InventoryBucket.ON_HAND, target.onHand - onHand]);
      if (target.damaged > damaged)
        deltas.push([InventoryBucket.DAMAGED, target.damaged - damaged]);
      for (const [index, [bucket, delta]] of deltas.entries()) {
        if (!delta) continue;
        const applied = await this.move(
          input.storeId,
          { inventoryItemId, quantity: Math.abs(delta), role: 'PRODUCT' },
          {
            bucket,
            delta,
            type:
              bucket === InventoryBucket.DAMAGED
                ? InventoryMovementType.RETURN_DAMAGED
                : delta > 0
                  ? InventoryMovementType.RETURN_GOOD
                  : InventoryMovementType.RETURN_LOST,
            reason: 'Warehouse condition allocation reconciled',
            lineId: input.lineId,
            idempotencyKey: `return-allocation:${input.lineId}:${input.revision}:${inventoryItemId}:${index}`,
          },
        );
        updated ||= applied !== 0;
      }
    }
    return updated;
  }

  private async releaseLine(
    storeId: string,
    orderLabel: string,
    line: OrderLineWithStock,
  ) {
    for (const unit of physicalUnits(line)) {
      const reserved = await this.netReserved(line.id, unit.inventoryItemId);
      if (reserved <= 0) continue;
      await this.move(storeId, unit, {
        type: InventoryMovementType.ORDER_RELEASED,
        bucket: InventoryBucket.RESERVED,
        delta: -reserved,
        reason: `Released: order ${orderLabel} cancelled or returned`,
        lineId: line.id,
        idempotencyKey: `order-release:${line.id}`,
      });
    }
    for (const [inventoryItemId, reserved] of await this.orphanReservations(
      line,
    )) {
      await this.move(
        storeId,
        { inventoryItemId, quantity: reserved, role: 'PRODUCT' },
        {
          type: InventoryMovementType.ORDER_RELEASED,
          bucket: InventoryBucket.RESERVED,
          delta: -reserved,
          reason: `Released: order ${orderLabel} cancelled or returned`,
          lineId: line.id,
          idempotencyKey: `order-release:${line.id}`,
        },
      );
    }
    await this.setStatus(line.id, OrderLineStockStatus.RELEASED);
  }

  /**
   * Items still reserved for a line but no longer part of its product, e.g.
   * a bundle component or gift changed after the order was dispatched.
   */
  private async orphanReservations(
    line: OrderLineWithStock,
  ): Promise<Map<string, number>> {
    if (line.stockStatus !== OrderLineStockStatus.RESERVED) return new Map();
    const current = new Set(
      physicalUnits(line).map((unit) => unit.inventoryItemId),
    );
    const groups = await this.prisma.inventoryMovement.groupBy({
      by: ['inventoryItemId'],
      where: {
        referenceType: ORDER_LINE_REFERENCE,
        referenceId: line.id,
        bucket: InventoryBucket.RESERVED,
      },
      _sum: { quantityDelta: true },
    });
    const orphans = new Map<string, number>();
    for (const group of groups) {
      const reserved = group._sum.quantityDelta ?? 0;
      if (reserved > 0 && !current.has(group.inventoryItemId)) {
        orphans.set(group.inventoryItemId, reserved);
      }
    }
    return orphans;
  }

  private async loadOrder(orderId: string) {
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderName: true,
        connection: { select: { storeId: true } },
        lines: { include: ORDER_LINE_STOCK_INCLUDE },
      },
    });
    if (!order) return null;
    return {
      storeId: order.connection.storeId,
      label: order.orderName ?? order.id,
      lines: order.lines,
    };
  }

  private setStatus(lineId: string, stockStatus: OrderLineStockStatus) {
    return this.prisma.ecommerceOrderLine.update({
      where: { id: lineId },
      data: { stockStatus },
    });
  }

  private async netReserved(lineId: string, inventoryItemId: string) {
    const result = await this.prisma.inventoryMovement.aggregate({
      where: {
        referenceType: ORDER_LINE_REFERENCE,
        referenceId: lineId,
        inventoryItemId,
        bucket: InventoryBucket.RESERVED,
      },
      _sum: { quantityDelta: true },
    });
    return result._sum.quantityDelta ?? 0;
  }

  private async netReturned(
    orderId: string,
    lineId: string,
    inventoryItemId: string,
    bucket: InventoryBucket,
  ) {
    const result = await this.prisma.inventoryMovement.aggregate({
      where: {
        inventoryItemId,
        bucket,
        type: { in: RETURN_MOVEMENT_TYPES },
        OR: [
          { referenceType: ORDER_LINE_REFERENCE, referenceId: lineId },
          {
            referenceType: { in: LEGACY_RETURN_REFERENCES },
            referenceId: orderId,
          },
        ],
      },
      _sum: { quantityDelta: true },
    });
    return result._sum.quantityDelta ?? 0;
  }

  /** Applies the clamped part of `delta`; returns what was actually moved. */
  private async move(
    storeId: string,
    unit: StockUnit,
    input: MoveInput,
  ): Promise<number> {
    const inventoryItemId = unit.inventoryItemId;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const duplicate = await tx.inventoryMovement.findUnique({
              where: {
                inventoryItemId_idempotencyKey: {
                  inventoryItemId,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            if (duplicate) return duplicate.quantityDelta;

            const balance = await ensureDefaultBalance(
              tx,
              storeId,
              inventoryItemId,
            );
            const applied = clampDelta(balance, input.bucket, input.delta);
            if (applied !== input.delta) {
              this.logger.warn(
                `Stock short for item ${inventoryItemId}: wanted ${input.delta} ${input.bucket}, moved ${applied} (${input.idempotencyKey})`,
              );
            }
            if (applied === 0) return 0;

            const field = bucketField(input.bucket);
            const resultingQuantity = balance[field] + applied;
            await tx.inventoryBalance.update({
              where: { id: balance.id },
              data: { [field]: resultingQuantity, version: { increment: 1 } },
            });
            await tx.inventoryMovement.create({
              data: {
                inventoryItemId,
                locationId: balance.locationId,
                type: input.type,
                bucket: input.bucket,
                quantityDelta: applied,
                resultingQuantity,
                reason:
                  applied === input.delta
                    ? input.reason
                    : `${input.reason} (only ${Math.abs(applied)} of ${Math.abs(input.delta)} in stock)`,
                referenceType: ORDER_LINE_REFERENCE,
                referenceId: input.lineId,
                idempotencyKey: input.idempotencyKey,
              },
            });
            return applied;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          isOrderTransaction(this.prisma) ||
          !isWriteConflict(error) ||
          attempt === 3
        )
          throw error;
      }
    }
    throw new ConflictException('Inventory changed concurrently');
  }
}

function physicalUnits(line: OrderLineWithStock): StockUnit[] {
  return expandOrderLine(line).filter((unit) => unit.role !== 'PACKAGING');
}
