import { createHash } from 'node:crypto';
import { CourierCostsService } from './courier-costs.service';
import {
  expenseDateWhere,
  expenseInstant,
  expenseRange,
  dateInZone,
  monthInZone,
} from './expense-date.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseGroup, MediaAssetPurpose, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { StoreAccess } from '../access/store-access.service';
import {
  MediaService,
  type WarehouseMediaUploadFile,
} from '../warehouse/media.service';
import {
  attachReceipt,
  receiptPreviewPath,
} from '../common/media/attach-receipt.util';
import {
  isForeignKeyConstraintError,
  isUniqueConstraintError,
} from '../common/prisma-errors.util';
import { calculateTrend, lastNMonthKeys } from '../common/trend.util';
import {
  CreateExpenseCategoryDto,
  ExpenseCategoryResponseDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-category.dto';
import {
  CreateExpenseDto,
  ExpenseListQueryDto,
  ExpenseListResponseDto,
  ExpenseReceiptResponseDto,
  ExpenseResponseDto,
  ExpenseSummaryQueryDto,
  ExpenseSummaryResponseDto,
  UpdateExpenseDto,
  ExpenseTrendQueryDto,
  ExpenseTrendResponseDto,
} from './dto/expense.dto';
import { AdsSpendService } from '../ads/ads-spend.service';
import {
  AdSpendResponseDto,
  toAdSpendResponse,
  toUnconvertedDto,
} from '../ads/dto/ad-spend.dto';

const EXPENSE_INCLUDE = {
  category: true,
  salaryPayment: { select: { id: true } },
  merchantPurchase: { select: { id: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{
  include: typeof EXPENSE_INCLUDE;
}>;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly adsSpend: AdsSpendService,
    private readonly courierCosts: CourierCostsService,
  ) {}

  // ---- Receipts (shared by Expenses and Staff Salary Payments) ----------

  /**
   * Uploads a private receipt photo, unattached. The returned id is passed
   * as receiptAssetId when creating an expense or a manual salary payment,
   * which attaches it (and clears its 24h TTL) in the same write.
   */
  async uploadReceipt(
    access: StoreAccess,
    file?: WarehouseMediaUploadFile,
  ): Promise<ExpenseReceiptResponseDto> {
    const asset = await this.media.uploadForStore(
      access.storeId,
      MediaAssetPurpose.RECEIPT,
      file,
    );
    return {
      id: asset.id,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      previewPath: receiptPreviewPath(asset.id),
      expiresAt: asset.expiresAt,
    };
  }

  async streamReceipt(
    access: StoreAccess,
    assetId: string,
    response: Response,
  ): Promise<void> {
    return this.media.streamForStore(access.storeId, assetId, response);
  }

  // ---- Categories -------------------------------------------------------

  async listCategories(storeId: string): Promise<ExpenseCategoryResponseDto[]> {
    const categories = await this.prisma.expenseCategory.findMany({
      where: { storeId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return categories.map(toCategoryResponse);
  }

  async createCategory(
    storeId: string,
    dto: CreateExpenseCategoryDto,
  ): Promise<ExpenseCategoryResponseDto> {
    // SALARY is exclusively system-managed: resolveSalaryCategoryId() picks
    // "the" SALARY category for a store with a plain findFirst. A second,
    // user-created SALARY category would make that pick nondeterministic —
    // some salary expenses could land in the wrong one. And a category that
    // can never receive a directly-created expense (rejectSalaryCategory in
    // create()/update() below) is a dead end for the owner anyway.
    if (isSystemManagedGroup(dto.group ?? ExpenseGroup.OTHER)) {
      throw new ConflictException(
        'Shipping, advertising, purchase, and salary categories are managed by their source modules and cannot be created directly.',
      );
    }

    const existing = await this.prisma.expenseCategory.findUnique({
      where: { storeId_name: { storeId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException('A category with this name already exists');
    }

    try {
      const category = await this.prisma.expenseCategory.create({
        data: {
          storeId,
          name: dto.name,
          group: dto.group ?? ExpenseGroup.OTHER,
          icon: dto.icon ?? null,
          color: dto.color ?? null,
        },
      });
      return toCategoryResponse(category);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A category with this name already exists');
      }
      throw err;
    }
  }

  async updateCategory(
    storeId: string,
    categoryId: string,
    dto: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategoryResponseDto> {
    const category = await this.requireCategory(storeId, categoryId);

    // Allow a no-op resubmission of the seeded SALARY category's own group,
    // but never let a DIFFERENT category be reassigned into SALARY — same
    // "only one SALARY category, resolved deterministically" reasoning as
    // createCategory().
    if (
      dto.group &&
      isSystemManagedGroup(dto.group) &&
      dto.group !== category.group
    ) {
      throw new ConflictException(
        'System-managed expense groups cannot be assigned to or removed from a custom category.',
      );
    }
    if (category.isSystem && dto.group && dto.group !== category.group) {
      throw new ConflictException(
        'System expense categories cannot change groups.',
      );
    }

    if (dto.name && dto.name !== category.name) {
      const clash = await this.prisma.expenseCategory.findUnique({
        where: { storeId_name: { storeId, name: dto.name } },
      });
      if (clash) {
        throw new ConflictException('A category with this name already exists');
      }
    }

    try {
      const updated = await this.prisma.expenseCategory.update({
        where: { id: categoryId },
        data: {
          name: dto.name,
          group: dto.group,
          icon: dto.icon,
          color: dto.color,
        },
      });
      return toCategoryResponse(updated);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A category with this name already exists');
      }
      throw err;
    }
  }

  async removeCategory(storeId: string, categoryId: string): Promise<void> {
    const category = await this.requireCategory(storeId, categoryId);
    if (category.isSystem) {
      throw new ConflictException('System categories cannot be deleted');
    }

    const inUse = await this.prisma.expense.count({ where: { categoryId } });
    if (inUse > 0) {
      throw new ConflictException(
        'This category has expenses recorded against it. Move or delete them first.',
      );
    }

    try {
      await this.prisma.expenseCategory.delete({ where: { id: categoryId } });
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        throw new ConflictException(
          'This category has expenses recorded against it. Move or delete them first.',
        );
      }
      throw err;
    }
  }

  // ---- Expenses -----------------------------------------------------------

  async list(
    storeId: string,
    query: ExpenseListQueryDto,
  ): Promise<ExpenseListResponseDto> {
    expenseRange(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ExpenseWhereInput = {
      storeId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.group ? { category: { group: query.group } } : {}),
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' } }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            spentAt: {
              ...expenseDateWhere(query),
            },
          }
        : {}),
    };

    const [expenses, total, aggregate] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: { spentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      expenses: expenses.map(toExpenseResponse),
      total,
      totalAmount: (aggregate._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      page,
      limit,
    };
  }

  async summary(
    storeId: string,
    query: ExpenseSummaryQueryDto,
  ): Promise<ExpenseSummaryResponseDto> {
    expenseRange(query);
    const where: Prisma.ExpenseWhereInput = {
      storeId,
      ...(query.dateFrom || query.dateTo
        ? {
            spentAt: {
              ...expenseDateWhere(query),
            },
          }
        : {}),
    };

    const [expenses, adSpend, shipping] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        select: { amount: true, category: { select: { group: true } } },
      }),
      this.requireStore(storeId).then((store) =>
        this.adsSpend.getTotals(store, toAdSpendRange(query)),
      ),
      this.requireStore(storeId).then((store) =>
        this.courierCosts.getTotals(store, query),
      ),
    ]);

    const totals = new Map<ExpenseGroup, Prisma.Decimal>();
    let totalAmount = new Prisma.Decimal(0);
    for (const expense of expenses) {
      const group = expense.category.group;
      totals.set(
        group,
        (totals.get(group) ?? new Prisma.Decimal(0)).plus(expense.amount),
      );
      totalAmount = totalAmount.plus(expense.amount);
    }
    totals.set(
      ExpenseGroup.ADS,
      (totals.get(ExpenseGroup.ADS) ?? new Prisma.Decimal(0)).plus(
        adSpend.spend,
      ),
    );
    totals.set(
      ExpenseGroup.SHIPPING,
      (totals.get(ExpenseGroup.SHIPPING) ?? new Prisma.Decimal(0)).plus(
        shipping.total,
      ),
    );
    totalAmount = totalAmount.plus(adSpend.spend).plus(shipping.total);

    return {
      totalAmount: totalAmount.toFixed(2),
      byGroup: Object.values(ExpenseGroup).map((group) => ({
        group,
        total: (totals.get(group) ?? new Prisma.Decimal(0)).toFixed(2),
      })),
      unconvertedAdSpend: toUnconvertedDto(adSpend.unconverted),
      unconvertedShippingCosts: toUnconvertedDto(shipping.unconverted),
    };
  }

  /** Ad spend breakdown by platform and account (the "Ad spend" category). */
  async adSpend(
    storeId: string,
    query: ExpenseSummaryQueryDto,
  ): Promise<AdSpendResponseDto> {
    expenseRange(query);
    const store = await this.requireStore(storeId);
    return toAdSpendResponse(
      await this.adsSpend.getTotals(store, toAdSpendRange(query)),
    );
  }

  /** Monthly totals for the Expenses trend/line chart. */
  async trend(
    storeId: string,
    query: ExpenseTrendQueryDto,
  ): Promise<ExpenseTrendResponseDto> {
    const months = query.months ?? 6;
    const timezone = query.timezone ?? 'UTC';
    const currentMonth = monthInZone(new Date(), timezone);
    const reference = new Date(`${currentMonth}-15T12:00:00Z`);
    const keys = lastNMonthKeys(months, reference);
    const since = dateInZone(`${keys[0]}-01`, timezone);
    const next = new Date(`${currentMonth}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const until = dateInZone(next.toISOString().slice(0, 10), timezone);

    const [expenses, adSpend, shipping] = await Promise.all([
      this.prisma.expense.findMany({
        where: { storeId, spentAt: { gte: since, lt: until } },
        select: { amount: true, spentAt: true },
      }),
      this.requireStore(storeId).then((store) =>
        timezone === 'UTC'
          ? this.adsSpend.getMonthly(store, since)
          : this.adsSpend.getMonthly(store, since, `${keys[0]}-01`),
      ),
      this.requireStore(storeId).then((store) =>
        this.courierCosts.getMonthly(store, since, timezone, until),
      ),
    ]);

    const totals = new Map<string, Prisma.Decimal>(adSpend.byMonth);
    for (const expense of expenses) {
      const key = monthInZone(expense.spentAt, timezone);
      totals.set(
        key,
        (totals.get(key) ?? new Prisma.Decimal(0)).plus(expense.amount),
      );
    }

    for (const [month, amount] of shipping.byMonth)
      totals.set(
        month,
        (totals.get(month) ?? new Prisma.Decimal(0)).plus(amount),
      );
    const points = keys.map((month) => ({
      month,
      total: (totals.get(month) ?? new Prisma.Decimal(0)).toFixed(2),
    }));

    const current = Number(points[points.length - 1]?.total ?? 0);
    const previous = Number(points[points.length - 2]?.total ?? 0);

    return {
      points,
      trend: calculateTrend(current, previous),
      timezone,
      unconvertedShippingCosts: toUnconvertedDto(shipping.unconverted),
      unconvertedAdSpend: toUnconvertedDto(adSpend.unconverted),
    };
  }

  async create(
    access: StoreAccess,
    dto: CreateExpenseDto,
    headerKey?: string,
  ): Promise<ExpenseResponseDto> {
    if (
      headerKey !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(headerKey)
    )
      throw new BadRequestException(
        'Idempotency-Key must contain 8–100 letters, digits, dots, underscores, colons or hyphens',
      );
    if (headerKey && dto.idempotencyKey && headerKey !== dto.idempotencyKey)
      throw new BadRequestException(
        'Body and header idempotency keys must match',
      );
    const key = headerKey ?? dto.idempotencyKey;
    const spentAt = expenseInstant(dto.spentAt, dto.timezone);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          title: dto.title.trim(),
          amount: new Prisma.Decimal(dto.amount).toFixed(2),
          paymentMethod: dto.paymentMethod,
          spentAt: spentAt.toISOString(),
          categoryId: dto.categoryId,
          notes: dto.notes ?? null,
          receipt: dto.receiptAssetId
            ? { asset: dto.receiptAssetId }
            : { url: dto.receiptUrl ?? null },
        }),
      )
      .digest('hex');
    const expense = await this.prisma.$transaction(async (tx) => {
      if (key) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`expense:${access.storeId}:${key}`}, 0))::text`;
        const prior = await tx.expenseCreateRequest.findUnique({
          where: {
            storeId_idempotencyKey: {
              storeId: access.storeId,
              idempotencyKey: key,
            },
          },
          include: { expense: { include: EXPENSE_INCLUDE } },
        });
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new ConflictException(
              'Idempotency key was already used with different expense data',
            );
          if (!prior.expense)
            throw new ConflictException(
              'This expense was deleted; use a new key for a new expense',
            );
          return prior.expense;
        }
      }
      const category = await tx.expenseCategory.findFirst({
        where: { id: dto.categoryId, storeId: access.storeId },
      });
      if (!category) throw new NotFoundException('Expense category not found');
      this.rejectSalaryCategory(category.group);
      this.rejectPurchaseCategory(category.group);
      const created = await tx.expense.create({
        data: {
          storeId: access.storeId,
          title: dto.title,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          spentAt,
          categoryId: dto.categoryId,
          notes: dto.notes ?? null,
          receiptUrl: dto.receiptAssetId
            ? receiptPreviewPath(dto.receiptAssetId)
            : (dto.receiptUrl ?? null),
          createdByUserId: access.userId,
        },
      });

      if (dto.receiptAssetId) {
        await attachReceipt(tx, access.storeId, dto.receiptAssetId, {
          expenseId: created.id,
        });
      }

      if (key)
        await tx.expenseCreateRequest.create({
          data: {
            storeId: access.storeId,
            idempotencyKey: key,
            requestHash,
            expenseId: created.id,
          },
        });
      return tx.expense.findUniqueOrThrow({
        where: { id: created.id },
        include: EXPENSE_INCLUDE,
      });
    });

    return toExpenseResponse(expense);
  }

  async details(
    storeId: string,
    expenseId: string,
  ): Promise<ExpenseResponseDto> {
    return toExpenseResponse(await this.requireExpense(storeId, expenseId));
  }

  async update(
    access: StoreAccess,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    const expense = await this.requireExpense(access.storeId, expenseId);
    this.rejectIfSalaryGenerated(expense);
    this.rejectIfPurchaseGenerated(expense);

    if (dto.categoryId && dto.categoryId !== expense.categoryId) {
      const category = await this.requireCategory(
        access.storeId,
        dto.categoryId,
      );
      this.rejectSalaryCategory(category.group);
      this.rejectPurchaseCategory(category.group);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expenseId} FOR UPDATE`;
      const currentExpense = await tx.expense.findFirst({
        where: { id: expenseId, storeId: access.storeId },
        include: EXPENSE_INCLUDE,
      });
      if (!currentExpense) throw new NotFoundException('Expense not found');
      this.rejectIfSalaryGenerated(currentExpense);
      this.rejectIfPurchaseGenerated(currentExpense);
      const currentReceipt = await tx.mediaAsset.findUnique({
        where: { expenseId },
        select: { id: true },
      });
      const replaces =
        dto.receiptAssetId !== undefined &&
        dto.receiptAssetId !== currentReceipt?.id;
      // Clearing or replacing a receipt URL detaches its owned upload atomically.
      const detaches =
        replaces ||
        (dto.receiptAssetId === undefined && dto.receiptUrl !== undefined);
      if (detaches && currentReceipt)
        await tx.mediaAsset.update({
          where: { id: currentReceipt.id },
          data: { expenseId: null },
        });
      if (replaces && dto.receiptAssetId)
        await attachReceipt(tx, access.storeId, dto.receiptAssetId, {
          expenseId,
        });
      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: {
          title: dto.title,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          spentAt: dto.spentAt
            ? expenseInstant(dto.spentAt, dto.timezone)
            : undefined,
          categoryId: dto.categoryId,
          notes: dto.notes,
          receiptUrl: dto.receiptAssetId
            ? receiptPreviewPath(dto.receiptAssetId)
            : dto.receiptUrl,
        },
        include: EXPENSE_INCLUDE,
      });
      return { updated, previousReceipt: detaches ? currentReceipt : null };
    });
    if (result.previousReceipt)
      await this.media
        .deleteAttachedAsset(result.previousReceipt.id)
        .catch(() => undefined);
    const updated = result.updated;

    return toExpenseResponse(updated);
  }

  async remove(access: StoreAccess, expenseId: string): Promise<void> {
    const receipt = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expenseId} FOR UPDATE`;
      const expense = await tx.expense.findFirst({
        where: { id: expenseId, storeId: access.storeId },
        include: EXPENSE_INCLUDE,
      });
      if (!expense) throw new NotFoundException('Expense not found');
      this.rejectIfSalaryGenerated(expense);
      this.rejectIfPurchaseGenerated(expense);
      const attached = await tx.mediaAsset.findUnique({
        where: { expenseId },
        select: { id: true },
      });
      await tx.expense.delete({ where: { id: expenseId } });
      return attached;
    });
    if (receipt)
      await this.media.deleteAttachedAsset(receipt.id).catch(() => undefined);
  }

  private rejectSalaryCategory(group: ExpenseGroup): void {
    if (group === ExpenseGroup.SHIPPING || group === ExpenseGroup.ADS)
      throw new ConflictException(
        'Shipping and advertising costs are managed by their source modules',
      );
    if (group === ExpenseGroup.SALARY) {
      throw new ConflictException(
        'Salary expenses are recorded from Staff Salary, not created directly here.',
      );
    }
  }

  private rejectPurchaseCategory(group: ExpenseGroup): void {
    if (group === ExpenseGroup.PURCHASES) {
      throw new ConflictException(
        'Purchase costs are recorded from Purchases, not created directly here.',
      );
    }
  }

  private rejectIfPurchaseGenerated(expense: {
    merchantPurchase: { id: string } | null;
  }): void {
    if (expense.merchantPurchase) {
      throw new ConflictException(
        'This expense comes from a purchase — edit or delete the purchase instead.',
      );
    }
  }

  private rejectIfSalaryGenerated(expense: {
    staffMemberId: string | null;
  }): void {
    if (expense.staffMemberId) {
      throw new ConflictException(
        'This expense is linked to a confirmed salary payment and cannot be edited or deleted.',
      );
    }
  }

  private async requireStore(
    storeId: string,
  ): Promise<{ id: string; baseCurrency: string }> {
    return this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { id: true, baseCurrency: true },
    });
  }

  private async requireCategory(storeId: string, categoryId: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, storeId },
    });
    if (!category) {
      throw new NotFoundException('Expense category not found');
    }
    return category;
  }

  private async requireExpense(
    storeId: string,
    expenseId: string,
  ): Promise<ExpenseWithCategory> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, storeId },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    return expense;
  }
}

