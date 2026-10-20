import {
  MonthlyTrendQueryDto,
  MonthlyTrendResponseDto,
} from '../../common/dto/monthly-trend.dto';
import {
  IsExpenseDate,
  strictInteger,
  trimExpenseText,
} from '../expense-date.util';
import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { ExpenseGroup, ExpensePaymentMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsTimeZone,
  Matches,
  ValidateIf,
  MinLength,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExpenseCategoryResponseDto } from './expense-category.dto';
import { IsPositiveAmount } from '../../common/validators/is-positive-amount.validator';
import { UnconvertedAmountDto } from '../../ads/dto/ad-spend.dto';

export class CreateExpenseDto {
  @ApiPropertyOptional({
    default: 'UTC',
    description:
      'Phone IANA timezone for a date-only spentAt; timestamps must include their own offset.',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    minLength: 8,
    maxLength: 100,
    description:
      'Creation retry key, also accepted through Idempotency-Key. Reusing it with different data returns 409.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/)
  idempotencyKey?: string;

  @ApiProperty({ example: 'Bubble wrap restock', maxLength: 120 })
  @Transform(trimExpenseText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    example: '450.00',
    pattern: '^[0-9]{1,16}([.][0-9]{1,2})?$',
    description:
      'Positive store-currency amount; at most 16 integer digits and 2 decimals.',
  })
  @IsNumberString()
  @IsPositiveAmount()
  @Matches(/^\d{1,16}(?:\.\d{1,2})?$/, {
    message: 'amount must have at most 16 integer digits and 2 decimal places',
  })
  amount!: string;

  @ApiProperty({ enum: ExpensePaymentMethod })
  @IsIn(Object.values(ExpensePaymentMethod))
  paymentMethod!: ExpensePaymentMethod;

  @ApiProperty({ description: 'ISO date this was spent.' })
  @IsExpenseDate()
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
  @IsUrl({
    require_protocol: true,
    protocols: ['http', 'https'],
    require_tld: false,
  })
  receiptUrl?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'ID returned by POST /expenses/receipts. Attaches that upload to this expense and takes precedence over receiptUrl.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  receiptAssetId?: string;
}

export class UpdateExpenseDto extends PartialType(
  OmitType(CreateExpenseDto, ['idempotencyKey'] as const),
  { skipNullProperties: false },
) {}

export class ExpenseReceiptResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'image/webp' }) contentType!: string;
  @ApiProperty({ example: 182430 }) sizeBytes!: number;
  @ApiProperty({
    example: '/expenses/receipts/6ee20108-004a-49c8-bff1-f197b7b67939',
  })
  previewPath!: string;
  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'Temporary uploads expire after 24 hours if never attached to an expense or payment.',
  })
  expiresAt!: string | null;
}

export class ExpenseListQueryDto {
  @ApiPropertyOptional({
    default: 'UTC',
    description:
      'Phone IANA timezone; send the device timezone for local calendar-day filters.',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

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
  @IsExpenseDate()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsExpenseDate()
  dateTo?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000, default: 1 })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ExpenseResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Source salary record, when linked.',
  })
  salaryPaymentId!: string | null;
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ enum: ExpensePaymentMethod })
  paymentMethod!: ExpensePaymentMethod;
  @ApiProperty() spentAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) receiptUrl!:
    | string
    | null;
  @ApiProperty({ type: ExpenseCategoryResponseDto })
  category!: ExpenseCategoryResponseDto;
  @ApiPropertyOptional({ nullable: true, type: String }) staffMemberId!:
    | string
    | null;
  @ApiProperty({
    description:
      'True for an expense linked to a confirmed salary payment. These expenses cannot be edited or deleted.',
  })
  isSalaryGenerated!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Source purchase, when the expense comes from Purchases.',
  })
  purchaseId!: string | null;
  @ApiProperty({
    description:
      'True for a Purchase costs expense owned by a purchase. Edit or delete the purchase instead.',
  })
  isPurchaseGenerated!: boolean;
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
  @ApiPropertyOptional({
    default: 'UTC',
    description:
      'Phone IANA timezone; send the device timezone for local calendar-day filters.',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsExpenseDate()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive.' })
  @IsOptional()
  @IsExpenseDate()
  dateTo?: string;
}

export class ExpenseSummaryResponseDto {
  @ApiProperty({
    type: [UnconvertedAmountDto],
    description:
      'Courier fees excluded because a real exchange rate was unavailable.',
  })
  unconvertedShippingCosts!: UnconvertedAmountDto[];

  @ApiProperty({
    description:
      'Recorded expenses plus tracked ad spend and courier financial ledger costs, in the store currency.',
  })
  totalAmount!: string;

  @ApiProperty({
    type: [ExpenseGroupTotalDto],
    description:
      'ADS is calculated live from synced ad metrics; there are no ADS expense records.',
  })
  byGroup!: ExpenseGroupTotalDto[];

  @ApiProperty({
    type: [UnconvertedAmountDto],
    description:
      'Ad spend left out of the totals because no exchange rate to the store currency was available.',
  })
  unconvertedAdSpend!: UnconvertedAmountDto[];
}

export class ExpenseTrendQueryDto extends MonthlyTrendQueryDto {
  @ApiPropertyOptional({
    default: 'UTC',
    description:
      'Phone IANA timezone for monthly grouping and the current month.',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class ExpenseTrendResponseDto extends MonthlyTrendResponseDto {
  @ApiProperty({ description: 'IANA timezone used for monthly grouping.' })
  timezone!: string;
  @ApiProperty({ type: [UnconvertedAmountDto] })
  unconvertedShippingCosts!: UnconvertedAmountDto[];
  @ApiProperty({ type: [UnconvertedAmountDto] })
  unconvertedAdSpend!: UnconvertedAmountDto[];
}
