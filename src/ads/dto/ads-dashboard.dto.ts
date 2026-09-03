import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdsPlatform } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export class AdsCampaignsQueryDto {
  @ApiProperty({ enum: AdsPlatform })
  @IsIn(Object.values(AdsPlatform))
  platform!: AdsPlatform;

  @ApiPropertyOptional({
    description: 'Rolling reporting window ending today. Use 1 for Today.',
    enum: [1, 7, 30, 90],
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 7, 30, 90])
  days?: 1 | 7 | 30 | 90;
}

export class AdsCampaignMetricsDto {
  @ApiProperty({ example: '820.0000' }) spent!: string;
  @ApiProperty({ example: 88 }) clicks!: number;
  @ApiProperty({ example: 5 }) results!: number;
  @ApiPropertyOptional({ example: '5.0000', nullable: true }) costPerResult!: string | null;
  @ApiPropertyOptional({ example: '5.0000', nullable: true }) cpm!: string | null;
  @ApiPropertyOptional({ example: '5.0000', nullable: true }) ctr!: string | null;
  @ApiPropertyOptional({ example: '1.2000', nullable: true }) frequency!: string | null;
  @ApiPropertyOptional({ example: '820.0000', nullable: true }) budget!: string | null;
  @ApiPropertyOptional({ example: 1000, nullable: true }) reach!: number | null;
  @ApiProperty({ example: 1200 }) impressions!: number;
  @ApiPropertyOptional({ example: '60.0000', nullable: true }) conversionRate!: string | null;
}

export class AdsCampaignCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "Raw platform status, e.g. TikTok's ENABLE/DISABLE" })
  status!: string;
  @ApiProperty({ description: 'Whether the campaign is in a running/enabled state.' })
  active!: boolean;
  @ApiProperty({ type: AdsCampaignMetricsDto })
  metrics!: AdsCampaignMetricsDto;
}

export class AdsCampaignListResponseDto {
  @ApiProperty({ enum: AdsPlatform }) platform!: AdsPlatform;
  @ApiProperty({
    description: 'False when there is no ACTIVE connection for this platform yet.',
  })
  available!: boolean;
  @ApiProperty({ example: 'MAD' }) currency!: string;
  @ApiProperty({
    type: Object,
    example: { days: 1, from: '2026-08-30T00:00:00.000Z', to: '2026-08-30T23:59:59.999Z' },
  })
  period!: { days: number; from: string; to: string };
  @ApiProperty({ type: [AdsCampaignCardDto] })
  campaigns!: AdsCampaignCardDto[];
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  dataUpdatedAt!: string | null;
}

const METRIC_KEYS = [
  'linkClicks',
  'spent',
  'results',
  'costPerResult',
  'cpm',
  'frequency',
  'ctr',
  'reach',
  'impressions',
  'conversionRate',
] as const;
export type AdsMetricKey = (typeof METRIC_KEYS)[number];
export { METRIC_KEYS };

export class AdsStatisticsQueryDto {
  @ApiPropertyOptional({ enum: ['week', 'month', 'quarter'], default: 'month' })
  @IsOptional()
  @IsIn(['week', 'month', 'quarter'])
  period?: 'week' | 'month' | 'quarter';

  @ApiPropertyOptional({ enum: METRIC_KEYS, default: 'spent' })
  @IsOptional()
  @IsIn(METRIC_KEYS)
  metric?: AdsMetricKey;
}

export class AdsPlatformBreakdownDto {
  @ApiProperty({ enum: AdsPlatform }) platform!: AdsPlatform;
  @ApiProperty({ example: 25 }) value!: number;
  @ApiProperty({ example: 25 }) sharePercentage!: number;
  @ApiProperty({ description: 'False when there is no ACTIVE connection for this platform.' })
  available!: boolean;
}

export class AdsStatisticsResponseDto {
  @ApiProperty({ enum: ['week', 'month', 'quarter'] }) period!: 'week' | 'month' | 'quarter';
  @ApiProperty({ enum: METRIC_KEYS }) metric!: AdsMetricKey;
  @ApiProperty({ example: 100 }) total!: number;
  @ApiProperty({ type: [AdsPlatformBreakdownDto] })
  byPlatform!: AdsPlatformBreakdownDto[];
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  dataUpdatedAt!: string | null;
}
