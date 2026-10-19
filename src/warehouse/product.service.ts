import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
  InventoryBarcodeType,
  InventoryItemKind,
  MediaAssetPurpose,
  MediaAssetStatus,
  OrderLineStockStatus,
  Prisma,
  ShippingShipmentStatus,
  WarehouseProductKind,
  WarehouseProductStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { OrderEventType } from '../ecommerce/constants/order-event-type';
import { LightfunnelsDataService } from '../lightfunnels/lightfunnels-data.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyDataService } from '../shopify/shopify-data.service';
import { YouCanDataService } from '../youcan/youcan-data.service';
import { BarcodeService } from './barcode.service';
import {
  ImportPlatformProductsDto,
  ProductImportResultDto,
  ProductImportResultStatus,
} from './dto/product-import.dto';
import { MediaService } from './media.service';
import { downloadPlatformImage } from './platform-image.util';
import {
  fromLightfunnelsProduct,
  fromShopifyProduct,
  fromYouCanProduct,
  ImportMappingError,
  MAX_IMPORT_VARIANTS,
  type ImportedProduct,
  type ImportedVariant,
} from './platform-product-import.util';
import {
  CompareCatalogQueryDto,
  CompareProductPlatform,
  CreateWarehouseProductDto,
  CreateProductBundleDto,
  CompareProductsQueryDto,
  ProductPerformancePeriod,
  ProductPerformanceQueryDto,
  ProductOptionInputDto,
  ProductStockStatus,
  ProductVariantInputDto,
  UpdateWarehouseProductDto,
  WarehouseProductQueryDto,
} from './dto/product.dto';
import { WarehouseStoreService } from './warehouse-store.service';
import { computeComparisonInsight } from './product-comparison.util';
import { resolvePackagingUnitCosts } from './packaging-cost.util';
import {
  ORDER_LINE_STOCK_INCLUDE,
  orderLineCosts,
  packagingMaterialIds,
} from '../ecommerce/order-stock.util';

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
  bundleComponents: {
    orderBy: { position: 'asc' as const },
    include: {
      componentVariant: {
        include: {
          product: { select: { id: true, name: true, status: true } },
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
  productCode?: string;
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
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
    private readonly barcodes: BarcodeService,
    private readonly shopifyData: ShopifyDataService,
    private readonly youCanData: YouCanDataService,
    private readonly lightfunnelsData: LightfunnelsDataService,
    private readonly media: MediaService,
  ) {}

  /**
   * One-time operation: assigns a Product Tracking Code to every existing
   * variant created before this feature shipped (productCode is nullable in
   * the DB for exactly this reason). Idempotent — safe to call multiple
   * times; only ever touches variants that are still missing a code.
   */
  async backfillProductCodes(): Promise<{
    processed: number;
    skipped: number;
  }> {
    const variants = await this.prisma.warehouseVariant.findMany({
      where: { productCode: null },
      select: { id: true, storeId: true },
    });

    let processed = 0;
    let skipped = 0;
    for (const variant of variants) {
      try {
        const code = await this.barcodes.generateProductCodeForStore(
          variant.storeId,
        );
        await this.prisma.warehouseVariant.update({
          where: { id: variant.id },
          data: { productCode: code },
        });
        processed++;
      } catch (err) {
        this.logger.warn(
          `Product code backfill failed for variant ${variant.id}: ${String(err)}`,
        );
        skipped++;
      }
    }
    this.logger.log(
      `Product code backfill complete: ${processed} processed, ${skipped} skipped`,
    );
    return { processed, skipped };
  }

  async create(userId: string, dto: CreateWarehouseProductDto) {
    requireProductName(dto.name);
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
    await this.prepareProductCodes(store.id, prepared.variants);
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
            supplierNames: dto.supplierNames ?? [],
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
              productCode: input.productCode!,
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
      await this.linkOrderLinesForProduct(store.id, product.id);
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
          'A barcode, SKU, product code, or idempotency key is already in use',
        );
      }
      throw error;
    }
  }

  async createBundle(userId: string, dto: CreateProductBundleDto) {
    requireProductName(dto.name);
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
    const componentIds = dto.components.map((component) => component.variantId);
    if (new Set(componentIds).size !== componentIds.length) {
      throw new BadRequestException(
        'A variant can appear only once in a product bundle',
      );
    }
    const components = await this.prisma.warehouseVariant.findMany({
      where: {
        id: { in: componentIds },
        storeId: store.id,
        product: {
          status: WarehouseProductStatus.ACTIVE,
          kind: WarehouseProductKind.STANDARD,
        },
      },
      select: { id: true, costPrice: true },
    });
    if (components.length !== componentIds.length) {
      throw new BadRequestException(
        'Every bundle component must be an active standard product variant from this store',
      );
    }
    const upload = await this.prisma.mediaAsset.findFirst({
      where: {
        id: dto.mainImageUploadId,
        storeId: store.id,
        status: MediaAssetStatus.TEMPORARY,
        purpose: MediaAssetPurpose.PRODUCT_MAIN,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!upload) {
      throw new BadRequestException(
        'The bundle image upload is invalid or expired',
      );
    }

    const byId = new Map(
      components.map((component) => [component.id, component]),
    );
    const costPrice = dto.components.reduce(
      (total, component) =>
        total.plus(
          byId.get(component.variantId)!.costPrice.times(component.quantity),
        ),
      new Prisma.Decimal(0),
    );

    // Pack code: a bundle is stored as a WarehouseProduct with its own single
    // variant, so that variant's productCode doubles as the pack code
    // (e.g. "PK82LQ7") — no separate field needed.
    const packCode = await this.barcodes.generateProductCodeForStore(store.id);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.warehouseProduct.create({
          data: {
            storeId: store.id,
            categoryId: dto.categoryId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            status: dto.status ?? WarehouseProductStatus.ACTIVE,
            kind: WarehouseProductKind.BUNDLE,
            idempotencyKey: dto.idempotencyKey,
            idempotencyFingerprint: fingerprint,
          },
        });
        await tx.warehouseVariant.create({
          data: {
            productId: created.id,
            storeId: store.id,
            title: 'Bundle',
            sku: dto.sku?.trim() || null,
            productCode: packCode,
            price: dto.price,
            costPrice,
            lowStockThreshold: dto.lowStockAlertThreshold ?? 5,
            isDefault: true,
          },
        });
        await tx.productBundleComponent.createMany({
          data: dto.components.map((component, position) => ({
            bundleProductId: created.id,
            componentVariantId: component.variantId,
            quantity: component.quantity,
            position,
          })),
        });
        await this.attachMedia(
          tx,
          store.id,
          dto.mainImageUploadId,
          MediaAssetPurpose.PRODUCT_MAIN,
          { productId: created.id, position: 0 },
        );
        return tx.warehouseProduct.findUniqueOrThrow({
          where: { id: created.id },
          include: PRODUCT_INCLUDE,
        });
      });
      await this.linkOrderLinesForProduct(store.id, product.id);
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
          'A bundle SKU, product code, or idempotency key is already in use',
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
    // Stock availability is an aggregate over variant inventory balances, so it
    // cannot be expressed in a Prisma where clause. Resolve the matching product
    // IDs first and constrain the paginated query with them.
    const stockProductIds = query.stockStatus
      ? await this.stockMatchingProductIds(store.id, query.stockStatus)
      : null;
    const where: Prisma.WarehouseProductWhereInput = {
      storeId: store.id,
      ...(query.status
        ? { status: query.status }
        : { status: { not: 'ARCHIVED' } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(stockProductIds ? { id: { in: stockProductIds } } : {}),
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

  /**
   * Product IDs whose aggregated available stock (sum of onHand - reserved -
   * damaged across all variant inventory balances) matches the given status.
   * The low-stock threshold is the sum of the variants' lowStockAlertThreshold,
   * mirroring how available units are summed. Products without any inventory
   * have 0 available and therefore only match OUT_OF_STOCK.
   */
  private async stockMatchingProductIds(
    storeId: string,
    stockStatus: ProductStockStatus,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH variant_stock AS (
        SELECT
          v."id",
          COALESCE(SUM(b."onHand" - b."reserved" - b."damaged"), 0)::int AS available
        FROM "WarehouseVariant" v
        LEFT JOIN "InventoryItem" ii ON ii."variantId" = v."id"
        LEFT JOIN "InventoryBalance" b ON b."inventoryItemId" = ii."id"
        WHERE v."storeId" = ${storeId}
        GROUP BY v."id"
      ), standard_stock AS (
        SELECT
          p."id",
          p."kind",
          COALESCE(SUM(vs.available), 0)::int AS available,
          COALESCE(SUM(v."lowStockThreshold"), 0)::int AS threshold
        FROM "WarehouseProduct" p
        LEFT JOIN "WarehouseVariant" v ON v."productId" = p."id"
        LEFT JOIN variant_stock vs ON vs."id" = v."id"
        WHERE p."storeId" = ${storeId}
        GROUP BY p."id", p."kind"
      ), bundle_stock AS (
        SELECT
          c."bundleProductId" AS id,
          COALESCE(MIN(FLOOR(vs.available::numeric / c.quantity)), 0)::int AS available
        FROM "ProductBundleComponent" c
        LEFT JOIN variant_stock vs ON vs."id" = c."componentVariantId"
        GROUP BY c."bundleProductId"
      ), product_stock AS (
        SELECT
          s."id",
          CASE WHEN s."kind" = 'BUNDLE'
            THEN COALESCE(bs.available, 0)
            ELSE s.available
          END AS available,
          s.threshold
        FROM standard_stock s
        LEFT JOIN bundle_stock bs ON bs.id = s."id"
      )
      SELECT "id" FROM product_stock
      WHERE CASE ${stockStatus}
        WHEN 'OUT_OF_STOCK' THEN
          available = 0
        WHEN 'LOW_STOCK' THEN
          available > 0 AND available <= threshold
        ELSE
          available > threshold
      END
    `);
    return rows.map((row) => row.id);
  }

  async get(userId: string, productId: string) {
    const store = await this.stores.requireStore(userId);
    return this.toResponse(await this.requireProduct(store.id, productId));
  }

  async performance(
    userId: string,
    productId: string,
    query: ProductPerformanceQueryDto,
  ) {
    const store = await this.stores.requireStore(userId);
    await this.requireProduct(store.id, productId);
    const range = performanceRange(query);
    const lines = await this.prisma.ecommerceOrderLine.findMany({
      where: {
        warehouseVariant: { productId, storeId: store.id },
        order: {
          connection: { storeId: store.id },
          processedAt: { gte: range.from, lt: range.toExclusive },
        },
      },
      include: {
        warehouseVariant: {
          select: ORDER_LINE_STOCK_INCLUDE.warehouseVariant.select,
        },
        order: {
          select: {
            id: true,
            status: true,
            financialStatus: true,
            fulfillmentStatus: true,
            shippingCity: true,
            processedAt: true,
            providerUpdatedAt: true,
            dispatch: {
              select: {
                senditShipment: { select: { normalizedStatus: true } },
                quickLivraisonShipment: {
                  select: { normalizedStatus: true },
                },
                forceLogShipment: { select: { normalizedStatus: true } },
                ozoneExpressShipment: { select: { normalizedStatus: true } },
              },
            },
          },
        },
      },
      orderBy: { order: { processedAt: 'asc' } },
    });

    const days = dateKeys(range.from, range.toExclusive);
    const points = new Map(
      days.map((date) => [
        date,
        {
          date,
          orderIds: new Set<string>(),
          units: 0,
          revenue: new Prisma.Decimal(0),
          profit: new Prisma.Decimal(0),
        },
      ]),
    );
    const orders = new Map<
      string,
      {
        delivered: boolean;
        cancelled: boolean;
        returned: boolean;
        city: string | null;
        realized: boolean;
        updatedAt: Date;
      }
    >();
    const cities = new Map<
      string,
      { orderIds: Set<string>; revenue: Prisma.Decimal }
    >();
    let units = 0;
    let revenue = new Prisma.Decimal(0);
    let cost = new Prisma.Decimal(0);
    let giftCost = new Prisma.Decimal(0);
    let packagingCost = new Prisma.Decimal(0);
    let dataUpdatedAt: Date | null = null;
    const packagingUnitCosts = await resolvePackagingUnitCosts(
      this.prisma,
      packagingMaterialIds(lines),
    );

    for (const line of lines) {
      const state = productOrderState(line.order);
      orders.set(line.order.id, {
        ...state,
        city: line.order.shippingCity,
        updatedAt: line.order.providerUpdatedAt,
      });
      if (
        !dataUpdatedAt ||
        line.order.providerUpdatedAt.getTime() > dataUpdatedAt.getTime()
      ) {
        dataUpdatedAt = line.order.providerUpdatedAt;
      }
      units += line.quantity;
      const lineRevenue = state.realized
        ? line.totalPrice
        : new Prisma.Decimal(0);
      const zero = new Prisma.Decimal(0);
      const lineCosts = state.realized
        ? orderLineCosts(line, packagingUnitCosts)
        : { productCost: zero, giftCost: zero, packagingCost: zero };
      const lineCost = lineCosts.productCost;
      const lineExtraCost = lineCosts.giftCost.plus(lineCosts.packagingCost);
      revenue = revenue.plus(lineRevenue);
      cost = cost.plus(lineCost);
      giftCost = giftCost.plus(lineCosts.giftCost);
      packagingCost = packagingCost.plus(lineCosts.packagingCost);

      const point = points.get(utcDateKey(line.order.processedAt));
      if (point) {
        point.orderIds.add(line.order.id);
        point.units += line.quantity;
        point.revenue = point.revenue.plus(lineRevenue);
        point.profit = point.profit.plus(
          lineRevenue.minus(lineCost).minus(lineExtraCost),
        );
      }
      const city = line.order.shippingCity?.trim();
      if (city && state.realized) {
        const key = city.toLocaleLowerCase('en-US');
        const current = cities.get(key) ?? {
          orderIds: new Set<string>(),
          revenue: new Prisma.Decimal(0),
        };
        current.orderIds.add(line.order.id);
        current.revenue = current.revenue.plus(lineRevenue);
        cities.set(key, current);
      }
    }

    const orderStates = [...orders.values()];
    const grossProfit = revenue.minus(cost);
    const netProfit = grossProfit.minus(giftCost).minus(packagingCost);
    const totalCost = cost.plus(giftCost).plus(packagingCost);
    const totalOrders = orders.size;
    return {
      productId,
      currency: store.baseCurrency,
      period: {
        period: range.period,
        from: range.from.toISOString(),
        to: new Date(range.toExclusive.getTime() - 1).toISOString(),
      },
      metrics: {
        totalOrders,
        deliveredOrders: orderStates.filter((order) => order.delivered).length,
        cancelledOrders: orderStates.filter((order) => order.cancelled).length,
        returnedOrders: orderStates.filter((order) => order.returned).length,
        totalUnits: units,
        totalRevenue: revenue.toFixed(4),
        totalCost: cost.toFixed(4),
        giftCost: giftCost.toFixed(4),
        packagingCost: packagingCost.toFixed(4),
        grossProfit: grossProfit.toFixed(4),
        netProfit: netProfit.toFixed(4),
        roi: totalCost.isZero()
          ? null
          : round2(netProfit.div(totalCost).times(100).toNumber()),
        deliveryRate: percentage(
          orderStates.filter((order) => order.delivered).length,
          totalOrders,
        ),
        cancellationRate: percentage(
          orderStates.filter((order) => order.cancelled).length,
          totalOrders,
        ),
        returnRate: percentage(
          orderStates.filter((order) => order.returned).length,
          totalOrders,
        ),
      },
      performance: [...points.values()].map((point) => ({
        date: point.date,
        orders: point.orderIds.size,
        units: point.units,
        revenue: point.revenue.toFixed(4),
        profit: point.profit.toFixed(4),
      })),
      topCities: [...cities.entries()]
        .map(([key, value]) => ({
          city:
            orderStates.find(
              (order) => order.city?.toLocaleLowerCase('en-US') === key,
            )?.city ?? key,
          orders: value.orderIds.size,
          revenue: value.revenue.toFixed(4),
        }))
        .sort(
          (left, right) =>
            Number(right.revenue) - Number(left.revenue) ||
            left.city.localeCompare(right.city),
        )
        .slice(0, 5),
      dataUpdatedAt: dataUpdatedAt?.toISOString() ?? null,
    };
  }

  /**
   * Platforms available for the Compare Products dropdown. Warehouse is always
   * listed; e-com platforms are available only with an ACTIVE connection.
   */
  async listComparePlatforms(userId: string) {
    const store = await this.stores.requireStore(userId);
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: { storeId: store.id, status: EcommerceConnectionStatus.ACTIVE },
      select: { platform: true },
    });
    const active = new Set(connections.map((row) => row.platform));

    const options: Array<{
      id: CompareProductPlatform;
      label: string;
      available: boolean;
    }> = [
      {
        id: CompareProductPlatform.WAREHOUSE,
        label: 'Warehouse',
        available: true,
      },
      {
        id: CompareProductPlatform.SHOPIFY,
        label: 'Shopify',
        available: active.has(EcommercePlatform.SHOPIFY),
      },
      {
        id: CompareProductPlatform.YOUCAN,
        label: 'YouCan',
        available: active.has(EcommercePlatform.YOUCAN),
      },
      {
        id: CompareProductPlatform.LIGHTFUNNELS,
        label: 'Lightfunnels',
        available: active.has(EcommercePlatform.LIGHTFUNNELS),
      },
    ];

    return { platforms: options };
  }

  /**
   * Select Product sheet for Compare — platform-scoped search with a
   * normalized row shape (id, name, image, stock label).
   */
  async searchCompareProducts(userId: string, query: CompareCatalogQueryDto) {
    const store = await this.stores.requireStore(userId);
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;

    if (query.platform !== CompareProductPlatform.WAREHOUSE) {
      await this.requireActiveEcommercePlatform(store.id, query.platform);
    }

    switch (query.platform) {
      case CompareProductPlatform.WAREHOUSE:
        return this.searchWarehouseCompareCatalog(
          userId,
          query.search,
          page,
          limit,
        );
      case CompareProductPlatform.SHOPIFY:
        return this.searchShopifyCompareCatalog(
          userId,
          query.search,
          limit,
          query.after,
        );
      case CompareProductPlatform.YOUCAN:
        return this.searchYouCanCompareCatalog(
          userId,
          query.search,
          page,
          limit,
        );
      case CompareProductPlatform.LIGHTFUNNELS:
        return this.searchLightfunnelsCompareCatalog(
          userId,
          query.search,
          limit,
          query.after,
        );
      default:
        throw new BadRequestException('Unsupported compare platform');
    }
  }

  /**
   * Compare Products screen. Deliberately not built on top of performance()
   * — that method's daily-series/top-cities aggregation isn't needed here,
   * so this runs its own (smaller) version of the same order-line loop,
   * while still reusing the two pieces of business logic that actually
   * matter and must never drift from performance()'s own answer:
   * performanceRange() for period/custom-range parsing, and
   * productOrderState() for what counts as delivered/cancelled/returned.
   *
   * Each side may come from a different catalog (Warehouse / Shopify /
   * YouCan / Lightfunnels). Profit and CPO are null when that side has no
   * warehouse cost to attribute.
   */
  async compare(userId: string, query: CompareProductsQueryDto) {
    const platformA = query.platformA ?? CompareProductPlatform.WAREHOUSE;
    const platformB = query.platformB ?? CompareProductPlatform.WAREHOUSE;

    if (
      platformA === platformB &&
      normalizeCompareProductKey(platformA, query.productAId) ===
        normalizeCompareProductKey(platformB, query.productBId)
    ) {
      throw new BadRequestException('Select two different products to compare');
    }

    const store = await this.stores.requireStore(userId);
    const range = performanceRange(query);

    if (platformA !== CompareProductPlatform.WAREHOUSE) {
      await this.requireActiveEcommercePlatform(store.id, platformA);
    }
    if (platformB !== CompareProductPlatform.WAREHOUSE) {
      await this.requireActiveEcommercePlatform(store.id, platformB);
    }

    const [sideA, sideB] = await Promise.all([
      this.computeComparisonSide(
        userId,
        store.id,
        platformA,
        query.productAId,
        range,
      ),
      this.computeComparisonSide(
        userId,
        store.id,
        platformB,
        query.productBId,
        range,
      ),
    ]);

    const insight = computeComparisonInsight(
      sideA.insightMetrics,
      sideB.insightMetrics,
      sideA.name,
      sideB.name,
    );

    const dataUpdatedAt = [sideA.dataUpdatedAt, sideB.dataUpdatedAt]
      .filter((value): value is Date => value !== null)
      .sort((left, right) => right.getTime() - left.getTime())[0];

    return {
      period: {
        period: range.period,
        from: range.from.toISOString(),
        to: new Date(range.toExclusive.getTime() - 1).toISOString(),
      },
      currency: store.baseCurrency,
      productA: {
        platform: sideA.platform,
        productId: sideA.productId,
        name: sideA.name,
        imageUrl: sideA.imageUrl,
        metrics: sideA.metrics,
      },
      productB: {
        platform: sideB.platform,
        productId: sideB.productId,
        name: sideB.name,
        imageUrl: sideB.imageUrl,
        metrics: sideB.metrics,
      },
      insight,
      dataUpdatedAt: dataUpdatedAt?.toISOString() ?? null,
    };
  }

  private async searchWarehouseCompareCatalog(
    userId: string,
    search: string | undefined,
    page: number,
    limit: number,
  ) {
    const listed = await this.list(userId, {
      search,
      status: WarehouseProductStatus.ACTIVE,
      page,
      limit,
    });
    return {
      data: listed.data.map((product) => {
        const imageUrl =
          product.images.find((item) => item.purpose === 'PRODUCT_MAIN')?.url ??
          product.images[0]?.url ??
          null;
        return {
          id: product.id,
          platform: CompareProductPlatform.WAREHOUSE,
          name: product.name,
          imageUrl,
          stockLabel: `${product.inventory.available} In Stock`,
        };
      }),
      pagination: {
        page: listed.pagination.page,
        limit: listed.pagination.limit,
        total: listed.pagination.total,
        totalPages: listed.pagination.totalPages,
        nextCursor: null,
        hasNextPage: listed.pagination.page < listed.pagination.totalPages,
      },
    };
  }

  private async searchShopifyCompareCatalog(
    userId: string,
    search: string | undefined,
    limit: number,
    after?: string,
  ) {
    const result = await this.shopifyData.listProducts(userId, {
      first: limit,
      after,
      query: search?.trim() || undefined,
    });
    return {
      data: result.data.map((product) => {
        const numericId = shopifyNumericId(product.id) ?? product.id;
        const inventory = product.totalInventory ?? 0;
        return {
          id: numericId,
          platform: CompareProductPlatform.SHOPIFY,
          name: product.title,
          imageUrl: product.featuredImage?.url ?? null,
          stockLabel: `${inventory} In Stock`,
        };
      }),
      pagination: {
        page: null,
        limit,
        total: null,
        totalPages: null,
        nextCursor: result.pageInfo.hasNextPage
          ? (result.pageInfo.endCursor ?? null)
          : null,
        hasNextPage: result.pageInfo.hasNextPage,
      },
    };
  }

  private async searchYouCanCompareCatalog(
    userId: string,
    search: string | undefined,
    page: number,
    limit: number,
  ) {
    const result = await this.youCanData.listProducts(userId, {
      page,
      limit,
      q: search?.trim() || undefined,
    });
    const pagination = result.meta?.pagination;
    const total = pagination?.total ?? result.data.length;
    const totalPages =
      pagination?.last_page ?? Math.max(1, Math.ceil(total / limit));
    return {
      data: result.data.map((product) => {
        const inventory =
          typeof product.inventory === 'number' ? product.inventory : null;
        return {
          id: String(product.id),
          platform: CompareProductPlatform.YOUCAN,
          name: product.name?.trim() || `Product ${product.id}`,
          imageUrl: product.thumbnail?.trim() || null,
          stockLabel: inventory === null ? null : `${inventory} In Stock`,
        };
      }),
      pagination: {
        page: pagination?.current_page ?? page,
        limit: pagination?.per_page ?? limit,
        total,
        totalPages,
        nextCursor: null,
        hasNextPage: (pagination?.current_page ?? page) < totalPages,
      },
    };
  }

  private async searchLightfunnelsCompareCatalog(
    userId: string,
    search: string | undefined,
    limit: number,
    after?: string,
  ) {
    const result = await this.lightfunnelsData.listProducts(userId, {
      first: limit,
      after,
      query: search?.trim() || undefined,
    });
    const connection = result.data;
    return {
      data: (connection.edges ?? []).map((edge) => ({
        id: String(edge.node.id),
        platform: CompareProductPlatform.LIGHTFUNNELS,
        name: edge.node.title?.trim() || `Product ${edge.node.id}`,
        imageUrl: null,
        stockLabel: null,
      })),
      pagination: {
        page: null,
        limit,
        total: null,
        totalPages: null,
        nextCursor: connection.pageInfo.hasNextPage
          ? (connection.pageInfo.endCursor ?? null)
          : null,
        hasNextPage: connection.pageInfo.hasNextPage,
      },
    };
  }

  private async requireActiveEcommercePlatform(
    storeId: string,
    platform: CompareProductPlatform,
  ) {
    const ecommercePlatform = toEcommercePlatform(platform);
    if (!ecommercePlatform) {
      throw new BadRequestException('Unsupported compare platform');
    }
    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: {
        storeId,
        platform: ecommercePlatform,
        status: EcommerceConnectionStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!connection) {
      throw new BadRequestException(
        `${platform} is not connected. Connect it before comparing products from that catalog.`,
      );
    }
  }

  private async computeComparisonSide(
    userId: string,
    storeId: string,
    platform: CompareProductPlatform,
    productId: string,
    range: { from: Date; toExclusive: Date },
  ) {
    if (platform === CompareProductPlatform.WAREHOUSE) {
      return this.computeWarehouseComparisonSide(storeId, productId, range);
    }
    return this.computeEcommerceComparisonSide(
      userId,
      storeId,
      platform,
      productId,
      range,
    );
  }

  private async computeWarehouseComparisonSide(
    storeId: string,
    productId: string,
    range: { from: Date; toExclusive: Date },
  ) {
    const product = await this.prisma.warehouseProduct.findFirst({
      where: { id: productId, storeId },
      select: {
        id: true,
        name: true,
        media: { orderBy: { position: 'asc' }, take: 1, select: { id: true } },
      },
    });
    if (!product) {
      throw new NotFoundException(`Warehouse product ${productId} not found`);
    }

    const lines = await this.prisma.ecommerceOrderLine.findMany({
      where: {
        warehouseVariant: { productId, storeId },
        order: {
          connection: { storeId },
          processedAt: { gte: range.from, lt: range.toExclusive },
        },
      },
      include: comparisonLineInclude,
    });

    return finalizeComparisonSide({
      platform: CompareProductPlatform.WAREHOUSE,
      productId,
      name: product.name,
      imageUrl: product.media[0]
        ? `/warehouse/media/${product.media[0].id}/content`
        : null,
      lines,
      platformUnitCost: null,
      packagingUnitCosts: await resolvePackagingUnitCosts(
        this.prisma,
        packagingMaterialIds(lines),
      ),
    });
  }

  private async computeEcommerceComparisonSide(
    userId: string,
    storeId: string,
    platform: CompareProductPlatform,
    productId: string,
    range: { from: Date; toExclusive: Date },
  ) {
    const ecommercePlatform = toEcommercePlatform(platform)!;
    const productIds = expandExternalProductIds(platform, productId);

    const meta = await this.resolveEcommerceProductMeta(
      userId,
      platform,
      productId,
    );

    const lines = await this.prisma.ecommerceOrderLine.findMany({
      where: {
        externalProductId: { in: productIds },
        order: {
          connection: { storeId, platform: ecommercePlatform },
          processedAt: { gte: range.from, lt: range.toExclusive },
        },
      },
      include: comparisonLineInclude,
    });

    return finalizeComparisonSide({
      platform,
      productId: shopifyNumericId(productId) ?? productId,
      name: meta.name,
      imageUrl: meta.imageUrl,
      lines,
      platformUnitCost: meta.costPrice,
      packagingUnitCosts: await resolvePackagingUnitCosts(
        this.prisma,
        packagingMaterialIds(lines),
      ),
    });
  }

  private async resolveEcommerceProductMeta(
    userId: string,
    platform: CompareProductPlatform,
    productId: string,
  ): Promise<{
    name: string;
    imageUrl: string | null;
    costPrice: Prisma.Decimal | null;
  }> {
    try {
      if (platform === CompareProductPlatform.SHOPIFY) {
        const numeric = shopifyNumericId(productId) ?? productId;
        const product = await this.shopifyData.getProductDetails(
          userId,
          numeric,
          {} as Parameters<ShopifyDataService['getProductDetails']>[2],
        );
        return {
          name: product.title,
          imageUrl: product.featuredImage?.url ?? null,
          costPrice: null,
        };
      }
      if (platform === CompareProductPlatform.YOUCAN) {
        const product = await this.youCanData.getProductDetails(
          userId,
          productId,
        );
        const cost =
          typeof product.data.cost_price === 'number'
            ? new Prisma.Decimal(product.data.cost_price)
            : null;
        return {
          name: product.data.name?.trim() || `Product ${productId}`,
          imageUrl: product.data.thumbnail?.trim() || null,
          costPrice: cost,
        };
      }
      if (platform === CompareProductPlatform.LIGHTFUNNELS) {
        const product = await this.lightfunnelsData.getProductDetails(
          userId,
          productId,
        );
        return {
          name: product.data.title?.trim() || `Product ${productId}`,
          imageUrl: null,
          costPrice: null,
        };
      }
    } catch (error) {
      this.logger.warn(
        `Could not load ${platform} product ${productId} metadata: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { name: `Product ${productId}`, imageUrl: null, costPrice: null };
  }

  async update(
    userId: string,
    productId: string,
    dto: UpdateWarehouseProductDto,
  ) {
    const store = await this.stores.requireStore(userId);
    const product = await this.requireProduct(store.id, productId);
    if (dto.name !== undefined) requireProductName(dto.name);
    if (dto.categoryId)
      await this.requireActiveCategory(store.id, dto.categoryId);
    if (
      dto.variants?.length &&
      (dto.basePrice !== undefined ||
        dto.costPrice !== undefined ||
        dto.lowStockAlertThreshold !== undefined)
    ) {
      throw new BadRequestException(
        'Use either the simple-product pricing fields or variants, not both',
      );
    }
    if (
      (dto.basePrice !== undefined ||
        dto.costPrice !== undefined ||
        dto.lowStockAlertThreshold !== undefined) &&
      product.variants.length !== 1
    ) {
      throw new BadRequestException(
        'Products with multiple variants must be updated through the variants array',
      );
    }
    if (
      product.kind === WarehouseProductKind.BUNDLE &&
      (dto.costPrice !== undefined ||
        dto.variants?.some((variant) => variant.costPrice !== undefined))
    ) {
      throw new BadRequestException(
        'Bundle cost is derived from component variant costs',
      );
    }

    const variantUpdates = dto.variants ?? [];
    if (
      new Set(variantUpdates.map((variant) => variant.id)).size !==
      variantUpdates.length
    ) {
      throw new BadRequestException('A variant can be updated only once');
    }
    const productVariantIds = new Set(
      product.variants.map((variant) => variant.id),
    );
    if (variantUpdates.some((variant) => !productVariantIds.has(variant.id))) {
      throw new BadRequestException(
        'Every updated variant must belong to this product',
      );
    }
    const content = await this.prepareContentEdit(store.id, product, dto);

    const detachedMediaIds = await this.prisma
      .$transaction(async (tx) => {
        const result = await tx.warehouseProduct.updateMany({
          where: { id: productId, storeId: store.id, version: dto.version },
          data: {
            ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
            ...(dto.supplierNames === undefined
              ? {}
              : { supplierNames: dto.supplierNames }),
            ...(dto.description === undefined
              ? {}
              : { description: dto.description?.trim() || null }),
            ...(dto.categoryId === undefined
              ? {}
              : { categoryId: dto.categoryId }),
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

        const defaultVariant = product.variants[0];
        if (
          dto.basePrice !== undefined ||
          dto.costPrice !== undefined ||
          dto.lowStockAlertThreshold !== undefined
        ) {
          await tx.warehouseVariant.update({
            where: { id: defaultVariant.id },
            data: {
              ...(dto.basePrice === undefined ? {} : { price: dto.basePrice }),
              ...(dto.costPrice === undefined
                ? {}
                : { costPrice: dto.costPrice }),
              ...(dto.lowStockAlertThreshold === undefined
                ? {}
                : { lowStockThreshold: dto.lowStockAlertThreshold }),
            },
          });
        }
        for (const variant of variantUpdates) {
          await tx.warehouseVariant.update({
            where: { id: variant.id },
            data: {
              ...(variant.price === undefined ? {} : { price: variant.price }),
              ...(variant.costPrice === undefined
                ? {}
                : { costPrice: variant.costPrice }),
              ...(variant.lowStockAlertThreshold === undefined
                ? {}
                : { lowStockThreshold: variant.lowStockAlertThreshold }),
              ...(variant.sku === undefined
                ? {}
                : { sku: variant.sku.trim() || null }),
            },
          });
        }
        const changedCostVariantIds = [
          ...(dto.costPrice !== undefined ? [defaultVariant.id] : []),
          ...variantUpdates
            .filter((variant) => variant.costPrice !== undefined)
            .map((variant) => variant.id),
        ];
        await this.refreshBundleCosts(tx, changedCostVariantIds);
        return this.applyContentEdit(tx, store.id, product, dto, content);
      })
      .catch((error: unknown) => {
        if (isUniqueError(error)) {
          throw new ConflictException(
            'A SKU, barcode or product code is already used in this store',
          );
        }
        throw error;
      });

    for (const mediaId of detachedMediaIds) {
      await this.media.deleteAttachedAsset(mediaId);
    }
    if (
      dto.addVariants?.length ||
      variantUpdates.some((variant) => variant.sku !== undefined)
    ) {
      await this.linkOrderLinesForProduct(store.id, productId);
    }
    return this.toResponse(await this.requireProduct(store.id, productId));
  }

  /** Validates the image / gift / packaging / bundle / variant parts of an edit. */
  private async prepareContentEdit(
    storeId: string,
    product: ProductWithRelations,
    dto: UpdateWarehouseProductDto,
  ) {
    const isBundle = product.kind === WarehouseProductKind.BUNDLE;
    if (dto.bundleComponents && !isBundle) {
      throw new BadRequestException('Only bundles have components');
    }
    if (isBundle && (dto.addVariants?.length || dto.removeVariantIds?.length)) {
      throw new BadRequestException('A bundle has a single variant');
    }

    const productMediaIds = new Set([
      ...product.media.map((media) => media.id),
      ...product.variants.flatMap((variant) => variant.media.map((m) => m.id)),
    ]);
    const removeMediaIds = [...new Set(dto.removeMediaIds ?? [])];
    for (const mediaId of removeMediaIds) {
      const media =
        product.media.find((m) => m.id === mediaId) ??
        product.variants
          .flatMap((variant) => variant.media)
          .find((m) => m.id === mediaId);
      if (!media || !productMediaIds.has(mediaId)) {
        throw new BadRequestException(
          `Image ${mediaId} does not belong to this product`,
        );
      }
      if (media.purpose === MediaAssetPurpose.PRODUCT_MAIN) {
        throw new BadRequestException(
          'The main image can be replaced but not removed',
        );
      }
    }
    const galleryCount =
      product.media.filter(
        (m) =>
          m.purpose === MediaAssetPurpose.PRODUCT_GALLERY &&
          !removeMediaIds.includes(m.id),
      ).length + (dto.galleryImageUploadIds?.length ?? 0);
    if (galleryCount > 4) {
      throw new BadRequestException('The gallery holds at most 4 images');
    }
    const uploadIds = [
      ...(dto.mainImageUploadId ? [dto.mainImageUploadId] : []),
      ...(dto.galleryImageUploadIds ?? []),
      ...(dto.variants ?? []).flatMap((v) =>
        v.imageUploadId ? [v.imageUploadId] : [],
      ),
      ...(dto.addVariants ?? []).flatMap((v) =>
        v.imageUploadId ? [v.imageUploadId] : [],
      ),
    ];
    if (new Set(uploadIds).size !== uploadIds.length) {
      throw new BadRequestException(
        'The same uploaded image cannot be attached twice',
      );
    }

    if (dto.gift) {
      const gift = await this.prisma.warehouseVariant.findFirst({
        where: {
          id: dto.gift.giftVariantId,
          storeId,
          productId: { not: product.id },
          product: { status: WarehouseProductStatus.ACTIVE },
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

    let bundleCost: Prisma.Decimal | null = null;
    if (dto.bundleComponents) {
      const ids = dto.bundleComponents.map((c) => c.variantId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException(
          'A variant can appear only once in a product bundle',
        );
      }
      const components = await this.prisma.warehouseVariant.findMany({
        where: {
          id: { in: ids },
          storeId,
          product: {
            status: WarehouseProductStatus.ACTIVE,
            kind: WarehouseProductKind.STANDARD,
          },
        },
        select: { id: true, costPrice: true },
      });
      if (components.length !== ids.length) {
        throw new BadRequestException(
          'Every bundle component must be an active standard product variant from this store',
        );
      }
      const costById = new Map(components.map((c) => [c.id, c.costPrice]));
      bundleCost = dto.bundleComponents.reduce(
        (total, c) => total.plus(costById.get(c.variantId)!.times(c.quantity)),
        new Prisma.Decimal(0),
      );
    }

    const removeVariantIds = [...new Set(dto.removeVariantIds ?? [])];
    const variantIds = new Set(product.variants.map((v) => v.id));
    if (removeVariantIds.some((id) => !variantIds.has(id))) {
      throw new BadRequestException(
        'Every removed variant must belong to this product',
      );
    }
    if (
      removeVariantIds.some((id) =>
        dto.variants?.some((variant) => variant.id === id),
      )
    ) {
      throw new BadRequestException('A variant cannot be edited and removed');
    }
    const remainingCount =
      product.variants.length -
      removeVariantIds.length +
      (dto.addVariants?.length ?? 0);
    if (remainingCount < 1) {
      throw new BadRequestException(
        'A product needs at least one variant; archive it instead',
      );
    }
    if (remainingCount > 100) {
      throw new BadRequestException('A product can have at most 100 variants');
    }
    for (const id of removeVariantIds) {
      const variant = product.variants.find((v) => v.id === id)!;
      const hasStock = (variant.inventoryItem?.balances ?? []).some(
        (b) =>
          b.onHand > 0 || b.reserved > 0 || b.damaged > 0 || b.incoming > 0,
      );
      const [orderLines, giftUses, bundleUses, purchases, stockHistory] =
        await Promise.all([
          this.prisma.ecommerceOrderLine.count({
            where: { warehouseVariantId: id },
          }),
          this.prisma.productGift.count({ where: { giftVariantId: id } }),
          this.prisma.productBundleComponent.count({
            where: { componentVariantId: id },
          }),
          this.prisma.merchantPurchase.count({
            where: { warehouseVariantId: id },
          }),
          this.prisma.inventoryMovement.count({
            where: {
              inventoryItem: { variantId: id, storeId },
              NOT: {
                type: 'OPENING_BALANCE',
                quantityDelta: 0,
                resultingQuantity: 0,
              },
            },
          }),
        ]);
      if (
        hasStock ||
        orderLines ||
        giftUses ||
        bundleUses ||
        purchases ||
        stockHistory
      ) {
        throw new BadRequestException(
          `Variant ${variant.title} has stock, inventory or purchase history, order history, or is used as a gift or bundle component; archive the product instead`,
        );
      }
    }

    const addVariants: PreparedVariant[] = [];
    if (dto.addVariants?.length) {
      if (product.options.length === 0) {
        throw new BadRequestException(
          'Variants can be added only to a product that has options',
        );
      }
      const existingKeys = new Set(
        product.variants
          .filter((v) => !removeVariantIds.includes(v.id))
          .map((v) =>
            combinationKey(
              product.options.map(
                (option) =>
                  v.optionValues.find((ov) => ov.value.optionId === option.id)
                    ?.value.value ?? '',
              ),
            ),
          ),
      );
      const fallbackCost = product.variants[0].costPrice.toNumber();
      for (const input of dto.addVariants) {
        if (input.optionValues.length !== product.options.length) {
          throw new BadRequestException(
            'Variant option value count does not match product options',
          );
        }
        const values = input.optionValues.map((value) => value.trim());
        if (values.some((value) => !value || value.length > 50)) {
          throw new BadRequestException(
            'Option values must be 1–50 characters',
          );
        }
        const key = combinationKey(values);
        if (existingKeys.has(key)) {
          throw new BadRequestException(
            `Variant ${values.join(' / ')} already exists`,
          );
        }
        existingKeys.add(key);
        addVariants.push({
          ...input,
          optionValues: values,
          costPrice: input.costPrice ?? fallbackCost,
          lowStockAlertThreshold: input.lowStockAlertThreshold ?? 5,
        });
      }
      await this.prepareBarcodes(storeId, addVariants);
      await this.prepareProductCodes(storeId, addVariants);
      validateUniqueRequestValues(addVariants);
    }

    return { removeMediaIds, removeVariantIds, addVariants, bundleCost };
  }

  /** Applies a prepared content edit; returns media to delete from storage. */
  private async applyContentEdit(
    tx: Prisma.TransactionClient,
    storeId: string,
    product: ProductWithRelations,
    dto: UpdateWarehouseProductDto,
    content: Awaited<ReturnType<ProductService['prepareContentEdit']>>,
  ): Promise<string[]> {
    const detached: string[] = [...content.removeMediaIds];
    const detach = async (ids: string[]) => {
      if (!ids.length) return;
      await tx.mediaAsset.updateMany({
        where: { id: { in: ids }, storeId },
        data: {
          productId: null,
          variantId: null,
          status: MediaAssetStatus.TEMPORARY,
          expiresAt: new Date(),
        },
      });
    };

    if (dto.mainImageUploadId) {
      const current = product.media
        .filter((m) => m.purpose === MediaAssetPurpose.PRODUCT_MAIN)
        .map((m) => m.id);
      detached.push(...current);
      await detach(current);
      await this.attachMedia(
        tx,
        storeId,
        dto.mainImageUploadId,
        MediaAssetPurpose.PRODUCT_MAIN,
        { productId: product.id, position: 0 },
      );
    }
    await detach(content.removeMediaIds);
    if (dto.galleryImageUploadIds?.length) {
      const lastPosition = Math.max(
        0,
        ...product.media
          .filter((m) => m.purpose === MediaAssetPurpose.PRODUCT_GALLERY)
          .map((m) => m.position),
      );
      for (const [index, uploadId] of dto.galleryImageUploadIds.entries()) {
        await this.attachMedia(
          tx,
          storeId,
          uploadId,
          MediaAssetPurpose.PRODUCT_GALLERY,
          { productId: product.id, position: lastPosition + index + 1 },
        );
      }
    }
    for (const update of dto.variants ?? []) {
      if (!update.imageUploadId) continue;
      const variant = product.variants.find((v) => v.id === update.id)!;
      const current = variant.media.map((m) => m.id);
      detached.push(...current);
      await detach(current);
      await this.attachMedia(
        tx,
        storeId,
        update.imageUploadId,
        MediaAssetPurpose.VARIANT,
        { variantId: variant.id, position: 0 },
      );
    }

    if (dto.gift === null) {
      await tx.productGift.deleteMany({ where: { productId: product.id } });
    } else if (dto.gift) {
      await tx.productGift.upsert({
        where: { productId: product.id },
        create: {
          productId: product.id,
          giftVariantId: dto.gift.giftVariantId,
          quantity: dto.gift.quantity ?? 1,
        },
        update: {
          giftVariantId: dto.gift.giftVariantId,
          quantity: dto.gift.quantity ?? 1,
        },
      });
    }

    if (dto.packaging) {
      await tx.productPackagingRequirement.deleteMany({
        where: { productId: product.id, variantId: null },
      });
      if (dto.packaging.length) {
        await tx.productPackagingRequirement.createMany({
          data: dto.packaging.map((item) => ({
            productId: product.id,
            packagingMaterialId: item.packagingMaterialId,
            quantityPerUnit: item.quantityPerUnit,
          })),
        });
      }
    }

    if (dto.bundleComponents && content.bundleCost) {
      await tx.productBundleComponent.deleteMany({
        where: { bundleProductId: product.id },
      });
      await tx.productBundleComponent.createMany({
        data: dto.bundleComponents.map((component, position) => ({
          bundleProductId: product.id,
          componentVariantId: component.variantId,
          quantity: component.quantity,
          position,
        })),
      });
      await tx.warehouseVariant.updateMany({
        where: { productId: product.id, isDefault: true },
        data: { costPrice: content.bundleCost },
      });
    }

    if (content.removeVariantIds.length) {
      const variantMedia = product.variants
        .filter((v) => content.removeVariantIds.includes(v.id))
        .flatMap((v) => v.media.map((m) => m.id));
      detached.push(...variantMedia);
      await detach(variantMedia);
      // An unused variant still has a zero opening-balance initialization row.
      // Remove only that empty record; actual stock movements remain protected
      // by validation and the InventoryMovement restrictive foreign key.
      await tx.inventoryMovement.deleteMany({
        where: {
          inventoryItem: {
            storeId,
            variantId: { in: content.removeVariantIds },
          },
          type: 'OPENING_BALANCE',
          quantityDelta: 0,
          resultingQuantity: 0,
        },
      });
      await tx.warehouseVariant.deleteMany({
        where: { id: { in: content.removeVariantIds }, productId: product.id },
      });
    }

    if (content.addVariants.length) {
      await this.createVariants(tx, storeId, product, content.addVariants);
    }

    if (content.removeVariantIds.length || content.addVariants.length) {
      await tx.productOptionValue.deleteMany({
        where: {
          option: { productId: product.id },
          variants: { none: {} },
        },
      });
    }
    return detached;
  }

  private async createVariants(
    tx: Prisma.TransactionClient,
    storeId: string,
    product: ProductWithRelations,
    variants: PreparedVariant[],
    stockReason = 'Initial stock entered when the variant was added',
  ) {
    const location = await tx.warehouseLocation.upsert({
      where: { storeId_code: { storeId, code: 'MAIN' } },
      create: {
        storeId,
        name: 'Main Warehouse',
        code: 'MAIN',
        isDefault: true,
      },
      update: {},
    });
    const valueIds = new Map<string, string>();
    for (const [optionIndex, option] of product.options.entries()) {
      let nextPosition =
        Math.max(-1, ...option.values.map((value) => value.position)) + 1;
      for (const value of option.values) {
        valueIds.set(`${option.id}:${normalizeKey(value.value)}`, value.id);
      }
      for (const variant of variants) {
        const value = variant.optionValues[optionIndex];
        const key = `${option.id}:${normalizeKey(value)}`;
        if (valueIds.has(key)) continue;
        const created = await tx.productOptionValue.create({
          data: { optionId: option.id, value, position: nextPosition++ },
        });
        valueIds.set(key, created.id);
      }
    }

    let position = Math.max(-1, ...product.variants.map((v) => v.position)) + 1;
    for (const input of variants) {
      const variant = await tx.warehouseVariant.create({
        data: {
          productId: product.id,
          storeId,
          title: input.optionValues.length
            ? input.optionValues.join(' / ')
            : 'Default',
          sku: input.sku?.trim() || null,
          productCode: input.productCode!,
          price: input.price,
          costPrice: input.costPrice,
          lowStockThreshold: input.lowStockAlertThreshold,
          isDefault: input.optionValues.length === 0,
          position: position++,
          optionValues: {
            create: product.options.map((option, optionIndex) => ({
              valueId: valueIds.get(
                `${option.id}:${normalizeKey(input.optionValues[optionIndex])}`,
              )!,
            })),
          },
        },
      });
      await tx.inventoryItem.create({
        data: {
          storeId,
          kind: InventoryItemKind.PRODUCT_VARIANT,
          variantId: variant.id,
          barcodes: {
            create: {
              storeId,
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
            create: { locationId: location.id, onHand: input.stockQuantity },
          },
          movements: {
            create: {
              locationId: location.id,
              type: 'OPENING_BALANCE',
              bucket: 'ON_HAND',
              quantityDelta: input.stockQuantity,
              resultingQuantity: input.stockQuantity,
              reason: stockReason,
              idempotencyKey: `opening:${variant.id}`,
            },
          },
        },
      });
      if (input.imageUploadId) {
        await this.attachMedia(
          tx,
          storeId,
          input.imageUploadId,
          MediaAssetPurpose.VARIANT,
          { variantId: variant.id, position: 0 },
        );
      }
    }
  }

  /**
   * Creates Zomaal products from platform products. A product already
   * imported, or with any SKU already used in Zomaal, is reported instead of
   * duplicated; each product succeeds or fails on its own.
   */
  async importFromPlatform(userId: string, dto: ImportPlatformProductsDto) {
    const store = await this.stores.requireStore(userId);
    if (dto.categoryId) {
      await this.requireActiveCategory(store.id, dto.categoryId);
    }
    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: {
        storeId: store.id,
        platform: dto.platform,
        status: EcommerceConnectionStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!connection) {
      throw new BadRequestException(
        `${dto.platform} is not connected. Connect it before importing products.`,
      );
    }

    const results: ProductImportResultDto[] = [];
    for (const rawId of dto.productIds) {
      const externalId =
        dto.platform === EcommercePlatform.SHOPIFY
          ? (shopifyNumericId(rawId.trim()) ?? rawId.trim())
          : rawId.trim();
      results.push(await this.importOne(userId, store.id, dto, externalId));
    }
    return {
      platform: dto.platform,
      imported: results.filter(
        (result) => result.status === ProductImportResultStatus.IMPORTED,
      ).length,
      skipped: results.filter(
        (result) =>
          result.status === ProductImportResultStatus.ALREADY_IMPORTED ||
          result.status === ProductImportResultStatus.SKU_MATCHED,
      ).length,
      failed: results.filter(
        (result) => result.status === ProductImportResultStatus.FAILED,
      ).length,
      results,
    };
  }

  private async importOne(
    userId: string,
    storeId: string,
    dto: ImportPlatformProductsDto,
    externalId: string,
  ): Promise<ProductImportResultDto> {
    const base = {
      platformProductId: externalId,
      productId: null,
      name: null,
      variantsImported: 0,
      variantsWithoutSku: 0,
      costMissing: false,
      imageImported: false,
      message: null,
    };
    const idempotencyKey = `import:${dto.platform}:${externalId}`;
    const alreadyImported = () =>
      this.prisma.warehouseProduct.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey } },
        select: { id: true, name: true },
      });
    const existing = await alreadyImported();
    if (existing) {
      return {
        ...base,
        status: ProductImportResultStatus.ALREADY_IMPORTED,
        productId: existing.id,
        name: existing.name,
        message: 'This platform product was already imported',
      };
    }

    let imported: ImportedProduct;
    try {
      imported = await this.fetchPlatformProduct(
        userId,
        dto.platform,
        externalId,
      );
    } catch (error) {
      if (!(error instanceof ImportMappingError)) {
        this.logger.warn(
          `Import: could not load ${dto.platform} product ${externalId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return {
        ...base,
        status: ProductImportResultStatus.FAILED,
        message:
          error instanceof ImportMappingError
            ? error.message
            : `Could not load this product from ${dto.platform}`,
      };
    }

    const skus = imported.variants.flatMap((variant) =>
      variant.sku ? [variant.sku] : [],
    );
    if (skus.length) {
      const match = await this.prisma.warehouseVariant.findFirst({
        where: {
          storeId,
          OR: skus.map((sku) => ({
            sku: { equals: sku, mode: 'insensitive' as const },
          })),
        },
        select: { productId: true, product: { select: { name: true } } },
      });
      if (match) {
        return {
          ...base,
          status: ProductImportResultStatus.SKU_MATCHED,
          productId: match.productId,
          name: match.product.name,
          message:
            'A SKU of this product already exists in Zomaal, so nothing was created. Add missing variants from Edit product.',
        };
      }
    }

    const variants: PreparedVariant[] = imported.variants.map((variant) => ({
      optionValues: variant.optionValues,
      sku: variant.sku ?? undefined,
      price: variant.price,
      costPrice: variant.costPrice ?? 0,
      stockQuantity: dto.importStock ? Math.max(0, variant.stock ?? 0) : 0,
      lowStockAlertThreshold: 5,
    }));
    await this.adoptPlatformBarcodes(storeId, imported.variants, variants);
    await this.prepareBarcodes(storeId, variants);
    await this.prepareProductCodes(storeId, variants);
    const imageId = await this.importMainImage(storeId, imported);

    try {
      const productId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.warehouseProduct.create({
          data: {
            storeId,
            categoryId: dto.categoryId ?? null,
            name: imported.name,
            description: imported.description,
            status: dto.status ?? WarehouseProductStatus.ACTIVE,
            idempotencyKey,
            options: {
              create: imported.options.map((name, position) => ({
                name,
                position,
              })),
            },
          },
        });
        const product = await tx.warehouseProduct.findUniqueOrThrow({
          where: { id: created.id },
          include: PRODUCT_INCLUDE,
        });
        await this.createVariants(
          tx,
          storeId,
          product,
          variants,
          `Opening stock imported from ${dto.platform}`,
        );
        if (imageId) {
          await this.attachMedia(
            tx,
            storeId,
            imageId,
            MediaAssetPurpose.PRODUCT_MAIN,
            { productId: created.id, position: 0 },
          );
        }
        return created.id;
      });
      await this.linkOrderLinesForProduct(storeId, productId);
      return {
        ...base,
        status: ProductImportResultStatus.IMPORTED,
        productId,
        name: imported.name,
        variantsImported: variants.length,
        variantsWithoutSku: variants.filter((variant) => !variant.sku).length,
        costMissing: imported.variants.some(
          (variant) => variant.costPrice === null,
        ),
        imageImported: imageId !== null,
      };
    } catch (error) {
      if (isUniqueError(error)) {
        const raced = await alreadyImported();
        if (raced) {
          return {
            ...base,
            status: ProductImportResultStatus.ALREADY_IMPORTED,
            productId: raced.id,
            name: raced.name,
            message: 'This platform product was already imported',
          };
        }
        return {
          ...base,
          status: ProductImportResultStatus.FAILED,
          message: 'A SKU, barcode or product code is already used in Zomaal',
        };
      }
      this.logger.error(
        `Import of ${dto.platform} product ${externalId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ...base,
        status: ProductImportResultStatus.FAILED,
        message: 'The product could not be created',
      };
    }
  }

  private async fetchPlatformProduct(
    userId: string,
    platform: EcommercePlatform,
    externalId: string,
  ): Promise<ImportedProduct> {
    if (platform === EcommercePlatform.SHOPIFY) {
      return fromShopifyProduct(
        await this.shopifyData.getProductDetails(userId, externalId, {
          variantsFirst: MAX_IMPORT_VARIANTS,
          mediaFirst: 1,
        }),
      );
    }
    if (platform === EcommercePlatform.YOUCAN) {
      const product = await this.youCanData.getProductDetails(
        userId,
        externalId,
        'variants',
      );
      return fromYouCanProduct(product.data);
    }
    const product = await this.lightfunnelsData.getProductDetails(
      userId,
      externalId,
    );
    return fromLightfunnelsProduct(product.data);
  }

  /** Keeps a platform barcode (e.g. EAN) when it is valid and not already used in the store. */
  private async adoptPlatformBarcodes(
    storeId: string,
    source: ImportedVariant[],
    variants: PreparedVariant[],
  ) {
    const candidates = new Map<
      number,
      { value: string; type: InventoryBarcodeType }
    >();
    for (const [index, variant] of source.entries()) {
      if (!variant.barcode) continue;
      try {
        candidates.set(
          index,
          this.barcodes.normalizeAndValidate(variant.barcode),
        );
      } catch {
        // Invalid platform barcode: a Zomaal barcode is generated instead.
      }
    }
    if (!candidates.size) return;
    const taken = new Set(
      (
        await this.prisma.inventoryBarcode.findMany({
          where: {
            storeId,
            value: { in: [...candidates.values()].map((c) => c.value) },
          },
          select: { value: true },
        })
      ).map((barcode) => barcode.value),
    );
    for (const [index, barcode] of candidates) {
      if (taken.has(barcode.value)) continue;
      taken.add(barcode.value);
      variants[index].barcode = barcode.value;
      variants[index].barcodeType = barcode.type;
    }
  }

  private async importMainImage(
    storeId: string,
    product: ImportedProduct,
  ): Promise<string | null> {
    if (!product.imageUrl) return null;
    const file = await downloadPlatformImage(product.imageUrl);
    if (!file) return null;
    try {
      const asset = await this.media.uploadForStore(
        storeId,
        MediaAssetPurpose.PRODUCT_MAIN,
        file,
      );
      return asset.id;
    } catch (error) {
      this.logger.warn(
        `Import: could not store image for product ${product.externalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
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

  /**
   * Every variant gets its own internal Product Tracking Code (e.g. "DH564BJ0"),
   * printed on shipping tickets/QR labels instead of the full product title.
   * Always server-generated — merchants never supply this value.
   */
  private async prepareProductCodes(
    storeId: string,
    variants: PreparedVariant[],
  ) {
    for (const variant of variants) {
      variant.productCode =
        await this.barcodes.generateProductCodeForStore(storeId);
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

  private async linkOrderLinesForProduct(storeId: string, productId: string) {
    const variants = await this.prisma.warehouseVariant.findMany({
      where: { productId, storeId, sku: { not: null } },
      select: { id: true, sku: true },
    });
    for (const variant of variants) {
      if (!variant.sku) continue;
      const unlinked = {
        warehouseVariantId: null,
        sku: { equals: variant.sku, mode: 'insensitive' as const },
      };
      // Delivered before the product existed in Zomaal: the merchant's stock
      // count already excludes these units, so they must not be deducted again.
      await this.prisma.ecommerceOrderLine.updateMany({
        where: {
          ...unlinked,
          order: {
            connection: { storeId },
            OR: [
              { events: { some: { type: OrderEventType.DELIVERED } } },
              { financialEvents: { some: { type: 'REVENUE_RECOGNIZED' } } },
            ],
          },
        },
        data: {
          warehouseVariantId: variant.id,
          stockStatus: OrderLineStockStatus.DELIVERED,
        },
      });
      await this.prisma.ecommerceOrderLine.updateMany({
        where: { ...unlinked, order: { connection: { storeId } } },
        data: { warehouseVariantId: variant.id },
      });
    }
  }

  private async refreshBundleCosts(
    tx: Prisma.TransactionClient,
    componentVariantIds: string[],
  ) {
    if (!componentVariantIds.length) return;
    const usages = await tx.productBundleComponent.findMany({
      where: { componentVariantId: { in: componentVariantIds } },
      select: { bundleProductId: true },
      distinct: ['bundleProductId'],
    });
    for (const usage of usages) {
      const components = await tx.productBundleComponent.findMany({
        where: { bundleProductId: usage.bundleProductId },
        include: { componentVariant: { select: { costPrice: true } } },
      });
      const cost = components.reduce(
        (total, component) =>
          total.plus(
            component.componentVariant.costPrice.times(component.quantity),
          ),
        new Prisma.Decimal(0),
      );
      await tx.warehouseVariant.updateMany({
        where: { productId: usage.bundleProductId, isDefault: true },
        data: { costPrice: cost },
      });
    }
  }

  private toResponse(product: ProductWithRelations) {
    const bundleComponents = product.bundleComponents.map((component) => {
      const balances = component.componentVariant.inventoryItem?.balances ?? [];
      const onHand = balances.reduce((sum, balance) => sum + balance.onHand, 0);
      const availableUnits = balances.reduce(
        (sum, balance) =>
          sum + balance.onHand - balance.reserved - balance.damaged,
        0,
      );
      return {
        id: component.id,
        variantId: component.componentVariantId,
        productId: component.componentVariant.product.id,
        productName: component.componentVariant.product.name,
        variantTitle: component.componentVariant.title,
        sku: component.componentVariant.sku,
        quantity: component.quantity,
        onHandBundles: Math.floor(onHand / component.quantity),
        availableUnits,
        availableBundles: Math.floor(availableUnits / component.quantity),
        unitCost: Number(component.componentVariant.costPrice),
      };
    });
    const bundleOnHand = bundleComponents.length
      ? Math.min(
          ...bundleComponents.map((component) => component.onHandBundles),
        )
      : 0;
    const bundleAvailable = bundleComponents.length
      ? Math.min(
          ...bundleComponents.map((component) => component.availableBundles),
        )
      : 0;
    const variants = product.variants.map((variant) => {
      const balances = variant.inventoryItem?.balances ?? [];
      const storedOnHand = balances.reduce(
        (sum, balance) => sum + balance.onHand,
        0,
      );
      const reserved = balances.reduce(
        (sum, balance) => sum + balance.reserved,
        0,
      );
      const damaged = balances.reduce(
        (sum, balance) => sum + balance.damaged,
        0,
      );
      const onHand =
        product.kind === WarehouseProductKind.BUNDLE
          ? bundleOnHand
          : storedOnHand;
      const available =
        product.kind === WarehouseProductKind.BUNDLE
          ? bundleAvailable
          : onHand - reserved - damaged;
      return {
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        productCode: variant.productCode,
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
          available,
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
      supplierNames: product.supplierNames,
      description: product.description,
      status: product.status,
      kind: product.kind,
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
      bundleComponents: bundleComponents.map((component) => ({
        id: component.id,
        variantId: component.variantId,
        productId: component.productId,
        productName: component.productName,
        variantTitle: component.variantTitle,
        sku: component.sku,
        quantity: component.quantity,
        availableUnits: component.availableUnits,
        availableBundles: component.availableBundles,
        unitCost: component.unitCost,
      })),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      archivedAt: product.archivedAt?.toISOString() ?? null,
    };
  }
}

function performanceRange(query: ProductPerformanceQueryDto) {
  const period = query.period ?? ProductPerformancePeriod.SEVEN_DAYS;
  const now = new Date();
  if (period === ProductPerformancePeriod.CUSTOM) {
    if (!query.from || !query.to) {
      throw new BadRequestException(
        'from and to are required when period is CUSTOM',
      );
    }
    const from = parseUtcDate(query.from, 'from');
    const inclusiveTo = parseUtcDate(query.to, 'to');
    const toExclusive = new Date(inclusiveTo.getTime() + 86_400_000);
    if (from >= toExclusive) {
      throw new BadRequestException('from must not be after to');
    }
    if (toExclusive.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new BadRequestException(
        'Custom performance ranges cannot exceed 366 days',
      );
    }
    return { period, from, toExclusive };
  }
  const count =
    period === ProductPerformancePeriod.NINETY_DAYS
      ? 90
      : period === ProductPerformancePeriod.THIRTY_DAYS
        ? 30
        : 7;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    period,
    from: new Date(today.getTime() - (count - 1) * 86_400_000),
    toExclusive: new Date(today.getTime() + 86_400_000),
  };
}

function parseUtcDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return parsed;
}

function dateKeys(from: Date, toExclusive: Date) {
  const keys: string[] = [];
  for (
    let time = from.getTime();
    time < toExclusive.getTime();
    time += 86_400_000
  ) {
    keys.push(utcDateKey(new Date(time)));
  }
  return keys;
}

function utcDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

const RETURNED_SHIPMENT_STATUSES = new Set<ShippingShipmentStatus>([
  ShippingShipmentStatus.RETURN_PENDING,
  ShippingShipmentStatus.RETURN_IN_TRANSIT,
  ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  ShippingShipmentStatus.RETURN_INSPECTION,
  ShippingShipmentStatus.RETURNED_TO_STOCK,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
]);

function productOrderState(order: {
  status: EcommerceOrderStatus;
  financialStatus: EcommercePaymentStatus;
  fulfillmentStatus: string | null;
  dispatch: {
    senditShipment: { normalizedStatus: ShippingShipmentStatus } | null;
    quickLivraisonShipment: {
      normalizedStatus: ShippingShipmentStatus;
    } | null;
    forceLogShipment: { normalizedStatus: ShippingShipmentStatus } | null;
    ozoneExpressShipment: { normalizedStatus: ShippingShipmentStatus } | null;
  } | null;
}) {
  const shipmentStatus = order.dispatch
    ? [
        order.dispatch.senditShipment,
        order.dispatch.quickLivraisonShipment,
        order.dispatch.forceLogShipment,
        order.dispatch.ozoneExpressShipment,
      ]
        .map((shipment) => shipment?.normalizedStatus)
        .find(Boolean)
    : undefined;
  const fulfillment = order.fulfillmentStatus?.toLocaleLowerCase('en-US') ?? '';
  const returned = shipmentStatus
    ? RETURNED_SHIPMENT_STATUSES.has(shipmentStatus)
    : /return|restock/.test(fulfillment);
  const delivered = shipmentStatus
    ? shipmentStatus === ShippingShipmentStatus.DELIVERED
    : /deliver|fulfill/.test(fulfillment);
  const cancelled = order.status === EcommerceOrderStatus.CANCELLED;
  const refunded = order.financialStatus === EcommercePaymentStatus.REFUNDED;
  return {
    delivered,
    returned,
    cancelled,
    realized: !cancelled && !returned && !refunded,
  };
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : round2((numerator / denominator) * 100);
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function prepareProduct(dto: CreateWarehouseProductDto): {
  options: { name: string; values: string[] }[];
  variants: PreparedVariant[];
} {
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

const comparisonLineInclude = {
  warehouseVariant: {
    select: ORDER_LINE_STOCK_INCLUDE.warehouseVariant.select,
  },
  order: {
    select: {
      id: true,
      status: true,
      financialStatus: true,
      fulfillmentStatus: true,
      providerUpdatedAt: true,
      dispatch: {
        select: {
          senditShipment: { select: { normalizedStatus: true } },
          quickLivraisonShipment: { select: { normalizedStatus: true } },
          forceLogShipment: { select: { normalizedStatus: true } },
          ozoneExpressShipment: { select: { normalizedStatus: true } },
        },
      },
    },
  },
} as const;

type ComparisonLine = Prisma.EcommerceOrderLineGetPayload<{
  include: typeof comparisonLineInclude;
}>;

function finalizeComparisonSide(input: {
  platform: CompareProductPlatform;
  productId: string;
  name: string;
  imageUrl: string | null;
  lines: ComparisonLine[];
  /** Fallback unit cost when a line has no warehouseVariant (e.g. YouCan cost_price). */
  platformUnitCost: Prisma.Decimal | null;
  packagingUnitCosts: Map<string, Prisma.Decimal>;
}) {
  const orders = new Map<
    string,
    { delivered: boolean; cancelled: boolean; returned: boolean }
  >();
  let revenue = new Prisma.Decimal(0);
  let cost = new Prisma.Decimal(0);
  let costAvailable = false;
  let dataUpdatedAt: Date | null = null;

  for (const line of input.lines) {
    const state = productOrderState(line.order);
    orders.set(line.order.id, state);
    if (
      !dataUpdatedAt ||
      line.order.providerUpdatedAt.getTime() > dataUpdatedAt.getTime()
    ) {
      dataUpdatedAt = line.order.providerUpdatedAt;
    }
    if (!state.realized) continue;
    revenue = revenue.plus(line.totalPrice);
    if (line.warehouseVariant) {
      const lineCosts = orderLineCosts(line, input.packagingUnitCosts);
      cost = cost
        .plus(lineCosts.productCost)
        .plus(lineCosts.giftCost)
        .plus(lineCosts.packagingCost);
      costAvailable = true;
    } else if (input.platformUnitCost) {
      cost = cost.plus(input.platformUnitCost.times(line.quantity));
      costAvailable = true;
    }
  }

  // Warehouse sides with no orders still expose profit/cpo as "0.0000".
  if (
    input.platform === CompareProductPlatform.WAREHOUSE &&
    input.platformUnitCost === null
  ) {
    costAvailable = true;
  }

  const orderStates = [...orders.values()];
  const totalOrders = orders.size;
  const deliveryRate = percentage(
    orderStates.filter((order) => order.delivered).length,
    totalOrders,
  );
  const returnRate = percentage(
    orderStates.filter((order) => order.returned).length,
    totalOrders,
  );
  const cancellationRate = percentage(
    orderStates.filter((order) => order.cancelled).length,
    totalOrders,
  );
  const avgOrderValue =
    totalOrders === 0 ? new Prisma.Decimal(0) : revenue.div(totalOrders);
  const grossProfit = costAvailable ? revenue.minus(cost) : null;
  const cpo =
    costAvailable && totalOrders > 0
      ? cost.div(totalOrders)
      : costAvailable
        ? new Prisma.Decimal(0)
        : null;

  return {
    platform: input.platform,
    productId: input.productId,
    name: input.name,
    imageUrl: input.imageUrl,
    metrics: {
      totalOrders,
      deliveryRate,
      returnRate,
      cancellationRate,
      revenue: revenue.toFixed(4),
      profit: grossProfit?.toFixed(4) ?? null,
      avgOrderValue: avgOrderValue.toFixed(4),
      cpo: cpo?.toFixed(4) ?? null,
    },
    insightMetrics: {
      deliveryRate,
      returnRate,
      cancellationRate,
      revenue: revenue.toNumber(),
      profit: grossProfit?.toNumber() ?? null,
      avgOrderValue: avgOrderValue.toNumber(),
      cpo: cpo?.toNumber() ?? null,
    },
    dataUpdatedAt,
  };
}

function toEcommercePlatform(
  platform: CompareProductPlatform,
): EcommercePlatform | null {
  switch (platform) {
    case CompareProductPlatform.SHOPIFY:
      return EcommercePlatform.SHOPIFY;
    case CompareProductPlatform.YOUCAN:
      return EcommercePlatform.YOUCAN;
    case CompareProductPlatform.LIGHTFUNNELS:
      return EcommercePlatform.LIGHTFUNNELS;
    default:
      return null;
  }
}

function shopifyNumericId(value: string): string | null {
  const gidMatch = value.match(/^gid:\/\/shopify\/Product\/(\d+)$/i);
  if (gidMatch) return gidMatch[1];
  if (/^[1-9]\d{0,19}$/.test(value)) return value;
  return null;
}

function expandExternalProductIds(
  platform: CompareProductPlatform,
  productId: string,
): string[] {
  if (platform === CompareProductPlatform.SHOPIFY) {
    const numeric = shopifyNumericId(productId);
    if (numeric) {
      return [numeric, `gid://shopify/Product/${numeric}`];
    }
  }
  return [productId];
}

function normalizeCompareProductKey(
  platform: CompareProductPlatform,
  productId: string,
): string {
  if (platform === CompareProductPlatform.SHOPIFY) {
    return shopifyNumericId(productId) ?? productId.trim().toLowerCase();
  }
  return productId.trim().toLowerCase();
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

function requireProductName(name: string): void {
  if (typeof name !== 'string' || !name.trim()) {
    throw new BadRequestException('Product name must not be blank');
  }
}
