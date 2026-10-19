import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryBucket,
  InventoryItemKind,
  InventoryMovementType,
  MediaAssetPurpose,
  MediaAssetStatus,
  PackagingUnit,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreatePackagingDto,
  PackagingListQueryDto,
  PackagingSource,
  PackagingStockStatus,
  UpdatePackagingDto,
} from './dto/packaging.dto';
import type {
  OwnedPackagingMaterialResponseDto,
  PackagingMaterialDetailResponseDto,
} from './dto/packaging-response.dto';
import { MediaService } from './media.service';
import { WarehouseStoreService } from './warehouse-store.service';

const MATERIAL_INCLUDE = {
  inventoryItem: { include: { balances: true } },
  _count: { select: { requirements: true } },
} satisfies Prisma.PackagingMaterialInclude;

type MaterialRow = Prisma.PackagingMaterialGetPayload<{
  include: typeof MATERIAL_INCLUDE;
}>;

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
  private readonly logger = new Logger(PackagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
    private readonly media: MediaService,
  ) {}

  async listOwned(
    userId: string,
    query: PackagingListQueryDto = {},
  ): Promise<OwnedPackagingMaterialResponseDto[]> {
    const store = await this.stores.requireStore(userId);
    const materials = await this.prisma.packagingMaterial.findMany({
      where: {
        storeId: store.id,
        isActive: true,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.source === 'SHOP'
          ? { zomaalShopVariantId: { not: null } }
          : query.source === 'MANUAL'
            ? { zomaalShopVariantId: null }
            : {}),
      },
      include: MATERIAL_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return materials
      .map(toListItem)
      .filter(
        (item) => !query.stockStatus || item.stockStatus === query.stockStatus,
      );
  }

  async get(
    userId: string,
    id: string,
  ): Promise<PackagingMaterialDetailResponseDto> {
    const store = await this.stores.requireStore(userId);
    return this.detail(store.id, id);
  }

  /** "Add packaging item": packaging the merchant bought outside Zomaal Shop. */
  async create(
    userId: string,
    dto: CreatePackagingDto,
  ): Promise<PackagingMaterialDetailResponseDto> {
    const store = await this.stores.requireStore(userId);
    const openingStock = dto.openingStock ?? 0;
    const id = await this.prisma.$transaction(async (tx) => {
      const material = await tx.packagingMaterial.create({
        data: {
          storeId: store.id,
          name: dto.name,
          supplierNames: dto.supplierNames,
          sku: dto.sku || null,
          unit: dto.unit ?? PackagingUnit.PIECES,
          minimumLevel: dto.minimumLevel ?? 0,
          lowStockAlert: dto.lowStockAlert ?? true,
        },
      });
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
      await tx.inventoryItem.create({
        data: {
          storeId: store.id,
          kind: InventoryItemKind.PACKAGING_MATERIAL,
          packagingMaterialId: material.id,
          balances: {
            create: { locationId: location.id, onHand: openingStock },
          },
          ...(openingStock > 0
            ? {
                movements: {
                  create: {
                    locationId: location.id,
                    type: InventoryMovementType.OPENING_BALANCE,
                    bucket: InventoryBucket.ON_HAND,
                    quantityDelta: openingStock,
                    resultingQuantity: openingStock,
                    reason:
                      'Initial stock entered when the packaging was added',
                    idempotencyKey: `opening:${material.id}`,
                  },
                },
              }
            : {}),
        },
      });
      if (dto.imageUploadId) {
        await attachImage(tx, store.id, material.id, dto.imageUploadId);
      }
      return material.id;
    });
    return this.detail(store.id, id);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePackagingDto,
  ): Promise<PackagingMaterialDetailResponseDto> {
    const store = await this.stores.requireStore(userId);
    const material = await this.requireActive(store.id, id);
    const changesCatalogFields =
      dto.name !== undefined ||
      dto.sku !== undefined ||
      dto.imageUploadId !== undefined;
    if (material.zomaalShopVariantId && changesCatalogFields) {
      throw new BadRequestException(
        'Name, SKU and photo of Zomaal Shop packaging come from the shop catalog and cannot be edited',
      );
    }

    const previousImage = await this.prisma.mediaAsset.findUnique({
      where: { packagingMaterialId: id },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.packagingMaterial.update({
        where: { id },
        data: {
          name: dto.name,
          supplierNames: dto.supplierNames,
          sku: dto.sku === undefined ? undefined : dto.sku || null,
          unit: dto.unit,
          minimumLevel: dto.minimumLevel,
          lowStockAlert: dto.lowStockAlert,
        },
      });
      if (dto.imageUploadId === undefined) return;
      if (previousImage) {
        await tx.mediaAsset.update({
          where: { id: previousImage.id },
          data: { packagingMaterialId: null },
        });
      }
      if (dto.imageUploadId) {
        await attachImage(tx, store.id, id, dto.imageUploadId);
      } else {
        await tx.packagingMaterial.update({
          where: { id },
          data: { imageObjectName: null },
        });
      }
    });

    if (dto.imageUploadId !== undefined && previousImage) {
      await this.media
        .deleteAttachedAsset(previousImage.id)
        .catch((err: Error) =>
          this.logger.warn(
            `Old packaging image ${previousImage.id} not deleted: ${err.message}`,
          ),
        );
    }
    return this.detail(store.id, id);
  }

  /**
   * Hides the material. Its stock history is kept, and a later Zomaal Shop
   * delivery of the same item makes it active again.
   */
  async archive(userId: string, id: string): Promise<{ archived: true }> {
    const store = await this.stores.requireStore(userId);
    await this.requireActive(store.id, id);
    const products = await this.prisma.productPackagingRequirement.findMany({
      where: { packagingMaterialId: id },
      distinct: ['productId'],
      select: { productId: true },
    });
    if (products.length > 0) {
      throw new ConflictException(
        `This packaging is used by ${products.length} product${products.length === 1 ? '' : 's'}. Remove it from ${products.length === 1 ? 'that product' : 'those products'} first.`,
      );
    }
    await this.prisma.packagingMaterial.update({
      where: { id },
      data: { isActive: false },
    });
    return { archived: true };
  }

  private async requireActive(storeId: string, id: string) {
    const material = await this.prisma.packagingMaterial.findFirst({
      where: { id, storeId, isActive: true },
      select: { id: true, zomaalShopVariantId: true },
    });
    if (!material) throw new NotFoundException('Packaging not found');
    return material;
  }

  private async detail(
    storeId: string,
    id: string,
  ): Promise<PackagingMaterialDetailResponseDto> {
    const material = await this.prisma.packagingMaterial.findFirst({
      where: { id, storeId, isActive: true },
      include: {
        ...MATERIAL_INCLUDE,
        requirements: {
          select: {
            quantityPerUnit: true,
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, title: true } },
          },
          orderBy: { product: { name: 'asc' } },
        },
      },
    });
    if (!material) throw new NotFoundException('Packaging not found');
    const balances = material.inventoryItem?.balances ?? [];
    return {
      ...toListItem(material),
      reserved: balances.reduce((sum, b) => sum + b.reserved, 0),
      damaged: balances.reduce((sum, b) => sum + b.damaged, 0),
      products: material.requirements.map((r) => ({
        productId: r.product.id,
        productName: r.product.name,
        variantId: r.variant?.id ?? null,
        variantTitle: r.variant?.title ?? null,
        quantityPerUnit: r.quantityPerUnit,
      })),
    };
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

