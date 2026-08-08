import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryBucket, InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/inventory.dto';
import { WarehouseStoreService } from './warehouse-store.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
  ) {}

  async adjust(
    userId: string,
    inventoryItemId: string,
    dto: AdjustInventoryDto,
  ) {
    const store = await this.stores.requireStore(userId);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const item = await tx.inventoryItem.findFirst({
              where: { id: inventoryItemId, storeId: store.id },
              include: { balances: { include: { location: true } } },
            });
            if (!item) throw new NotFoundException('Inventory item not found');

            const duplicate = await tx.inventoryMovement.findUnique({
              where: {
                inventoryItemId_idempotencyKey: {
                  inventoryItemId,
                  idempotencyKey: dto.idempotencyKey,
                },
              },
            });
            if (duplicate) return duplicate;

            let balance = item.balances.find(
              (entry) => entry.location.isDefault,
            );
            if (!balance) {
              const location = await tx.warehouseLocation.upsert({
                where: { storeId_code: { storeId: store.id, code: 'MAIN' } },
                create: {
                  storeId: store.id,
                  code: 'MAIN',
                  name: 'Main Warehouse',
                  isDefault: true,
                },
                update: {},
              });
              balance = await tx.inventoryBalance.create({
                data: { inventoryItemId, locationId: location.id },
                include: { location: true },
              });
            }

            const field = bucketField(dto.bucket);
            const resultingQuantity = balance[field] + dto.quantityDelta;
            const next = { ...balance, [field]: resultingQuantity };
            validateBalance(next);
            await tx.inventoryBalance.update({
              where: { id: balance.id },
              data: {
                [field]: resultingQuantity,
                version: { increment: 1 },
              },
            });
            return tx.inventoryMovement.create({
              data: {
                inventoryItemId,
                locationId: balance.locationId,
                type: InventoryMovementType.MANUAL_ADJUSTMENT,
                bucket: dto.bucket,
                quantityDelta: dto.quantityDelta,
                resultingQuantity,
                reason: dto.reason.trim(),
                referenceType: dto.referenceType?.trim() || null,
                referenceId: dto.referenceId?.trim() || null,
                idempotencyKey: dto.idempotencyKey,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        if (attempt === 3) {
          throw new ConflictException(
            'Inventory changed concurrently; retry the request',
          );
        }
      }
    }
    throw new ConflictException(
      'Inventory changed concurrently; retry the request',
    );
  }

  async getItem(userId: string, inventoryItemId: string) {
    const store = await this.stores.requireStore(userId);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, storeId: store.id },
      include: {
        barcodes: true,
        balances: { include: { location: true } },
        variant: { include: { product: { select: { id: true, name: true } } } },
        packagingMaterial: true,
      },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return {
      id: item.id,
      kind: item.kind,
      variant: item.variant
        ? {
            id: item.variant.id,
            title: item.variant.title,
            sku: item.variant.sku,
            price: Number(item.variant.price),
            costPrice: Number(item.variant.costPrice),
            lowStockAlertThreshold: item.variant.lowStockThreshold,
            product: item.variant.product,
          }
        : null,
      packagingMaterial: item.packagingMaterial
        ? {
            id: item.packagingMaterial.id,
            name: item.packagingMaterial.name,
            sku: item.packagingMaterial.sku,
            imageUrl: item.packagingMaterial.imageObjectName
              ? `/warehouse/packaging/${item.packagingMaterial.id}/image`
              : null,
          }
        : null,
      barcodes: item.barcodes.map((barcode) => ({
        id: barcode.id,
        value: barcode.value,
        type: barcode.type,
        isPrimary: barcode.isPrimary,
        source: barcode.source,
      })),
      balances: item.balances.map((balance) => ({
        id: balance.id,
        onHand: balance.onHand,
        reserved: balance.reserved,
        damaged: balance.damaged,
        incoming: balance.incoming,
        version: balance.version,
        available: balance.onHand - balance.reserved - balance.damaged,
        location: balance.location,
      })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  async movements(userId: string, inventoryItemId: string, limit = 100) {
    const store = await this.stores.requireStore(userId);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, storeId: store.id },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return this.prisma.inventoryMovement.findMany({
      where: { inventoryItemId },
      include: { location: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }
}

function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

function bucketField(bucket: InventoryBucket) {
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

function validateBalance(balance: {
  onHand: number;
  reserved: number;
  damaged: number;
  incoming: number;
}) {
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
