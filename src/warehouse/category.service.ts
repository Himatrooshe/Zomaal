import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductCategoryDto,
  UpdateProductCategoryDto,
} from './dto/category.dto';
import { WarehouseStoreService } from './warehouse-store.service';

@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
  ) {}

  async create(userId: string, dto: CreateProductCategoryDto) {
    const store = await this.stores.requireStore(userId);
    if (dto.parentId) {
      await this.requireCategory(store.id, dto.parentId);
    }
    return this.prisma.productCategory.create({
      data: {
        storeId: store.id,
        name: dto.name.trim(),
        slug: await this.uniqueSlug(store.id, dto.name),
        description: dto.description?.trim() || null,
        parentId: dto.parentId,
        position: dto.position ?? 0,
      },
    });
  }

  async list(userId: string, includeInactive = false) {
    const store = await this.stores.requireStore(userId);
    return this.prisma.productCategory.findMany({
      where: {
        storeId: store.id,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
  }

  async update(
    userId: string,
    categoryId: string,
    dto: UpdateProductCategoryDto,
  ) {
    const store = await this.stores.requireStore(userId);
    const category = await this.requireCategory(store.id, categoryId);
    if (dto.parentId === category.id) {
      throw new ConflictException('A category cannot be its own parent');
    }
    if (dto.parentId) {
      await this.requireCategory(store.id, dto.parentId);
      await this.assertNoCycle(store.id, category.id, dto.parentId);
    }
    return this.prisma.productCategory.update({
      where: { id: category.id },
      data: {
        ...(dto.name === undefined
          ? {}
          : {
              name: dto.name.trim(),
              slug: await this.uniqueSlug(store.id, dto.name, category.id),
            }),
        ...(dto.description === undefined
          ? {}
          : { description: dto.description.trim() || null }),
        ...(dto.parentId === undefined ? {} : { parentId: dto.parentId }),
        ...(dto.position === undefined ? {} : { position: dto.position }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
  }

  async archive(userId: string, categoryId: string) {
    const store = await this.stores.requireStore(userId);
    const category = await this.requireCategory(store.id, categoryId);
    return this.prisma.productCategory.update({
      where: { id: category.id },
      data: { isActive: false },
    });
  }

  private async requireCategory(storeId: string, id: string) {
    const category = await this.prisma.productCategory.findFirst({
      where: { id, storeId },
    });
    if (!category) {
      throw new NotFoundException('Product category not found');
    }
    return category;
  }

  private async assertNoCycle(
    storeId: string,
    categoryId: string,
    proposedParentId: string,
  ) {
    const visited = new Set<string>();
    let cursor: string | null = proposedParentId;
    while (cursor) {
      if (cursor === categoryId || visited.has(cursor)) {
        throw new ConflictException(
          'Category hierarchy cannot contain a cycle',
        );
      }
      visited.add(cursor);
      const parent: { parentId: string | null } | null =
        await this.prisma.productCategory.findFirst({
          where: { id: cursor, storeId },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }

  private async uniqueSlug(storeId: string, value: string, ignoreId?: string) {
    const base = slugify(value) || 'category';
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const found = await this.prisma.productCategory.findFirst({
        where: {
          storeId,
          slug,
          ...(ignoreId ? { id: { not: ignoreId } } : {}),
        },
        select: { id: true },
      });
      if (!found) return slug;
    }
    throw new ConflictException('Unable to generate a unique category slug');
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
