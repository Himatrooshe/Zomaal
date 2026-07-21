import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  EcommerceConnectionListDto,
  RevenueAmountsDto,
  RevenueCurrencyTotalDto,
  RevenuePlatformTotalDto,
  RevenueSummaryDto,
  RevenueTimeseriesDto,
} from './dto/ecommerce-response.dto';
import type { RevenueRangeQueryDto } from './dto/revenue-query.dto';

const INCLUDED_PAYMENT_STATUSES = Prisma.sql`
  (
    'PARTIALLY_PAID'::"EcommercePaymentStatus",
    'PAID'::"EcommercePaymentStatus",
    'PARTIALLY_REFUNDED'::"EcommercePaymentStatus",
    'REFUNDED'::"EcommercePaymentStatus"
  )
`;
const MAX_TIMESERIES_DAYS = 366;

interface AggregateRow {
  platform?: string;
  date?: Date | string;
  currency: string;
  orderCount: number | bigint;
  grossSales: Prisma.Decimal;
  discounts: Prisma.Decimal;
  refunds: Prisma.Decimal;
  netSales: Prisma.Decimal;
  shipping: Prisma.Decimal;
  tax: Prisma.Decimal;
  totalCollected: Prisma.Decimal;
}

@Injectable()
export class EcommerceService {
  constructor(private readonly prisma: PrismaService) {}

  async listConnections(userId: string): Promise<EcommerceConnectionListDto> {
    const store = await this.requireStore(userId);
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: { storeId: store.id },
      orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      data: connections.map((connection) => ({
        id: connection.id,
        platform: connection.platform,
        externalAccountId: connection.externalAccountId,
        displayName: connection.displayName,
        status: connection.status,
        includeInRevenue: connection.includeInRevenue,
        lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
        syncPending: connection.syncStartedAt !== null,
        lastSyncError: connection.lastSyncError,
      })),
    };
  }

  async getRevenueSummary(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<RevenueSummaryDto> {
    const store = await this.requireStore(userId);
    const range = validateRange(query);
    const dateFilter = buildDateFilter(range);

    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        connection."platform"::text AS "platform",
        orders."currency",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(orders."grossSales"), 0) AS "grossSales",
        COALESCE(SUM(orders."discounts"), 0) AS "discounts",
        COALESCE(SUM(orders."refunds"), 0) AS "refunds",
        COALESCE(SUM(orders."netSales"), 0) AS "netSales",
        COALESCE(SUM(orders."shipping"), 0) AS "shipping",
        COALESCE(SUM(orders."tax"), 0) AS "tax",
        COALESCE(SUM(orders."totalCollected"), 0) AS "totalCollected"
      FROM "EcommerceOrder" orders
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      WHERE connection."storeId" = ${store.id}
        AND connection."includeInRevenue" = true
        AND orders."financialStatus" IN ${INCLUDED_PAYMENT_STATUSES}
        ${dateFilter}
      GROUP BY connection."platform", orders."currency"
      ORDER BY connection."platform", orders."currency"
    `);

    const byPlatform = rows.map(toPlatformTotal);
    const totalsByCurrency = combineByCurrency(rows);
    return {
      period: range,
      totalsByCurrency,
      byPlatform,
      dataFreshAsOf: await this.getDataFreshness(store.id),
    };
  }

  async getRevenueTimeseries(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<RevenueTimeseriesDto> {
    const store = await this.requireStore(userId);
    const range = validateRange(query, true);
    const dateFilter = buildDateFilter(range);

    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        (orders."processedAt" AT TIME ZONE ${range.timezone})::date AS "date",
        orders."currency",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(orders."grossSales"), 0) AS "grossSales",
        COALESCE(SUM(orders."discounts"), 0) AS "discounts",
        COALESCE(SUM(orders."refunds"), 0) AS "refunds",
        COALESCE(SUM(orders."netSales"), 0) AS "netSales",
        COALESCE(SUM(orders."shipping"), 0) AS "shipping",
        COALESCE(SUM(orders."tax"), 0) AS "tax",
        COALESCE(SUM(orders."totalCollected"), 0) AS "totalCollected"
      FROM "EcommerceOrder" orders
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      WHERE connection."storeId" = ${store.id}
        AND connection."includeInRevenue" = true
        AND orders."financialStatus" IN ${INCLUDED_PAYMENT_STATUSES}
        ${dateFilter}
      GROUP BY "date", orders."currency"
      ORDER BY "date", orders."currency"
    `);

    return {
      period: range,
      data: rows.map((row) => ({
        date: formatSqlDate(row.date),
        currency: row.currency,
        orderCount: Number(row.orderCount),
        ...toAmounts(row),
      })),
    };
  }

  private async requireStore(userId: string): Promise<{ id: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  private async getDataFreshness(storeId: string): Promise<string | null> {
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: { storeId, includeInRevenue: true },
      select: { lastSyncedAt: true },
    });
    if (
      connections.length === 0 ||
      connections.some((connection) => connection.lastSyncedAt === null)
    ) {
      return null;
    }
    const oldest = connections.reduce(
      (current, connection) =>
        connection.lastSyncedAt! < current ? connection.lastSyncedAt! : current,
      connections[0].lastSyncedAt!,
    );
    return oldest.toISOString();
  }
}

