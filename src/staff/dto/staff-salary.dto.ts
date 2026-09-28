import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  Matches,
  IsUrl,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPositiveAmount } from '../../common/validators/is-positive-amount.validator';

export class SetSalaryProfileDto {
  @ApiProperty({
    example: '3500.00',
    description: 'Base salary amount in the store currency.',
  })
  @IsNumberString()
  @IsPositiveAmount()
  @Matches(/^\d{1,16}(?:\.\d{1,2})?$/, {
    message: 'Amount must have at most 16 integer digits and 2 decimal places',
  })
  baseSalary!: string;

  @ApiProperty({ enum: SalaryFrequency })
  @IsIn(Object.values(SalaryFrequency))
  frequency!: SalaryFrequency;

  @ApiProperty({ enum: SalaryPaymentMethod })
  @IsIn(Object.values(SalaryPaymentMethod))
  paymentMethod!: SalaryPaymentMethod;

  @ApiPropertyOptional({
    enum: SalaryExpenseHandling,
    default: SalaryExpenseHandling.AUTOMATIC,
    description:
      'AUTOMATIC: confirming payment creates its expense. MANUAL: record a linked expense later. Both modes accrue recurring PENDING obligations; neither transfers money.',
  })
  @IsOptional()
  @IsIn(Object.values(SalaryExpenseHandling))
  expenseHandling?: SalaryExpenseHandling;

  @ApiProperty({ description: 'ISO date the salary schedule starts from.' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SalaryProfileResponseDto {
  @ApiProperty() baseSalary!: string;
  @ApiProperty({ enum: SalaryFrequency }) frequency!: SalaryFrequency;
  @ApiProperty({ enum: SalaryPaymentMethod })
  paymentMethod!: SalaryPaymentMethod;
  @ApiProperty({ enum: SalaryExpenseHandling })
  expenseHandling!: SalaryExpenseHandling;
  @ApiProperty() startDate!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) nextPaymentDate!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
}

export class SalaryProfileWrapperDto {
  @ApiPropertyOptional({
    nullable: true,
    type: SalaryProfileResponseDto,
    description: 'null when no salary profile has been set yet.',
  })
  profile!: SalaryProfileResponseDto | null;
}

export class CreateSalaryPaymentDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Reuse this key when retrying the same batch; use a new key for a new record.',
  })
  @IsUUID()
  idempotencyKey!: string;

  @ApiPropertyOptional({
    enum: SalaryPaymentStatus,
    default: SalaryPaymentStatus.PENDING,
  })
  @IsOptional()
  @IsIn(Object.values(SalaryPaymentStatus))
  status?: SalaryPaymentStatus;

  @ApiPropertyOptional({
    enum: SalaryExpenseHandling,
    description:
      'Defaults to the staff salary profile, or AUTOMATIC without one.',
  })
  @IsOptional()
  @IsIn(Object.values(SalaryExpenseHandling))
  expenseHandling?: SalaryExpenseHandling;

  @ApiPropertyOptional({
    enum: SalaryFrequency,
    description:
      'Snapshot for this record; does not create or change a recurring profile.',
  })
  @IsOptional()
  @IsIn(Object.values(SalaryFrequency))
  frequency?: SalaryFrequency;
  @ApiProperty({
    type: [String],
    description:
      'Staff members to pay in this batch (Select Staff Member screen — usually one, but supports multi-select).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  staffMemberIds!: string[];

  @ApiPropertyOptional({
    description:
      "Amount per staff member. Defaults to each staff member's configured base salary when omitted.",
  })
  @IsOptional()
  @IsNumberString()
  @IsPositiveAmount()
  @Matches(/^\d{1,16}(?:\.\d{1,2})?$/, {
    message: 'Amount must have at most 16 integer digits and 2 decimal places',
  })
  amount?: string;

  @ApiProperty({
    description:
      'Salary due date in UTC. One obligation per staff member per date.',
  })
  @IsDateString()
  paymentDate!: string;

  @ApiProperty({ enum: SalaryPaymentMethod })
  @IsIn(Object.values(SalaryPaymentMethod))
  paymentMethod!: SalaryPaymentMethod;

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
    protocols: ['https', 'http'],
    require_tld: false,
  })
  @MaxLength(2048)
  receiptUrl?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'ID returned by POST /expenses/receipts. Attaches that upload to the first payment created in this batch and takes precedence over receiptUrl.',
  })
  @IsOptional()
  @IsUUID()
  receiptAssetId?: string;
}

