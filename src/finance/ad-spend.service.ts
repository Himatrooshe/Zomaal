import { Injectable, NotFoundException } from '@nestjs/common';
import { AdPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';
import type { RevenueRangeQueryDto } from '../ecommerce/dto/revenue-query.dto';
import {
  AdPlatformSummaryDto,
  AdSpendEntryDto,
  AdSpendListDto,
  AdSpendListQueryDto,
  AdSpendSummaryResponseDto,
} from './dto/ad-spend.dto';
import { resolveRange } from './finance-range.util';

// The four named platforms on the Advertising screen — always returned in
// byPlatform, even with zero data, so the UI tiles never need special-casing
// for "not started yet". Anything logged as OTHER is folded into totals but
// only appears in byPlatform when it actually has data.
const NAMED_PLATFORMS: AdPlatform[] = [
  AdPlatform.META,
  AdPlatform.TIKTOK,
  AdPlatform.GOOGLE,
  AdPlatform.SNAPCHAT,
];

@Injectable()
export class AdSpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  // No write path exists on purpose — see the controller-level comment.
  // AdSpendEntry is only ever populated by a future OAuth-connected ads
  // sync, so list()/getSummary() below are query-only and will report
  // empty/available:false for every store until that sync exists.

  async list(userId: string, query: AdSpendListQueryDto): Promise<AdSpendListDto> {
    const store = await this.requireStore(userId);
    const where: Prisma.AdSpendEntryWhereInput = { storeId: store.id };
    if (query.platform) {
      where.platform = query.platform;
    }
    if (query.from || query.to) {
      where.spentAt = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to
          ? { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + 86_400_000) }
          : {}),
      };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const [total, entries] = await Promise.all([
      this.prisma.adSpendEntry.count({ where }),
      this.prisma.adSpendEntry.findMany({
        where,
        orderBy: { spentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data: entries.map(toAdSpendDto), total, page, limit };
  }

  async getSummary(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<AdSpendSummaryResponseDto> {
    const store = await this.requireStore(userId);
    const range = resolveRange(query);
    const spentAtWhere =
      range.fromDate || range.toDateExclusive
        ? {
            spentAt: {
              ...(range.fromDate ? { gte: range.fromDate } : {}),
              ...(range.toDateExclusive ? { lt: range.toDateExclusive } : {}),
            },
          }
        : {};

    const [entries, latest] = await Promise.all([
      this.prisma.adSpendEntry.findMany({
        where: { storeId: store.id, ...spentAtWhere },
      }),
      this.prisma.adSpendEntry.findFirst({
        where: { storeId: store.id },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);

    const byPlatform = new Map<AdPlatform, { results: number; spend: Prisma.Decimal }>();
    let totalSpend = new Prisma.Decimal(0);
    let totalResults = 0;

    for (const entry of entries) {
      const converted =
        entry.currency === store.baseCurrency
          ? new Prisma.Decimal(entry.amount)
          : await this.currencyService.convertAmount(
              entry.amount,
              entry.currency,
              store.baseCurrency,
            );
      const current = byPlatform.get(entry.platform) ?? {
        results: 0,
        spend: new Prisma.Decimal(0),
      };
      current.results += entry.results ?? 0;
      current.spend = current.spend.plus(converted);
      byPlatform.set(entry.platform, current);

      totalSpend = totalSpend.plus(converted);
      totalResults += entry.results ?? 0;
    }

    const platformsToReturn = new Set<AdPlatform>(NAMED_PLATFORMS);
    if (byPlatform.has(AdPlatform.OTHER)) {
      platformsToReturn.add(AdPlatform.OTHER);
    }

    const byPlatformDto: AdPlatformSummaryDto[] = [...platformsToReturn].map(
      (platform) => {
        const totals = byPlatform.get(platform) ?? {
          results: 0,
          spend: new Prisma.Decimal(0),
        };
        return {
          platform,
          results: totals.results,
          spend: totals.spend.toFixed(4),
          costPerResult: totals.results
            ? totals.spend.dividedBy(totals.results).toFixed(4)
            : null,
        };
      },
    );

    return {
      // True only once at least one entry exists for the period — today
      // that never happens, since nothing can write to AdSpendEntry yet.
      // Starts reporting real data automatically once a connected-ads sync
      // exists, with no other change needed here.
      available: entries.length > 0,
      period: { from: range.from, to: range.to, timezone: range.timezone },
      currency: store.baseCurrency,
      totalSpend: totalSpend.toFixed(4),
      totalResults,
      averageCostPerResult: totalResults
        ? totalSpend.dividedBy(totalResults).toFixed(4)
        : null,
      byPlatform: byPlatformDto,
      dataUpdatedAt: latest?.updatedAt.toISOString() ?? null,
    };
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

function toAdSpendDto(entry: {
  id: string;
  platform: AdPlatform;
  amount: Prisma.Decimal;
  currency: string;
  results: number | null;
  description: string | null;
  spentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): AdSpendEntryDto {
  return {
    id: entry.id,
    platform: entry.platform,
    amount: entry.amount.toFixed(4),
    currency: entry.currency,
    results: entry.results,
    description: entry.description,
    spentAt: entry.spentAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
