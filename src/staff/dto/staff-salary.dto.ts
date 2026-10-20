import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  Matches,
  IsUrl,
  ArrayUnique,
  IsArray,
  IsTimeZone,
  ValidateIf,
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
import { MonthlyTrendQueryDto } from '../../common/dto/monthly-trend.dto';
import { IsCalendarDate, strictInteger } from '../../common/calendar-date.util';
import { IsPositiveAmount } from '../../common/validators/is-positive-amount.validator';

export class SalaryTimezoneQueryDto {
  @ApiPropertyOptional({
    description: 'Phone IANA timezone; defaults to UTC for compatibility.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsTimeZone()
  timezone?: string;
}
export class SalaryTrendQueryDto extends MonthlyTrendQueryDto {
  @ApiPropertyOptional({
    description:
      'Phone IANA timezone for paid-month grouping; defaults to UTC.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsTimeZone()
  timezone?: string;
}

export class SetSalaryProfileDto extends SalaryTimezoneQueryDto {
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
      'AUTOMATIC: the scheduler marks the due salary PAID and creates its linked expense. MANUAL: the scheduler creates a PENDING obligation; the owner records the expense to mark it PAID.',
  })
  @IsOptional()
  @IsIn(Object.values(SalaryExpenseHandling))
  expenseHandling?: SalaryExpenseHandling;

  @ApiProperty({
    description:
      'Calendar date the salary schedule starts from in its saved timezone.',
  })
  @IsCalendarDate()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SalaryProfileResponseDto {
  @ApiProperty({
    description:
      'Saved IANA schedule timezone. Due dates are calendar labels encoded at UTC midnight.',
  })
  timezone!: string;
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

export class CreateSalaryPaymentDto extends SalaryTimezoneQueryDto {
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
      'Salary due calendar date. Date-only input retains its label; timestamps use the supplied timezone, default UTC. One obligation per staff member per calendar date.',
  })
  @IsCalendarDate()
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
      'Derived for the UI. OVERDUE = PENDING with paymentDate before today in the requested timezone — never stored.',
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

export class SalaryPaymentListQueryDto extends SalaryTimezoneQueryDto {
  @ApiPropertyOptional({
    enum: ['PAID', 'PENDING', 'OVERDUE'],
    description: 'Filter by derived display status (All when omitted).',
  })
  @IsOptional()
  @IsIn(['PAID', 'PENDING', 'OVERDUE'])
  status?: 'PAID' | 'PENDING' | 'OVERDUE';

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

export class ConfirmSalaryPaymentDto extends SalaryTimezoneQueryDto {
  @ApiPropertyOptional({
    description:
      'Actual payment timestamp, defaults to now. Cannot be in the future.',
  })
  @IsOptional()
  @IsCalendarDate()
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

export class SalaryAnnualQueryDto extends SalaryTimezoneQueryDto {
  @ApiPropertyOptional({
    minimum: 2000,
    maximum: 2100,
    description:
      'Phone-local calendar year for payouts; defaults to the current year in the requested timezone.',
  })
  @IsOptional()
  @Transform(strictInteger)
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
