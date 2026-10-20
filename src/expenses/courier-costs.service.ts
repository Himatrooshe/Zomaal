import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';
import { UnconvertedAmount } from '../ads/ads-spend.service';
import { expenseRange, ExpenseRangeQuery } from './expense-date.util';

type Store = { id: string; baseCurrency: string };
interface CostRow {
  currency: string;
  amount: Prisma.Decimal;
  month: string;
}

/** Read the immutable courier financial ledger; never invent a courier fee or
 * copy it into a second mutable Expense ledger. Match order financial signs,
 * including legacy reversals that actually reversed a shipping cost.
 */
@Injectable()
export class CourierCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async getTotals(store: Store, query: ExpenseRangeQuery) {
    const rows = await this.rows(store.id, query);
    let total = new Prisma.Decimal(0);
    const unconverted: UnconvertedAmount[] = [];
    for (const row of rows) {
      if (new Prisma.Decimal(row.amount).isZero()) continue;
      const amount = await this.currency.convertOrNull(
        row.amount,
        row.currency,
        store.baseCurrency,
      );
      if (amount !== null) total = total.plus(amount);
      else
        unconverted.push({
          currency: row.currency,
          amount: new Prisma.Decimal(row.amount),
        });
    }
    return { total, unconverted };
  }

  async getMonthly(store: Store, since: Date, timezone: string, until: Date) {
    const rows = await this.rows(
      store.id,
      {
        dateFrom: since.toISOString(),
        dateTo: new Date(until.getTime() - 1).toISOString(),
        timezone,
      },
      true,
    );
    const byMonth = new Map<string, Prisma.Decimal>();
    const missing = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      if (new Prisma.Decimal(row.amount).isZero()) continue;
      const amount = await this.currency.convertOrNull(
        row.amount,
        row.currency,
        store.baseCurrency,
      );
      if (amount !== null)
        byMonth.set(
          row.month,
          (byMonth.get(row.month) ?? new Prisma.Decimal(0)).plus(amount),
        );
      else
        missing.set(
          row.currency,
          (missing.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.amount),
        );
    }
    return {
      byMonth,
      unconverted: [...missing].map(([currency, amount]) => ({
        currency,
        amount,
      })),
    };
  }

  private rows(storeId: string, query: ExpenseRangeQuery, monthly = false) {
    const range = expenseRange(query);
    const month = monthly
      ? Prisma.sql`to_char(e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${query.timezone ?? 'UTC'}, 'YYYY-MM')`
      : Prisma.sql`''`;
    const upper = range.to
      ? range.inclusiveTo
        ? Prisma.sql`AND e."createdAt" <= ${range.to}`
        : Prisma.sql`AND e."createdAt" < ${range.to}`
      : Prisma.empty;
    return this.prisma.$queryRaw<CostRow[]>(Prisma.sql`
      SELECT e.currency, ${month} AS month,
        SUM(CASE WHEN e.type = 'REVENUE_REVERSED' THEN -e."shippingCost" ELSE e."shippingCost" END) AS amount
      FROM "EcommerceOrderFinancialEvent" e
      JOIN "EcommerceOrder" o ON o.id = e."orderId"
      JOIN "EcommerceConnection" c ON c.id = o."connectionId"
      WHERE c."storeId" = ${storeId}
      AND e.type IN ('REVENUE_RECOGNIZED', 'REVENUE_REINSTATED', 'REVENUE_REVERSED', 'SHIPPING_LOSS')
      ${range.from ? Prisma.sql`AND e."createdAt" >= ${range.from}` : Prisma.empty} ${upper}
      GROUP BY 1, 2
    `);
  }
}
