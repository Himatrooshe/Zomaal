import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import {
  defaultExpenseCategorySeeds,
  defaultRoleSeeds,
} from '../access/store-defaults.util';
import { StoreAccessService } from '../access/store-access.service';
import { SubscriptionService } from '../billing/subscription.service';

const DEFAULT_COUNTRY = 'Morocco';

@Injectable()
export class StoresService {
  constructor(
    private prisma: PrismaService,
    private storeAccess: StoreAccessService,
    private subscriptions: SubscriptionService,
  ) {}

  async create(userId: string, createStoreDto: CreateStoreDto) {
    // Staff cannot create additional stores under someone else's account.
    const staff = await this.prisma.staffMember.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (staff) {
      throw new ConflictException(
        'Staff members cannot create stores; ask the store owner',
      );
    }

    // Q17.6: Starter = one store; Pro = multiple businesses.
    await this.subscriptions.assertCanCreateStore(userId);

    const { baseCurrency, country = DEFAULT_COUNTRY, ...rest } = createStoreDto;
    // First store completes onboarding; every new store becomes the active one
    // so the Create Store / Add New Store flow lands on the store just made.
    // One transaction: a store must never exist with onboarding still false.
    const store = await this.prisma.$transaction(async (tx) => {
      const created = await tx.store.create({
        data: {
          ...rest,
          country,
          ...(baseCurrency !== undefined && {
            baseCurrency: baseCurrency.toUpperCase(),
          }),
          userId,
          roles: { create: defaultRoleSeeds() },
          expenseCategories: { create: defaultExpenseCategorySeeds() },
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { onboardingComplete: true, activeStoreId: created.id },
      });
      return created;
    });
    await this.subscriptions.startTrialIfMissing(userId);

    return this.toResponse(store, true);
  }

  /** Active (current) store — Settings header + Store Information screen. */
  async findCurrent(userId: string) {
    const access = await this.storeAccess.requireOwner(userId);
    const store = await this.prisma.store.findUnique({
      where: { id: access.storeId },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return this.toResponse(store, true);
  }

  /** Figma "Your Stores" list — every store the owner owns. */
  async list(userId: string) {
    await this.storeAccess.requireOwner(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeStoreId: true },
    });
    const stores = await this.prisma.store.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      data: stores.map((s) => this.toResponse(s, s.id === user?.activeStoreId)),
    };
  }

  async update(userId: string, updateStoreDto: UpdateStoreDto) {
    const access = await this.storeAccess.requireOwner(userId);
    const { baseCurrency, ...rest } = updateStoreDto;
    if (Object.keys(rest).length === 0 && baseCurrency === undefined) {
      throw new BadRequestException('Provide at least one field to update');
    }

    const store = await this.prisma.store.update({
      where: { id: access.storeId },
      data: {
        ...rest,
        ...(baseCurrency !== undefined && {
          baseCurrency: baseCurrency.toUpperCase(),
        }),
      },
    });
    return this.toResponse(store, true);
  }

  /** Switch the Settings / app context to another owned store. */
  async select(userId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, userId },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { activeStoreId: store.id },
    });

    return this.toResponse(store, true);
  }

  /**
   * Permanently deletes one owned store (Figma store-list Delete). Cascades
   * store-scoped data. Refuses to delete the last store — use Delete Account
   * instead. If the deleted store was active, switches to another owned store.
   */
  async remove(userId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, userId },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Serialize destructive store operations per owner; a second concurrent
      // delete must recheck the last-store rule after the first commits.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const count = await tx.store.count({ where: { userId } });
      if (count <= 1)
        throw new BadRequestException(
          'Cannot delete your only store; use Delete Account instead',
        );
      if (!(await tx.store.findFirst({ where: { id: storeId, userId } })))
        throw new NotFoundException('Store not found');
      // Inventory journals remain immutable during normal operation. Explicit
      // owner-authorized STORE deletion removes its journals before their
      // RESTRICT-protected items/locations. Every predicate is store-scoped.
      await tx.inventoryMovement.deleteMany({
        where: { inventoryItem: { storeId } },
      });
      await tx.productBundleComponent.deleteMany({
        where: { bundleProduct: { storeId } },
      });
      await tx.productGift.deleteMany({ where: { product: { storeId } } });
      await tx.productPackagingRequirement.deleteMany({
        where: { product: { storeId } },
      });
      await tx.warehouseProduct.deleteMany({ where: { storeId } });
      await tx.expense.deleteMany({ where: { storeId } });
      await tx.store.delete({ where: { id: storeId } });
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { activeStoreId: true },
      });
      if (!user?.activeStoreId || user.activeStoreId === storeId) {
        const next = await tx.store.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        await tx.user.update({
          where: { id: userId },
          data: { activeStoreId: next?.id ?? null },
        });
      }
    });

    return { message: 'Store deleted successfully' };
  }

  private toResponse(
    store: {
      id: string;
      ownerName: string;
      ownerPhotoUrl: string | null;
      businessName: string;
      address: string;
      city: string;
      country: string;
      logoUrl: string | null;
      isActive: boolean;
      baseCurrency: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
    },
    isCurrent: boolean,
  ) {
    return {
      id: store.id,
      ownerName: store.ownerName,
      ownerPhotoUrl: store.ownerPhotoUrl,
      businessName: store.businessName,
      address: store.address,
      city: store.city,
      country: store.country,
      logoUrl: store.logoUrl,
      isActive: store.isActive,
      baseCurrency: store.baseCurrency,
      isCurrent,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
      userId: store.userId,
    };
  }
}
