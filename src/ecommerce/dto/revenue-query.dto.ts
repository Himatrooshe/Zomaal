import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class RevenueRangeQueryDto {
  @ApiPropertyOptional({
    description:
      'Inclusive first reporting date in the requested timezone. Omit for an all-time summary.',
    example: '2026-07-01',
    pattern: DATE_PATTERN.source,
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  from?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive last reporting date in the requested timezone. Omit for an all-time summary.',
    example: '2026-07-31',
    pattern: DATE_PATTERN.source,
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  to?: string;

  @ApiPropertyOptional({
    description:
      'IANA timezone used for date boundaries and daily grouping. Times are stored in UTC.',
    default: 'UTC',
    example: 'Africa/Casablanca',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone: string = 'UTC';
}
