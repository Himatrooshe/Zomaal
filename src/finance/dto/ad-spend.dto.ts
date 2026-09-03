import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdPlatform } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

// Read-only DTOs. No Meta/TikTok/Google/Snapchat account connection exists
// yet, so there is intentionally no Create/Update DTO here — see
// ad-spend.controller.ts for why.

export class AdSpendEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AdPlatform }) platform!: AdPlatform;
  @ApiProperty({ example: '38.0000' }) amount!: string;
  @ApiProperty({ example: 'MAD' }) currency!: string;
  @ApiPropertyOptional({ nullable: true, example: 510 }) results!: number | null;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date-time' }) spentAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class AdSpendListQueryDto {
  @ApiPropertyOptional({ enum: AdPlatform })
  @IsOptional()
  @IsEnum(AdPlatform)
  platform?: AdPlatform;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Inclusive first date (spentAt), UTC.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Inclusive last date (spentAt), UTC.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AdSpendListDto {
  @ApiProperty({ type: [AdSpendEntryDto] })
  data!: AdSpendEntryDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}

export class AdPlatformSummaryDto {
  @ApiProperty({ enum: AdPlatform })
  platform!: AdPlatform;

  @ApiProperty({ example: 0 })
  results!: number;

  @ApiProperty({ example: '0.0000' })
  spend!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'spend / results. Null when results is 0.',
  })
  costPerResult!: string | null;
}

export class AdSpendSummaryResponseDto {
  @ApiProperty({
    example: false,
    description:
      'True once at least one ad platform account is connected and has reported spend for ' +
      'this period. No connect flow exists yet, so this is always false today — every field ' +
      'below is a real zero, never a placeholder.',
  })
  available!: boolean;

  @ApiProperty({
    type: Object,
    example: { from: '2026-08-01', to: '2026-08-30', timezone: 'UTC' },
  })
  period!: { from: string | null; to: string | null; timezone: string };

  @ApiProperty({ example: 'MAD' })
  currency!: string;

  @ApiProperty({ example: '0.0000' })
  totalSpend!: string;

  @ApiProperty({ example: 0 })
  totalResults!: number;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'totalSpend / totalResults. Null when totalResults is 0.',
  })
  averageCostPerResult!: string | null;

  @ApiProperty({ type: [AdPlatformSummaryDto] })
  byPlatform!: AdPlatformSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
  })
  dataUpdatedAt!: string | null;
}
