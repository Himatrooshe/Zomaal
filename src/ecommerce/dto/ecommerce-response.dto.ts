import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EcommerceConnectionDto {
  @ApiProperty({ example: '7cf83ca3-497c-44a7-bc11-ae0c7cfdba1f' })
  id!: string;

  @ApiProperty({
    description:
      'Provider identifier. Additional values will be introduced as integrations are added.',
    enum: ['SHOPIFY'],
    example: 'SHOPIFY',
  })
  platform!: string;

  @ApiProperty({ example: 'atlas-market.myshopify.com' })
  externalAccountId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Atlas Market' })
  displayName!: string | null;

  @ApiProperty({
    enum: ['ACTIVE', 'DISCONNECTED', 'REAUTHORIZATION_REQUIRED'],
    example: 'ACTIVE',
  })
  status!: string;

  @ApiProperty({
    description:
      'Whether this connection contributes to combined revenue calculations.',
    example: true,
  })
  includeInRevenue!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-07-19T08:30:00.000Z',
  })
  lastSyncedAt!: string | null;

  @ApiProperty({
    description:
      'Whether a subsequent sync request is required to finish the current backfill.',
    example: false,
  })
  syncPending!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Last safe synchronization error message.',
    example: null,
  })
  lastSyncError!: string | null;
}

export class EcommerceConnectionListDto {
  @ApiProperty({ type: [EcommerceConnectionDto] })
  data!: EcommerceConnectionDto[];
}

export class EcommerceSyncResponseDto {
  @ApiProperty({ example: '7cf83ca3-497c-44a7-bc11-ae0c7cfdba1f' })
  connectionId!: string;

  @ApiProperty({ enum: ['SHOPIFY'], example: 'SHOPIFY' })
  platform!: string;

  @ApiProperty({
    description:
      'Orders inserted or refreshed during this synchronization run.',
    example: 87,
  })
  processedOrders!: number;

  @ApiProperty({
    description:
      'Whether more provider pages remain. Call this endpoint again when true.',
    example: false,
  })
  hasMore!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Completed synchronization watermark. Null while a paginated backfill remains.',
    example: '2026-07-19T08:30:00.000Z',
  })
  lastSyncedAt!: string | null;
}

export class RevenuePeriodDto {
  @ApiPropertyOptional({ nullable: true, example: '2026-07-01' })
  from!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-07-31' })
  to!: string | null;

  @ApiProperty({ example: 'Africa/Casablanca' })
  timezone!: string;
}

export class RevenueAmountsDto {
  @ApiProperty({
    description: 'Order subtotal before discounts and refunds.',
    example: '24000.0000',
  })
  grossSales!: string;

  @ApiProperty({ example: '1000.0000' })
  discounts!: string;

  @ApiProperty({ example: '500.0000' })
  refunds!: string;

  @ApiProperty({
    description: 'Gross sales minus discounts and product refunds.',
    example: '22500.0000',
  })
  netSales!: string;

  @ApiProperty({ example: '700.0000' })
  shipping!: string;

  @ApiProperty({ example: '0.0000' })
  tax!: string;

  @ApiProperty({
    description:
      'Net captured payments after refunds. This is the primary income metric.',
    example: '23200.0000',
  })
  totalCollected!: string;
}

export class RevenueCurrencyTotalDto extends RevenueAmountsDto {
  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'MAD' })
  currency!: string;

  @ApiProperty({ example: 42 })
  orderCount!: number;
}

export class RevenuePlatformTotalDto extends RevenueCurrencyTotalDto {
  @ApiProperty({ enum: ['SHOPIFY'], example: 'SHOPIFY' })
  platform!: string;
}

export class RevenueSummaryDto {
  @ApiProperty({ type: RevenuePeriodDto })
  period!: RevenuePeriodDto;

  @ApiProperty({ type: [RevenueCurrencyTotalDto] })
  totalsByCurrency!: RevenueCurrencyTotalDto[];

  @ApiProperty({ type: [RevenuePlatformTotalDto] })
  byPlatform!: RevenuePlatformTotalDto[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Oldest last-sync timestamp among included connections. Null when no connection has completed a sync.',
    example: '2026-07-19T08:30:00.000Z',
  })
  dataFreshAsOf!: string | null;
}

export class RevenueDailyTotalDto extends RevenueCurrencyTotalDto {
  @ApiProperty({ format: 'date', example: '2026-07-19' })
  date!: string;
}

export class RevenueTimeseriesDto {
  @ApiProperty({ type: RevenuePeriodDto })
  period!: RevenuePeriodDto;

  @ApiProperty({ type: [RevenueDailyTotalDto] })
  data!: RevenueDailyTotalDto[];
}
