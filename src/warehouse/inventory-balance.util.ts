import { BadRequestException } from '@nestjs/common';
import { InventoryBucket, InventoryMovementType, Prisma } from '@prisma/client';

export type BalanceQuantities = {
  onHand: number;
  reserved: number;
  damaged: number;
  incoming: number;
};

/**
 * The item's balance at the store's default location, creating the MAIN
 * location and an empty balance on first use.
 */
export async function ensureDefaultBalance(
  tx: Prisma.TransactionClient,
  storeId: string,
  inventoryItemId: string,
) {
  const existing = await tx.inventoryBalance.findFirst({
    where: { inventoryItemId, location: { isDefault: true } },
  });
  if (existing) return existing;

  const location = await tx.warehouseLocation.upsert({
    where: { storeId_code: { storeId, code: 'MAIN' } },
    create: { storeId, code: 'MAIN', name: 'Main Warehouse', isDefault: true },
    update: {},
  });
  return tx.inventoryBalance.create({
    data: { inventoryItemId, locationId: location.id },
  });
}

export function bucketField(bucket: InventoryBucket) {
  switch (bucket) {
    case InventoryBucket.ON_HAND:
      return 'onHand' as const;
    case InventoryBucket.RESERVED:
      return 'reserved' as const;
    case InventoryBucket.DAMAGED:
      return 'damaged' as const;
    case InventoryBucket.INCOMING:
      return 'incoming' as const;
  }
}

/** Units that can still be reserved, sold or marked damaged. */
export function availableQuantity(balance: BalanceQuantities): number {
  return balance.onHand - balance.reserved - balance.damaged;
}

export function validateBalance(balance: BalanceQuantities) {
  if (
    balance.onHand < 0 ||
    balance.reserved < 0 ||
    balance.damaged < 0 ||
    balance.incoming < 0
  ) {
    throw new BadRequestException(
      'Inventory quantities cannot become negative',
    );
  }
  if (balance.reserved + balance.damaged > balance.onHand) {
    throw new BadRequestException(
      'Reserved and damaged stock exceed on-hand stock',
    );
  }
}

/**
 * Moves on-hand stock at the default location inside the caller's
 * transaction and writes the matching movement. Throws BadRequest when the
 * balance would go negative or below reserved + damaged.
 */
export async function moveOnHandInTx(
  tx: Prisma.TransactionClient,
  storeId: string,
  inventoryItemId: string,
  movement: {
    type: InventoryMovementType;
    quantityDelta: number;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey?: string;
  },
) {
  const balance = await ensureDefaultBalance(tx, storeId, inventoryItemId);
  const onHand = balance.onHand + movement.quantityDelta;
  validateBalance({ ...balance, onHand });
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { onHand, version: { increment: 1 } },
  });
  return tx.inventoryMovement.create({
    data: {
      inventoryItemId,
      locationId: balance.locationId,
      type: movement.type,
      bucket: InventoryBucket.ON_HAND,
      quantityDelta: movement.quantityDelta,
      resultingQuantity: onHand,
      reason: movement.reason,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      idempotencyKey: movement.idempotencyKey ?? null,
    },
  });
}

export function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}
