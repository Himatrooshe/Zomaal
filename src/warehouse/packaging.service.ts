import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryBucket,
  InventoryItemKind,
  InventoryMovementType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseStoreService } from './warehouse-store.service';

export interface DeliveredPackagingPurchase {
  zomaalShopVariantId: string;
  name: string;
  sku?: string;
  imageObjectName?: string;
  quantity: number;
  deliveryReference: string;
}

@Injectable()
export class PackagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
  ) {}

  async listOwned(userId: string) {
    const store = await this.stores.requireStore(userId);
    const materials = await this.prisma.packagingMaterial.findMany({
      where: { storeId: store.id, isActive: true },
      include: {
        inventoryItem: {
          include: {
            barcodes: true,
            balances: { include: { location: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return materials.map((material) => ({
      id: material.id,
      zomaalShopVariantId: material.zomaalShopVariantId,
      name: material.name,
      sku: material.sku,
      imageUrl: material.imageObjectName
        ? `/warehouse/packaging/${material.id}/image`
        : null,
      inventoryItemId: material.inventoryItem?.id ?? null,
      available:
        material.inventoryItem?.balances.reduce(
          (sum, balance) =>
            sum + balance.onHand - balance.reserved - balance.damaged,
          0,
        ) ?? 0,
      createdAt: material.createdAt.toISOString(),
      updatedAt: material.updatedAt.toISOString(),
    }));
  }

  async requireImageObject(userId: string, packagingMaterialId: string) {
    const store = await this.stores.requireStore(userId);
    const material = await this.prisma.packagingMaterial.findFirst({
      where: {
        id: packagingMaterialId,
        storeId: store.id,
        isActive: true,
        imageObjectName: { not: null },
      },
      select: { imageObjectName: true },
    });
    if (!material?.imageObjectName) {
      throw new NotFoundException('Packaging image not found');
    }
    return material.imageObjectName;
  }

  async creditDeliveredPurchase(
    storeId: string,
    item: DeliveredPackagingPurchase,
  ) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(
        'Delivered packaging quantity must be a positive integer',
      );
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const location = await tx.warehouseLocation.upsert({
              where: { storeId_code: { storeId, code: 'MAIN' } },
              create: {
                storeId,
                code: 'MAIN',
                name: 'Main Warehouse',
                isDefault: true,
              },
              update: {},
            });
            const material = await tx.packagingMaterial.upsert({
              where: {
                storeId_zomaalShopVariantId: {
                  storeId,
                  zomaalShopVariantId: item.zomaalShopVariantId,
                },
              },
              create: {
                storeId,
                zomaalShopVariantId: item.zomaalShopVariantId,
                name: item.name,
                sku: item.sku,
                imageObjectName: item.imageObjectName,
              },
              update: {
                name: item.name,
                sku: item.sku,
                imageObjectName: item.imageObjectName,
                isActive: true,
              },
            });
            const inventoryItem = await tx.inventoryItem.upsert({
              where: { packagingMaterialId: material.id },
              create: {
                storeId,
                kind: InventoryItemKind.PACKAGING_MATERIAL,
                packagingMaterialId: material.id,
              },
              update: {},
            });
            const priorMovement = await tx.inventoryMovement.findUnique({
              where: {
                inventoryItemId_idempotencyKey: {
                  inventoryItemId: inventoryItem.id,
                  idempotencyKey: `shop-delivery:${item.deliveryReference}`,
                },
              },
            });
            if (priorMovement) return priorMovement;
            const balance = await tx.inventoryBalance.upsert({
              where: {
                inventoryItemId_locationId: {
                  inventoryItemId: inventoryItem.id,
                  locationId: location.id,
                },
              },
              create: {
                inventoryItemId: inventoryItem.id,
                locationId: location.id,
                onHand: item.quantity,
              },
              update: {
                onHand: { increment: item.quantity },
                version: { increment: 1 },
              },
            });
            return tx.inventoryMovement.create({
              data: {
                inventoryItemId: inventoryItem.id,
                locationId: location.id,
                type: InventoryMovementType.PACKAGING_RECEIVED,
                bucket: InventoryBucket.ON_HAND,
                quantityDelta: item.quantity,
                resultingQuantity: balance.onHand,
                reason: 'Packaging received from a delivered Zomaal Shop order',
                referenceType: 'ZOMAAL_SHOP_DELIVERY',
                referenceId: item.deliveryReference,
                idempotencyKey: `shop-delivery:${item.deliveryReference}`,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isWriteConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error('Unable to credit packaging inventory');
  }
}

function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}
