import { Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';
import type { RevenueRangeQueryDto } from '../ecommerce/dto/revenue-query.dto';
import {
  ExpenseEntryDto,
  ExpenseListDto,
  ExpenseListQueryDto,
  ExpenseSummaryResponseDto,
} from './dto/expense.dto';
import { resolveRange } from './finance-range.util';

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  // No write path exists on purpose — see the controller-level comment.
  // list()/getSummary() below are query-only and will report empty/zero for
  // every store until a deliberate write source exists.

  async list(userId: string, query: ExpenseListQueryDto): Promise<ExpenseListDto> {
    const store = await this.requireStore(userId);
    const where: Prisma.ExpenseEntryWhereInput = { storeId: store.id };
    if (query.category) {
      where.category = query.category;
    }
    if (query.from || query.to) {
      where.incurredAt = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to
          ? { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + 86_400_000) }
          : {}),
      };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const [total, entries] = await Promise.all([
      this.prisma.expenseEntry.count({ where }),
      this.prisma.expenseEntry.findMany({
        where,
        orderBy: { incurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data: entries.map(toExpenseDto), total, page, limit };
  }

  async getSummary(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<ExpenseSummaryResponseDto> {
    const store = await this.requireStore(userId);
    const range = resolveRange(query);
    const incurredAtWhere =
      range.fromDate || range.toDateExclusive
        ? {
            incurredAt: {
              ...(range.fromDate ? { gte: range.fromDate } : {}),
              ...(range.toDateExclusive ? { lt: range.toDateExclusive } : {}),
            },
          }
        : {};
    const spentAtWhere =
      range.fromDate || range.toDateExclusive
        ? {
            spentAt: {
              ...(range.fromDate ? { gte: range.fromDate } : {}),
              ...(range.toDateExclusive ? { lt: range.toDateExclusive } : {}),
            },
          }
        : {};

    const [expenseEntries, adSpendEntries, orderCount, latestExpense, latestAdSpend] =
      await Promise.all([
        this.prisma.expenseEntry.findMany({
          where: { storeId: store.id, ...incurredAtWhere },
        }),
        this.prisma.adSpendEntry.findMany({
          where: { storeId: store.id, ...spentAtWhere },
        }),
        this.prisma.ecommerceOrder.count({
          where: {
            connection: { storeId: store.id },
            status: { not: 'CANCELLED' },
            ...(range.fromDate || range.toDateExclusive
              ? {
                  processedAt: {
                    ...(range.fromDate ? { gte: range.fromDate } : {}),
                    ...(range.toDateExclusive ? { lt: range.toDateExclusive } : {}),
                  },
                }
              : {}),
          },
        }),
        this.prisma.expenseEntry.findFirst({
          where: { storeId: store.id },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
        this.prisma.adSpendEntry.findFirst({
          where: { storeId: store.id },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
      ]);

    let operational = new Prisma.Decimal(0);
    let purchases = new Prisma.Decimal(0);
    let packagingCost = new Prisma.Decimal(0);
    let packagingPieces = 0;
    let totalExpenses = new Prisma.Decimal(0);

    for (const entry of expenseEntries) {
      const converted = await this.toBaseCurrency(
        entry.amount,
        entry.currency,
        store.baseCurrency,
      );
      totalExpenses = totalExpenses.plus(converted);
      switch (entry.category) {
        case ExpenseCategory.OPERATIONAL:
          operational = operational.plus(converted);
          break;
        case ExpenseCategory.PURCHASES:
          purchases = purchases.plus(converted);
          break;
        case ExpenseCategory.PACKAGING:
          packagingCost = packagingCost.plus(converted);
          packagingPieces += entry.quantity ?? 0;
          break;
        case ExpenseCategory.OTHER:
          // Counted in totalExpenses only — there is no "Other" tile on the
          // Expenses screen to attribute it to.
          break;
      }
    }

    let advertising = new Prisma.Decimal(0);
    for (const entry of adSpendEntries) {
      advertising = advertising.plus(
        await this.toBaseCurrency(entry.amount, entry.currency, store.baseCurrency),
      );
    }
    totalExpenses = totalExpenses.plus(advertising);

    const latest = latestDate(
      latestExpense?.updatedAt ?? null,
      latestAdSpend?.updatedAt ?? null,
    );

    return {
      period: { from: range.from, to: range.to, timezone: range.timezone },
      currency: store.baseCurrency,
      totalExpenses: totalExpenses.toFixed(4),
      averageCostPerOrder: orderCount
        ? totalExpenses.dividedBy(orderCount).toFixed(4)
        : null,
      operational: { cost: operational.toFixed(4) },
      purchases: { cost: purchases.toFixed(4) },
      packaging: { cost: packagingCost.toFixed(4), pieces: packagingPieces },
      advertising: { cost: advertising.toFixed(4) },
      dataUpdatedAt: latest?.toISOString() ?? null,
    };
  }

  private async toBaseCurrency(
    amount: Prisma.Decimal,
    currency: string,
    baseCurrency: string,
  ): Promise<Prisma.Decimal> {
    return currency === baseCurrency
      ? new Prisma.Decimal(amount)
      : this.currencyService.convertAmount(amount, currency, baseCurrency);
  }

  private async requireStore(
    userId: string,
  ): Promise<{ id: string; baseCurrency: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true, baseCurrency: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }
}

function toExpenseDto(entry: {
  id: string;
  category: ExpenseCategory;
  amount: Prisma.Decimal;
  currency: string;
  quantity: number | null;
  description: string | null;
  incurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ExpenseEntryDto {
  return {
    id: entry.id,
    category: entry.category,
    amount: entry.amount.toFixed(4),
    currency: entry.currency,
    quantity: entry.quantity,
    description: entry.description,
    incurredAt: entry.incurredAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function latestDate(...values: Array<Date | null>): Date | null {
  return values.reduce<Date | null>(
    (latest, value) => (value && (!latest || value > latest) ? value : latest),
    null,
  );
}
