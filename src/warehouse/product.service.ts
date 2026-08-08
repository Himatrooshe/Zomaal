import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryBarcodeType,
  InventoryItemKind,
  MediaAssetPurpose,
  MediaAssetStatus,
  Prisma,
  WarehouseProductStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeService } from './barcode.service';
import {
  CreateWarehouseProductDto,
  ProductOptionInputDto,
  ProductVariantInputDto,
  UpdateWarehouseProductDto,
  WarehouseProductQueryDto,
} from './dto/product.dto';
import { WarehouseStoreService } from './warehouse-store.service';

const PRODUCT_INCLUDE = {
  category: true,
  options: {
    orderBy: { position: 'asc' as const },
    include: { values: { orderBy: { position: 'asc' as const } } },
  },
  variants: {
    orderBy: { position: 'asc' as const },
    include: {
      optionValues: { include: { value: { include: { option: true } } } },
      inventoryItem: {
        include: {
          barcodes: { orderBy: { isPrimary: 'desc' as const } },
          balances: { include: { location: true } },
        },
      },
      media: { orderBy: { position: 'asc' as const } },
    },
  },
  media: { orderBy: { position: 'asc' as const } },
  gift: {
    include: {
      giftVariant: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              media: {
                where: { purpose: MediaAssetPurpose.PRODUCT_MAIN },
                orderBy: { position: 'asc' as const },
                take: 1,
              },
            },
          },
        },
      },
    },
  },
  packagingRequirements: {
    include: {
      packagingMaterial: {
        include: {
          inventoryItem: { include: { balances: true } },
        },
      },
    },
  },
} as const;

type ProductWithRelations = Prisma.WarehouseProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