function validateRange(
  query: RevenueRangeQueryDto,
  defaultToLast30Days = false,
): { from: string | null; to: string | null; timezone: string } {
  const timezone = query.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone');
  }

  let from = query.from ?? null;
  let to = query.to ?? null;
  if (defaultToLast30Days && !from && !to) {
    to = dateInTimezone(new Date(), timezone);
    from = addUtcDays(to, -29);
  }
  if (from) {
    assertCalendarDate(from, 'from');
  }
  if (to) {
    assertCalendarDate(to, 'to');
  }
  if (from && to && from > to) {
    throw new BadRequestException('from must be on or before to');
  }
  if (defaultToLast30Days && from && to) {
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days > MAX_TIMESERIES_DAYS) {
      throw new BadRequestException(
        `timeseries range cannot exceed ${MAX_TIMESERIES_DAYS} days`,
      );
    }
  }
  return { from, to, timezone };
}

function buildDateFilter(range: {
  from: string | null;
  to: string | null;
  timezone: string;
}): Prisma.Sql {
  const from = range.from
    ? Prisma.sql`AND orders."processedAt" >= (${range.from}::date AT TIME ZONE ${range.timezone})`
    : Prisma.empty;
  const to = range.to
    ? Prisma.sql`AND orders."processedAt" < ((${range.to}::date + INTERVAL '1 day') AT TIME ZONE ${range.timezone})`
    : Prisma.empty;
  return Prisma.sql`${from} ${to}`;
}

function toPlatformTotal(row: AggregateRow): RevenuePlatformTotalDto {
  return {
    platform: row.platform!,
    currency: row.currency,
    orderCount: Number(row.orderCount),
    ...toAmounts(row),
  };
}

function combineByCurrency(rows: AggregateRow[]): RevenueCurrencyTotalDto[] {
  const combined = new Map<
    string,
    {
      orderCount: number;
      amounts: Record<keyof RevenueAmountsDto, Prisma.Decimal>;
    }
  >();

  for (const row of rows) {
    const current = combined.get(row.currency) ?? {
      orderCount: 0,
      amounts: zeroAmounts(),
    };
    current.orderCount += Number(row.orderCount);
    for (const key of amountKeys) {
      current.amounts[key] = current.amounts[key].plus(row[key]);
    }
    combined.set(row.currency, current);
  }

  return [...combined.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      currency,
      orderCount: total.orderCount,
      ...decimalAmounts(total.amounts),
    }));
}

const amountKeys: (keyof RevenueAmountsDto)[] = [
  'grossSales',
  'discounts',
  'refunds',
  'netSales',
  'shipping',
  'tax',
  'totalCollected',
];

function toAmounts(row: AggregateRow): RevenueAmountsDto {
  return {
    grossSales: row.grossSales.toFixed(4),
    discounts: row.discounts.toFixed(4),
    refunds: row.refunds.toFixed(4),
    netSales: row.netSales.toFixed(4),
    shipping: row.shipping.toFixed(4),
    tax: row.tax.toFixed(4),
    totalCollected: row.totalCollected.toFixed(4),
  };
}

function zeroAmounts(): Record<keyof RevenueAmountsDto, Prisma.Decimal> {
  return Object.fromEntries(
    amountKeys.map((key) => [key, new Prisma.Decimal(0)]),
  ) as Record<keyof RevenueAmountsDto, Prisma.Decimal>;
}

function decimalAmounts(
  amounts: Record<keyof RevenueAmountsDto, Prisma.Decimal>,
): RevenueAmountsDto {
  return Object.fromEntries(
    amountKeys.map((key) => [key, amounts[key].toFixed(4)]),
  ) as unknown as RevenueAmountsDto;
}

function assertCalendarDate(value: string, field: string): void {
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} must be a valid calendar date`);
  }
}

function dateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatSqlDate(value: Date | string | undefined): string {
  if (!value) {
    throw new Error('Revenue query returned an invalid date');
  }
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}
