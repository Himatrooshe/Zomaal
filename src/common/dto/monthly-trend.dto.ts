import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class MonthlyTrendQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 24,
    default: 6,
    description: 'How many months to include, ending at the current month.',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number = 6;
}

export class MonthlyTrendPointDto {
  @ApiProperty({ example: '2026-09', description: 'UTC year-month.' })
  month!: string;

  @ApiProperty({ example: '4250.00' })
  total!: string;
}

export class MonthlyTrendDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Percent change of the most recent month vs the one before it. Null when the prior month was zero and this one is not — growth from a zero baseline has no defined percentage.',
  })
  changePercent!: number | null;

  @ApiProperty({ enum: ['up', 'down', 'flat'] })
  direction!: 'up' | 'down' | 'flat';
}

export class MonthlyTrendResponseDto {
  @ApiProperty({
    type: [MonthlyTrendPointDto],
    description: 'Oldest first. Every month in range appears even if its total is zero.',
  })
  points!: MonthlyTrendPointDto[];

  @ApiProperty({ type: MonthlyTrendDto })
  trend!: MonthlyTrendDto;
}
