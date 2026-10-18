import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';

/** Inclusive calendar dates (YYYY-MM-DD). null = unbounded. */
export interface AdSpendRange {
  from: string | null;
  to: string | null;
}

export interface AdSpendStore {
  id: string;
  baseCurrency: string;
}

export interface UnconvertedAmount {
  currency: string;
  amount: Prisma.Decimal;
}

export interface AdSpendAccount {
  connectionId: string;
  platform: string;
  accountName: string | null;
  accountCurrency: string;
  spendInAccountCurrency: Prisma.Decimal;
  /** In the store base currency; null when no exchange rate is available. */
  spend: Prisma.Decimal | null;
  results: number;
}

export interface AdSpendTotals {
  currency: string;
  spend: Prisma.Decimal;
  results: number;
  /** Converted spend ÷ results of converted accounts; null with no results. */
  costPerResult: Prisma.Decimal | null;
  byPlatform: { platform: string; spend: Prisma.Decimal; results: number }[];
  accounts: AdSpendAccount[];
  unconverted: UnconvertedAmount[];
  dataUpdatedAt: Date | null;
}

interface AccountRow {
  connectionId: string;
  platform: string;
  accountName: string | null;
  currency: string;
  spend: Prisma.Decimal;
  results: bigint | number;
  lastSyncedAt: Date | null;
}

interface MonthRow {
  month: string;
  currency: string;
  spend: Prisma.Decimal;
}

// Ad spend is read live from synced snapshots, never copied into Expense
// rows: platforms revise recent days, and a copy would drift. Only tracked
// (selected) campaigns count toward a store's spend. Disconnected accounts
// keep their history, because that money was really spent.
@Injectable()
export class AdsSpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async getTotals(
    store: AdSpendStore,
    range: AdSpendRange,
  ): Promise<AdSpendTotals> {
    const rows = await this.prisma.$queryRaw<AccountRow[]>(Prisma.sql`
      SELECT
        c."id" AS "connectionId",
        c."platform"::text AS "platform",
        c."displayName" AS "accountName",
        s."currency",
        COALESCE(SUM(s."spend"), 0) AS "spend",
        COALESCE(SUM(s."results"), 0) AS "results",
        MAX(c."lastSyncedAt") AS "lastSyncedAt"
      FROM "AdsMetricSnapshot" s
      INNER JOIN "AdsCampaign" cp ON cp."id" = s."campaignId"
      INNER JOIN "AdsConnection" c ON c."id" = cp."connectionId"
      WHERE c."storeId" = ${store.id}
        AND cp."tracked" = true
        ${dateFilter(range)}
      GROUP BY c."id", c."platform", c."displayName", s."currency"
      ORDER BY c."platform", c."displayName", s."currency"
    `);

    let spend = new Prisma.Decimal(0);
    let results = 0;
    let convertedResults = 0;
    let dataUpdatedAt: Date | null = null;
    const byPlatform = new Map<
      string,
      { spend: Prisma.Decimal; results: number }
    >();
    const unconverted = new Map<string, Prisma.Decimal>();
    const accounts: AdSpendAccount[] = [];

    for (const row of rows) {
      const rowSpend = new Prisma.Decimal(row.spend);
      const rowResults = Number(row.results);
      const converted = await this.currency.convertOrNull(
        rowSpend,
        row.currency,
        store.baseCurrency,
      );
      results += rowResults;
      const platform = byPlatform.get(row.platform) ?? {
        spend: new Prisma.Decimal(0),
        results: 0,
      };
      platform.results += rowResults;
      if (converted) {
        spend = spend.plus(converted);
        convertedResults += rowResults;
        platform.spend = platform.spend.plus(converted);
      } else {
        unconverted.set(
          row.currency,
          (unconverted.get(row.currency) ?? new Prisma.Decimal(0)).plus(
            rowSpend,
          ),
        );
      }
      byPlatform.set(row.platform, platform);
      accounts.push({
        connectionId: row.connectionId,
        platform: row.platform,
        accountName: row.accountName,
        accountCurrency: row.currency,
        spendInAccountCurrency: rowSpend,
        spend: converted,
        results: rowResults,
      });
      if (
        row.lastSyncedAt &&
        (!dataUpdatedAt || row.lastSyncedAt > dataUpdatedAt)
      ) {
        dataUpdatedAt = row.lastSyncedAt;
      }
    }

    return {
      currency: store.baseCurrency,
      spend,
      results,
      costPerResult:
        convertedResults > 0 ? spend.dividedBy(convertedResults) : null,
      byPlatform: [...byPlatform.entries()].map(([platform, value]) => ({
        platform,
        ...value,
      })),
      accounts,
      unconverted: toUnconverted(unconverted),
      dataUpdatedAt,
    };
  }

  /** Spend per UTC month key (YYYY-MM) since the given date, base currency. */
  async getMonthly(
    store: AdSpendStore,
    since: Date,
  ): Promise<{
    byMonth: Map<string, Prisma.Decimal>;
    unconverted: UnconvertedAmount[];
  }> {
    const rows = await this.prisma.$queryRaw<MonthRow[]>(Prisma.sql`
      SELECT
        to_char(s."date", 'YYYY-MM') AS "month",
        s."currency",
        COALESCE(SUM(s."spend"), 0) AS "spend"
      FROM "AdsMetricSnapshot" s
      INNER JOIN "AdsCampaign" cp ON cp."id" = s."campaignId"
      INNER JOIN "AdsConnection" c ON c."id" = cp."connectionId"
      WHERE c."storeId" = ${store.id}
        AND cp."tracked" = true
        AND s."date" >= ${since.toISOString().slice(0, 10)}::date
      GROUP BY "month", s."currency"
    `);

    const byMonth = new Map<string, Prisma.Decimal>();
    const unconverted = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      const converted = await this.currency.convertOrNull(
        row.spend,
        row.currency,
        store.baseCurrency,
      );
      if (converted) {
        byMonth.set(
          row.month,
          (byMonth.get(row.month) ?? new Prisma.Decimal(0)).plus(converted),
        );
      } else {
        unconverted.set(
          row.currency,
          (unconverted.get(row.currency) ?? new Prisma.Decimal(0)).plus(
            row.spend,
          ),
        );
      }
    }
    return { byMonth, unconverted: toUnconverted(unconverted) };
  }
}

function dateFilter(range: AdSpendRange): Prisma.Sql {
  const from = range.from
    ? Prisma.sql`AND s."date" >= ${range.from}::date`
    : Prisma.empty;
  const to = range.to
    ? Prisma.sql`AND s."date" <= ${range.to}::date`
    : Prisma.empty;
  return Prisma.sql`${from} ${to}`;
}

function toUnconverted(map: Map<string, Prisma.Decimal>): UnconvertedAmount[] {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
}
