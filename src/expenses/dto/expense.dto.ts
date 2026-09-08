import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ExpenseGroup, ExpensePaymentMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExpenseCategoryResponseDto } from './expense-category.dto';
import { IsPositiveAmount } from '../../common/validators/is-positive-amount.validator';

export class CreateExpenseDto {
  @ApiProperty({ example: 'Bubble wrap restock', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: '450.00' })
  @IsNumberString()
  @IsPositiveAmount()
  amount!: string;

  @ApiProperty({ enum: ExpensePaymentMethod })
  @IsIn(Object.values(ExpensePaymentMethod))
  paymentMethod!: ExpensePaymentMethod;

  @ApiProperty({ description: 'ISO date this was spent.' })
  @IsDateString()
  spentAt!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'A raw external receipt URL. Ignored when receiptAssetId is also provided — upload through POST /expenses/receipts instead.',
  })
  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'ID returned by POST /expenses/receipts. Attaches that upload to this expense and takes precedence over receiptUrl.',
  })
  @IsOptional()
  @IsUUID()
  receiptAssetId?: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class ExpenseReceiptResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'image/webp' }) contentType!: string;
  @ApiProperty({ example: 182430 }) sizeBytes!: number;
  @ApiProperty({ example: '/expenses/receipts/6ee20108-004a-49c8-bff1-f197b7b67939' })
  previewPath!: string;
  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'Temporary uploads expire after 24 hours if never attached to an expense or payment.',
  })
  expiresAt!: string | null;
}

export class ExpenseListQueryDto {
  @ApiPropertyOptional({ description: 'Matches title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ExpenseGroup })
  @IsOptional()
  @IsIn(Object.values(ExpenseGroup))
  group?: ExpenseGroup;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

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

export class ExpenseResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ enum: ExpensePaymentMethod }) paymentMethod!: ExpensePaymentMethod;
  @ApiProperty() spentAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) receiptUrl!: string | null;
  @ApiProperty({ type: ExpenseCategoryResponseDto }) category!: ExpenseCategoryResponseDto;
  @ApiPropertyOptional({ nullable: true, type: String }) staffMemberId!: string | null;
  @ApiProperty({
    description: 'True for expenses generated from a staff salary payment — edit/delete from Staff Salary instead.',
  })
  isSalaryGenerated!: boolean;
  @ApiProperty() createdAt!: string;
}

export class ExpenseListResponseDto {
  @ApiProperty({ type: [ExpenseResponseDto] }) expenses!: ExpenseResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() totalAmount!: string;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class ExpenseGroupTotalDto {
  @ApiProperty({ enum: ExpenseGroup }) group!: ExpenseGroup;
  @ApiProperty() total!: string;
}

export class ExpenseSummaryQueryDto {
  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class ExpenseSummaryResponseDto {
  @ApiProperty() totalAmount!: string;
  @ApiProperty({ type: [ExpenseGroupTotalDto] }) byGroup!: ExpenseGroupTotalDto[];
}
