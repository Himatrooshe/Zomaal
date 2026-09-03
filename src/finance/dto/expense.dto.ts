import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

// Read-only DTOs. Nothing writes to ExpenseEntry today, so there is
// intentionally no Create/Update DTO here — see expense.controller.ts.

export class ExpenseEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ExpenseCategory }) category!: ExpenseCategory;
  @ApiProperty({ example: '250.0000' }) amount!: string;
  @ApiProperty({ example: 'MAD' }) currency!: string;
  @ApiPropertyOptional({ nullable: true, example: 102 }) quantity!: number | null;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date-time' }) incurredAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ExpenseListQueryDto {
  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Inclusive first date (incurredAt), UTC.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Inclusive last date (incurredAt), UTC.',
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

export class ExpenseListDto {
  @ApiProperty({ type: [ExpenseEntryDto] })
  data!: ExpenseEntryDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}

class ExpenseCategoryTotalDto {
  @ApiProperty({ example: '3800.0000' })
  cost!: string;
}

class ExpensePackagingTotalDto extends ExpenseCategoryTotalDto {
  @ApiProperty({ example: 102, description: 'Sum of quantity for PACKAGING entries in the period.' })
  pieces!: number;
}

export class ExpenseSummaryResponseDto {
  @ApiProperty({
    type: Object,
    example: { from: '2026-08-01', to: '2026-08-30', timezone: 'UTC' },
  })
  period!: { from: string | null; to: string | null; timezone: string };

  @ApiProperty({ example: 'MAD' })
  currency!: string;

  @ApiProperty({ example: '4238.0000' })
  totalExpenses!: string;

  @ApiProperty({
    example: '11.42',
    nullable: true,
    description: 'totalExpenses divided by confirmed order count in the same period. Null when there are no orders.',
  })
  averageCostPerOrder!: string | null;

  @ApiProperty({ type: ExpenseCategoryTotalDto })
  operational!: ExpenseCategoryTotalDto;

  @ApiProperty({ type: ExpenseCategoryTotalDto })
  purchases!: ExpenseCategoryTotalDto;

  @ApiProperty({ type: ExpensePackagingTotalDto })
  packaging!: ExpensePackagingTotalDto;

  @ApiProperty({
    type: ExpenseCategoryTotalDto,
    description: 'Sum of AdSpendEntry for the same period — see GET /finance/ad-spend/summary for the per-platform breakdown.',
  })
  advertising!: ExpenseCategoryTotalDto;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
  })
  dataUpdatedAt!: string | null;
}