interface PreparedVariant {
  optionValues: string[];
  sku?: string;
  barcode?: string;
  barcodeType?: InventoryBarcodeType;
  price: number;
  costPrice: number;
  stockQuantity: number;
  lowStockAlertThreshold: number;
  imageUploadId?: string;
}

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
    private readonly barcodes: BarcodeService,
  ) {}

  async create(userId: string, dto: CreateWarehouseProductDto) {
    const store = await this.stores.requireStore(userId);
    const fingerprint = createFingerprint(dto);
    const existing = await this.prisma.warehouseProduct.findUnique({
      where: {
        storeId_idempotencyKey: {
          storeId: store.id,
          idempotencyKey: dto.idempotencyKey,
        },
      },
      include: PRODUCT_INCLUDE,
    });
    if (existing) {
      this.assertMatchingIdempotency(
        existing.idempotencyFingerprint,
        fingerprint,
      );
      return this.toResponse(existing);
    }

    await this.requireActiveCategory(store.id, dto.categoryId);
    const prepared = prepareProduct(dto);
    await this.prepareBarcodes(store.id, prepared.variants);
    validateUniqueRequestValues(prepared.variants);
    await this.validateReferences(store.id, dto, prepared.variants);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const location = await tx.warehouseLocation.upsert({
          where: { storeId_code: { storeId: store.id, code: 'MAIN' } },
          create: {
            storeId: store.id,
            name: 'Main Warehouse',
            code: 'MAIN',
            isDefault: true,
          },
          update: {},
        });
        const created = await tx.warehouseProduct.create({
          data: {
            storeId: store.id,
            categoryId: dto.categoryId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            status: dto.status ?? WarehouseProductStatus.ACTIVE,
            idempotencyKey: dto.idempotencyKey,
            idempotencyFingerprint: fingerprint,
          },
        });

        const optionValueIds: Array<Map<string, string>> = [];
        for (
          let optionIndex = 0;
          optionIndex < prepared.options.length;
          optionIndex += 1
        ) {
          const option = prepared.options[optionIndex];
          const saved = await tx.productOption.create({
            data: {
              productId: created.id,
              name: option.name,
              position: optionIndex,
              values: {
                create: option.values.map((value, position) => ({
                  value,
                  position,
                })),
              },
            },
            include: { values: true },
          });
          optionValueIds.push(
            new Map(
              saved.values.map((value) => [
                normalizeKey(value.value),
                value.id,
              ]),
            ),
          );
        }

        for (
          let position = 0;
          position < prepared.variants.length;
          position += 1
        ) {
          const input = prepared.variants[position];
          const title = input.optionValues.length
            ? input.optionValues.join(' / ')
            : 'Default';
          const variant = await tx.warehouseVariant.create({
            data: {
              productId: created.id,
              storeId: store.id,
              title,
              sku: input.sku?.trim() || null,
              price: input.price,
              costPrice: input.costPrice,
              lowStockThreshold: input.lowStockAlertThreshold,
              isDefault: input.optionValues.length === 0,
              position,
              optionValues: {
                create: input.optionValues.map((value, optionIndex) => {
                  const valueId = optionValueIds[optionIndex].get(
                    normalizeKey(value),
                  );
                  if (!valueId)
                    throw new BadRequestException(
                      'Invalid variant option value',
                    );
                  return { valueId };
                }),
              },
            },
          });
          const item = await tx.inventoryItem.create({
            data: {
              storeId: store.id,
              kind: InventoryItemKind.PRODUCT_VARIANT,
              variantId: variant.id,
              barcodes: {
                create: {
                  storeId: store.id,
                  value: input.barcode!,
                  type: input.barcodeType!,
                  isPrimary: true,
                  source:
                    input.barcodeType === InventoryBarcodeType.INTERNAL_CODE_128
                      ? 'ZOMAAL'
                      : 'MERCHANT',
                },
              },
              balances: {
                create: {
                  locationId: location.id,
                  onHand: input.stockQuantity,
                },
              },
              movements: {
                create: {
                  locationId: location.id,
                  type: 'OPENING_BALANCE',
                  bucket: 'ON_HAND',
                  quantityDelta: input.stockQuantity,
                  resultingQuantity: input.stockQuantity,
                  reason: 'Initial stock entered when the product was created',
                  idempotencyKey: `opening:${created.id}:${position}`,
                },
              },
            },
          });
          void item;
          if (input.imageUploadId) {
            await this.attachMedia(
              tx,
              store.id,
              input.imageUploadId,
              MediaAssetPurpose.VARIANT,
              { variantId: variant.id, position: 0 },
            );
          }
        }

        await this.attachMedia(
          tx,
          store.id,
          dto.mainImageUploadId,
          MediaAssetPurpose.PRODUCT_MAIN,
          { productId: created.id, position: 0 },
        );
        for (
          let position = 0;
          position < (dto.galleryImageUploadIds ?? []).length;
          position += 1
        ) {
          await this.attachMedia(
            tx,
            store.id,
            dto.galleryImageUploadIds![position],
            MediaAssetPurpose.PRODUCT_GALLERY,
            { productId: created.id, position: position + 1 },
          );
        }

        if (dto.gift) {
          await tx.productGift.create({
            data: {
              productId: created.id,
              giftVariantId: dto.gift.giftVariantId,
              quantity: dto.gift.quantity ?? 1,
            },
          });
        }
        if (dto.packaging?.length) {
          await tx.productPackagingRequirement.createMany({
            data: dto.packaging.map((item) => ({
              productId: created.id,
              packagingMaterialId: item.packagingMaterialId,
              quantityPerUnit: item.quantityPerUnit,
            })),
          });
        }
        return tx.warehouseProduct.findUniqueOrThrow({
          where: { id: created.id },
          include: PRODUCT_INCLUDE,
        });
      });
      return this.toResponse(product);
    } catch (error) {
      if (isUniqueError(error)) {
        const duplicate = await this.prisma.warehouseProduct.findUnique({
          where: {
            storeId_idempotencyKey: {
              storeId: store.id,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          include: PRODUCT_INCLUDE,
        });
        if (duplicate) {
          this.assertMatchingIdempotency(
            duplicate.idempotencyFingerprint,
            fingerprint,
          );
          return this.toResponse(duplicate);
        }
        throw new ConflictException(
          'A barcode, SKU, or idempotency key is already in use',
        );
      }
      throw error;
    }
  }

  private assertMatchingIdempotency(
    existingFingerprint: string | null,
    requestedFingerprint: string,
  ) {
    if (
      existingFingerprint !== null &&
      existingFingerprint !== requestedFingerprint
    ) {
      throw new ConflictException(
        'Idempotency key was already used with a different product request',
      );
    }
  }

  async list(userId: string, query: WarehouseProductQueryDto) {
    const store = await this.stores.requireStore(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.WarehouseProductWhereInput = {
      storeId: store.id,
      ...(query.status
        ? { status: query.status }
        : { status: { not: 'ARCHIVED' } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              {
                variants: {
                  some: {
                    sku: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              {
                variants: {
                  some: {
                    inventoryItem: {
                      barcodes: { some: { value: query.search } },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, products] = await Promise.all([
      this.prisma.warehouseProduct.count({ where }),
      this.prisma.warehouseProduct.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: products.map((product) => this.toResponse(product)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async get(userId: string, productId: string) {
    const store = await this.stores.requireStore(userId);
    return this.toResponse(await this.requireProduct(store.id, productId));
  }

  async update(
    userId: string,
    productId: string,
    dto: UpdateWarehouseProductDto,
  ) {
    const store = await this.stores.requireStore(userId);
    await this.requireProduct(store.id, productId);
    if (dto.categoryId)
      await this.requireActiveCategory(store.id, dto.categoryId);
    const result = await this.prisma.warehouseProduct.updateMany({
      where: { id: productId, storeId: store.id, version: dto.version },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.description === undefined
          ? {}
          : { description: dto.description.trim() || null }),
        ...(dto.categoryId === undefined ? {} : { categoryId: dto.categoryId }),
        ...(dto.status === undefined
          ? {}
          : {
              status: dto.status,
              archivedAt: dto.status === 'ARCHIVED' ? new Date() : null,
            }),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Product was changed by another request; reload and retry',
      );
    }
    return this.toResponse(await this.requireProduct(store.id, productId));
  }

  async archive(userId: string, productId: string) {
    const store = await this.stores.requireStore(userId);
    await this.requireProduct(store.id, productId);
    await this.prisma.warehouseProduct.update({
      where: { id: productId },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        version: { increment: 1 },
      },
    });
    return this.toResponse(await this.requireProduct(store.id, productId));
  }

  async activate(userId: string, productId: string) {
    const store = await this.stores.requireStore(userId);
    const product = await this.requireProduct(store.id, productId);
    if (product.categoryId)
      await this.requireActiveCategory(store.id, product.categoryId);
    await this.prisma.warehouseProduct.update({
      where: { id: productId },
      data: { status: 'ACTIVE', archivedAt: null, version: { increment: 1 } },
    });
    return this.toResponse(await this.requireProduct(store.id, productId));
  }

  private async prepareBarcodes(storeId: string, variants: PreparedVariant[]) {
    for (const variant of variants) {
      if (variant.barcode) {
        const normalized = this.barcodes.normalizeAndValidate(
          variant.barcode,
          variant.barcodeType,
        );
        variant.barcode = normalized.value;
        variant.barcodeType = normalized.type;
      } else {
        const generated = await this.barcodes.generateForStore(storeId);
        variant.barcode = generated.value;
        variant.barcodeType = generated.type;
      }
    }
  }

  private async validateReferences(
    storeId: string,
    dto: CreateWarehouseProductDto,
    variants: PreparedVariant[],
  ) {
    const mediaIds = [
      dto.mainImageUploadId,
      ...(dto.galleryImageUploadIds ?? []),
      ...variants.flatMap((variant) =>
        variant.imageUploadId ? [variant.imageUploadId] : [],
      ),
    ];
    if (new Set(mediaIds).size !== mediaIds.length) {
      throw new BadRequestException(
        'The same uploaded image cannot be attached twice',
      );
    }
    const mediaCount = await this.prisma.mediaAsset.count({
      where: {
        storeId,
        id: { in: mediaIds },
        status: MediaAssetStatus.TEMPORARY,
        expiresAt: { gt: new Date() },
      },
    });
    if (mediaCount !== mediaIds.length) {
      throw new BadRequestException(
        'One or more image uploads are invalid or expired',
      );
    }
    if (dto.gift) {
      const gift = await this.prisma.warehouseVariant.findFirst({
        where: {
          id: dto.gift.giftVariantId,
          product: { storeId, status: 'ACTIVE' },
        },
        select: { id: true },
      });
      if (!gift) throw new BadRequestException('Gift variant is unavailable');
    }
    if (dto.packaging?.length) {
      const ids = dto.packaging.map((item) => item.packagingMaterialId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException(
          'Packaging material was selected more than once',
        );
      }
      const count = await this.prisma.packagingMaterial.count({
        where: { id: { in: ids }, storeId, isActive: true },
      });
      if (count !== ids.length) {
        throw new BadRequestException(
          'One or more packaging materials are unavailable',
        );
      }
    }
  }

  private async attachMedia(
    tx: Prisma.TransactionClient,
    storeId: string,
    mediaId: string,
    purpose: MediaAssetPurpose,
    target: { productId?: string; variantId?: string; position: number },
  ) {
    const result = await tx.mediaAsset.updateMany({
      where: {
        id: mediaId,
        storeId,
        status: MediaAssetStatus.TEMPORARY,
        purpose,
        expiresAt: { gt: new Date() },
      },
      data: {
        status: MediaAssetStatus.ATTACHED,
        expiresAt: null,
        productId: target.productId,
        variantId: target.variantId,
        position: target.position,
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        `Image ${mediaId} cannot be attached as ${purpose}`,
      );
    }
  }

  private async requireActiveCategory(storeId: string, categoryId: string) {
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, storeId, isActive: true },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException('Product category is unavailable');
  }

  private async requireProduct(storeId: string, productId: string) {
    const product = await this.prisma.warehouseProduct.findFirst({
      where: { id: productId, storeId },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Warehouse product not found');
    return product;
  }

  private toResponse(product: ProductWithRelations) {
    const variants = product.variants.map((variant) => {
      const balances = variant.inventoryItem?.balances ?? [];
      const onHand = balances.reduce((sum, balance) => sum + balance.onHand, 0);
      const reserved = balances.reduce(
        (sum, balance) => sum + balance.reserved,
        0,
      );
      const damaged = balances.reduce(
        (sum, balance) => sum + balance.damaged,
        0,
      );
      return {
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: Number(variant.price),
        costPrice: Number(variant.costPrice),
        lowStockAlertThreshold: variant.lowStockThreshold,
        isDefault: variant.isDefault,
        options: variant.optionValues
          .sort((a, b) => a.value.option.position - b.value.option.position)
          .map((entry) => ({
            name: entry.value.option.name,
            value: entry.value.value,
          })),
        inventoryItemId: variant.inventoryItem?.id ?? null,
        barcode: (() => {
          const barcode = variant.inventoryItem?.barcodes.find(
            (entry) => entry.isPrimary,
          );
          return barcode
            ? {
                id: barcode.id,
                value: barcode.value,
                type: barcode.type,
                isPrimary: barcode.isPrimary,
                source: barcode.source,
              }
            : null;
        })(),
        inventory: {
          onHand,
          reserved,
          damaged,
          available: onHand - reserved - damaged,
          locations: balances.map((balance) => ({
            id: balance.location.id,
            name: balance.location.name,
            onHand: balance.onHand,
            reserved: balance.reserved,
            damaged: balance.damaged,
            incoming: balance.incoming,
            available: balance.onHand - balance.reserved - balance.damaged,
          })),
        },
        images: variant.media.map(mediaResponse),
      };
    });
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      status: product.status,
      version: product.version,
      category: product.category,
      options: product.options.map((option) => ({
        id: option.id,
        name: option.name,
        position: option.position,
        values: option.values.map((value) => ({
          id: value.id,
          value: value.value,
          position: value.position,
        })),
      })),
      images: product.media.map(mediaResponse),
      variants,
      inventory: {
        onHand: variants.reduce(
          (sum, variant) => sum + variant.inventory.onHand,
          0,
        ),
        available: variants.reduce(
          (sum, variant) => sum + variant.inventory.available,
          0,
        ),
      },
      gift: product.gift
        ? {
            variantId: product.gift.giftVariantId,
            quantity: product.gift.quantity,
            productId: product.gift.giftVariant.product.id,
            productName: product.gift.giftVariant.product.name,
            variantTitle: product.gift.giftVariant.title,
            price: Number(product.gift.giftVariant.price),
            image: product.gift.giftVariant.product.media[0]
              ? mediaResponse(product.gift.giftVariant.product.media[0])
              : null,
          }
        : null,
      packaging: product.packagingRequirements.map((requirement) => ({
        id: requirement.id,
        packagingMaterialId: requirement.packagingMaterialId,
        name: requirement.packagingMaterial.name,
        quantityPerUnit: requirement.quantityPerUnit,
        ownedQuantity:
          requirement.packagingMaterial.inventoryItem?.balances.reduce(
            (sum, balance) =>
              sum + balance.onHand - balance.reserved - balance.damaged,
            0,
          ) ?? 0,
        imageUrl: requirement.packagingMaterial.imageObjectName
          ? `/warehouse/packaging/${requirement.packagingMaterial.id}/image`
          : null,
      })),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      archivedAt: product.archivedAt?.toISOString() ?? null,
    };
  }
}

export function prepareProduct(dto: CreateWarehouseProductDto) {
  const options = normalizeOptions(dto.options ?? []);
  if (options.length === 0) {
    if (dto.variants?.length) {
      throw new BadRequestException(
        'Variants require at least one product option',
      );
    }
    return {
      options,
      variants: [
        {
          optionValues: [],
          sku: dto.sku,
          barcode: dto.barcode,
          barcodeType: dto.barcodeType,
          price: dto.basePrice,
          costPrice: dto.costPrice,
          stockQuantity: dto.stockQuantity,
          lowStockAlertThreshold: dto.lowStockAlertThreshold ?? 5,
        },
      ] satisfies PreparedVariant[],
    };
  }
  const combinations = cartesian(options.map((option) => option.values));
  if (combinations.length > 100) {
    throw new BadRequestException(
      'Product options generate more than 100 variants',
    );
  }
  if (dto.variants?.length !== combinations.length) {
    throw new BadRequestException(
      `Exactly ${combinations.length} variant configurations are required`,
    );
  }
  const supplied = new Map<string, ProductVariantInputDto>();
  for (const variant of dto.variants) {
    if (variant.optionValues.length !== options.length) {
      throw new BadRequestException(
        'Variant option value count does not match product options',
      );
    }
    const canonical = variant.optionValues.map((value, index) => {
      const found = options[index].values.find(
        (candidate) => normalizeKey(candidate) === normalizeKey(value),
      );
      if (!found) {
        throw new BadRequestException(
          `${value} is not valid for option ${options[index].name}`,
        );
      }
      return found;
    });
    const key = combinationKey(canonical);
    if (supplied.has(key))
      throw new BadRequestException('Duplicate variant combination');
    supplied.set(key, { ...variant, optionValues: canonical });
  }
  return {
    options,
    variants: combinations.map((combination) => {
      const variant = supplied.get(combinationKey(combination));
      if (!variant) {
        throw new BadRequestException(
          `Missing variant ${combination.join(' / ')}`,
        );
      }
      return {
        ...variant,
        costPrice: variant.costPrice ?? dto.costPrice,
        lowStockAlertThreshold:
          variant.lowStockAlertThreshold ?? dto.lowStockAlertThreshold ?? 5,
      };
    }),
  };
}

function normalizeOptions(options: ProductOptionInputDto[]) {
  const names = new Set<string>();
  return options.map((option) => {
    const name = option.name.trim();
    const nameKey = normalizeKey(name);
    if (names.has(nameKey))
      throw new BadRequestException('Option names must be unique');
    names.add(nameKey);
    const values = option.values.map((value) => value.trim());
    if (new Set(values.map(normalizeKey)).size !== values.length) {
      throw new BadRequestException(`Option ${name} contains duplicate values`);
    }
    return { name, values };
  });
}

function cartesian(groups: string[][]): string[][] {
  return groups.reduce<string[][]>(
    (combinations, group) =>
      combinations.flatMap((combination) =>
        group.map((value) => [...combination, value]),
      ),
    [[]],
  );
}

function normalizeKey(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

function combinationKey(values: string[]) {
  return values.map(normalizeKey).join('\u001f');
}

function validateUniqueRequestValues(variants: PreparedVariant[]) {
  const barcodes = variants.map((variant) => variant.barcode!);
  if (new Set(barcodes).size !== barcodes.length) {
    throw new BadRequestException('Variant barcodes must be unique');
  }
  const skus = variants
    .map((variant) => variant.sku?.trim().toLocaleLowerCase('en-US'))
    .filter((value): value is string => Boolean(value));
  if (new Set(skus).size !== skus.length) {
    throw new BadRequestException(
      'Variant SKUs must be unique within a product',
    );
  }
}

function mediaResponse(media: {
  id: string;
  purpose: MediaAssetPurpose;
  position: number;
  contentType: string;
}) {
  return {
    id: media.id,
    purpose: media.purpose,
    position: media.position,
    contentType: media.contentType,
    url: `/warehouse/media/${media.id}/content`,
  };
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export function createFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortForFingerprint(value)))
    .digest('hex');
}

function sortForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForFingerprint);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortForFingerprint(entry)]),
    );
  }
  return value;
}
