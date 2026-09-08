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
import { MediaService, type WarehouseMediaUploadFile } from '../warehouse/media.service';
import { attachReceipt, receiptPreviewPath } from '../common/media/attach-receipt.util';
import {
  isForeignKeyConstraintError,
  isUniqueConstraintError,
} from '../common/prisma-errors.util';
import { calculateTrend, lastNMonthKeys, monthKey, monthsAgoStart } from '../common/trend.util';
import {
  MonthlyTrendQueryDto,
  MonthlyTrendResponseDto,
} from '../common/dto/monthly-trend.dto';
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
} from './dto/expense.dto';

const EXPENSE_INCLUDE = {
  category: true,
} satisfies Prisma.ExpenseInclude;

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
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

  async streamReceipt(access: StoreAccess, assetId: string, response: Response): Promise<void> {
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
    if ((dto.group ?? ExpenseGroup.OTHER) === ExpenseGroup.SALARY) {
      throw new ConflictException(
        'The SALARY category is managed automatically by Staff Salary and cannot be created directly.',
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
    if (dto.group === ExpenseGroup.SALARY && category.group !== ExpenseGroup.SALARY) {
      throw new ConflictException(
        'The SALARY category is managed automatically by Staff Salary and cannot be assigned directly.',
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

  async list(storeId: string, query: ExpenseListQueryDto): Promise<ExpenseListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ExpenseWhereInput = {
      storeId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.group ? { category: { group: query.group } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            spentAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
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
    const where: Prisma.ExpenseWhereInput = {
      storeId,
      ...(query.dateFrom || query.dateTo
        ? {
            spentAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const expenses = await this.prisma.expense.findMany({
      where,
      select: { amount: true, category: { select: { group: true } } },
    });

    const totals = new Map<ExpenseGroup, Prisma.Decimal>();
    let totalAmount = new Prisma.Decimal(0);
    for (const expense of expenses) {
      const group = expense.category.group;
      totals.set(group, (totals.get(group) ?? new Prisma.Decimal(0)).plus(expense.amount));
      totalAmount = totalAmount.plus(expense.amount);
    }

    return {
      totalAmount: totalAmount.toFixed(2),
      byGroup: Object.values(ExpenseGroup).map((group) => ({
        group,
        total: (totals.get(group) ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    };
  }

  /** Monthly totals for the Expenses trend/line chart. */
  async trend(storeId: string, query: MonthlyTrendQueryDto): Promise<MonthlyTrendResponseDto> {
    const months = query.months ?? 6;
    const keys = lastNMonthKeys(months);
    const since = monthsAgoStart(months);

    const expenses = await this.prisma.expense.findMany({
      where: { storeId, spentAt: { gte: since } },
      select: { amount: true, spentAt: true },
    });

    const totals = new Map<string, Prisma.Decimal>();
    for (const expense of expenses) {
      const key = monthKey(expense.spentAt);
      totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(expense.amount));
    }

    const points = keys.map((month) => ({
      month,
      total: (totals.get(month) ?? new Prisma.Decimal(0)).toFixed(2),
    }));

    const current = Number(points[points.length - 1]?.total ?? 0);
    const previous = Number(points[points.length - 2]?.total ?? 0);

    return { points, trend: calculateTrend(current, previous) };
  }

  async create(access: StoreAccess, dto: CreateExpenseDto): Promise<ExpenseResponseDto> {
    const category = await this.requireCategory(access.storeId, dto.categoryId);
    this.rejectSalaryCategory(category.group);

    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          storeId: access.storeId,
          title: dto.title,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          spentAt: new Date(dto.spentAt),
          categoryId: dto.categoryId,
          notes: dto.notes ?? null,
          receiptUrl: dto.receiptAssetId ? receiptPreviewPath(dto.receiptAssetId) : (dto.receiptUrl ?? null),
          createdByUserId: access.userId,
        },
      });

      if (dto.receiptAssetId) {
        await attachReceipt(tx, access.storeId, dto.receiptAssetId, { expenseId: created.id });
      }

      return tx.expense.findUniqueOrThrow({ where: { id: created.id }, include: EXPENSE_INCLUDE });
    });

    return toExpenseResponse(expense);
  }

  async update(
    access: StoreAccess,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    const expense = await this.requireExpense(access.storeId, expenseId);
    this.rejectIfSalaryGenerated(expense);

    if (dto.categoryId && dto.categoryId !== expense.categoryId) {
      const category = await this.requireCategory(access.storeId, dto.categoryId);
      this.rejectSalaryCategory(category.group);
    }

    if (dto.receiptAssetId) {
      // expenseId is @unique on MediaAsset — replacing the receipt means
      // freeing the old one first (best-effort GCS delete, same as remove()),
      // done outside the transaction since the GCS call can't roll back with it.
      const existingReceipt = await this.prisma.mediaAsset.findUnique({ where: { expenseId } });
      if (existingReceipt && existingReceipt.id !== dto.receiptAssetId) {
        await this.media.deleteAttachedAsset(existingReceipt.id).catch(() => undefined);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.receiptAssetId) {
        await attachReceipt(tx, access.storeId, dto.receiptAssetId, { expenseId });
      }

      return tx.expense.update({
        where: { id: expenseId },
        data: {
          title: dto.title,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          spentAt: dto.spentAt ? new Date(dto.spentAt) : undefined,
          categoryId: dto.categoryId,
          notes: dto.notes,
          receiptUrl: dto.receiptAssetId ? receiptPreviewPath(dto.receiptAssetId) : dto.receiptUrl,
        },
        include: EXPENSE_INCLUDE,
      });
    });

    return toExpenseResponse(updated);
  }

  async remove(access: StoreAccess, expenseId: string): Promise<void> {
    const expense = await this.requireExpense(access.storeId, expenseId);
    this.rejectIfSalaryGenerated(expense);

    // The FK is SetNull, not Cascade, so deleting the expense wouldn't clean
    // up an attached receipt on its own — do it explicitly so nothing is
    // left orphaned in Cloud Storage.
    const receipt = await this.prisma.mediaAsset.findUnique({ where: { expenseId } });
    if (receipt) {
      await this.media.deleteAttachedAsset(receipt.id).catch(() => undefined);
    }
    await this.prisma.expense.delete({ where: { id: expenseId } });
  }

  private rejectSalaryCategory(group: ExpenseGroup): void {
    if (group === ExpenseGroup.SALARY) {
      throw new ConflictException(
        'Salary expenses are recorded from Staff Salary, not created directly here.',
      );
    }
  }

  private rejectIfSalaryGenerated(expense: { staffMemberId: string | null }): void {
    if (expense.staffMemberId) {
      throw new ConflictException(
        'This expense was generated from a salary payment — edit or delete it from Staff Salary instead.',
      );
    }
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

  private async requireExpense(storeId: string, expenseId: string): Promise<ExpenseWithCategory> {
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
    isSalaryGenerated: expense.staffMemberId !== null,
    createdAt: expense.createdAt.toISOString(),
  };
}