function isSystemManagedGroup(group: ExpenseGroup): boolean {
  return (
    [
      ExpenseGroup.SHIPPING,
      ExpenseGroup.ADS,
      ExpenseGroup.PURCHASES,
      ExpenseGroup.SALARY,
    ] as ExpenseGroup[]
  ).includes(group);
}

// Ad spend is stored per day, so date-times are widened to whole days.
function toAdSpendRange(query: { dateFrom?: string; dateTo?: string }) {
  return {
    from: query.dateFrom ? query.dateFrom.slice(0, 10) : null,
    to: query.dateTo ? query.dateTo.slice(0, 10) : null,
  };
}

function toCategoryResponse(category: {
  id: string;
  name: string;
  group: ExpenseGroup;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
}): ExpenseCategoryResponseDto {
  return {
    id: category.id,
    name: category.name,
    group: category.group,
    icon: category.icon,
    color: category.color,
    isSystem: category.isSystem,
  };
}

function toExpenseResponse(expense: ExpenseWithCategory): ExpenseResponseDto {
  return {
    id: expense.id,
    title: expense.title,
    amount: expense.amount.toFixed(2),
    paymentMethod: expense.paymentMethod,
    spentAt: expense.spentAt.toISOString(),
    notes: expense.notes,
    receiptUrl: expense.receiptUrl,
    category: toCategoryResponse(expense.category),
    staffMemberId: expense.staffMemberId,
    salaryPaymentId: expense.salaryPayment?.id ?? null,
    isSalaryGenerated: expense.staffMemberId !== null,
    purchaseId: expense.merchantPurchase?.id ?? null,
    isPurchaseGenerated: Boolean(expense.merchantPurchase),
    createdAt: expense.createdAt.toISOString(),
  };
}