export class SalaryPaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() staffMemberId!: string;
  @ApiProperty() staffName!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() paymentDate!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) paidAt!: string | null;
  @ApiProperty({ enum: SalaryPaymentMethod })
  paymentMethod!: SalaryPaymentMethod;
  @ApiProperty({
    enum: SalaryPaymentStatus,
    description:
      'Stored status (PENDING | PAID). Prefer displayStatus for UI chips.',
  })
  status!: SalaryPaymentStatus;

  @ApiProperty({
    enum: ['PAID', 'PENDING', 'OVERDUE'],
    description:
      'Derived for the UI. OVERDUE = PENDING with paymentDate before today in UTC — never stored.',
  })
  displayStatus!: 'PAID' | 'PENDING' | 'OVERDUE';

  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) receiptUrl!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, type: String }) photoUrl!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, type: String }) jobTitle!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, enum: SalaryFrequency })
  frequency!: SalaryFrequency | null;
  @ApiPropertyOptional({ nullable: true, type: String }) nextPaymentDate!:
    | string
    | null;
  @ApiProperty({ enum: SalaryExpenseHandling })
  expenseHandling!: SalaryExpenseHandling;
  @ApiPropertyOptional({ nullable: true, type: String }) expenseId!:
    | string
    | null;
  @ApiProperty() expenseRecorded!: boolean;
}

export class SalaryPaymentBatchResponseDto {
  @ApiProperty({ type: [SalaryPaymentResponseDto] })
  payments!: SalaryPaymentResponseDto[];
}

export class SalaryPaymentListResponseDto {
  @ApiProperty({ type: [SalaryPaymentResponseDto] })
  payments!: SalaryPaymentResponseDto[];

  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class SalaryPaymentListQueryDto {
  @ApiPropertyOptional({
    enum: ['PAID', 'PENDING', 'OVERDUE'],
    description: 'Filter by derived display status (All when omitted).',
  })
  @IsOptional()
  @IsIn(['PAID', 'PENDING', 'OVERDUE'])
  status?: 'PAID' | 'PENDING' | 'OVERDUE';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(100)
  @Min(1)
  limit?: number = 20;
}

export class SalarySummaryResponseDto {
  @ApiProperty() currency!: string;
  @ApiProperty({
    description: 'Sum of PAID salary payments (store currency, 2 dp).',
  })
  totalSalaryPaid!: string;

  @ApiProperty({
    description: 'Count of payments whose displayStatus is PENDING or OVERDUE.',
  })
  pendingPaymentCount!: number;

  @ApiProperty({
    description:
      'Sum of PENDING + OVERDUE payment amounts (store currency, 2 dp).',
  })
  pendingPaymentsTotal!: string;
}

export class ConfirmSalaryPaymentDto {
  @ApiPropertyOptional({
    description:
      'Actual payment timestamp, defaults to now. Cannot be in the future.',
  })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({ enum: SalaryPaymentMethod })
  @IsOptional()
  @IsIn(Object.values(SalaryPaymentMethod))
  paymentMethod?: SalaryPaymentMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  receiptAssetId?: string;
}

export class SalaryAnnualQueryDto {
  @ApiPropertyOptional({
    minimum: 2000,
    maximum: 2100,
    description: 'UTC calendar year, defaults to current year.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class SalaryAnnualSummaryDto {
  @ApiProperty() year!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({
    description: 'Actual PAID amounts by paidAt within this year.',
  })
  totalPaidThisYear!: string;
  @ApiProperty({
    description:
      'Unpaid records due in this year plus not-yet-created scheduled obligations.',
  })
  remainingPayments!: number;
  @ApiProperty() remainingAmount!: string;
  @ApiProperty({
    description:
      'Paid this year + unpaid/projected obligations; not a fixed annual commitment.',
  })
  annualTotal!: string;
  @ApiProperty() projected!: boolean;
}