export function packagingStockStatus(
  available: number,
  minimumLevel: number,
): PackagingStockStatus {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= minimumLevel) return 'LOW_STOCK';
  return 'IN_STOCK';
}

function toListItem(material: MaterialRow): OwnedPackagingMaterialResponseDto {
  const balances = material.inventoryItem?.balances ?? [];
  const onHand = balances.reduce((sum, b) => sum + b.onHand, 0);
  const available = balances.reduce(
    (sum, b) => sum + b.onHand - b.reserved - b.damaged,
    0,
  );
  const source: PackagingSource = material.zomaalShopVariantId
    ? 'SHOP'
    : 'MANUAL';
  return {
    id: material.id,
    source,
    zomaalShopVariantId: material.zomaalShopVariantId,
    name: material.name,
    supplierNames: material.supplierNames ?? [],
    sku: material.sku,
    unit: material.unit,
    imageUrl: material.imageObjectName
      ? `/warehouse/packaging/${material.id}/image`
      : null,
    inventoryItemId: material.inventoryItem?.id ?? null,
    onHand,
    available,
    minimumLevel: material.minimumLevel,
    lowStockAlert: material.lowStockAlert,
    stockStatus: packagingStockStatus(available, material.minimumLevel),
    usedInProducts: material._count.requirements,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  };
}

async function attachImage(
  tx: Prisma.TransactionClient,
  storeId: string,
  packagingMaterialId: string,
  uploadId: string,
) {
  const asset = await tx.mediaAsset.findFirst({
    where: {
      id: uploadId,
      storeId,
      status: MediaAssetStatus.TEMPORARY,
      purpose: MediaAssetPurpose.PACKAGING,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, objectName: true },
  });
  if (!asset) {
    throw new BadRequestException(
      `Image ${uploadId} cannot be attached as PACKAGING`,
    );
  }
  await tx.mediaAsset.update({
    where: { id: asset.id },
    data: {
      status: MediaAssetStatus.ATTACHED,
      expiresAt: null,
      packagingMaterialId,
    },
  });
  await tx.packagingMaterial.update({
    where: { id: packagingMaterialId },
    data: { imageObjectName: asset.objectName },
  });
}

function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}
