import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShopProductStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  validateImage,
  type WarehouseMediaUploadFile,
} from '../../warehouse/media.service';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import {
  CreateShopCategoryDto,
  UpdateShopCategoryDto,
} from './dto/category.dto';
import {
  CreateShopProductDto,
  ShopProductSpecInputDto,
  ShopProductVariantInputDto,
  UpdateShopProductDto,
} from './dto/product.dto';
import { ListShopProductsQueryDto } from './dto/list-products-query.dto';
import { parseCsv, toCsv } from './csv.util';
import { ShopImageStorageService } from './shop-image-storage.service';

// Below this many units left, a product shows as "low stock" on the
// Products list and counts toward the Dashboard's low-stock alert.
export const LOW_STOCK_THRESHOLD = 20;

const CSV_HEADERS = [
  'name',
  'category',
  'sku',
  'price',
  'stock',
  'status',
  'description',
] as const;
const MAX_IMPORT_ROWS = 2000;
export const MAX_PRODUCT_IMAGES = 8;

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  images: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  },
  variants: { orderBy: { sortOrder: 'asc' } },
  specs: {
    orderBy: { sortOrder: 'asc' },
    select: { label: true, value: true },
  },
} satisfies Prisma.ShopProductInclude;

type ProductWithCategory = Prisma.ShopProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ShopImageStorageService,
    private readonly activity: ActivityLogService,
  ) {}

  // ---- Categories ----

  async listCategories() {
    const categories = await this.prisma.shopCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return categories.map((category) => this.toCategoryResponse(category));
  }

  async createCategory(
    actor: SuperAdminJwtPayload,
    dto: CreateShopCategoryDto,
  ) {
    const category = await this.prisma.shopCategory.create({
      data: {
        name: dto.name.trim(),
        slug: await this.uniqueCategorySlug(dto.name),
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { _count: { select: { products: true } } },
    });
    await this.activity.record(actor, {
      action: 'CATEGORY_CREATED',
      entityType: ActivityEntity.SHOP_CATEGORY,
      entityId: category.id,
      summary: `Created category "${category.name}"`,
    });
    return this.toCategoryResponse(category);
  }

  async updateCategory(
    actor: SuperAdminJwtPayload,
    categoryId: string,
    dto: UpdateShopCategoryDto,
  ) {
    const before = await this.requireCategory(categoryId);
    const category = await this.prisma.shopCategory.update({
      where: { id: categoryId },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name.trim(),
              slug: await this.uniqueCategorySlug(dto.name, categoryId),
            }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { _count: { select: { products: true } } },
    });
    await this.activity.record(actor, {
      action: 'CATEGORY_UPDATED',
      entityType: ActivityEntity.SHOP_CATEGORY,
      entityId: category.id,
      summary: `Updated category "${category.name}"`,
      metadata: changedFields(before, category, [
        'name',
        'sortOrder',
        'isActive',
      ]),
    });
    return this.toCategoryResponse(category);
  }

  async deleteCategory(actor: SuperAdminJwtPayload, categoryId: string) {
    const category = await this.requireCategory(categoryId);
    const productCount = await this.prisma.shopProduct.count({
      where: { categoryId },
    });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete "${category.name}" — it still has ${productCount} product(s). Move or delete them first.`,
      );
    }
    await this.prisma.shopCategory.delete({ where: { id: categoryId } });
    await this.activity.record(actor, {
      action: 'CATEGORY_DELETED',
      entityType: ActivityEntity.SHOP_CATEGORY,
      entityId: category.id,
      summary: `Deleted category "${category.name}"`,
    });
    return { message: `Category "${category.name}" deleted` };
  }

  // ---- Products ----

  async listProducts(query: ListShopProductsQueryDto) {
    const products = await this.prisma.shopProduct.findMany({
      where: this.productWhere(query),
      orderBy: { createdAt: 'desc' },
      include: PRODUCT_INCLUDE,
    });
    return products.map((product) => this.toProductResponse(product));
  }

  async createProduct(actor: SuperAdminJwtPayload, dto: CreateShopProductDto) {
    await this.requireCategory(dto.categoryId);
    await this.assertSkuAvailable(dto.sku);
    const product = await this.prisma.shopProduct.create({
      data: {
        name: dto.name.trim(),
        slug: await this.uniqueProductSlug(dto.name),
        categoryId: dto.categoryId,
        sku: dto.sku?.trim() || null,
        description: dto.description?.trim() || null,
        price: new Prisma.Decimal(dto.price),
        stock: dto.stock ?? 0,
        status: dto.status ?? ShopProductStatus.DRAFT,
        compareAtPrice:
          dto.compareAtPrice === undefined || dto.compareAtPrice === null
            ? null
            : new Prisma.Decimal(dto.compareAtPrice),
        unitLabel: dto.unitLabel?.trim() || 'piece',
        isFeatured: dto.isFeatured ?? false,
      },
      include: PRODUCT_INCLUDE,
    });
    await this.activity.record(actor, {
      action: 'PRODUCT_CREATED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: product.id,
      summary: `Created product "${product.name}"`,
    });
    return this.toProductResponse(product);
  }

  async updateProduct(
    actor: SuperAdminJwtPayload,
    productId: string,
    dto: UpdateShopProductDto,
  ) {
    const before = await this.requireProduct(productId);
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
    }
    if (dto.sku !== undefined) {
      await this.assertSkuAvailable(dto.sku, productId);
    }
    if (dto.stock !== undefined) {
      const optionCount = await this.prisma.shopProductVariant.count({
        where: { productId },
      });
      if (optionCount > 0 && dto.stock !== before.stock) {
        throw new BadRequestException(
          'This product has options — set stock on each option instead.',
        );
      }
    }

    const product = await this.prisma.shopProduct.update({
      where: { id: productId },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name.trim(),
              slug: await this.uniqueProductSlug(dto.name, productId),
            }
          : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku?.trim() || null } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.price !== undefined
          ? { price: new Prisma.Decimal(dto.price) }
          : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.compareAtPrice !== undefined
          ? {
              compareAtPrice:
                dto.compareAtPrice === null
                  ? null
                  : new Prisma.Decimal(dto.compareAtPrice),
            }
          : {}),
        ...(dto.unitLabel !== undefined
          ? { unitLabel: dto.unitLabel.trim() || 'piece' }
          : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
      },
      include: PRODUCT_INCLUDE,
    });
    await this.activity.record(actor, {
      action: 'PRODUCT_UPDATED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: product.id,
      summary: `Updated product "${product.name}"`,
      metadata: changedFields(
        { ...before, price: before.price.toFixed(2) },
        { ...product, price: product.price.toFixed(2) },
        [
          'name',
          'categoryId',
          'sku',
          'price',
          'stock',
          'status',
          'unitLabel',
          'isFeatured',
        ],
      ),
    });
    return this.toProductResponse(product);
  }

  async deleteProduct(actor: SuperAdminJwtPayload, productId: string) {
    const product = await this.requireProduct(productId);
    const images = await this.prisma.shopProductImage.findMany({
      where: { productId },
      select: { objectName: true },
    });
    // Rows cascade with the product; the stored files are removed after the
    // delete commits, so a storage hiccup can never block the delete.
    await this.prisma.shopProduct.delete({ where: { id: productId } });
    await Promise.all(images.map((i) => this.images.remove(i.objectName)));
    await this.activity.record(actor, {
      action: 'PRODUCT_DELETED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: product.id,
      summary: `Deleted product "${product.name}"`,
      metadata: { imagesRemoved: images.length },
    });
    return { message: `Product "${product.name}" deleted` };
  }

  // ---- Product options (variants) & specifications ----

  // Replaces the full option list in one transaction: listed ids are updated,
  // new entries created, unlisted options deleted (removing them from carts;
  // past order lines keep their snapshot). product.stock becomes the sum.
  async replaceVariants(
    actor: SuperAdminJwtPayload,
    productId: string,
    variants: ShopProductVariantInputDto[],
  ) {
    const product = await this.requireProduct(productId);
    const clean = variants.map((v, index) => ({
      ...v,
      size: v.size?.trim() || null,
      color: v.color?.trim() || null,
      sku: v.sku?.trim() || null,
      sortOrder: index,
    }));

    const combos = new Set<string>();
    for (const v of clean) {
      if (!v.size && !v.color) {
        throw new BadRequestException(
          'Every option needs a size, a color, or both.',
        );
      }
      const combo = `${v.size?.toLowerCase() ?? ''}|${v.color?.toLowerCase() ?? ''}`;
      if (combos.has(combo)) {
        throw new BadRequestException(
          `Duplicate option: ${[v.size, v.color].filter(Boolean).join(' / ')}`,
        );
      }
      combos.add(combo);
    }
    const skus = clean.map((v) => v.sku).filter((x): x is string => !!x);
    if (new Set(skus).size !== skus.length) {
      throw new BadRequestException('Option SKUs must be unique.');
    }

    const existing = await this.prisma.shopProductVariant.findMany({
      where: { productId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));
    for (const v of clean) {
      if (v.id && !existingIds.has(v.id)) {
        throw new BadRequestException(
          'One of the options does not belong to this product.',
        );
      }
    }
    if (skus.length) {
      const taken = await this.prisma.shopProductVariant.findFirst({
        where: { sku: { in: skus }, productId: { not: productId } },
        select: { sku: true },
      });
      if (taken)
        throw new ConflictException(
          `SKU "${taken.sku}" is already used by another product.`,
        );
    }

    const keepIds = clean.map((v) => v.id).filter((x): x is string => !!x);
    const dec = (n: number | null | undefined) =>
      n === undefined || n === null ? null : new Prisma.Decimal(n);

    await this.prisma.$transaction(async (tx) => {
      await tx.shopProductVariant.deleteMany({
        where: { productId, id: { notIn: keepIds } },
      });
      // Clear SKUs first so swapping SKUs between two options can't trip the
      // unique index mid-transaction.
      if (keepIds.length) {
        await tx.shopProductVariant.updateMany({
          where: { id: { in: keepIds } },
          data: { sku: null },
        });
      }
      for (const v of clean) {
        const data = {
          size: v.size,
          color: v.color,
          colorHex: v.colorHex?.toUpperCase() ?? null,
          sku: v.sku,
          price: dec(v.price),
          compareAtPrice: dec(v.compareAtPrice),
          stock: v.stock,
          isActive: v.isActive ?? true,
          sortOrder: v.sortOrder,
        };
        if (v.id) {
          await tx.shopProductVariant.update({ where: { id: v.id }, data });
        } else {
          await tx.shopProductVariant.create({ data: { productId, ...data } });
        }
      }
      if (clean.length) {
        await tx.shopProduct.update({
          where: { id: productId },
          data: { stock: clean.reduce((sum, v) => sum + v.stock, 0) },
        });
      }
    });

    await this.activity.record(actor, {
      action: 'PRODUCT_OPTIONS_UPDATED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: productId,
      summary: clean.length
        ? `Set ${clean.length} option${clean.length === 1 ? '' : 's'} on "${product.name}"`
        : `Removed all options from "${product.name}"`,
    });
    return this.getProduct(productId);
  }

  async replaceSpecs(
    actor: SuperAdminJwtPayload,
    productId: string,
    specs: ShopProductSpecInputDto[],
  ) {
    const product = await this.requireProduct(productId);
    await this.prisma.$transaction([
      this.prisma.shopProductSpec.deleteMany({ where: { productId } }),
      this.prisma.shopProductSpec.createMany({
        data: specs.map((spec, index) => ({
          productId,
          label: spec.label.trim(),
          value: spec.value.trim(),
          sortOrder: index,
        })),
      }),
    ]);
    await this.activity.record(actor, {
      action: 'PRODUCT_SPECS_UPDATED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: productId,
      summary: `Updated specifications of "${product.name}"`,
    });
    return this.getProduct(productId);
  }

  // ---- Product gallery ----

  // All-or-nothing: every file is validated first, then every file is
  // stored, and only then are the rows written. If any storage write fails,
  // the files already written for this request are removed and nothing is
  // added — no half-uploaded gallery.
  async addProductImages(
    actor: SuperAdminJwtPayload,
    productId: string,
    files: WarehouseMediaUploadFile[],
  ) {
    const product = await this.requireProduct(productId);
    if (!files || files.length === 0) {
      throw new BadRequestException('Choose at least one image to upload');
    }

    const existing = await this.prisma.shopProductImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const room = MAX_PRODUCT_IMAGES - existing.length;
    if (files.length > room) {
      throw new BadRequestException(
        room <= 0
          ? `This product already has the maximum of ${MAX_PRODUCT_IMAGES} images. Remove one first.`
          : `A product can have up to ${MAX_PRODUCT_IMAGES} images — you can add ${room} more.`,
      );
    }

    files.forEach((file, i) => {
      try {
        validateImage(file);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'invalid image';
        throw new BadRequestException(
          `"${file.originalname || `Image ${i + 1}`}": ${reason}`,
        );
      }
    });

    const stored: { objectName: string; file: WarehouseMediaUploadFile }[] = [];
    try {
      for (const file of files) {
        // A fresh object name per upload, never overwrite-in-place, so a
        // cached old image can't be served for a new one.
        const objectName = `shop/products/${productId}/${randomUUID()}.${imageExtension(file.mimetype)}`;
        await this.images.save(objectName, file.buffer, file.mimetype);
        stored.push({ objectName, file });
      }
    } catch (error) {
      await Promise.all(stored.map((s) => this.images.remove(s.objectName)));
      throw error;
    }

    const startOrder = (existing[0]?.sortOrder ?? -1) + 1;
    await this.prisma.shopProductImage.createMany({
      data: stored.map((s, i) => ({
        productId,
        objectName: s.objectName,
        contentType: s.file.mimetype,
        sizeBytes: s.file.buffer.length,
        sortOrder: startOrder + i,
      })),
    });

    await this.activity.record(actor, {
      action: 'PRODUCT_IMAGES_ADDED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: productId,
      summary: `Added ${stored.length} image${stored.length === 1 ? '' : 's'} to "${product.name}"`,
    });
    return this.getProduct(productId);
  }

  async removeProductImage(
    actor: SuperAdminJwtPayload,
    productId: string,
    imageId: string,
  ) {
    const product = await this.requireProduct(productId);
    const image = await this.prisma.shopProductImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) throw new NotFoundException('Image not found on this product');

    const wasCover = await this.isCover(productId, imageId);
    await this.prisma.shopProductImage.delete({ where: { id: imageId } });
    await this.normalizeImageOrder(productId);
    await this.images.remove(image.objectName);

    await this.activity.record(actor, {
      action: 'PRODUCT_IMAGE_REMOVED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: productId,
      summary: `Removed ${wasCover ? 'the cover image' : 'an image'} from "${product.name}"`,
    });
    return this.getProduct(productId);
  }

  // imageIds must be exactly this product's images, in the new order. The
  // first one becomes the cover.
  async reorderProductImages(
    actor: SuperAdminJwtPayload,
    productId: string,
    imageIds: string[],
  ) {
    const product = await this.requireProduct(productId);
    const current = await this.prisma.shopProductImage.findMany({
      where: { productId },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    const currentIds = current.map((c) => c.id);
    const sameSet =
      imageIds.length === currentIds.length &&
      new Set(imageIds).size === imageIds.length &&
      imageIds.every((id) => currentIds.includes(id));
    if (!sameSet) {
      throw new BadRequestException(
        "imageIds must list every one of this product's images exactly once",
      );
    }

    await this.prisma.$transaction(
      imageIds.map((id, index) =>
        this.prisma.shopProductImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    const coverChanged = currentIds[0] !== imageIds[0];
    await this.activity.record(actor, {
      action: coverChanged
        ? 'PRODUCT_COVER_CHANGED'
        : 'PRODUCT_IMAGES_REORDERED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      entityId: productId,
      summary: coverChanged
        ? `Changed the cover image of "${product.name}"`
        : `Reordered images of "${product.name}"`,
    });
    return this.getProduct(productId);
  }

  async streamImage(imageId: string, response: Response) {
    const image = await this.prisma.shopProductImage.findUnique({
      where: { id: imageId },
      select: { objectName: true, contentType: true },
    });
    if (!image) throw new NotFoundException('Image not found');
    await this.images.stream(image.objectName, image.contentType, response);
  }

  async getProduct(productId: string) {
    const product = await this.prisma.shopProduct.findUnique({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.toProductResponse(product);
  }

  private async isCover(productId: string, imageId: string) {
    const first = await this.prisma.shopProductImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    return first?.id === imageId;
  }

  // Keeps sortOrder dense (0..n-1) after a removal so "first = cover" and
  // appends stay predictable.
  private async normalizeImageOrder(productId: string) {
    const rest = await this.prisma.shopProductImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true },
    });
    const updates = rest
      .map((img, index) => ({ ...img, index }))
      .filter((img) => img.sortOrder !== img.index)
      .map((img) =>
        this.prisma.shopProductImage.update({
          where: { id: img.id },
          data: { sortOrder: img.index },
        }),
      );
    if (updates.length) await this.prisma.$transaction(updates);
  }

  // ---- CSV import / export ----

  async exportProductsCsv(query: ListShopProductsQueryDto) {
    const products = await this.prisma.shopProduct.findMany({
      where: this.productWhere(query),
      orderBy: { createdAt: 'desc' },
      include: PRODUCT_INCLUDE,
    });
    return toCsv([
      [...CSV_HEADERS],
      ...products.map((product) => [
        product.name,
        product.category.name,
        product.sku,
        product.price.toFixed(2),
        product.stock,
        product.status,
        product.description,
      ]),
    ]);
  }

  // Rows update an existing product matched by SKU, or — for rows without a
  // SKU — by exact name (case-insensitive); anything unmatched is created. Categories are
  // matched by name (case-insensitive) and created when missing. All rows
  // are validated first; nothing is written unless every row is valid, so
  // a half-applied import can't leave the catalog in a mixed state.
  async importProductsCsv(actor: SuperAdminJwtPayload, csvText: string) {
    const rows = parseCsv(csvText);
    if (rows.length < 2) {
      throw new BadRequestException(
        'The CSV needs a header row and at least one product row.',
      );
    }

    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const index = Object.fromEntries(
      CSV_HEADERS.map((name) => [name, header.indexOf(name)]),
    ) as Record<(typeof CSV_HEADERS)[number], number>;
    for (const required of ['name', 'category', 'price'] as const) {
      if (index[required] === -1) {
        throw new BadRequestException(
          `Missing required column "${required}". Expected columns: ${CSV_HEADERS.join(', ')}`,
        );
      }
    }

    const dataRows = rows.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Import is limited to ${MAX_IMPORT_ROWS} rows per file.`,
      );
    }

    const cell = (row: string[], column: (typeof CSV_HEADERS)[number]) =>
      index[column] === -1 ? '' : (row[index[column]] ?? '').trim();

    const errors: string[] = [];
    const parsed = dataRows.map((row, i) => {
      const line = i + 2;
      const name = cell(row, 'name');
      const categoryName = cell(row, 'category');
      const priceText = cell(row, 'price');
      const stockText = cell(row, 'stock');
      const statusText = cell(row, 'status').toUpperCase();
      const price = Number(priceText);
      const stock = stockText === '' ? 0 : Number(stockText);

      if (!name) errors.push(`Row ${line}: name is required`);
      if (!categoryName) errors.push(`Row ${line}: category is required`);
      if (priceText === '' || !Number.isFinite(price) || price < 0) {
        errors.push(`Row ${line}: price must be a number ≥ 0`);
      }
      if (!Number.isInteger(stock) || stock < 0) {
        errors.push(`Row ${line}: stock must be a whole number ≥ 0`);
      }
      if (
        statusText &&
        statusText !== ShopProductStatus.ACTIVE &&
        statusText !== ShopProductStatus.DRAFT
      ) {
        errors.push(`Row ${line}: status must be ACTIVE or DRAFT`);
      }

      return {
        name,
        categoryName,
        sku: cell(row, 'sku') || null,
        description: cell(row, 'description') || null,
        price,
        stock,
        status: (statusText || ShopProductStatus.DRAFT) as ShopProductStatus,
      };
    });

    const skuCounts = new Map<string, number>();
    parsed.forEach((p) => {
      if (p.sku) skuCounts.set(p.sku, (skuCounts.get(p.sku) ?? 0) + 1);
    });
    skuCounts.forEach((count, sku) => {
      if (count > 1)
        errors.push(`SKU "${sku}" appears ${count} times in the file`);
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Import rejected — fix these rows and try again.',
        errors: errors.slice(0, 50),
      });
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const categories = await tx.shopCategory.findMany();
        const categoryByName = new Map(
          categories.map((c) => [c.name.toLowerCase(), c]),
        );
        let createdCategories = 0;
        let created = 0;
        let updated = 0;

        for (const row of parsed) {
          let category = categoryByName.get(row.categoryName.toLowerCase());
          if (!category) {
            category = await tx.shopCategory.create({
              data: {
                name: row.categoryName,
                slug: await this.uniqueCategorySlug(
                  row.categoryName,
                  undefined,
                  tx,
                ),
              },
            });
            categoryByName.set(row.categoryName.toLowerCase(), category);
            createdCategories += 1;
          }

          // Match by SKU when the row has one; otherwise by exact name
          // (case-insensitive) — so re-importing the same file updates
          // rows instead of duplicating every SKU-less product.
          const existing = row.sku
            ? await tx.shopProduct.findUnique({ where: { sku: row.sku } })
            : await tx.shopProduct.findFirst({
                where: { name: { equals: row.name, mode: 'insensitive' } },
                orderBy: { createdAt: 'asc' },
              });

          if (existing) {
            await tx.shopProduct.update({
              where: { id: existing.id },
              data: {
                name: row.name,
                ...(row.name !== existing.name
                  ? {
                      slug: await this.uniqueProductSlug(
                        row.name,
                        existing.id,
                        tx,
                      ),
                    }
                  : {}),
                categoryId: category.id,
                description: row.description,
                price: new Prisma.Decimal(row.price),
                // Products with options track stock per option; the CSV's
                // single stock column can't say which option it means.
                ...((await tx.shopProductVariant.count({
                  where: { productId: existing.id },
                })) > 0
                  ? {}
                  : { stock: row.stock }),
                status: row.status,
              },
            });
            updated += 1;
          } else {
            await tx.shopProduct.create({
              data: {
                name: row.name,
                slug: await this.uniqueProductSlug(row.name, undefined, tx),
                categoryId: category.id,
                sku: row.sku,
                description: row.description,
                price: new Prisma.Decimal(row.price),
                stock: row.stock,
                status: row.status,
              },
            });
            created += 1;
          }
        }

        return { created, updated, createdCategories };
      },
      { timeout: 60_000 },
    );

    await this.activity.record(actor, {
      action: 'PRODUCTS_IMPORTED',
      entityType: ActivityEntity.SHOP_PRODUCT,
      summary: `Imported products from CSV: ${result.created} created, ${result.updated} updated, ${result.createdCategories} new categories`,
      metadata: result,
    });
    return result;
  }

  // ---- Dashboard ----

  async catalogSummary() {
    const [
      totalProducts,
      activeProducts,
      totalCategories,
      lowStockItems,
      lowStockCount,
    ] = await Promise.all([
      this.prisma.shopProduct.count(),
      this.prisma.shopProduct.count({
        where: { status: ShopProductStatus.ACTIVE },
      }),
      this.prisma.shopCategory.count(),
      this.prisma.shopProduct.findMany({
        where: { stock: { lt: LOW_STOCK_THRESHOLD } },
        orderBy: { stock: 'asc' },
        select: { id: true, name: true, stock: true },
        take: 10,
      }),
      this.prisma.shopProduct.count({
        where: { stock: { lt: LOW_STOCK_THRESHOLD } },
      }),
    ]);

    return {
      totalProducts,
      activeProducts,
      totalCategories,
      lowStockCount,
      lowStockItems,
    };
  }

  // ---- Helpers ----

  private productWhere(
    query: ListShopProductsQueryDto,
  ): Prisma.ShopProductWhereInput {
    return {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private async assertSkuAvailable(sku: string | undefined, ignoreId?: string) {
    const value = sku?.trim();
    if (!value) return;
    const taken = await this.prisma.shopProduct.findFirst({
      where: { sku: value, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { name: true },
    });
    if (taken) {
      throw new ConflictException(
        `SKU "${value}" is already used by "${taken.name}"`,
      );
    }
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.shopCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.shopProduct.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async uniqueCategorySlug(
    value: string,
    ignoreId?: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const base = slugify(value) || 'category';
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const found = await client.shopCategory.findFirst({
        where: { slug, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
        select: { id: true },
      });
      if (!found) return slug;
    }
    throw new ConflictException('Unable to generate a unique category slug');
  }

  private async uniqueProductSlug(
    value: string,
    ignoreId?: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const base = slugify(value) || 'product';
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const found = await client.shopProduct.findFirst({
        where: { slug, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
        select: { id: true },
      });
      if (!found) return slug;
    }
    throw new ConflictException('Unable to generate a unique product slug');
  }

  private toCategoryResponse(category: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    _count: { products: number };
  }) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      isActive: category.isActive,
      sortOrder: category.sortOrder,
      productCount: category._count.products,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }

  private toProductResponse(product: ProductWithCategory) {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      description: product.description,
      price: product.price.toFixed(2),
      compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
      unitLabel: product.unitLabel,
      isFeatured: product.isFeatured,
      stock: product.stock,
      lowStock: product.stock < LOW_STOCK_THRESHOLD,
      status: product.status,
      category: product.category,
      variants: product.variants.map((v) => ({
        id: v.id,
        size: v.size,
        color: v.color,
        colorHex: v.colorHex,
        sku: v.sku,
        price: v.price?.toFixed(2) ?? null,
        compareAtPrice: v.compareAtPrice?.toFixed(2) ?? null,
        stock: v.stock,
        isActive: v.isActive,
      })),
      specs: product.specs,
      // Ordered gallery; the first image is the cover. Image ids are unique
      // per upload, so URLs never need cache-busting.
      images: product.images.map((image) => ({
        id: image.id,
        url: `/shop-media/images/${image.id}`,
      })),
      imageUrl: product.images[0]
        ? `/shop-media/images/${product.images[0].id}`
        : null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }
}

function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T)[],
) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes[field as string] = { from: before[field], to: after[field] };
    }
  }
  return changes as Prisma.InputJsonValue;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function imageExtension(contentType: string) {
  return contentType === 'image/jpeg'
    ? 'jpg'
    : contentType === 'image/png'
      ? 'png'
      : 'webp';
}
