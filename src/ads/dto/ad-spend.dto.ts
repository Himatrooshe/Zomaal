import { ApiProperty } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { AdSpendTotals, UnconvertedAmount } from '../ads-spend.service';

export class UnconvertedAmountDto {
  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({
    example: '0.00',
    description:
      'Spend in this currency that is left out of the totals because no exchange rate to the store currency was available.',
  })
  amount!: string;
}

export class AdSpendPlatformDto {
  @ApiProperty({ example: 'META', enum: ['TIKTOK', 'GOOGLE', 'META'] })
  platform!: string;

  @ApiProperty({ example: '0.00', description: 'Store currency.' })
  spend!: string;

  @ApiProperty({ example: 0 })
  results!: number;
}

export class AdSpendAccountDto {
  @ApiProperty({ format: 'uuid' })
  connectionId!: string;

  @ApiProperty({ example: 'META' })
  platform!: string;

  @ApiProperty({ type: String, nullable: true })
  accountName!: string | null;

  @ApiProperty({ example: 'USD' })
  accountCurrency!: string;

  @ApiProperty({ example: '0.00' })
  spendInAccountCurrency!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0.00',
    description: 'Store currency. null when no exchange rate is available.',
  })
  spend!: string | null;

  @ApiProperty({ example: 0 })
  results!: number;
}

export class AdSpendResponseDto {
  @ApiProperty({ example: 'MAD', description: 'Store base currency.' })
  currency!: string;

  @ApiProperty({
    example: '0.00',
    description:
      'Spend of tracked campaigns in the period, converted to the store currency.',
  })
  spend!: string;

  @ApiProperty({
    example: 0,
    description: 'Platform-reported results (purchases, leads, …).',
  })
  results!: number;

  @ApiProperty({ type: String, nullable: true, example: null })
  costPerResult!: string | null;

  @ApiProperty({ type: [AdSpendPlatformDto] })
  byPlatform!: AdSpendPlatformDto[];

  @ApiProperty({ type: [AdSpendAccountDto] })
  accounts!: AdSpendAccountDto[];

  @ApiProperty({ type: [UnconvertedAmountDto] })
  unconverted!: UnconvertedAmountDto[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Latest ads sync among the accounts above.',
  })
  dataUpdatedAt!: string | null;
}

export function toUnconvertedDto(
  items: UnconvertedAmount[],
): UnconvertedAmountDto[] {
  return items.map((item) => ({
    currency: item.currency,
    amount: item.amount.toFixed(2),
  }));
}

export function toAdSpendResponse(totals: AdSpendTotals): AdSpendResponseDto {
  return {
    currency: totals.currency,
    spend: totals.spend.toFixed(2),
    results: totals.results,
    costPerResult: totals.costPerResult?.toFixed(2) ?? null,
    byPlatform: totals.byPlatform.map((row) => ({
      platform: row.platform,
      spend: row.spend.toFixed(2),
      results: row.results,
    })),
    accounts: totals.accounts.map((account) => ({
      connectionId: account.connectionId,
      platform: account.platform,
      accountName: account.accountName,
      accountCurrency: account.accountCurrency,
      spendInAccountCurrency: new Prisma.Decimal(
        account.spendInAccountCurrency,
      ).toFixed(2),
      spend: account.spend?.toFixed(2) ?? null,
      results: account.results,
    })),
    unconverted: toUnconvertedDto(totals.unconverted),
    dataUpdatedAt: totals.dataUpdatedAt?.toISOString() ?? null,
  };
}
