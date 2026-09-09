import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AddToBlacklistDto {
  @ApiPropertyOptional({
    description:
      'Reason shown on the Add to Blacklist confirmation. Auto-filled from the risk score breakdown when omitted.',
    example: '3 returns, 1 cancellation',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RiskProximityDto {
  @ApiProperty({
    enum: ['returns', 'cancellations', 'refusals', 'noAnswer', 'combined'],
    example: 'returns',
  })
  category!: 'returns' | 'cancellations' | 'refusals' | 'noAnswer' | 'combined';

  @ApiProperty({ example: 2 }) current!: number;
  @ApiProperty({ example: 3 }) limit!: number;
  @ApiProperty({
    example: 1,
    description: 'Actions remaining until auto-blacklist.',
  })
  remaining!: number;
}

export class AtRiskCustomerDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  id!: string;

  @ApiProperty({ example: '+8801400715037' })
  phone!: string;

  @ApiProperty({ example: 'Ahamed Rifat', nullable: true, type: String })
  name!: string | null;

  @ApiProperty() riskProximity!: RiskProximityDto;
}

export class BlacklistedCustomerDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  id!: string;

  @ApiProperty({ example: '+8801400715037' })
  phone!: string;

  @ApiProperty({ example: 'Ahamed Rifat', nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ example: 3 }) returnsCount!: number;
  @ApiProperty({ example: 1 }) cancellationsCount!: number;
  @ApiProperty({ example: 0 }) refusalsCount!: number;
  @ApiProperty({ example: 0 }) noAnswerCount!: number;

  @ApiProperty({ example: '2026-04-20T00:00:00.000Z', format: 'date-time' })
  blacklistedAt!: string;
}

export class BlacklistScreenResponseDto {
  @ApiProperty({ example: 24 }) totalBlacklisted!: number;
  @ApiProperty({ type: [AtRiskCustomerDto] })
  atRiskCustomers!: AtRiskCustomerDto[];
  @ApiProperty({ type: [BlacklistedCustomerDto] })
  blacklistedCustomers!: BlacklistedCustomerDto[];
}

export class BlacklistSettingsDto {
  @ApiProperty({
    example: 3,
    description: '0 = this category never triggers auto-blacklist on its own.',
  })
  returnsLimit!: number;

  @ApiProperty({ example: 0 }) cancellationsLimit!: number;
  @ApiProperty({ example: 0 }) refusalsLimit!: number;
  @ApiProperty({ example: 0 }) noAnswerLimit!: number;

  @ApiProperty({
    example: true,
    description:
      'When true, auto-blacklist triggers off combinedLimit (sum of all four counters) instead of each category’s own limit.',
  })
  useCombinedLimit!: boolean;

  @ApiProperty({ example: 4 }) combinedLimit!: number;

  @ApiProperty({
    example: true,
    description:
      'Show a warning when a blacklisted customer places a new order.',
  })
  warnOnNewOrder!: boolean;
}

export class UpdateBlacklistSettingsDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  returnsLimit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationsLimit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  refusalsLimit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  noAnswerLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useCombinedLimit?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  combinedLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  warnOnNewOrder?: boolean;
}
